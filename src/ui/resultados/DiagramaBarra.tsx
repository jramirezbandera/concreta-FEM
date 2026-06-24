// DiagramaBarra (feature-14, Tarea 2.2): diagrama de esfuerzo a lo largo de UNA
// barra (axil / cortante / flector / flecha) sobre Plotly. Este modulo es la
// FRONTERA tras la que aislamos Plotly (hallazgo #21): todo el acoplamiento a la
// libreria vive AQUI, de modo que migrar a uPlot solo toque este fichero. Hacia
// fuera la interfaz es GENERICA y agnostica: recibe arrays ya extraidos
// (posiciones x[], valores v[]) + metadatos de presentacion; no conoce PyNite ni
// la forma de los `*_array()`. Por eso es el destino del import lazy (Plotly pesa
// ~1 MB gzip): solo se descarga al abrir un diagrama, no en el arranque.
//
// UNIDADES (CLAUDE.md §14): el panel ya entrega valores en unidades de
// presentacion (flecha en mm; N/V/M en kN/kN·m); aqui NO se convierte nada, solo
// se dibuja. La etiqueta del eje (unidad) llega como prop.

import { useMemo } from "react";
import createPlotlyComponent from "react-plotly.js/factory";
// El bundle reducido trae lo justo para scatter/line (suficiente para N/V/M/flecha).
// Su .d.ts ambient (plotly-basic-dist-min.d.ts) reexpone los tipos de plotly.js.
import Plotly from "plotly.js-basic-dist-min";
import type { Layout, Config, Data } from "plotly.js";

// react-plotly.js/factory NO publica tipos para el factory en si (solo para el
// componente por defecto); el cast acotado evita un `any` mas ancho. Construir el
// componente UNA vez a nivel de modulo: es estable y no debe recrearse por render.
const Plot = createPlotlyComponent(
  Plotly as unknown as Parameters<typeof createPlotlyComponent>[0],
);

export interface PropiedadesDiagramaBarra {
  // Posiciones a lo largo de la barra, en metros (eje X del diagrama).
  posiciones: readonly number[];
  // Valor del esfuerzo en cada posicion, ya en unidades de presentacion.
  valores: readonly number[];
  // Etiqueta del eje Y con su unidad, en lenguaje de obra ("Momento (kN·m)").
  etiquetaY: string;
  // Color de la curva (token semantico resuelto por el llamante).
  color: string;
}

export default function DiagramaBarra({
  posiciones,
  valores,
  etiquetaY,
  color,
}: PropiedadesDiagramaBarra) {
  // Memoizamos las estructuras que Plotly consume para no recrearlas en cada
  // render (evita re-dibujos innecesarios; el panel re-renderiza al cambiar
  // seleccion/combo/magnitud, pero si los arrays no cambian no rehacemos el plot).
  const data = useMemo<Data[]>(
    () => [
      {
        type: "scatter",
        mode: "lines",
        x: posiciones as number[],
        y: valores as number[],
        line: { color, width: 2 },
        // Relleno hasta el eje 0: lectura tipica de un diagrama N/V/M (area bajo
        // la curva). "tozeroy" sombrea entre la curva y y=0, respetando el signo.
        fill: "tozeroy",
        fillcolor: aClaro(color),
        hovertemplate: "x = %{x:.2f} m<br>%{y:.3g}<extra></extra>",
      },
    ],
    [posiciones, valores, color],
  );

  const layout = useMemo<Partial<Layout>>(
    () => ({
      autosize: true,
      margin: { l: 52, r: 12, t: 8, b: 36 },
      // Transparente: el diagrama se integra en el panel glass (toma su fondo).
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: {
        // Mono para datos numericos (coherente con el tema CAD del proyecto).
        family:
          "Geist Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        size: 11,
        color: "var(--text-2, #5a6678)",
      },
      showlegend: false,
      xaxis: {
        title: { text: "Posición (m)", font: { size: 11 } },
        zeroline: false,
        gridcolor: "var(--border, #e2e7ee)",
        linecolor: "var(--border-2, #d2d9e2)",
        ticks: "outside",
        ticklen: 3,
      },
      yaxis: {
        title: { text: etiquetaY, font: { size: 11 } },
        // Linea base del esfuerzo (y=0): referencia clave para leer signo.
        zeroline: true,
        zerolinecolor: "var(--border-strong, #b9c2cf)",
        zerolinewidth: 1,
        gridcolor: "var(--border, #e2e7ee)",
        linecolor: "var(--border-2, #d2d9e2)",
        ticks: "outside",
        ticklen: 3,
      },
    }),
    [etiquetaY],
  );

  const config = useMemo<Partial<Config>>(
    () => ({
      // Sin barra de modo intrusiva: es un diagrama de lectura, no un editor.
      displayModeBar: false,
      responsive: true,
      // Sin logo de Plotly ni enlaces de edicion (estetica de producto propia).
      displaylogo: false,
    }),
    [],
  );

  return (
    <Plot
      data={data}
      layout={layout}
      config={config}
      // El contenedor (PanelDiagramas) fija el tamano; el plot se adapta a el.
      style={{ width: "100%", height: "100%" }}
      // Reaccionar al resize del contenedor (panel redimensionable / responsive).
      useResizeHandler
    />
  );
}

// Deriva un relleno tenue del color de la curva. El color llega como cadena CSS
// (puede ser var(--token), hex o rgb); no podemos parsearla aqui de forma fiable,
// asi que envolvemos en color-mix con transparente: soportado por los navegadores
// objetivo (Chromium) y degrada a sin relleno si no se soporta. Aislado en una
// helper para no repetir la cadena y dejar un unico punto si cambia el criterio.
function aClaro(color: string): string {
  return `color-mix(in srgb, ${color} 16%, transparent)`;
}
