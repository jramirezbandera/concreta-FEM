# feature-11 · Entrada de pilares

> Tier 3 · UI · **Dependencias: feature-9, feature-10** · Bloquea: 12, 13.

## Objetivo

Pestaña **Entrada de pilares**: introducir pilares gráficamente en la planta del grupo activo y editar sus propiedades por inspector, todo reversible (undo/redo).

## Alcance

**Incluye** (`/src/ui/entradaPilares`, `/src/ui/inspector`)
- Herramienta de introducción gráfica: clic en planta crea un `Pilar` en `(x,y)` con `plantaInicial/plantaFinal`.
- Snapping a rejilla / a plantilla DXF (si existe, feature-15).
- **Inspector de pilar**: `seccionId` (biblioteca feature-3), `materialId`, `angulo`, `arranque` (empotrado/articulado/elástico), `vinculacionExterior`.
- Selección/hover (de `seleccionStore`); render de pilares en el viewport (instancing).
- Todas las ediciones como **comandos** (feature-7); coalescing en arrastres de reposición.
- Mover/duplicar/eliminar pilares.

**Excluye**: cálculo, discretización (es la Capa 1; el discretizador feature-4 ya sabe convertir estos campos), cargas (feature-13).

## Entradas de I+D / CLAUDE.md

- `CLAUDE.md §6` (`Pilar`), `§7` (cómo se discretiza: pilar→member vertical; arranque empotrado+vinculación→support), `§11`.
- Hallazgo #11 (interacción de viewport: refs en `useFrame`, no `setState` por frame).

## Criterios de aceptación

- Se crean pilares con clic; aparecen en el viewport en su posición.
- El inspector edita sección/material/ángulo/arranque/vinculación y se refleja.
- Crear/mover/eliminar son reversibles (undo/redo); arrastre = un paso de undo.
- Editar invalida resultados (`resultadosStore`).
- Component test (RTL) del inspector.

## Notas / riesgos

- No exponer jerga FEM (nada de "nodo"/"member") en la UI de F1. El modo "Ver modelo de cálculo" (que sí mostraría la Capa 2 generada) es **F2**: no implementarlo ni referenciarlo aquí.
- Reusar primitivas e interacción del viewport de feature-9 (no reimplementar picking).
