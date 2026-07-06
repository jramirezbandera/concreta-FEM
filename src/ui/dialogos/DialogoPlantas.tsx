import { useEffect, useRef, useState } from "react";
import { Dialogo } from "./Dialogo";
import {
  validarPlanta,
  esValido,
  type ErrorCampo,
} from "./validacionesDialogo";
import { Campo, CampoNumero, SelectUso, Boton, formatearQk } from "../primitivas";
import { detectarIncoherenciasCotas } from "./coherenciaCotas";
import {
  modeloStore,
  vistaStore,
  crearPlanta,
  editarPlanta,
  eliminarPlanta,
} from "../../estado";
import type { CategoriaUso, Modelo } from "../../dominio";
import { categoriaUso } from "../../biblioteca";
import "./dialogos.css";
import "./gruposPlantas.css";

// DialogoPlantas (F3.4, "plantas sin grupos"; sustituye a DialogoGruposYPlantas de
// feature-10): maestro-detalle con COMMIT EN VIVO. A la izquierda la lista de
// plantas del edificio (orden CYPECAD: mayor cota arriba); al seleccionar una, sus
// campos a la derecha — incluidos el uso y las cargas superficiales, que desde v4
// viven en la PLANTA (no en un grupo). Cada edicion despacha su comando al
// instante (no hay boton "Guardar"). Cero jerga FEM.
//
// INVARIANTE DEL `base` (CLAUDE.md §10 / comando.ts): los comandos se construyen
// SIEMPRE contra el modelo ACTUAL leido justo antes de ejecutar. Nunca se retiene
// el modelo entre ediciones. Por eso usamos `modeloStore.getState().getModelo()`
// dentro de cada handler y no la copia del render.

// Datos por defecto de una planta nueva (razonables para uso residencial).
// `sobrecargaUso` arranca cableada al qk normativo de la categoria por defecto
// (CTE DB-SE-AE Tabla 3.1 via biblioteca/acciones), igual que al cambiar la
// categoria en vivo: no hay numero magico que pueda divergir de la tabla.
const CATEGORIA_DEFECTO: CategoriaUso = "A";
const CARGAS_DEFECTO = {
  categoriaUso: CATEGORIA_DEFECTO,
  sobrecargaUso: categoriaUso(CATEGORIA_DEFECTO).qk,
  cargasMuertas: 1,
};

// Lee el modelo ACTUAL del store. Se llama justo antes de cada comando para no
// retener el modelo entre ediciones (invariante del `base`).
function leerModelo() {
  return modeloStore.getState().getModelo();
}

// --- Subcomponente: input de TEXTO controlado-local con commit en blur --------
// Mantiene estado LOCAL mientras se teclea (no despacha por tecla). Se resincroniza
// con el valor entrante si cambia desde fuera (otra edicion, undo). En blur llama
// onCommit(valor); el padre valida y decide si despacha. `error` lo provee el padre.
interface CampoTextoProps {
  etiqueta: string;
  valor: string;
  onCommit: (v: string) => void;
  error?: string;
}

function CampoTexto({ etiqueta, valor, onCommit, error }: CampoTextoProps) {
  const [local, setLocal] = useState(valor);
  // Resincroniza cuando cambia el valor del modelo (p. ej. tras undo o al cambiar
  // de elemento seleccionado): el input refleja la fuente de verdad.
  useEffect(() => {
    setLocal(valor);
  }, [valor]);
  // UX-C8: bandera para que el blur que dispara Escape NO commitee (mismo motivo que
  // en CampoNumero: al hacer blur() se dispararia onBlur con el `local` aun sin
  // resincronizar). Escape revierte sin guardar.
  const revirtiendo = useRef(false);
  return (
    <Campo
      etiqueta={etiqueta}
      value={local}
      error={error}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (revirtiendo.current) {
          revirtiendo.current = false;
          return;
        }
        onCommit(local);
      }}
      // UX-C8: mismo contrato de teclado que CampoNumero. Enter -> blur (commit en
      // onBlur). Escape -> descarta lo tecleado (resincroniza con el valor del
      // modelo) y hace blur SIN commit; detiene la propagacion para que ESE Esc no
      // cierre el dialogo (Radix cierra con Escape en el contenido).
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          revirtiendo.current = true;
          setLocal(valor);
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// Busca el mensaje de un campo concreto en una lista de errores de validacion.
function errorDe(errores: ErrorCampo[], campo: string): string | undefined {
  return errores.find((e) => e.campo === campo)?.mensaje;
}

// Cuenta lo que ARRASTRARIA borrar una planta: misma regla que purgarPlantas
// (comandosModelo) — pilares que tocan esa planta, vigas y paños de esa planta y
// cargas sobre la planta/pilar/viga/paño. Sirve para avisar del alcance del
// borrado antes de confirmarlo (diseno para la confianza, revision F10).
function contarArrastre(modelo: Modelo, plantaIds: Set<string>) {
  const pilares = modelo.pilares.filter(
    (p) => plantaIds.has(p.plantaInicial) || plantaIds.has(p.plantaFinal),
  );
  const idsPilar = new Set(pilares.map((p) => p.id));
  const vigas = modelo.vigas.filter((v) => plantaIds.has(v.plantaId));
  const idsViga = new Set(vigas.map((v) => v.id));
  const panos = modelo.panos.filter((pa) => plantaIds.has(pa.plantaId));
  const idsPano = new Set(panos.map((pa) => pa.id));
  const cargas = modelo.cargas.filter(
    (c) =>
      plantaIds.has(c.ambito) ||
      idsPilar.has(c.ambito) ||
      idsViga.has(c.ambito) ||
      idsPano.has(c.ambito),
  );
  return {
    pilares: pilares.length,
    vigas: vigas.length,
    panos: panos.length,
    cargas: cargas.length,
  };
}

// Frase en lenguaje de obra del alcance del borrado (solo las partes con count > 0,
// con singular/plural). P. ej. "8 pilares, 4 vigas y 1 paño".
function fraseArrastre(partes: {
  pilares: number;
  vigas: number;
  panos: number;
  cargas: number;
}): string {
  const trozos: string[] = [];
  const add = (n: number, sing: string, plur: string) => {
    if (n) trozos.push(`${n} ${n === 1 ? sing : plur}`);
  };
  add(partes.pilares, "pilar", "pilares");
  add(partes.vigas, "viga", "vigas");
  add(partes.panos, "paño", "paños");
  add(partes.cargas, "carga", "cargas");
  if (trozos.length <= 1) return trozos[0] ?? "";
  return `${trozos.slice(0, -1).join(", ")} y ${trozos[trozos.length - 1]}`;
}

export function DialogoPlantas() {
  // Lectura reactiva del modelo (el dialogo no esta en el bucle del viewport; el
  // re-render al editar es aceptable). Selectores de campos sueltos.
  const plantas = modeloStore((s) => s.modelo.plantas);
  const panos = modeloStore((s) => s.modelo.panos);

  const dialogoActivo = vistaStore((s) => s.dialogoActivo);
  const plantaActivaId = vistaStore((s) => s.plantaActivaId);
  const setPlantaActiva = vistaStore((s) => s.setPlantaActiva);
  const cerrarDialogo = vistaStore((s) => s.cerrarDialogo);

  const open = dialogoActivo === "plantas";

  // Errores de validacion campo a campo de la planta seleccionada. Se limpian y
  // actualizan en cada commit; NO bloquean el teclear (el estado local del input es
  // libre).
  const [errores, setErrores] = useState<ErrorCampo[]>([]);
  // Confirmacion de borrado destructivo (solo cuando arrastra dependientes). null =
  // sin confirmacion abierta. onConfirmar ejecuta el borrado real.
  const [confirmacion, setConfirmacion] = useState<{
    titulo: string;
    mensaje: string;
    onConfirmar: () => void;
  } | null>(null);

  const plantaActiva = plantas.find((p) => p.id === plantaActivaId) ?? null;

  // --- Acciones ---------------------------------------------------------------
  const nuevaPlanta = () => {
    const m = leerModelo();
    // Cota sugerida: la cabeza de la planta mas alta (cota max + su altura), o 0
    // para la primera planta del edificio.
    let cotaSugerida = 0;
    if (m.plantas.length > 0) {
      const masAlta = m.plantas.reduce((a, b) => (b.cota > a.cota ? b : a));
      cotaSugerida = masAlta.cota + masAlta.altura;
    }
    // Recien creada por diferencia de ids (no por posicion en la lista).
    const idsPrevios = new Set(m.plantas.map((p) => p.id));
    modeloStore
      .getState()
      .ejecutar(crearPlanta(m, { cota: cotaSugerida, altura: 3, ...CARGAS_DEFECTO }));
    const creada = leerModelo().plantas.find((p) => !idsPrevios.has(p.id));
    if (creada) setPlantaActiva(creada.id);
    // Limpia errores de la planta anterior: la nueva es valida y no debe heredar
    // un mensaje obsoleto (p. ej. un nombre duplicado de la que estaba activa).
    setErrores([]);
  };

  const ejecutarBorrarPlanta = (plantaId: string) => {
    modeloStore.getState().ejecutar(eliminarPlanta(leerModelo(), plantaId));
    if (plantaActivaId === plantaId) {
      setPlantaActiva(leerModelo().plantas[0]?.id ?? null);
    }
    setErrores([]);
  };

  const borrarPlanta = (plantaId: string) => {
    const m = leerModelo();
    const planta = m.plantas.find((p) => p.id === plantaId);
    const arrastre = contarArrastre(m, new Set([plantaId]));
    const total = arrastre.pilares + arrastre.vigas + arrastre.panos + arrastre.cargas;
    if (total === 0) {
      ejecutarBorrarPlanta(plantaId);
      return;
    }
    const frase = fraseArrastre(arrastre);
    setConfirmacion({
      titulo: `Eliminar ${planta?.nombre ?? "la planta"}`,
      mensaje: `Se eliminará también ${frase}. Podrás deshacerlo con Ctrl+Z.`,
      onConfirmar: () => ejecutarBorrarPlanta(plantaId),
    });
  };

  // Commit de un campo de la planta activa. `cambiosRaw` es el parcial editado; el
  // resto de campos se toma de la planta actual para validar el conjunto.
  const editarCampoPlanta = (cambiosRaw: {
    nombre?: string;
    cota?: number;
    altura?: number;
    sobrecargaUso?: number;
    cargasMuertas?: number;
  }) => {
    if (!plantaActiva) return;
    const m = leerModelo();
    const planta = m.plantas.find((p) => p.id === plantaActiva.id);
    if (!planta) return;
    // Nombre sin espacios al borde (no burlar el chequeo de duplicados, que valida
    // trimeado).
    const cambios =
      cambiosRaw.nombre !== undefined
        ? { ...cambiosRaw, nombre: cambiosRaw.nombre.trim() }
        : cambiosRaw;
    const datos = {
      nombre: cambios.nombre ?? planta.nombre,
      cota: cambios.cota ?? planta.cota,
      altura: cambios.altura ?? planta.altura,
      sobrecargaUso: cambios.sobrecargaUso ?? planta.sobrecargaUso,
      cargasMuertas: cambios.cargasMuertas ?? planta.cargasMuertas,
    };
    // La finitud y el signo los valida validarPlanta (regla centralizada en el
    // modulo puro): numero no finito -> error del campo, sin despachar. CampoNumero
    // ya manda NaN cuando el campo se vacia. Solo reflejamos los errores de los
    // CAMPOS editados en este commit (los demas conservan su estado).
    const errs = validarPlanta(m, planta.id, datos);
    const camposEditados = new Set(Object.keys(cambios));
    setErrores((prev) => [
      ...prev.filter((e) => !camposEditados.has(e.campo)),
      ...errs.filter((e) => camposEditados.has(e.campo)),
    ]);
    if (!esValido(errs.filter((e) => camposEditados.has(e.campo)))) return;
    // No-op: si los campos editados ya tienen ese valor, no ensucies el undo.
    const sinCambio = (Object.keys(cambios) as (keyof typeof cambios)[]).every(
      (k) => cambios[k] === undefined || cambios[k] === planta[k],
    );
    if (sinCambio) return;
    modeloStore.getState().ejecutar(editarPlanta(m, planta.id, cambios));
  };

  // Cambiar la categoria de uso RE-ASIGNA la sobrecarga al qk normativo de esa
  // categoria (CTE DB-SE-AE Tabla 3.1, via biblioteca/acciones), como CYPECAD:
  // ambos campos van en la MISMA edicion (un solo comando, un solo undo). Las
  // ediciones manuales posteriores de `sobrecargaUso` persisten hasta el siguiente
  // cambio de categoria (override manual permitido).
  const editarCategoria = (categoria: CategoriaUso) => {
    if (!plantaActiva) return;
    if (categoria === plantaActiva.categoriaUso) return; // no-op
    const m = leerModelo();
    const sobrecargaUso = categoriaUso(categoria).qk;
    modeloStore
      .getState()
      .ejecutar(
        editarPlanta(m, plantaActiva.id, { categoriaUso: categoria, sobrecargaUso }),
      );
    // El campo de sobrecarga acaba de cambiar por debajo: limpia un posible error
    // previo de ese campo (el qk normativo es siempre valido).
    setErrores((prev) => prev.filter((e) => e.campo !== "sobrecargaUso"));
  };

  // Plantas de mayor a menor cota (orden CYPECAD descendente, como el Sidebar).
  const plantasOrdenadasDesc = plantas.slice().sort((a, b) => b.cota - a.cota);

  // UX-D3 (D16): avisos NO bloqueantes de incoherencia cota/altura entre plantas
  // consecutivas (hueco o solape: cota_i + altura_i != cota de la siguiente). El
  // helper es puro y ordena por cota ascendente por su cuenta. Informativo, no
  // impide editar ni calcular: cotas y alturas son campos independientes a
  // proposito (retranqueos, dobles alturas).
  const avisosCotas = detectarIncoherenciasCotas(plantas);

  // Honestidad (F3.4): la nota de las cargas dice la VERDAD de esta planta. Con
  // paños, se aplican sobre ellos; sin paños, NO entran en el calculo (el mismo
  // hecho que avisa PLANTA_CARGA_SIN_PANO al calcular).
  const plantaTienePanos =
    plantaActiva !== null && panos.some((pa) => pa.plantaId === plantaActiva.id);

  const pie = (
    <Boton variante="ghost" onClick={cerrarDialogo}>
      Cerrar
    </Boton>
  );

  return (
    <>
      <Dialogo
        open={open}
        onOpenChange={(o) => {
          if (!o) cerrarDialogo();
        }}
        titulo="Plantas"
        pie={pie}
      >
        <div className="cx-gyp">
          {/* --- Maestro: lista de plantas --- */}
          <div className="cx-gyp__maestro">
            <div className="cx-gyp__maestro-head">
              <span className="cx-gyp__seccion-titulo">Plantas</span>
              <Boton variante="primary" onClick={nuevaPlanta}>
                Nueva planta
              </Boton>
            </div>
            <div className="cx-gyp__lista">
              {plantasOrdenadasDesc.length === 0 ? (
                <div className="cx-gyp__vacio">
                  Aún no hay plantas. Crea la primera para empezar a colocar
                  pilares.
                </div>
              ) : (
                plantasOrdenadasDesc.map((p) => {
                  const clases = [
                    "cx-gyp__item",
                    "cx-gyp__item--con-tag",
                    p.id === plantaActivaId && "cx-gyp__item--sel",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={clases}
                      aria-pressed={p.id === plantaActivaId}
                      onClick={() => {
                        setPlantaActiva(p.id);
                        setErrores([]);
                      }}
                    >
                      <span className="cx-gyp__item-nombre">{p.nombre}</span>
                      <span className="cx-gyp__item-tag">{p.cota.toFixed(2)} m</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* --- Detalle: planta activa --- */}
          <div className="cx-gyp__detalle">
            {!plantaActiva ? (
              <div className="cx-gyp__vacio">Crea una planta para empezar.</div>
            ) : (
              <>
                <div className="cx-gyp__grupo-campos">
                  <div className="cx-gyp__campo-ancho">
                    <CampoTexto
                      etiqueta="Nombre"
                      valor={plantaActiva.nombre}
                      onCommit={(v) => editarCampoPlanta({ nombre: v })}
                      error={errorDe(errores, "nombre")}
                    />
                  </div>
                  <CampoNumero
                    etiqueta="Cota"
                    sufijo="m"
                    valor={plantaActiva.cota}
                    onCommit={(v) => editarCampoPlanta({ cota: v })}
                    error={errorDe(errores, "cota")}
                  />
                  <CampoNumero
                    etiqueta="Altura"
                    sufijo="m"
                    valor={plantaActiva.altura}
                    onCommit={(v) => editarCampoPlanta({ altura: v })}
                    error={errorDe(errores, "altura")}
                  />
                  <div className="cx-gyp__campo-ancho">
                    <SelectUso
                      etiqueta="Categoría de uso"
                      valor={plantaActiva.categoriaUso}
                      onCambio={editarCategoria}
                    />
                    {/* UX-D2: nota contextual bajo el selector. Cambiar la categoria
                        reasigna la sobrecarga al qk normativo (editarCategoria): sin
                        esta linea el override se haria en silencio. */}
                    <p className="cx-note">
                      La categoría {plantaActiva.categoriaUso} fija{" "}
                      {formatearQk(categoriaUso(plantaActiva.categoriaUso).qk)} kN/m²
                      (CTE DB-SE-AE).
                    </p>
                  </div>
                  <CampoNumero
                    etiqueta="Sobrecarga de uso"
                    sufijo="kN/m²"
                    valor={plantaActiva.sobrecargaUso}
                    onCommit={(v) => editarCampoPlanta({ sobrecargaUso: v })}
                    error={errorDe(errores, "sobrecargaUso")}
                  />
                  <CampoNumero
                    etiqueta="Cargas muertas"
                    sufijo="kN/m²"
                    valor={plantaActiva.cargasMuertas}
                    onCommit={(v) => editarCampoPlanta({ cargasMuertas: v })}
                    error={errorDe(errores, "cargasMuertas")}
                  />
                  {/* Nota de HONESTIDAD (F3.4): estos valores solo llegan al calculo
                      a traves de los paños de la planta. Sin paños, decirlo aqui
                      evita la sorpresa (ademas del aviso PLANTA_CARGA_SIN_PANO al
                      calcular). */}
                  <p className="cx-note cx-gyp__campo-ancho">
                    {plantaTienePanos
                      ? "Estos valores se aplican automáticamente como carga superficial sobre los paños de esta planta (las cargas muertas como permanente y la sobrecarga de uso como variable)."
                      : "Esta planta no tiene paños: estos valores no entran en el cálculo hasta que introduzcas un paño (o aplica cargas lineales sobre las vigas)."}
                  </p>
                </div>

                {/* UX-D3 (D16): avisos de coherencia cota/altura. NO bloqueantes
                    (role=status, --warning): informan de huecos/solapes entre plantas
                    consecutivas sin impedir editar ni calcular. Uno por par incoherente. */}
                {avisosCotas.length > 0 ? (
                  <div className="cx-gyp__avisos-cotas" role="status">
                    {avisosCotas.map((a) => (
                      <p key={a.plantaInferiorId} className="cx-gyp__aviso-cota">
                        {a.mensaje}
                      </p>
                    ))}
                  </div>
                ) : null}

                {/* Eliminar la planta activa (al pie del detalle). */}
                <div>
                  <button
                    type="button"
                    className="cx-gyp__borrar"
                    onClick={() => borrarPlanta(plantaActiva.id)}
                  >
                    Eliminar planta
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </Dialogo>

      {/* Confirmacion de borrado destructivo (solo cuando arrastra dependientes).
          Dialogo anidado de Radix: se monta sobre el principal. */}
      <Dialogo
        open={confirmacion !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmacion(null);
        }}
        titulo={confirmacion?.titulo ?? ""}
        pie={
          <>
            <Boton variante="ghost" onClick={() => setConfirmacion(null)}>
              Cancelar
            </Boton>
            <Boton
              variante="danger"
              onClick={() => {
                confirmacion?.onConfirmar();
                setConfirmacion(null);
              }}
            >
              Eliminar
            </Boton>
          </>
        }
      >
        <p className="cx-gyp__confirmar-texto">{confirmacion?.mensaje}</p>
      </Dialogo>
    </>
  );
}
