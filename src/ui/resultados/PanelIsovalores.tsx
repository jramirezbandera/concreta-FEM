// PanelIsovalores: panel HUD (HTML) de la pestana Isovalores (F3). Ofrece el selector de
// magnitud (Flecha / Mx / My) y la leyenda de rampa generica (LeyendaRampa) con el rango
// min->max de la magnitud activa y su unidad. Estilo glass coherente con el resto del HUD.
//
// Espejo de LeyendaEscala (deformada), pero con un SELECTOR de magnitud en vez del slider
// de amplificacion. La rampa la pinta LeyendaRampa (compartida). Se autooculta si no hay
// resultados de placa para la combinacion activa (un portico sin losa no muestra panel).
//
// LENGUAJE DE OBRA (CLAUDE.md §17): "Flecha", "Momento Mx", "Momento My"; nunca "quad" ni
// "nodo". UNIDADES (CLAUDE.md §14): la flecha (m interno) se pasa a mm SOLO aqui, en el
// borde (mToMm); Mx/My ya estan en kN·m/m (identidad, sin conversion).
import { useMemo, useSyncExternalStore } from "react";
import { PanelFlotante, Segmentado } from "../primitivas";
import { resultadosStore, vistaStore } from "../../estado";
import type { MagnitudIsovalores } from "../../estado";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { mToMm } from "../../unidades";
import { construirBuffersIsovalores } from "./isovaloresBuffers";
import { LeyendaRampa } from "./LeyendaRampa";
import "./panelIsovalores.css";

// Opciones del selector de magnitud (lenguaje de obra). El identificador interno
// (flecha/momentoX/momentoY) va en vistaStore; aqui solo la etiqueta visible.
const OPCIONES: ReadonlyArray<{
  valor: MagnitudIsovalores;
  etiqueta: string;
  titulo: string;
}> = [
  { valor: "flecha", etiqueta: "Flecha", titulo: "Flecha (desplazamiento vertical)" },
  { valor: "momentoX", etiqueta: "Mx", titulo: "Momento Mx por unidad de ancho" },
  { valor: "momentoY", etiqueta: "My", titulo: "Momento My por unidad de ancho" },
];

// Etiqueta de unidad de la leyenda por magnitud (lenguaje de obra + unidad).
const UNIDAD: Record<MagnitudIsovalores, string> = {
  flecha: "flecha (mm)",
  momentoX: "momento Mx (kN·m/m)",
  momentoY: "momento My (kN·m/m)",
};

// --- Lectura reactiva (fuera del bucle de render) ----------------------------

interface Entradas {
  modeloFEM: ModeloFEM | null;
  trazabilidad: Trazabilidad | null;
  resultados: ResultadosCalculo | null;
  combo: string | null;
  magnitud: MagnitudIsovalores;
}

let snapCache: Entradas = leerEntradas();
function leerEntradas(): Entradas {
  const r = resultadosStore.getState();
  const v = vistaStore.getState();
  return {
    modeloFEM: r.modeloFEM,
    trazabilidad: r.trazabilidad,
    resultados: r.resultados,
    combo: v.combinacionActiva,
    magnitud: v.magnitudIsovalores,
  };
}
function getSnapshot(): Entradas {
  const a = leerEntradas();
  const c = snapCache;
  if (
    a.modeloFEM === c.modeloFEM &&
    a.trazabilidad === c.trazabilidad &&
    a.resultados === c.resultados &&
    a.combo === c.combo &&
    a.magnitud === c.magnitud
  ) {
    return c;
  }
  snapCache = a;
  return a;
}
function suscribir(cb: () => void): () => void {
  const offM = resultadosStore.subscribe((s) => s.modeloFEM, cb);
  const offT = resultadosStore.subscribe((s) => s.trazabilidad, cb);
  const offR = resultadosStore.subscribe((s) => s.resultados, cb);
  const offCombo = vistaStore.subscribe((s) => s.combinacionActiva, cb);
  const offMag = vistaStore.subscribe((s) => s.magnitudIsovalores, cb);
  return () => {
    offM();
    offT();
    offR();
    offCombo();
    offMag();
  };
}
function useEntradas(): Entradas {
  return useSyncExternalStore(suscribir, getSnapshot, getSnapshot);
}

export function PanelIsovalores() {
  const entradas = useEntradas();
  const setMagnitud = vistaStore.getState().setMagnitudIsovalores;

  // Rango (min->max) de la magnitud activa, calculado solo al cambiar las entradas. Reusa
  // la derivacion pura (misma fuente que el overlay): null si no hay resultados de placa.
  const rango = useMemo(() => {
    const b = construirBuffersIsovalores({
      modeloFEM: entradas.modeloFEM,
      trazabilidad: entradas.trazabilidad,
      resultados: entradas.resultados,
      combo: entradas.combo,
      magnitud: entradas.magnitud,
    });
    if (!b) return null;
    return { min: b.valorMin, max: b.valorMax };
  }, [entradas]);

  // Sin resultados de placa: no mostramos el panel (un portico sin losa no tiene
  // isovalores). El overlay tambien se autooculta.
  if (!rango) return null;

  // Conversion de presentacion SOLO en el borde: la flecha (m interno) -> mm; Mx/My ya
  // estan en kN·m/m (identidad).
  const esFlecha = entradas.magnitud === "flecha";
  const min = esFlecha ? mToMm(rango.min) : rango.min;
  const max = esFlecha ? mToMm(rango.max) : rango.max;

  return (
    <PanelFlotante className="cx-isovalores" titulo="Isovalores" tag="losa">
      <div className="cx-isovalores__selector">
        <span className="cx-campo__label">Magnitud</span>
        <Segmentado<MagnitudIsovalores>
          opciones={OPCIONES}
          valor={entradas.magnitud}
          onValor={setMagnitud}
          aria-label="Magnitud de isovalores"
        />
      </div>

      <LeyendaRampa
        min={min}
        max={max}
        unidad={UNIDAD[entradas.magnitud]}
        decimales={esFlecha ? 1 : 2}
      />
    </PanelFlotante>
  );
}
