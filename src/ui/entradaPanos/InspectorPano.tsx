// InspectorPano (F3): panel flotante sobre el lienzo que edita el paño SELECCIONADO con
// COMMIT EN VIVO. Espejo de InspectorViga, SOLO-PROPIEDADES: la geometria (perimetro) la
// fija la introduccion grafica en planta, NO este formulario. Visible solo cuando hay
// EXACTAMENTE un paño seleccionado. Vocabulario de obra (Paño, Material, Espesor, Tamaño
// de malla, Apoyo de borde); cero jerga FEM.
//
// INVARIANTE DEL `base` (CLAUDE.md §10): los comandos se construyen contra el modelo
// ACTUAL leido justo antes de ejecutar, nunca contra la copia del render.
//
// UNIDADES (CLAUDE.md §14): espesor y tamaño de malla se editan en mm (CampoLongitudMm,
// conversion en el borde); el material por id; el apoyo de borde enum.
import { useEffect, useState } from "react";
import { PanelFlotante, Boton, SelectMaterial } from "../primitivas";
import { CampoBordeApoyo, CampoLongitudMm } from "./camposPano";
import { Dialogo } from "../dialogos/Dialogo";
import { SeccionCargaSuperficial } from "./SeccionCargaSuperficial";
import {
  validarPano,
  type DatosPanoUI,
  type ErrorCampo,
} from "../dialogos/validacionesPano";
import {
  modeloStore,
  seleccionStore,
  vistaStore,
  editarPano,
  eliminarPano,
} from "../../estado";
import type { Modelo, Pano, Nudo } from "../../dominio";
import { cargasDeAmbito } from "../../dominio";
// FUENTE UNICA [2A] de las cargas automaticas de grupo (F3.2, D-1): la MISMA que
// usa el discretizador para emitirlas. La linea informativa del inspector no puede
// divergir de lo que el calculo aplica.
import { cargasGrupoDePano, CASE_CM_GRUPO } from "../../discretizador/cargasGrupo";
// FUENTE UNICA (F2.3, losa plana): el MISMO detector geometrico que usa el acople del
// discretizador para decidir que pilares interiores recogen la losa. Es pura Capa 1
// (obra): lee pilares/plantas/perimetro, NO discretiza (no genera nudos/quads/FEM). La
// nota de honestidad sobre el momento en cabeza de pilar no puede divergir de lo que
// el calculo realmente acopla.
import { pilaresInterioresBajoPano } from "../../discretizador/acople";
import "./inspectorPano.css";

function leerModelo() {
  return modeloStore.getState().getModelo();
}

function errorDe(errores: ErrorCampo[], campo: string): string | undefined {
  return errores.find((e) => e.campo === campo)?.mensaje;
}

// Construye los DatosPanoUI completos a partir del paño actual y un parche del campo
// editado. validarPano valida el CONJUNTO. El nombre no se edita aqui (solo-propiedades)
// pero forma parte del contrato de validacion (unicidad).
function datosDesde(pano: Pano, cambios: Partial<DatosPanoUI>): DatosPanoUI {
  return {
    nombre: pano.nombre,
    materialId: pano.materialId,
    espesor: pano.espesor,
    tamMalla: pano.tamMalla,
    bordeApoyo: pano.bordeApoyo,
    ...cambios,
  };
}

// Cuenta las cargas que arrastraria borrar el paño (mismo criterio que eliminarPano).
function contarCargasDelPano(modelo: Modelo, panoId: string): number {
  return cargasDeAmbito(modelo, panoId).length;
}

// Dimensiones del paño para el bloque solo-lectura D8b: ancho × alto (m) del rectangulo
// que envuelve su perimetro (bounding box de los nudos del contorno). En el corte 1 el
// paño ES un rectangulo de ejes, asi que ancho/alto del bounding box son sus dimensiones
// reales. UNIDADES internas en m (sin conversion: las coordenadas van en m). Devuelve
// null si el perimetro no resuelve a nudos suficientes (import inconsistente).
interface DimensionesPano {
  ancho: number; // m (extension en X)
  alto: number; // m (extension en Y)
}

function dimensionesDePano(nudos: Nudo[], pano: Pano): DimensionesPano | null {
  const puntos = pano.perimetro
    .map((id) => nudos.find((n) => n.id === id))
    .filter((n): n is Nudo => n !== undefined);
  if (puntos.length < 2) return null;
  const xs = puntos.map((p) => p.x);
  const ys = puntos.map((p) => p.y);
  const ancho = Math.max(...xs) - Math.min(...xs);
  const alto = Math.max(...ys) - Math.min(...ys);
  return { ancho, alto };
}

// Formatea un valor en metros a 2 decimales (bloque geometrico D8b, mono tabular).
function fmt2(v: number): string {
  return v.toFixed(2);
}

// Formatea una presion (kN/m²) con coma decimal es-ES y 2 decimales fijos, como el
// resto de cifras normativas de la UI ("1,35", "2,00").
function fmtCarga(v: number): string {
  return v.toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Estado vacio del inspector (auditoria UX-C6): en la pestana de Isovalores (donde el
// paño es el editor principal) con la herramienta "seleccion" y sin paño seleccionado,
// el dock mostraba solo "Ayudas" sin guiar a que seleccionar un paño abre su editor.
// En vez de desaparecer (return null), rinde una seccion de estado vacio en el cromo
// plano del dock (patron de PanelDiagramas / InspectorPilar). En la pestana de vigas el
// paño acompaña a la viga (editor principal), asi que alli NO muestra estado vacio: lo
// cubre el de InspectorViga y dos "Selecciona…" apilados serian ruido.
function EstadoVacioPano({ mensaje }: { mensaje: string }) {
  return (
    <PanelFlotante className="cx-inspector-pano" titulo="Propiedades">
      <p className="cx-inspector-vacio">{mensaje}</p>
    </PanelFlotante>
  );
}

export function InspectorPano() {
  const seleccion = seleccionStore((s) => s.seleccion);
  const panos = modeloStore((s) => s.modelo.panos);
  // Nudos del perimetro: para el bloque de dimensiones D8b. Suscripcion ligera.
  const nudos = modeloStore((s) => s.modelo.nudos);
  // Modelo completo para la linea de cargas de grupo (F3.2, D-1): la fuente unica
  // `cargasGrupoDePano` necesita plantas+grupos. Re-render por edicion de obra:
  // aceptable (cromo HUD visible solo con un paño seleccionado, fuera del lienzo).
  const modelo = modeloStore((s) => s.modelo);
  // Contexto de UI para el estado vacio: solo en Isovalores (editor principal del paño)
  // y con la herramienta de seleccion.
  const pestanaActiva = vistaStore((s) => s.pestanaActiva);
  const herramienta = vistaStore((s) => s.herramienta);

  const [errores, setErrores] = useState<ErrorCampo[]>([]);
  const [confirmacion, setConfirmacion] = useState<{
    titulo: string;
    mensaje: string;
    onConfirmar: () => void;
  } | null>(null);

  const panoId = seleccion.length === 1 ? seleccion[0] : null;
  const pano = panoId ? panos.find((p) => p.id === panoId) ?? null : null;

  // Cargas automaticas del grupo que este paño recibira (F3.2, D-1), con la misma
  // fuente que el discretizador. [] si el grupo no aporta (linea ausente, GAP-H).
  const cargasGrupo = pano ? cargasGrupoDePano(modelo, pano) : [];

  // Losa PLANA (F2.3): la losa se apoya en pilares interiores (su cabeza comparte
  // el nudo con la malla). El acople exige >=2 apoyos (DP1: con 1 solo pilar el paño
  // ni siquiera calcula, PANO_PILAR_INTERIOR bloquea), asi que umbral >=2 para no
  // mostrar la nota sobre un paño que en realidad esta bloqueado. Detector puro de
  // Capa 1 (misma fuente que el acople), no re-discretiza.
  const esLosaPlana = pano ? pilaresInterioresBajoPano(modelo, pano).length >= 2 : false;

  // Al cambiar de paño seleccionado, limpia los errores de la anterior.
  useEffect(() => {
    setErrores([]);
  }, [panoId]);

  // Sin un paño aplicable (0 seleccionados, multiseleccion, o id no-paño): el
  // inspector no edita nada. En Isovalores con herramienta "seleccion" muestra un
  // estado vacio que guia (UX-C6); en cualquier otro contexto se repliega a null
  // (en la pestana de vigas el editor principal es la viga).
  if (!pano) {
    if (pestanaActiva === "isovalores" && herramienta === "seleccion") {
      const mensaje =
        seleccion.length > 1
          ? `${seleccion.length} elementos seleccionados. Edítalos de uno en uno.`
          : "Selecciona un paño para editar sus propiedades.";
      return <EstadoVacioPano mensaje={mensaje} />;
    }
    return null;
  }

  // Commit generico de un campo: construye DatosPanoUI con el parche, valida, refleja
  // solo los errores de los campos tocados y despacha si pasan. No-op si no cambia.
  const commit = (
    campos: ReadonlyArray<keyof DatosPanoUI>,
    cambios: Partial<DatosPanoUI>,
    parche: Partial<Omit<Pano, "id" | "nombre" | "perimetro">>,
  ) => {
    const m = leerModelo();
    const actual = m.panos.find((p) => p.id === pano.id);
    if (!actual) return;
    const datos = datosDesde(actual, cambios);
    const errs = validarPano(m, pano.id, datos);
    const camposSet = new Set<string>(campos);
    const errsCampo = errs.filter((e) => camposSet.has(e.campo));
    setErrores((prev) => [
      ...prev.filter((e) => !camposSet.has(e.campo)),
      ...errsCampo,
    ]);
    if (errsCampo.length > 0) return;
    const sinCambio = (Object.keys(parche) as (keyof Pano)[]).every(
      (k) => actual[k] === parche[k as keyof typeof parche],
    );
    if (sinCambio) return;
    modeloStore.getState().ejecutar(editarPano(m, pano.id, parche));
  };

  // --- Borrado ---------------------------------------------------------------
  const ejecutarBorrar = () => {
    modeloStore.getState().ejecutar(eliminarPano(leerModelo(), pano.id));
    seleccionStore.getState().limpiar();
  };

  const borrar = () => {
    const m = leerModelo();
    const nCargas = contarCargasDelPano(m, pano.id);
    if (nCargas === 0) {
      ejecutarBorrar();
      return;
    }
    const frase = nCargas === 1 ? "1 carga asociada" : `${nCargas} cargas asociadas`;
    setConfirmacion({
      titulo: `Eliminar el paño ${pano.nombre}`,
      mensaje: `Se eliminará el paño ${pano.nombre} y ${frase}. Podrás deshacerlo con Ctrl+Z.`,
      onConfirmar: ejecutarBorrar,
    });
  };

  // D8b: dimensiones del paño (ancho × alto, solo lectura). Del bounding box de su
  // perimetro (modelo.nudos). El bloque no se pinta si el perimetro no resuelve.
  const dimensiones = dimensionesDePano(nudos, pano);

  return (
    <>
      <PanelFlotante
        className="cx-inspector-pano"
        titulo={`Paño ${pano.nombre}`}
        tag="losa"
      >
        {/* D8b: dimensiones del paño (solo lectura). Ancho × alto en m (2 decimales,
            mono). Derivadas de la geometria en planta; no se editan aqui. */}
        {dimensiones ? (
          <div className="cx-inspector-pano__geom">
            <span className="cx-inspector-pano__geom-etq">Dimensiones</span>
            <span className="cx-inspector-pano__geom-val">
              {fmt2(dimensiones.ancho)} × {fmt2(dimensiones.alto)} m
            </span>
          </div>
        ) : null}

        <CampoLongitudMm
          etiqueta="Espesor"
          valorM={pano.espesor}
          onValorM={(m) => commit(["espesor"], { espesor: m }, { espesor: m })}
          error={errorDe(errores, "espesor")}
        />

        <SelectMaterial
          etiqueta="Material"
          valor={pano.materialId}
          onCambio={(id) => commit(["materialId"], { materialId: id }, { materialId: id })}
        />
        {errorDe(errores, "materialId") ? (
          <div className="cx-campo__error" role="alert">
            {errorDe(errores, "materialId")}
          </div>
        ) : null}

        <CampoLongitudMm
          etiqueta="Tamaño de malla"
          valorM={pano.tamMalla}
          onValorM={(m) => commit(["tamMalla"], { tamMalla: m }, { tamMalla: m })}
          error={errorDe(errores, "tamMalla")}
        />

        <CampoBordeApoyo
          className="cx-inspector-pano__campo"
          valor={pano.bordeApoyo}
          onValor={(v) => commit([], { bordeApoyo: v }, { bordeApoyo: v })}
        />

        {/* UX-C9 (reescrita en F3.2; ampliada en F2.3): la losa DESCARGA en el
            portico cuando su contorno coincide con vigas, y ademas en los pilares que
            queden por DENTRO de su superficie (losa plana, >=2 pilares); el bordeApoyo
            queda como fallback de los bordes sin viga. Lenguaje de obra, sin
            sobre-prometer. */}
        <p className="cx-note">
          La losa descarga en las vigas y pilares de su contorno cuando los comparte, y
          también en los pilares que queden por dentro de su superficie; en los bordes
          sin viga se usa el apoyo de borde elegido.
        </p>

        {/* Nota de honestidad (F2.3, losa plana): cuando la losa se apoya en pilares
            interiores, el pico de momento sobre la cabeza del pilar depende del
            tamaño de malla y no converge (deuda T-f3-losa-plana-momento-local); la
            flecha y el axil del pilar SI son fiables. Advertencia CUALITATIVA en
            lenguaje de obra: no promete un valor, avisa de lo que aun no es de diseño.
            El armado a punzonamiento sobre el pilar llega en una fase posterior. */}
        {esLosaPlana ? (
          <p className="cx-note">
            Esta losa se apoya en pilares por dentro de su superficie. La flecha y la
            carga que baja por cada pilar son fiables; en cambio, el momento justo sobre
            la cabeza del pilar es orientativo (varía al afinar el tamaño de malla). El
            dimensionado de la losa sobre el pilar (punzonamiento) llegará en una fase
            posterior.
          </p>
        ) : null}

        {/* Linea informativa de cargas de GRUPO (F3.2, D-1): lo que este paño recibe
            automaticamente de su grupo, con la MISMA fuente que el calculo
            (cargasGrupoDePano). Ausente si el grupo no aporta (valores a 0). */}
        {cargasGrupo.length > 0 ? (
          <p className="cx-note cx-inspector-pano__grupo">
            Recibe además, del grupo de su planta:{" "}
            {cargasGrupo
              .map(
                (cg) =>
                  `${fmtCarga(cg.presion)} kN/m² de ${
                    cg.case === CASE_CM_GRUPO ? "cargas muertas" : "sobrecarga de uso"
                  }`,
              )
              .join(" y ")}
            .
          </p>
        ) : null}

        <SeccionCargaSuperficial panoId={pano.id} />

        <div className="cx-inspector-pano__acciones">
          <Boton variante="ghost" onClick={borrar}>
            Eliminar paño
          </Boton>
        </div>
      </PanelFlotante>

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
        <p className="cx-inspector-pano__confirmar-texto">{confirmacion?.mensaje}</p>
      </Dialogo>
    </>
  );
}
