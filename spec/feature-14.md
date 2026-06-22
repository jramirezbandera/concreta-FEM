# feature-14 · Resultados (deformada + diagramas + reacciones)

> Tier 4 · UI · **Dependencias: feature-5, feature-6, feature-9, feature-13** · Bloquea: 16.

## Objetivo

Pestaña **Resultados**: disparar el cálculo asíncrono y visualizar **deformada 3D**, **diagramas de esfuerzos** (N/V/M/flecha) por barra y **tabla de reacciones**, con selector de combinación. Cierra el corte vertical F1.

## Alcance

**Incluye** (`/src/ui/resultados`)
- Botón **Calcular**: `modelo` → `discretizar()` (feature-4) → `solverClient.calcular()` (feature-5). Estados visibles **"cargando motor"** y **"calculando"**; "Calcular" habilitado cuando el worker está listo.
- **Deformada 3D**: escala de colores + **animación**, factor de escala ajustable, sobre la geometría del viewport (feature-9). Mutación de refs en `useFrame` (hallazgo #11).
- **Diagramas por barra** N/V/M/flecha: componente aislado **`<DiagramaBarra>`** sobre **Plotly** (`react-plotly.js`), mapeando directo desde los `*_array()` de PyNite (hallazgo #21). Aislar tras la interfaz del componente para poder migrar a uPlot si crece.
- **Tabla de reacciones** (datos numéricos en monoespaciada).
- **Selector de combinación** (de `vistaStore`).
- Lectura de resultados desde `resultadosStore` (derivados; se limpian al editar la obra).

**Excluye**: isovalores/paños (F3), cálculo P-Δ/modal (F2). Solo análisis lineal/general de F1.

## Entradas de I+D

- Hallazgos #11 (deformada por refs), #21 (Plotly aislado, migrable a uPlot), #6 (solver asíncrono).
- `CLAUDE.md §11` (pantalla Resultados), Área 3 §7.

## Criterios de aceptación

- Calcular ejecuta el pipeline completo sin bloquear la UI, con estados motor/calculando visibles.
- La deformada se muestra con escala de color y se anima; el factor de escala funciona.
- Los diagramas N/V/M/flecha se dibujan desde los arrays de PyNite para la barra seleccionada.
- La tabla de reacciones muestra valores correctos para la combinación activa.
- Cambiar de combinación actualiza deformada/diagramas/reacciones.
- Editar la obra invalida y limpia los resultados mostrados.

## Notas / riesgos

- Plotly pesa ~1 MB gzip: cargarlo lazy y mantenerlo tras `<DiagramaBarra>` (puerta a uPlot).
- No materializar ndarrays gigantes innecesarios cruzando Comlink (feature-5 ya entrega typed arrays).
