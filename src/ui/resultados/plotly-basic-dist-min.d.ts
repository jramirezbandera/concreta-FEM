// El bundle reducido `plotly.js-basic-dist-min` (scatter/line: suficiente para
// N/V/M/flecha) no publica tipos propios. Declaramos un modulo ambient minimo:
// reexportamos los tipos del paquete completo `plotly.js` (presente como dep
// transitiva y con .d.ts) para que `createPlotlyComponent(Plotly)` de
// `react-plotly.js/factory` tipe sin arrastrar el bundle pesado en runtime.
declare module "plotly.js-basic-dist-min" {
  import type * as Plotly from "plotly.js";
  // El bundle exporta el namespace de Plotly como default (objeto runtime).
  const plotly: typeof Plotly;
  export default plotly;
}
