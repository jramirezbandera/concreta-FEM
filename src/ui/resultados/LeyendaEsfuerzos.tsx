// LeyendaEsfuerzos: panel HUD (glass) del overlay de esfuerzos. Hermano de
// LeyendaEscala (deformada): selector de magnitud (N/V/M), leyenda de los dos
// colores por signo con el |maximo| del combo activo, y el control del tamano de
// los diagramas (multiplicador relativo, slider logaritmico). Solo se muestra con
// el overlay "esfuerzos" activo (D9, exclusion mutua) y si hay diagramas que
// dibujar.
//
// LENGUAJE DE OBRA (CLAUDE.md §17): "Axil", "Cortante", "Momento", "positivo",
// "negativo"; nunca members/nodos. SIN conversion de unidades: los valores ya
// vienen en kN / kN·m del contrato (fmtPico solo formatea).
import { useMemo, useSyncExternalStore } from "react";
import { PanelFlotante, Segmentado } from "../primitivas";
import { resultadosStore, vistaStore } from "../../estado";
import type { MagnitudEsfuerzo, ModoVista, OverlayResultados } from "../../estado";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { esfuerzosGeometria } from "./esfuerzosGeometria";
import { fmtPico } from "./picosEsfuerzos";
import "./leyendaEsfuerzos.css";

// Opciones del selector (lenguaje de obra en el tooltip; la letra es la NOTACION
// ESTANDAR de esfuerzos con su eje: N axil, Vy cortante, Mz flector — el contrato
// del solver trae el cortante/flector del plano local x-y, de ahi los subindices).
const OPCIONES: ReadonlyArray<{
  valor: MagnitudEsfuerzo;
  etiqueta: string;
  titulo: string;
}> = [
  { valor: "axil", etiqueta: "N", titulo: "Axil (tracción +)" },
  { valor: "cortante", etiqueta: "Vy", titulo: "Cortante Vy" },
  { valor: "momento", etiqueta: "Mz", titulo: "Flector Mz (vano +)" },
];

const LETRA: Record<MagnitudEsfuerzo, string> = {
  axil: "N",
  cortante: "Vy",
  momento: "Mz",
};

// Etiquetas de la leyenda de colores por magnitud: el axil comunica el significado
// fisico del signo (convenio de presentacion: traccion +, compresion -); en
// cortante/flector el signo estandar (+/-) basta.
const ETIQUETAS_SIGNO: Record<MagnitudEsfuerzo, { pos: string; neg: string }> = {
  axil: { pos: "tracción", neg: "compresión" },
  cortante: { pos: "positivo", neg: "negativo" },
  momento: { pos: "positivo", neg: "negativo" },
};

// [D6, mismo patron que LeyendaEscala] Slider LOGARITMICO para el multiplicador
// relativo [0.1 .. 10]: cada tramo del recorrido multiplica por un factor constante
// (×1 queda en el centro). El estado (esfuerzosEscala) es el multiplicador real;
// el <input> usa la posicion.
const MULT_MIN = 0.1;
const MULT_MAX = 10;
const PASOS_SLIDER = 1000;
const LN_MIN = Math.log(MULT_MIN);
const LN_MAX = Math.log(MULT_MAX);

function posicionAMult(pos: number): number {
  const t = Math.min(1, Math.max(0, pos / PASOS_SLIDER));
  return Math.exp(LN_MIN + t * (LN_MAX - LN_MIN));
}

function multAPosicion(mult: number): number {
  const m = Math.min(MULT_MAX, Math.max(MULT_MIN, mult));
  const t = (Math.log(m) - LN_MIN) / (LN_MAX - LN_MIN);
  return Math.round(t * PASOS_SLIDER);
}

// --- Lectura reactiva (fuera del bucle de render) ----------------------------

interface Entradas {
  resultados: ResultadosCalculo | null;
  modeloFEM: ModeloFEM | null;
  vigente: boolean;
  combo: string | null;
  magnitud: MagnitudEsfuerzo;
  modoVista: ModoVista;
  overlay: OverlayResultados;
}

let snapCache: Entradas = leerEntradas();
function leerEntradas(): Entradas {
  const r = resultadosStore.getState();
  const v = vistaStore.getState();
  return {
    resultados: r.resultados,
    modeloFEM: r.modeloFEM,
    vigente: r.vigente,
    combo: v.combinacionActiva,
    magnitud: v.magnitudEsfuerzo,
    modoVista: v.modoVista,
    overlay: v.overlayResultados,
  };
}
function getSnapshot(): Entradas {
  const a = leerEntradas();
  const c = snapCache;
  if (
    a.resultados === c.resultados &&
    a.modeloFEM === c.modeloFEM &&
    a.vigente === c.vigente &&
    a.combo === c.combo &&
    a.magnitud === c.magnitud &&
    a.modoVista === c.modoVista &&
    a.overlay === c.overlay
  ) {
    return c;
  }
  snapCache = a;
  return a;
}
function suscribir(cb: () => void): () => void {
  const offR = resultadosStore.subscribe((s) => s.resultados, cb);
  const offM = resultadosStore.subscribe((s) => s.modeloFEM, cb);
  const offV = resultadosStore.subscribe((s) => s.vigente, cb);
  const offCombo = vistaStore.subscribe((s) => s.combinacionActiva, cb);
  const offMag = vistaStore.subscribe((s) => s.magnitudEsfuerzo, cb);
  const offModo = vistaStore.subscribe((s) => s.modoVista, cb);
  const offOverlay = vistaStore.subscribe((s) => s.overlayResultados, cb);
  return () => {
    offR();
    offM();
    offV();
    offCombo();
    offMag();
    offModo();
    offOverlay();
  };
}
function useEntradas(): Entradas {
  return useSyncExternalStore(suscribir, getSnapshot, getSnapshot);
}

// Multiplicador (reactivo): la leyenda lo muestra y lo controla via el slider.
function useMultiplicador(): number {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.esfuerzosEscala, cb),
    () => vistaStore.getState().esfuerzosEscala,
    () => vistaStore.getState().esfuerzosEscala,
  );
}

export function LeyendaEsfuerzos() {
  const entradas = useEntradas();
  const multiplicador = useMultiplicador();

  // |v| maximo del combo/magnitud activos (misma fuente pura que el overlay). Solo
  // se recalcula al cambiar las entradas, no por frame ni al mover el slider.
  const rango = useMemo(() => {
    const geo = esfuerzosGeometria(
      entradas.modeloFEM,
      entradas.resultados,
      entradas.combo,
      entradas.magnitud,
    );
    return { vMaxAbs: geo.vMaxAbs, hay: geo.diagramas.length > 0 };
  }, [entradas]);

  // [D9] Solo es la leyenda del overlay de ESFUERZOS: con otro overlay activo no
  // tiene nada que rotular (exclusion mutua, espejo de LeyendaEscala).
  if (entradas.overlay !== "esfuerzos") return null;
  // Sin diagramas para la combinacion activa: nada que dibujar ni controlar.
  if (!rango.hay) return null;

  // Los diagramas solo se dibujan en pleno (3D/alzados/mosaico); en planta se
  // comunica y los controles quedan atenuados/inertes (UX-H1, espejo LeyendaEscala).
  const soloEnPlanta = entradas.modoVista === "planta";

  return (
    <PanelFlotante
      className="cx-leyenda-esf"
      titulo="Esfuerzos"
      tag={entradas.vigente ? undefined : "obsoletos"}
      tagVariante={entradas.vigente ? "neutro" : "warning"}
    >
      {/* Selector de magnitud: una a la vez en TODAS las barras (estilo SAP/CYPE). */}
      <div className="cx-leyenda-esf__selector">
        <span className="cx-leyenda-esf__etq">Magnitud</span>
        <Segmentado<MagnitudEsfuerzo>
          opciones={OPCIONES}
          valor={entradas.magnitud}
          onValor={(m) => vistaStore.getState().setMagnitudEsfuerzo(m)}
          aria-label="Magnitud de esfuerzos en escena"
        />
      </div>

      {/* Leyenda de los dos colores por signo + |maximo| del combo activo. En axil
          el signo se traduce a su significado fisico (traccion/compresion). */}
      <div className="cx-leyenda-esf__colores">
        <span className="cx-leyenda-esf__color">
          <span
            className="cx-leyenda-esf__swatch"
            style={{ background: "var(--esfuerzo-pos)" }}
            aria-hidden="true"
          />
          {ETIQUETAS_SIGNO[entradas.magnitud].pos}
        </span>
        <span className="cx-leyenda-esf__color">
          <span
            className="cx-leyenda-esf__swatch"
            style={{ background: "var(--esfuerzo-neg)" }}
            aria-hidden="true"
          />
          {ETIQUETAS_SIGNO[entradas.magnitud].neg}
        </span>
      </div>
      <p className="cx-leyenda-esf__max mono tnum">
        máx |{LETRA[entradas.magnitud]}| = {fmtPico(rango.vMaxAbs, entradas.magnitud)}
      </p>

      {/* Guia cuando estamos en planta (UX-H1): el overlay se ve en 3D. */}
      {soloEnPlanta && (
        <p className="cx-leyenda-esf__guia" role="note">
          Los diagramas de esfuerzos se muestran en la vista 3D.
        </p>
      )}

      {/* Tamano relativo de los diagramas (multiplicador sobre la escala automatica). */}
      <label
        className={
          soloEnPlanta
            ? "cx-leyenda-esf__control cx-leyenda-esf__control--off"
            : "cx-leyenda-esf__control"
        }
      >
        <span className="cx-leyenda-esf__etq">
          Tamaño <span className="mono tnum">×{multiplicador.toFixed(1)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={PASOS_SLIDER}
          step={1}
          value={multAPosicion(multiplicador)}
          disabled={soloEnPlanta}
          onChange={(e) =>
            vistaStore.getState().setEsfuerzosEscala(posicionAMult(Number(e.target.value)))
          }
          aria-label="Tamaño de los diagramas de esfuerzos"
        />
      </label>
    </PanelFlotante>
  );
}
