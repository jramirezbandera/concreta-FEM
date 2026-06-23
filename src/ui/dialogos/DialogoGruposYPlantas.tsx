import { useEffect, useState } from "react";
import { Dialogo } from "./Dialogo";
import {
  validarGrupo,
  validarPlanta,
  esValido,
  type ErrorCampo,
} from "./validacionesDialogo";
import { Campo, CampoNumero, SelectUso, Boton } from "../primitivas";
import {
  modeloStore,
  vistaStore,
  crearGrupo,
  editarGrupo,
  eliminarGrupo,
  crearPlanta,
  editarPlanta,
  eliminarPlanta,
} from "../../estado";
import { plantasDeGrupo } from "../../dominio";
import type { CategoriaUso, Modelo } from "../../dominio";
import { categoriaUso } from "../../biblioteca";
import "./dialogos.css";
import "./gruposPlantas.css";

// DialogoGruposYPlantas (feature-10, Tarea 2.1): maestro-detalle con COMMIT EN
// VIVO. A la izquierda la lista de grupos; al seleccionar uno, sus campos + la
// lista de sus plantas a la derecha. Cada edicion despacha su comando al instante
// (no hay boton "Guardar"). Vocabulario CYPECAD (Grupo, Planta); cero jerga FEM.
//
// INVARIANTE DEL `base` (CLAUDE.md §10 / comando.ts): los comandos se construyen
// SIEMPRE contra el modelo ACTUAL leido justo antes de ejecutar. Nunca se retiene
// el modelo entre ediciones. Por eso usamos `modeloStore.getState().getModelo()`
// dentro de cada handler y no la copia del render.

// Datos por defecto de un grupo nuevo (razonables para uso residencial).
// `sobrecargaUso` arranca cableada al qk normativo de la categoria por defecto
// (CTE DB-SE-AE Tabla 3.1 via biblioteca/acciones), igual que al cambiar la
// categoria en vivo: no hay numero magico que pueda divergir de la tabla.
const CATEGORIA_DEFECTO: CategoriaUso = "A";
const GRUPO_DEFECTO = {
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
  return (
    <Campo
      etiqueta={etiqueta}
      value={local}
      error={error}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(local)}
    />
  );
}

// El input NUMERICO controlado-local con commit en blur vive ahora en la primitiva
// compartida `CampoNumero` (src/ui/primitivas), reutilizada tambien por los paneles
// de pilar. Aqui solo queda el CampoTexto local (variante de texto).

// Busca el mensaje de un campo concreto en una lista de errores de validacion.
function errorDe(errores: ErrorCampo[], campo: string): string | undefined {
  return errores.find((e) => e.campo === campo)?.mensaje;
}

// Cuenta lo que ARRASTRARIA borrar un conjunto de plantas: misma regla que
// purgarPlantas (comandosModelo) — pilares que tocan esas plantas, vigas de esas
// plantas y cargas sobre la planta/pilar/viga. Sirve para avisar del alcance del
// borrado antes de confirmarlo (diseno para la confianza, revision F10).
function contarArrastre(modelo: Modelo, plantaIds: Set<string>) {
  const pilares = modelo.pilares.filter(
    (p) => plantaIds.has(p.plantaInicial) || plantaIds.has(p.plantaFinal),
  );
  const idsPilar = new Set(pilares.map((p) => p.id));
  const vigas = modelo.vigas.filter((v) => plantaIds.has(v.plantaId));
  const idsViga = new Set(vigas.map((v) => v.id));
  const cargas = modelo.cargas.filter(
    (c) => plantaIds.has(c.ambito) || idsPilar.has(c.ambito) || idsViga.has(c.ambito),
  );
  return { pilares: pilares.length, vigas: vigas.length, cargas: cargas.length };
}

// Frase en lenguaje de obra del alcance del borrado (solo las partes con count > 0,
// con singular/plural). P. ej. "3 plantas, 8 pilares y 4 vigas".
function fraseArrastre(partes: {
  plantas?: number;
  pilares: number;
  vigas: number;
  cargas: number;
}): string {
  const trozos: string[] = [];
  const add = (n: number | undefined, sing: string, plur: string) => {
    if (n) trozos.push(`${n} ${n === 1 ? sing : plur}`);
  };
  add(partes.plantas, "planta", "plantas");
  add(partes.pilares, "pilar", "pilares");
  add(partes.vigas, "viga", "vigas");
  add(partes.cargas, "carga", "cargas");
  if (trozos.length <= 1) return trozos[0] ?? "";
  return `${trozos.slice(0, -1).join(", ")} y ${trozos[trozos.length - 1]}`;
}

export function DialogoGruposYPlantas() {
  // Lectura reactiva del modelo (el dialogo no esta en el bucle del viewport; el
  // re-render al editar es aceptable). Selectores de campos sueltos.
  const grupos = modeloStore((s) => s.modelo.grupos);
  const plantas = modeloStore((s) => s.modelo.plantas);

  const dialogoActivo = vistaStore((s) => s.dialogoActivo);
  const grupoActivoId = vistaStore((s) => s.grupoActivoId);
  const plantaActivaId = vistaStore((s) => s.plantaActivaId);
  const setGrupoActivo = vistaStore((s) => s.setGrupoActivo);
  const setPlantaActiva = vistaStore((s) => s.setPlantaActiva);
  const cerrarDialogo = vistaStore((s) => s.cerrarDialogo);

  const open = dialogoActivo === "gruposPlantas";

  // Errores de validacion campo a campo, separados por ambito. Se limpian/actualizan
  // en cada commit; NO bloquean el teclear (el estado local del input es libre).
  const [erroresGrupo, setErroresGrupo] = useState<ErrorCampo[]>([]);
  // Errores por planta, indexados por id de planta.
  const [erroresPlanta, setErroresPlanta] = useState<Record<string, ErrorCampo[]>>(
    {},
  );
  // Confirmacion de borrado destructivo (solo cuando arrastra dependientes). null =
  // sin confirmacion abierta. onConfirmar ejecuta el borrado real.
  const [confirmacion, setConfirmacion] = useState<{
    titulo: string;
    mensaje: string;
    onConfirmar: () => void;
  } | null>(null);

  const grupoActivo = grupos.find((g) => g.id === grupoActivoId) ?? null;

  // --- Acciones de grupo -----------------------------------------------------
  const nuevoGrupo = () => {
    const m = leerModelo();
    // Identificamos el grupo recien creado por DIFERENCIA de ids (no por posicion):
    // no asumimos que el comando lo anada al final de la lista.
    const idsPrevios = new Set(m.grupos.map((g) => g.id));
    modeloStore.getState().ejecutar(crearGrupo(m, GRUPO_DEFECTO));
    const creado = leerModelo().grupos.find((g) => !idsPrevios.has(g.id));
    if (creado) setGrupoActivo(creado.id);
    // Limpia errores del grupo anterior: el nuevo grupo es valido y no debe heredar
    // un mensaje obsoleto (p. ej. un nombre duplicado del grupo que estaba activo).
    setErroresGrupo([]);
  };

  // Ejecuta el borrado real del grupo (re-lee el modelo: invariante del `base`) y
  // reajusta la seleccion activa.
  const ejecutarBorrarGrupo = (grupoId: string) => {
    const actual = leerModelo();
    const plantaIds = new Set(plantasDeGrupo(actual, grupoId).map((p) => p.id));
    modeloStore.getState().ejecutar(eliminarGrupo(actual, grupoId));
    if (grupoActivoId === grupoId) {
      setGrupoActivo(leerModelo().grupos[0]?.id ?? null);
    }
    if (plantaActivaId !== null && plantaIds.has(plantaActivaId)) {
      setPlantaActiva(null);
    }
    setErroresGrupo([]);
  };

  const borrarGrupo = (grupoId: string) => {
    const m = leerModelo();
    const grupo = m.grupos.find((g) => g.id === grupoId);
    const plantasDelGrupo = plantasDeGrupo(m, grupoId);
    const plantaIds = new Set(plantasDelGrupo.map((p) => p.id));
    const arrastre = contarArrastre(m, plantaIds);
    const total =
      plantasDelGrupo.length + arrastre.pilares + arrastre.vigas + arrastre.cargas;
    // Sin dependientes (grupo vacio): borrado inmediato, sin friccion.
    if (total === 0) {
      ejecutarBorrarGrupo(grupoId);
      return;
    }
    // Con dependientes: confirmar avisando del alcance (se puede deshacer).
    const frase = fraseArrastre({ plantas: plantasDelGrupo.length, ...arrastre });
    setConfirmacion({
      titulo: `Eliminar el grupo ${grupo?.nombre ?? ""}`.trim(),
      mensaje: `Se eliminará también ${frase}. Podrás deshacerlo con Ctrl+Z.`,
      onConfirmar: () => ejecutarBorrarGrupo(grupoId),
    });
  };

  const editarNombreGrupo = (nombreRaw: string) => {
    if (!grupoActivo) return;
    // Commiteamos el nombre SIN espacios al borde: validamos trimeado, asi que
    // guardar " G2 " burlaria el chequeo de duplicados contra "G2".
    const nombre = nombreRaw.trim();
    const m = leerModelo();
    const errs = validarGrupo(m, grupoActivo.id, { nombre });
    // Solo tocamos el error del campo "nombre" (los numericos los lleva su handler).
    const errNombre = errs.filter((e) => e.campo === "nombre");
    setErroresGrupo((prev) => [
      ...prev.filter((e) => e.campo !== "nombre"),
      ...errNombre,
    ]);
    if (errNombre.length > 0) return;
    if (nombre === grupoActivo.nombre) return; // no-op: no ensucies el undo
    modeloStore.getState().ejecutar(editarGrupo(m, grupoActivo.id, { nombre }));
  };

  // Cambiar la categoria de uso RE-ASIGNA la sobrecarga al qk normativo de esa
  // categoria (CTE DB-SE-AE Tabla 3.1, via biblioteca/acciones), como CYPECAD:
  // ambos campos van en la MISMA edicion (un solo comando, un solo undo). Las
  // ediciones manuales posteriores de `sobrecargaUso` persisten hasta el siguiente
  // cambio de categoria (override manual permitido).
  const editarCategoria = (categoria: CategoriaUso) => {
    if (!grupoActivo) return;
    if (categoria === grupoActivo.categoriaUso) return; // no-op
    const m = leerModelo();
    const sobrecargaUso = categoriaUso(categoria).qk;
    modeloStore
      .getState()
      .ejecutar(
        editarGrupo(m, grupoActivo.id, { categoriaUso: categoria, sobrecargaUso }),
      );
    // El campo de sobrecarga acaba de cambiar por debajo: limpia un posible error
    // previo de ese campo (el qk normativo es siempre valido).
    setErroresGrupo((prev) => prev.filter((e) => e.campo !== "sobrecargaUso"));
  };

  // Commit de un campo numerico del grupo (sobrecargaUso | cargasMuertas). La
  // validacion (incluida la finitud del numero) vive en validarGrupo; aqui solo
  // reflejamos el error de ESTE campo y despachamos si pasa (el nombre se valida en
  // su propio handler, no debe bloquear un cambio numerico).
  const editarNumeroGrupo = (
    campo: "sobrecargaUso" | "cargasMuertas",
    valor: number,
  ) => {
    if (!grupoActivo) return;
    const m = leerModelo();
    const errs = validarGrupo(m, grupoActivo.id, {
      nombre: grupoActivo.nombre,
      [campo]: valor,
    });
    const errCampo = errs.filter((e) => e.campo === campo);
    setErroresGrupo((prev) => [
      ...prev.filter((e) => e.campo !== campo),
      ...errCampo,
    ]);
    if (errCampo.length > 0) return;
    if (valor === grupoActivo[campo]) return; // no-op: no ensucies el undo
    modeloStore.getState().ejecutar(editarGrupo(m, grupoActivo.id, { [campo]: valor }));
  };

  // --- Acciones de planta ----------------------------------------------------
  const nuevaPlanta = () => {
    if (!grupoActivo) return;
    const m = leerModelo();
    const delGrupo = plantasDeGrupo(m, grupoActivo.id);
    // Cota sugerida: la cabeza de la planta mas alta (cota max + su altura), o 0.
    let cotaSugerida = 0;
    if (delGrupo.length > 0) {
      const masAlta = delGrupo.reduce((a, b) => (b.cota > a.cota ? b : a));
      cotaSugerida = masAlta.cota + masAlta.altura;
    }
    // Recien creada por diferencia de ids (no por posicion en la lista).
    const idsPrevios = new Set(m.plantas.map((p) => p.id));
    modeloStore
      .getState()
      .ejecutar(crearPlanta(m, { cota: cotaSugerida, altura: 3, grupoId: grupoActivo.id }));
    const creada = leerModelo().plantas.find((p) => !idsPrevios.has(p.id));
    if (creada) {
      setPlantaActiva(creada.id);
      setGrupoActivo(grupoActivo.id);
    }
  };

  const ejecutarBorrarPlanta = (plantaId: string) => {
    modeloStore.getState().ejecutar(eliminarPlanta(leerModelo(), plantaId));
    if (plantaActivaId === plantaId) setPlantaActiva(null);
    setErroresPlanta((prev) => {
      const sig = { ...prev };
      delete sig[plantaId];
      return sig;
    });
  };

  const borrarPlanta = (plantaId: string) => {
    const m = leerModelo();
    const planta = m.plantas.find((p) => p.id === plantaId);
    const arrastre = contarArrastre(m, new Set([plantaId]));
    const total = arrastre.pilares + arrastre.vigas + arrastre.cargas;
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

  // Commit de un campo de planta. `cambios` es el parcial editado; el resto de
  // campos se toma de la planta actual para validar el conjunto.
  const editarCampoPlanta = (
    plantaId: string,
    cambiosRaw: { nombre?: string; cota?: number; altura?: number },
  ) => {
    if (!grupoActivo) return;
    const m = leerModelo();
    const planta = m.plantas.find((p) => p.id === plantaId);
    if (!planta) return;
    // Nombre sin espacios al borde (mismo motivo que en el grupo: no burlar el
    // chequeo de duplicados que valida trimeado).
    const cambios =
      cambiosRaw.nombre !== undefined
        ? { ...cambiosRaw, nombre: cambiosRaw.nombre.trim() }
        : cambiosRaw;
    const datos = {
      nombre: cambios.nombre ?? planta.nombre,
      cota: cambios.cota ?? planta.cota,
      altura: cambios.altura ?? planta.altura,
      grupoId: planta.grupoId,
    };
    // La finitud y el signo de cota/altura los valida validarPlanta (regla
    // centralizada en el modulo puro): numero no finito -> error del campo, sin
    // despachar. CampoNumero ya manda NaN cuando el campo se vacia.
    const errs = validarPlanta(m, plantaId, datos);
    setErroresPlanta((prev) => ({ ...prev, [plantaId]: errs }));
    if (!esValido(errs)) return;
    // No-op: si el campo editado ya tiene ese valor, no ensucies el undo.
    const sinCambio =
      (cambios.nombre === undefined || cambios.nombre === planta.nombre) &&
      (cambios.cota === undefined || cambios.cota === planta.cota) &&
      (cambios.altura === undefined || cambios.altura === planta.altura);
    if (sinCambio) return;
    modeloStore.getState().ejecutar(editarPlanta(m, plantaId, cambios));
  };

  // Plantas del grupo activo, de mayor a menor cota (orden CYPECAD descendente,
  // como el Sidebar).
  const plantasGrupo = grupoActivo
    ? plantas
        .filter((p) => p.grupoId === grupoActivo.id)
        .sort((a, b) => b.cota - a.cota)
    : [];

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
      titulo="Plantas y grupos"
      pie={pie}
    >
      <div className="cx-gyp">
        {/* --- Maestro: lista de grupos --- */}
        <div className="cx-gyp__maestro">
          <div className="cx-gyp__maestro-head">
            <span className="cx-gyp__seccion-titulo">Grupos</span>
            <Boton variante="primary" onClick={nuevoGrupo}>
              Nuevo grupo
            </Boton>
          </div>
          <div className="cx-gyp__lista">
            {grupos.length === 0 ? (
              <div className="cx-gyp__vacio">Aún no hay grupos.</div>
            ) : (
              grupos.map((g) => {
                const clases = [
                  "cx-gyp__item",
                  g.id === grupoActivoId && "cx-gyp__item--sel",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={clases}
                    aria-pressed={g.id === grupoActivoId}
                    onClick={() => {
                      setGrupoActivo(g.id);
                      setErroresGrupo([]);
                    }}
                  >
                    {g.nombre}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* --- Detalle: grupo activo --- */}
        <div className="cx-gyp__detalle">
          {!grupoActivo ? (
            <div className="cx-gyp__vacio">Crea un grupo para empezar.</div>
          ) : (
            <>
              <div className="cx-gyp__grupo-campos">
                <div className="cx-gyp__campo-ancho">
                  <CampoTexto
                    etiqueta="Nombre"
                    valor={grupoActivo.nombre}
                    onCommit={editarNombreGrupo}
                    error={errorDe(erroresGrupo, "nombre")}
                  />
                </div>
                <div className="cx-gyp__campo-ancho">
                  <SelectUso
                    etiqueta="Categoría de uso"
                    valor={grupoActivo.categoriaUso}
                    onCambio={editarCategoria}
                  />
                </div>
                <CampoNumero
                  etiqueta="Sobrecarga de uso"
                  sufijo="kN/m²"
                  valor={grupoActivo.sobrecargaUso}
                  onCommit={(v) => editarNumeroGrupo("sobrecargaUso", v)}
                  error={errorDe(erroresGrupo, "sobrecargaUso")}
                />
                <CampoNumero
                  etiqueta="Cargas muertas"
                  sufijo="kN/m²"
                  valor={grupoActivo.cargasMuertas}
                  onCommit={(v) => editarNumeroGrupo("cargasMuertas", v)}
                  error={errorDe(erroresGrupo, "cargasMuertas")}
                />
              </div>

              {/* --- Plantas del grupo --- */}
              <div className="cx-gyp__seccion-head">
                <span className="cx-gyp__seccion-titulo">Plantas</span>
                <Boton variante="primary" onClick={nuevaPlanta}>
                  Nueva planta
                </Boton>
              </div>
              <div className="cx-gyp__plantas">
                {plantasGrupo.length === 0 ? (
                  <div className="cx-gyp__vacio">Este grupo no tiene plantas.</div>
                ) : (
                  plantasGrupo.map((p) => {
                    const errs = erroresPlanta[p.id] ?? [];
                    const sel = p.id === plantaActivaId;
                    const clases = [
                      "cx-gyp__planta",
                      sel && "cx-gyp__planta--sel",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <div key={p.id} className={clases}>
                        <button
                          type="button"
                          className="cx-gyp__planta-sel-btn"
                          aria-label={`Seleccionar ${p.nombre}`}
                          aria-pressed={sel}
                          onClick={() => {
                            setPlantaActiva(p.id);
                            setGrupoActivo(grupoActivo.id);
                          }}
                        />
                        <CampoTexto
                          etiqueta="Nombre"
                          valor={p.nombre}
                          onCommit={(v) => editarCampoPlanta(p.id, { nombre: v })}
                          error={errorDe(errs, "nombre")}
                        />
                        <CampoNumero
                          etiqueta="Cota"
                          sufijo="m"
                          className="cx-gyp__campo-num"
                          valor={p.cota}
                          onCommit={(v) => editarCampoPlanta(p.id, { cota: v })}
                          error={errorDe(errs, "cota")}
                        />
                        <CampoNumero
                          etiqueta="Altura"
                          sufijo="m"
                          className="cx-gyp__campo-num"
                          valor={p.altura}
                          onCommit={(v) => editarCampoPlanta(p.id, { altura: v })}
                          error={errorDe(errs, "altura")}
                        />
                        <button
                          type="button"
                          className="cx-gyp__borrar"
                          onClick={() => borrarPlanta(p.id)}
                        >
                          Eliminar
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Eliminar el grupo activo (al pie del detalle). */}
              <div>
                <button
                  type="button"
                  className="cx-gyp__borrar"
                  onClick={() => borrarGrupo(grupoActivo.id)}
                >
                  Eliminar grupo
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
