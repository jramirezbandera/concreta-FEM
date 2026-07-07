// SelectorOverlayResultados: conmutador de la VISUALIZACION de resultados en escena
// (Deformada | Esfuerzos), en glass junto al lienzo (Slot mid-right, encima de las
// leyendas). Escribe vistaStore.overlayResultados (D9, exclusion mutua).
//
// Con la FORMA MODAL activa (overlay "modal") ningun segmento queda marcado y pulsar
// cualquiera SALE del modo modal (coherente con PanelFrecuencias, que sigue siendo
// la puerta de entrada al modal). Se autooculta sin resultados (el dock ya guia a
// calcular).
import { useSyncExternalStore } from "react";
import { PanelFlotante, Segmentado } from "../primitivas";
import { resultadosStore, vistaStore } from "../../estado";
import type { OverlayResultados } from "../../estado";
import "./selectorOverlayResultados.css";

const OPCIONES: ReadonlyArray<{
  valor: OverlayResultados;
  etiqueta: string;
  titulo: string;
}> = [
  { valor: "deformada", etiqueta: "Deformada", titulo: "Deformada de la estructura" },
  {
    valor: "esfuerzos",
    etiqueta: "Esfuerzos",
    titulo: "Diagramas de esfuerzos (N/V/M) sobre las barras",
  },
];

function useHayResultados(): boolean {
  return useSyncExternalStore(
    (cb) => resultadosStore.subscribe((s) => s.resultados, cb),
    () => resultadosStore.getState().resultados !== null,
    () => resultadosStore.getState().resultados !== null,
  );
}

function useOverlay(): OverlayResultados {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.overlayResultados, cb),
    () => vistaStore.getState().overlayResultados,
    () => vistaStore.getState().overlayResultados,
  );
}

export function SelectorOverlayResultados() {
  const hayResultados = useHayResultados();
  const overlay = useOverlay();

  if (!hayResultados) return null;

  return (
    <PanelFlotante className="cx-selector-overlay">
      {/* Con overlay "modal" el valor no casa con ningun segmento: ninguno marcado. */}
      <Segmentado<OverlayResultados>
        opciones={OPCIONES}
        valor={overlay}
        onValor={(v) => vistaStore.getState().setOverlayResultados(v)}
        aria-label="Visualización de resultados en escena"
      />
    </PanelFlotante>
  );
}
