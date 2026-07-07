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
// plantas se trocea en varios tramos FEM. [AUDITORIA D20] En vez de fijar el tramo
// inferior con un aviso, se ofrece un SELECTOR de tramo ("Planta 1", "Planta 2"…)
// derivado de la trazabilidad, para acceder a los esfuerzos de cualquier planta.
//
// UNIDADES (CLAUDE.md §14): el contrato del solver trae N/V en kN, M en kN·m y
// flecha en m. La unica conversion de presentacion (flecha m -> mm) ocurre AQUI,
// en el borde, justo antes de entregar la serie al diagrama.

import { Suspense, useEffect, useMemo, useState } from "react";

import { PanelFlotante, Segmentado, ErrorBoundary } from "../primitivas";
import type { OpcionSegmento } from "../primitivas";
import { seleccionStore, resultadosStore, vistaStore, modeloStore } from "../../estado";
import type { MagnitudDiagrama } from "../../estado";
import type { EstadoMiembroCombo } from "../../solver";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { Modelo } from "../../dominio";
import { mToMm } from "../../unidades";

import { DiagramaBarraLazy } from "./diagramaLazy";
import { serieVigaTramos } from "./serieVigaTramos";
import { SIGNO_UI } from "./convencionEsfuerzos";
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

// Etiquetas con la NOTACION ESTANDAR y su eje (N, Vy, Mz): el contrato del solver
// trae el cortante/flector del plano local x-y, de ahi los subindices.
const META: Record<MagnitudDiagrama, MetaMagnitud> = {
  axil: {
    campo: "axial",
    etiquetaEje: "Axil N (kN)",
    etiquetaBoton: "N",
    titulo: "Axil (tracción +)",
    color: "var(--text-2, #5a6678)",
  },
  cortante: {
    campo: "shear_y",
    etiquetaEje: "Cortante Vy (kN)",
    etiquetaBoton: "Vy",
    titulo: "Cortante Vy",
    color: "var(--accent, #2563eb)",
  },
  momento: {
    campo: "moment_z",
    etiquetaEje: "Flector Mz (kN·m)",
    etiquetaBoton: "Mz",
    titulo: "Flector Mz (vano +)",
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

// Un tramo del elemento seleccionado, con su barra FEM y la etiqueta de PLANTA en lenguaje
// de obra (nunca "member M7"). Para una viga los tramos NO se exponen (su diagrama se
// CONCATENA en una unica serie continua, F3.2); para un pilar pasante, uno por planta que
// atraviesa (pie->cabeza), con selector (D20).
interface TramoBarra {
  memberName: string;
  etiqueta: string; // "Planta 1", "Cubierta"... (nombre de la planta que alcanza el tramo)
}

// Resuelve el elemento de obra seleccionado a sus tramos FEM (barras) via trazabilidad, SIN
// exponer jerga FEM. Una viga -> un tramo; un pilar -> N tramos (pie->cabeza), cada uno
// etiquetado con la PLANTA que alcanza (su nudo cabeza). null si no hay mapeo (no
// seleccionado / no es barra). [D20] Devolver TODOS los tramos habilita el selector.
interface ResolucionBarra {
  tramos: TramoBarra[]; // >=1; para pilar en orden pie->cabeza
  esPilar: boolean; // true si el elemento es un pilar (puede tener varios tramos)
}

// Etiqueta de PLANTA que alcanza un tramo de pilar: la planta de su nudo CABEZA (member.j),
// via trazabilidad.nodoFEMAPlanta -> plantaId -> nombre de la planta en la obra. Fallback a
// un ordinal ("Tramo N") si falta el mapeo (no deberia con datos coherentes del mismo
// calculo). Lenguaje de obra: nombre real de la planta, nunca el id FEM del nudo.
function etiquetaTramoPilar(
  memberName: string,
  ordinal: number,
  modeloFEM: ModeloFEM,
  trazabilidad: Trazabilidad,
  modelo: Modelo,
): string {
  const member = modeloFEM.members.find((m) => m.name === memberName);
  const plantaId = member ? trazabilidad.nodoFEMAPlanta[member.j] : undefined;
  const planta = plantaId
    ? modelo.plantas.find((p) => p.id === plantaId)
    : undefined;
  return planta?.nombre ?? `Tramo ${ordinal}`;
}

function resolverBarra(
  seleccion: readonly string[],
  trazabilidad: Trazabilidad,
  modeloFEM: ModeloFEM,
  modelo: Modelo,
): ResolucionBarra | null {
  if (seleccion.length !== 1) return null;
  const id = seleccion[0];
  // Viga: TODOS sus members en orden i->j (una viga sin acople es un array de 1; una
  // viga de contorno subdividida por el acople paño<->portico, F3.2, son N). Sin
  // etiqueta de planta: la viga es UNA para el arquitecto y su serie se concatena.
  const membersViga = trazabilidad.vigaAMembers[id];
  if (membersViga !== undefined && membersViga.length > 0) {
    return {
      tramos: membersViga.map((memberName) => ({ memberName, etiqueta: "" })),
      esPilar: false,
    };
  }
  // Pilar: array de tramos en orden pie->cabeza; cada tramo se etiqueta con su planta.
  const tramos = trazabilidad.pilarAMembers[id];
  if (tramos !== undefined && tramos.length > 0) {
    return {
      tramos: tramos.map((memberName, i) => ({
        memberName,
        etiqueta: etiquetaTramoPilar(memberName, i + 1, modeloFEM, trazabilidad, modelo),
      })),
      esPilar: true,
    };
  }
  return null;
}

// Valores crudos -> presentacion: signo del convenio (convencionEsfuerzos: traccion
// +, vano +; UNICO punto de flip compartido con el overlay 3D) y conversion de
// unidades en el borde (solo la flecha: m -> mm).
function aPresentacion(
  crudos: readonly number[],
  meta: MetaMagnitud,
): number[] {
  const signo = SIGNO_UI[meta.campo];
  const { convertir } = meta;
  return crudos.map((v) => {
    const s = v * signo;
    return convertir === undefined ? s : convertir(s);
  });
}

// Extrae la serie (x[], v[]) de un EstadoMiembroCombo segun la magnitud, en
// convenio y unidades de presentacion. El diagrama es forma (2,n): fila 0 =
// posiciones (m, eje de la barra), fila 1 = valores.
function extraerSerie(
  estado: EstadoMiembroCombo,
  magnitud: MagnitudDiagrama,
): { posiciones: number[]; valores: number[] } {
  const meta = META[magnitud];
  const diagrama = estado[meta.campo]; // [ [x...], [v...] ]
  return { posiciones: diagrama[0], valores: aPresentacion(diagrama[1], meta) };
}

export function PanelDiagramas() {
  // Lectura reactiva. Este panel NO esta en el bucle del viewport (#11): un
  // re-render al cambiar seleccion/combo/magnitud es aceptable (es cromo HUD, no
  // el lienzo 3D). Suscripcion a campos sueltos para no re-renderizar de mas.
  const seleccion = seleccionStore((s) => s.seleccion);
  const resultados = resultadosStore((s) => s.resultados);
  const modeloFEM = resultadosStore((s) => s.modeloFEM);
  const trazabilidad = resultadosStore((s) => s.trazabilidad);
  const vigente = resultadosStore((s) => s.vigente);
  const combinacionActiva = vistaStore((s) => s.combinacionActiva);
  const magnitud = vistaStore((s) => s.magnitudDiagrama);
  const setMagnitud = vistaStore((s) => s.setMagnitudDiagrama);
  // El nombre de las plantas (Capa 1) para etiquetar los tramos del pilar (D20). Lectura
  // reactiva: renombrar una planta reetiqueta el selector (aunque editar invalida vigente).
  const modelo = modeloStore((s) => s.modelo);

  // Resuelve el elemento seleccionado a sus TRAMOS (D20). Solo depende de la seleccion y del
  // trio de calculo (no de la magnitud/tramo): memoizada aparte para que el selector y la
  // serie compartan la misma resolucion.
  const resolucion = useMemo(() => {
    if (!resultados || !trazabilidad || !modeloFEM) return null;
    return resolverBarra(seleccion, trazabilidad, modeloFEM, modelo);
  }, [resultados, trazabilidad, modeloFEM, modelo, seleccion]);

  // [D20] Tramo activo (indice en resolucion.tramos), default 0 (el inferior, pie). Estado
  // LOCAL de UI: se re-inicializa a 0 cuando cambia la seleccion (`key` del componente
  // interno). Aqui se ACOTA por si la resolucion cambio a menos tramos.
  const [tramoActivo, setTramoActivo] = useState(0);
  const nTramos = resolucion?.tramos.length ?? 0;
  const idxTramo = nTramos > 0 ? Math.min(tramoActivo, nTramos - 1) : 0;
  // Al cambiar la SELECCION, volver al tramo inferior (pie): la eleccion de tramo es de la
  // barra anterior. `seleccion[0]` como dependencia (una barra por seleccion valida).
  const seleccionKey = seleccion.length === 1 ? seleccion[0] : "";
  useEffect(() => {
    setTramoActivo(0);
  }, [seleccionKey]);

  // Serie a dibujar, para la combinacion y magnitud actuales. VIGA: una unica serie
  // CONTINUA concatenando todos sus tramos (F3.2: una viga subdividida por el acople
  // sigue siendo UNA viga; el salto de cortante en los nudos compartidos es fisico y
  // se conserva). PILAR: la serie del tramo activo del selector (D20).
  const datos = useMemo(() => {
    if (!resultados || !trazabilidad) return { estado: "sin-resultados" as const };
    if (!resolucion) return { estado: "sin-seleccion" as const };
    if (combinacionActiva === null) return { estado: "sin-combo" as const };
    const meta = META[magnitud];
    if (!resolucion.esPilar && modeloFEM) {
      const serie = serieVigaTramos(
        resolucion.tramos.map((t) => t.memberName),
        resultados,
        modeloFEM,
        combinacionActiva,
        meta.campo,
      );
      if (serie.estado !== "ok") return { estado: serie.estado };
      // Signo del convenio + conversion de presentacion en el borde, igual que
      // extraerSerie para el pilar.
      return {
        estado: "ok" as const,
        posiciones: serie.posiciones,
        valores: aPresentacion(serie.valores, meta),
      };
    }
    const tramo = resolucion.tramos[idxTramo] ?? resolucion.tramos[0]!;
    const porCombo = resultados.barras[tramo.memberName];
    // member inexistente en los resultados (no deberia pasar si trazabilidad y
    // resultados son del mismo calculo, pero lo manejamos sin romper).
    if (porCombo === undefined) return { estado: "sin-barra" as const };
    const estadoBarra = porCombo[combinacionActiva];
    // combo inexistente para esta barra (combinacion seleccionada no calculada).
    if (estadoBarra === undefined) return { estado: "sin-combo" as const };
    const serie = extraerSerie(estadoBarra, magnitud);
    return { estado: "ok" as const, ...serie };
  }, [resultados, trazabilidad, resolucion, idxTramo, combinacionActiva, magnitud, modeloFEM]);

  // [D20] Opciones del selector de tramo: una por tramo del pilar, etiquetada con su planta.
  // El Segmentado exige valores STRING (T extends string): usamos el indice como cadena y lo
  // convertimos en el borde (onValor). Solo se muestra con MAS de un tramo (una viga o un
  // pilar de una planta no lo necesita).
  const opcionesTramo: ReadonlyArray<OpcionSegmento<string>> =
    resolucion && resolucion.esPilar && resolucion.tramos.length > 1
      ? resolucion.tramos.map((t, i) => ({
          valor: String(i),
          etiqueta: t.etiqueta,
          titulo: t.etiqueta,
        }))
      : [];

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

      {/* [D20] Selector de TRAMO para un pilar que abarca varias plantas: en vez de fijar el
          tramo inferior con un aviso, se elige la planta cuyo esfuerzo se dibuja. Solo se
          muestra con mas de un tramo (una viga o un pilar de una planta no lo necesita). */}
      {opcionesTramo.length > 1 ? (
        <div className="cx-panel-diagramas__tramo">
          <span className="cx-campo__label">Tramo</span>
          <Segmentado<string>
            className="cx-panel-diagramas__seg"
            aria-label="Tramo del pilar"
            opciones={opcionesTramo}
            valor={String(idxTramo)}
            onValor={(v) => setTramoActivo(Number(v))}
          />
        </div>
      ) : null}

      <div className="cx-panel-diagramas__lienzo">
        {datos.estado === "ok" ? (
          // [AUDITORIA M-6] <Suspense> solo cubre el *pending* del lazy; si el
          // chunk de Plotly no carga (offline tras redeploy, 404 del hash) la
          // promesa RECHAZADA tumbaria el arbol entero. El boundary contiene el
          // fallo en este panel y el resto de la UI sigue viva.
          <ErrorBoundary mensaje="No se pudo cargar el diagrama. Comprueba la conexión y recarga la página.">
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
          </ErrorBoundary>
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
