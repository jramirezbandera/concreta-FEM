# feature-9 · Shell de UI + viewport R3F base

> Tier 2 · UI · **Dependencias: feature-7** · Bloquea: 10–15.

## Objetivo

Montar el **armazón de la interfaz** (pestañas, menús, paneles, barra de estado) calcado a CYPECAD, y la **escena R3F base** (planta 2D / 3D) sobre la que las demás features de UI dibujan. Aquí se fijan las reglas de rendimiento del viewport.

## Alcance

**Incluye** (`/src/ui/shell`, `/src/ui/viewport`)
- **Shell**: 4 pestañas abajo-izquierda (**Entrada de pilares · Entrada de vigas · Resultados · Isovalores**; Isovalores presente pero deshabilitada/placeholder en F1); barra de menús superior que cambia por pestaña; barra lateral izquierda (gestión de vistas, elementos, árbol de obra); herramientas arriba-derecha; barra de estado inferior con línea de mensajes.
- Radix UI (Dialog/Tabs/Popover) + Tailwind con **CSS variables semánticas** como tokens; componentes shadcn copiados al repo (control del estilo CAD oscuro) (hallazgo #22).
- **Viewport R3F** (three.js + R3F + drei):
  - Cámara **ortográfica** (planta) / **perspectiva** (3D) con `makeDefault`; reanclar controles al conmutar (corrección de verificación).
  - Vista en planta del **grupo activo** (de `vistaStore`), conmutable a 3D o mosaico.
  - **Reglas de rendimiento (hallazgo #11):** nada de alta frecuencia por `setState`. Cámara/hover/drag → **mutación de refs en `useFrame`** + transient updates de Zustand (`subscribe`, requiere `subscribeWithSelector` de feature-7). `frameloop="demand"` + `invalidate()`.
  - **Picking con `<Bvh>`** (three-mesh-bvh); **`InstancedMesh`** directo para barras/nudos masivos (preferir sobre `<Instances>` por overhead CPU — corrección de verificación).
  - Gizmo de orientación; rejilla; ejes.

**Excluye**: introducción real de pilares/vigas (feature-11/12), render de resultados/deformada (feature-14), plantillas DXF (feature-15). Aquí solo el lienzo y las primitivas reutilizables.

## Entradas de I+D

- Hallazgos #11 (viewport), #22 (Radix/shadcn/Tailwind).
- `CLAUDE.md §11`, `Concreta_Estructuras_Spec_Frontend.md`, Área 3.

## Criterios de aceptación

- Las 4 pestañas conmutan y la barra de menús cambia con la pestaña activa.
- El viewport muestra la planta del grupo activo y conmuta planta↔3D reanclando controles.
- `frameloop="demand"`: el lienzo no re-renderiza en reposo (verificable).
- Hover/drag de prueba usan mutación de refs, no `setState` por frame.
- Picking con `<Bvh>` selecciona la primitiva bajo el cursor.
- Estilo CAD oscuro con tokens CSS; componentes Radix accesibles.

## Notas / riesgos

- No meter el `Modelo` en el bucle reactivo de render (el modelo se lee, no se re-renderiza por frame).
- Dejar APIs/props limpias para que feature-11/12/14 inyecten geometría sin tocar el núcleo del viewport.
