# feature-12 · Entrada de vigas

> Tier 3 · UI · **Dependencias: feature-9, feature-11** · Bloquea: 13.

## Objetivo

Pestaña **Entrada de vigas**: introducir vigas gráficamente entre nudos en la planta del grupo activo, con sus condiciones de extremo, y editarlas por inspector (undo/redo).

## Alcance

**Incluye** (`/src/ui/entradaVigas`, `/src/ui/inspector`)
- Herramienta de introducción gráfica: dibujar viga entre dos puntos/nudos (`nudoI`, `nudoJ`) sobre la planta activa.
- Snapping a cabezas de pilar y a otras vigas; tolerancia coherente con el discretizador (`1e-3` m).
- **Inspector de viga**: `seccionId`, `materialId`, `extremoI`/`extremoJ` (empotrado/articulado), `tirante`.
- Selección/hover; render de vigas en el viewport (instancing).
- Ediciones como **comandos** (feature-7); mover/dividir/eliminar.

**Excluye**: cálculo y discretización (feature-4 ya convierte: viga→member, articulado→releases Ry/Rz), cargas (feature-13).

## Entradas de I+D / CLAUDE.md

- `CLAUDE.md §6` (`Viga`), `§7` (viga→member; `extremo=articulado`→releases; **nunca liberar Rx en ambos**, hallazgo #8).
- Hallazgo #11 (viewport).

## Criterios de aceptación

- Se dibujan vigas entre nudos; comparten nudo con pilares donde coincide la geometría.
- El inspector edita sección/material/extremos/tirante y se refleja.
- Crear/mover/eliminar reversibles (undo/redo); editar invalida resultados.
- Articular un extremo se traduce (en feature-4) a release de flexión, no de torsión — verificar visualmente que el campo de dominio es coherente.
- Component test (RTL) del inspector.

## Notas / riesgos

- El snapping debe casar con la tolerancia del discretizador para que se compartan nudos.
- Sin jerga FEM en la UI de F1 (el modo "Ver modelo de cálculo" que mostraría la Capa 2 es F2).
