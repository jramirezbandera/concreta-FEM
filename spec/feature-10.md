# feature-10 · Diálogo de Grupos y Plantas

> Tier 3 · UI · **Dependencias: feature-7, feature-9** · Bloquea: 11, 12, 13.

## Objetivo

Permitir definir la **estructura vertical de la obra**: grupos y plantas, con sus cotas, alturas y datos de carga por grupo. Es el primer paso del flujo F1 y fija el "grupo activo" sobre el que se introduce todo lo demás.

## Alcance

**Incluye** (`/src/ui/dialogos`)
- Diálogo (Radix Dialog) para crear/editar/eliminar **grupos** y **plantas**.
- Por **grupo**: `nombre`, `categoriaUso` (enum de feature-2), `sobrecargaUso`, `cargasMuertas`.
- Por **planta**: `nombre`, `cota`, `altura`, `grupoId`.
- Edición vía **comandos** (undo/redo, feature-7).
- Fijar **grupo activo** y **planta activa** en `vistaStore`; el viewport (feature-9) reacciona.
- Validación de UI (cotas coherentes, nombres únicos) con mensajes en español.

**Excluye**: pilares/vigas (feature-11/12), cargas detalladas (feature-13), valores normativos de qk/ψ (feature-13; aquí solo se selecciona la categoría).

## Entradas de I+D / CLAUDE.md

- `CLAUDE.md §6` (`Grupo`, `Planta`), `§11`.
- Hallazgo #7 (la `CategoriaUso` del grupo deriva qk/ψ — se consume en feature-13).

## Criterios de aceptación

- Crear/editar/eliminar grupos y plantas con undo/redo.
- Seleccionar grupo activo actualiza el viewport (muestra la planta del grupo).
- Nombres únicos validados; mensajes en español con tildes.
- Component test (RTL, jsdom) del diálogo.

## Notas / riesgos

- Vocabulario CYPECAD: "Grupo", "Planta" (no jerga FEM).
- No exponer aquí nada de la Capa 2.
