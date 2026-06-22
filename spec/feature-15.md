# feature-15 · Plantillas DXF y capturas

> Tier 4 · UI · **Dependencias: feature-9** (dura); **feature-11, feature-12** (blanda: el snapping de pilares/vigas a entidades del DXF requiere sus herramientas — la importación/visualización del DXF no) · Bloquea: — (parte de F1, independiente del flujo de cálculo).

## Objetivo

Permitir importar una **plantilla DXF** como fondo de la planta activa (para calcar la obra) y tomar **capturas** del viewport. F1 incluye plantillas DXF explícitamente (`CLAUDE.md §15`).

## Alcance

**Incluye** (`/src/ui/viewport` + herramientas arriba-derecha del shell)
- Importar un fichero **DXF** y dibujarlo como fondo 2D en la planta del grupo activo.
- Controles de **escala, origen y rotación** de la plantilla; bloquear/ocultar; opacidad.
- Gestión **por planta/grupo** (cada planta puede tener su plantilla).
- **Snapping** del dibujo de pilares/vigas a entidades del DXF (líneas/puntos) — coordinar con feature-11/12.
- **Capturas** del viewport (export PNG de la vista actual).

**Excluye**: edición del DXF, exportar a DXF, isovalores (F3). Solo lectura/visualización como plantilla.

## Entradas de I+D / CLAUDE.md

- `CLAUDE.md §11` (plantillas DXF F4 en la barra de herramientas, capturas), `§15` (F1 incluye plantillas DXF).
- Área 3 (viewport).

## Criterios de aceptación

- Importar un DXF lo muestra como fondo de la planta, con escala/origen ajustables.
- La plantilla se asocia a la planta/grupo y persiste en `vistaStore` (y se guarda como referencia, no como Capa 1 de cálculo).
- Se puede capturar la vista a PNG.
- El snapping a la plantilla funciona al introducir pilares/vigas.

## Notas / riesgos

- DXF puede ser pesado/variado: empezar con entidades básicas (LINE/LWPOLYLINE/POINT); documentar lo no soportado.
- La plantilla es ayuda de dibujo, **no** entra en el modelo de cálculo.
- Elegir librería DXF ligera (evaluar coste; no inflar el bundle).
