import { lazy } from "react";

// Carga diferida de <DiagramaBarra>: Plotly pesa ~1 MB gzip (hallazgo #21), asi
// que solo se descarga al entrar en Resultados y abrir un diagrama, no en el
// arranque. El consumidor debe envolver el uso en un <Suspense> con su fallback
// ("dibujando diagrama..."). El propio DiagramaBarra es la frontera tras la que
// se aisla Plotly (puerta a uPlot), por eso el import perezoso apunta a el.
export const DiagramaBarraLazy = lazy(() => import("./DiagramaBarra"));
