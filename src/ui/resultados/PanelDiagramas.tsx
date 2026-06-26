// PanelDiagramas (feature-14, Tarea 2.2): panel flotante de la pestana Resultados
// que muestra el diagrama de esfuerzos (axil / cortante / flector / flecha) de la
// barra SELECCIONADA para la combinacion activa. Reacciona a:
//   - seleccionStore: que elemento de obra esta seleccionado.
//   - resultadosStore: resultados + trazabilidad + vigencia del ultimo calculo.
//   - vistaStore: combinacion activa + magnitud a dibujar (selector N/V/M/flecha).
//
// AISLAMIENTO DE PLOTLY (hallazgo #21): este panel NO importa Plotly. Extrae las
// series (posiciones x[], valores v[]) ya en unidades de presentacion y se las
// pasa a <DiagramaBarraLazy> (la frontera tras la que vive Plotly). Asi migrar a
// uPlot solo toca DiagramaBarra.tsx, no este panel.
//
// LENGUAJE DE OBRA (CLAUDE.md §2): cero jerga FEM visible. Hablamos de "barra",
// "pilar", "viga"; nunca de "member M7" ni "nodo". Cuando un pilar pasa por varias
// plantas se trocea en varios tramos FEM; en F1 mostramos el PRIMER tramo (pie) con
// una nota, sin exponer el concepto de "member".
//
// UNIDADES (CLAUDE.md §14): el contrato del solver trae N/V en kN, M en kN·m y
// flecha en m. La unica conversion de presentacion (flecha m -> mm) ocurre AQUI,
// en el borde, justo antes de entregar la serie al diagrama.

import { Suspense, useMemo } from "react";

import { PanelFlotante, Segmentado } from "../primitivas";
import type { OpcionSegmento } from "../primitivas";
import { seleccionStore, resultadosStore, vistaStore } from "../../estado";
import type { MagnitudDiagrama } from "../../estado";
import type { EstadoMiembroCombo } from "../../solver";
import type { Trazabilidad } from "../../discretizador";
import { mToMm } from "../../unidades";

import { DiagramaBarraLazy } from "./diagramaLazy";
import "./panelDiagramas.css";

// Metadatos de presentacion por magnitud: campo del contrato del solver, etiqueta
// del eje (con unidad, en lenguaje de obra), color (token semantico) y factor de
// conversion al sistema de presentacion. Tabla unica para no esparcir el mapeo.
interface MetaMagnitud {
  // Campo del EstadoMiembroCombo con el diagrama (forma (2,n)).
  campo: "axial" | "shear_y" | "moment_z" | "defl_y";
  etiquetaEje: string; // "Momento (kN·m)" — para el eje Y del diagrama
  etiquetaBoton: string; // "M" — para el segmentado compacto
  titulo: string; // "Momento" — tooltip/aria del boton
  color: string; // token semantico CSS
  // Conversion m->presentacion en el borde. Solo la flecha convierte (m -> mm) y
  // lo hace a traves de la UNICA capa /src/unidades (§14); el resto omite el campo
  // (ya vienen en kN / kN·m del contrato, son identidad).
  convertir?: (v: number) => number;
}

const META: Record<MagnitudDiagrama, MetaMagnitud> = {
  axil: {
    campo: "axial",
    etiquetaEje: "Axil (kN)",
    etiquetaBoton: "N",
    titulo: "Axil",
    color: "var(--text-2, #5a6678)",
  },
  cortante: {
    campo: "shear_y",
    etiquetaEje: "Cortante (kN)",
    etiquetaBoton: "V",
    titulo: "Cortante",
    color: "var(--accent, #2563eb)",
  },
  momento: {
    campo: "moment_z",
    etiquetaEje: "Momento (kN·m)",
    etiquetaBoton: "M",
    titulo: "Momento",
    color: "var(--moment, #a855f7)",
  },
  flecha: {
    campo: "defl_y",
    etiquetaEje: "Flecha (mm)",
    etiquetaBoton: "Flecha",
    titulo: "Flecha",
    color: "var(--deformed, #38bdf8)",
    convertir: mToMm, // m -> mm via la unica capa de conversion (§14)
  },
};

// Opciones del selector de magnitud, en el orden canonico de lectura N/V/M/flecha.
const OPCIONES_MAGNITUD: ReadonlyArray<OpcionSegmento<MagnitudDiagrama>> = (
  ["axil", "cortante", "momento", "flecha"] as const
).map((m) => ({
  valor: m,
  etiqueta: META[m].etiquetaBoton,
  titulo: META[m].titulo,
}));

// Resuelve el elemento de obra seleccionado a su barra FEM via trazabilidad, SIN
// exponer jerga FEM. Una viga -> un member; un pilar -> varios tramos (devolvemos
// el primero, el del pie). Devuelve tambien si el elemento se troceo (varios tramos)
// para poder avisar al usuario. null si no hay mapeo (no seleccionado / no es barra).
interface ResolucionBarra {
  memberName: string;
  troceado: boolean; // pilar con mas de un tramo (mostramos solo el primero)
}

function resolverBarra(
  seleccion: readonly string[],
  trazabilidad: Trazabilidad,
): ResolucionBarra | null {
  if (seleccion.length !== 1) return null;
  const id = seleccion[0];
  // Viga: mapeo 1:1.
  const member = trazabilidad.vigaAMember[id];
  if (member !== undefined) return { memberName: member, troceado: false };
  // Pilar: array de tramos en orden pie->cabeza. En F1 mostramos el primero.
  const tramos = trazabilidad.pilarAMembers[id];
  if (tramos !== undefined && tramos.length > 0) {
    return { memberName: tramos[0], troceado: tramos.length > 1 };
  }
  return null;
}

// Extrae la serie (x[], v[]) de un EstadoMiembroCombo segun la magnitud, aplicando
// la conversion de presentacion. El diagrama es forma (2,n): fila 0 = posiciones
// (m), fila 1 = valores. Mantenemos x en m (eje de la barra) y convertimos los
// valores con el factor de la magnitud (solo la flecha: m -> mm).
function extraerSerie(
  estado: EstadoMiembroCombo,
  magnitud: MagnitudDiagrama,
): { posiciones: number[]; valores: number[] } {
  const meta = META[magnitud];
  const diagrama = estado[meta.campo]; // [ [x...], [v...] ]
  const posiciones = diagrama[0];
  const { convertir } = meta;
  const valores =
    convertir === undefined ? diagrama[1] : diagrama[1].map(convertir);
  return { posiciones, valores };
}

export function PanelDiagramas() {
  // Lectura reactiva. Este panel NO esta en el bucle del viewport (#11): un
  // re-render al cambiar seleccion/combo/magnitud es aceptable (es cromo HUD, no
  // el lienzo 3D). Suscripcion a campos sueltos para no re-renderizar de mas.
  const seleccion = seleccionStore((s) => s.seleccion);
  const resultados = resultadosStore((s) => s.resultados);
  const trazabilidad = resultadosStore((s) => s.trazabilidad);
  const vigente = resultadosStore((s) => s.vigente);
  const combinacionActiva = vistaStore((s) => s.combinacionActiva);
  const magnitud = vistaStore((s) => s.magnitudDiagrama);
  const setMagnitud = vistaStore((s) => s.setMagnitudDiagrama);

  // Resolucion de la barra seleccionada -> serie a dibujar. Memoizada para no
  // recorrer arrays en cada render si nada relevante cambio.
  const datos = useMemo(() => {
    if (!resultados || !trazabilidad) return { estado: "sin-resultados" as const };
    const barra = resolverBarra(seleccion, trazabilidad);
    if (!barra) return { estado: "sin-seleccion" as const };
    if (combinacionActiva === null)
      return { estado: "sin-combo" as const };
    const porCombo = resultados.barras[barra.memberName];
    // member inexistente en los resultados (no deberia pasar si trazabilidad y
    // resultados son del mismo calculo, pero lo manejamos sin romper).
    if (porCombo === undefined) return { estado: "sin-barra" as const };
    const estadoBarra = porCombo[combinacionActiva];
    // combo inexistente para esta barra (combinacion seleccionada no calculada).
    if (estadoBarra === undefined) return { estado: "sin-combo" as const };
    const serie = extraerSerie(estadoBarra, magnitud);
    return {
      estado: "ok" as const,
      ...serie,
      troceado: barra.troceado,
    };
  }, [resultados, trazabilidad, seleccion, combinacionActiva, magnitud]);

  const meta = META[magnitud];

  return (
    <PanelFlotante
      className="cx-panel-diagramas"
      titulo="Esfuerzos en la barra"
      // data-testid para E2E (feature-16): panel glass sin rol (es un <div .cx-float>);
      // el selector de magnitud (radiogroup) y los textos guia se localizan por rol,
      // pero el contenedor necesita un gancho estable para acotar las asercion del E2E.
      data-testid="panel-diagramas"
    >
      <Segmentado<MagnitudDiagrama>
        className="cx-panel-diagramas__seg"
        aria-label="Magnitud del diagrama"
        opciones={OPCIONES_MAGNITUD}
        valor={magnitud}
        onValor={setMagnitud}
      />

      {/* Aviso de resultados obsoletos: la obra se edito tras calcular. El
          diagrama sigue siendo del ultimo calculo (no se borra), pero avisamos. */}
      {datos.estado === "ok" && !vigente ? (
        <p className="cx-panel-diagramas__aviso" role="status">
          Estos esfuerzos son del último cálculo. Vuelve a calcular para
          actualizarlos.
        </p>
      ) : null}

      {/* Nota para pilares troceados (varias plantas): mostramos el primer tramo. */}
      {datos.estado === "ok" && datos.troceado ? (
        <p className="cx-panel-diagramas__aviso" role="status">
          Este pilar abarca varias plantas; se muestra el tramo inferior.
        </p>
      ) : null}

      <div className="cx-panel-diagramas__lienzo">
        {datos.estado === "ok" ? (
          <Suspense
            fallback={
              <p className="cx-panel-diagramas__guia">Dibujando diagrama…</p>
            }
          >
            <DiagramaBarraLazy
              posiciones={datos.posiciones}
              valores={datos.valores}
              etiquetaY={meta.etiquetaEje}
              color={meta.color}
            />
          </Suspense>
        ) : (
          <p className="cx-panel-diagramas__guia">{mensajeGuia(datos.estado)}</p>
        )}
      </div>
    </PanelFlotante>
  );
}

// Mensaje guia en lenguaje de obra segun por que no hay diagrama que dibujar.
function mensajeGuia(
  estado: "sin-resultados" | "sin-seleccion" | "sin-combo" | "sin-barra",
): string {
  switch (estado) {
    case "sin-resultados":
      return "Calcula la obra para ver los esfuerzos.";
    case "sin-seleccion":
      return "Selecciona una barra para ver sus esfuerzos.";
    case "sin-combo":
      return "No hay combinación seleccionada para esta barra.";
    case "sin-barra":
      return "Esta barra no tiene esfuerzos en el último cálculo.";
  }
}
