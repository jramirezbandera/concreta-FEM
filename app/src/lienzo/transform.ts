// Copiado de concreta-v2/src/lib/canvas/transform.ts (© Javier Ramírez Bandera; V-a en docs/fem3d/visor.md) con ZOOM_MAX = 64 en vez de 8.
// Lienzos de barras — transform mundo ↔ pantalla (autofit + encuadre de cámara).
//
// Compartido por FEM 2D y FEM 1D: el gesto de cámara no puede divergir entre
// los dos módulos, así que la matemática vive aquí y cada lienzo aporta solo su
// autofit (el 2D con `makeTransform` sobre nudos x/y; el 1D con su banda
// horizontal). Vivía en `features/fem2d/transform.ts` hasta que el 1D pidió la
// misma cámara — se promovió tal cual, sin cambiar una línea de la matemática.
//
// Dos capas, deliberadamente separadas:
//
//   makeTransform(nodes, w, h, insets)   ← AUTOFIT PURO (lo que siempre hubo)
//        │                                  aspect-preserving, centra el bbox de
//        │                                  nudos en el viewport menos insets.
//        │                                  Los 4 clones PDF llaman SOLO a esto:
//        │                                  la figura exportada no puede moverse.
//        ▼
//   withView(t, view)                    ← CÁMARA (zoom/encuadre de pantalla)
//                                           sx' = k·sx + tx ; sy' = k·sy + ty
//
// Propiedad clave del diseño: withView escala la GEOMETRÍA, no el dibujo. Los
// trazos, glifos, textos y las tolerancias de hit-testing se siguen midiendo en
// píxeles de pantalla, así que acercarse SEPARA las etiquetas en vez de
// ampliarlas — que es justo lo que resuelve el solape de N/M en la Pratt. Es la
// diferencia entre un CAD y un zoom de imagen.
//
// Invariante: k = 1 ⇒ tx = ty = 0 ⇒ withView es la identidad, y el encuadre
// coincide EXACTAMENTE con el autofit (clampView lo garantiza).
//
// Este módulo es PURO y NO IMPORTA NADA a propósito: es la pieza compartida por
// pantalla y PDF, y su ausencia de dependencias es lo que la hace trivialmente
// testeable. El cálculo de los límites navegables (que sí necesita mirar cargas,
// glifos y etiquetas) vive en drawableBounds.ts; clampView recibe el rectángulo
// ya calculado.
//
// Insets: el editor reserva gutters izquierdo/inferior para las cadenas de cotas;
// el lienzo de solo lectura pasa un margen uniforme.

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Transform2D {
  /** world x (m) → screen px */
  sx: (x: number) => number;
  /** world y (m) → screen px (flipped: +y up) */
  sy: (y: number) => number;
  /** px per metre */
  scale: number;
  /** screen px → world m */
  invert: (px: number, py: number) => { x: number; y: number };
}

/** Estado de cámara del lienzo. k=1, tx=ty=0 ⇒ autofit exacto. */
export interface CanvasView2D {
  /** Factor de zoom respecto al autofit. */
  k: number;
  /** Desplazamiento horizontal en px de pantalla. */
  tx: number;
  /** Desplazamiento vertical en px de pantalla. */
  ty: number;
}

/** Rectángulo en px de pantalla (coordenadas del transform SIN cámara). */
export interface BoundsRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const ZOOM_MIN = 1;
// Visor: una planta de 60 m se recorre hasta un pilar; en Concreta, 8.
export const ZOOM_MAX = 64;
/** Píxeles del dibujo que deben seguir visibles tras cualquier encuadre. */
export const PAN_KEEP_VISIBLE_PX = 40;

export const IDENTITY_VIEW: CanvasView2D = { k: 1, tx: 0, ty: 0 };

export const isIdentityView = (v: CanvasView2D): boolean =>
  v.k === 1 && v.tx === 0 && v.ty === 0;

export function uniformInsets(pad: number): Insets {
  return { left: pad, right: pad, top: pad, bottom: pad };
}

export function makeTransform(
  nodes: ReadonlyArray<{ x: number; y: number }>,
  width: number,
  height: number,
  insets: Insets,
): Transform2D {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 10;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 3;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const availW = Math.max(40, width - insets.left - insets.right);
  const availH = Math.max(40, height - insets.top - insets.bottom);
  const scale = Math.min(availW / spanX, availH / spanY);

  const drawW = spanX * scale;
  const drawH = spanY * scale;
  // Centre the drawing inside the inset viewport (offY is implicit in `sy`:
  // it anchors from the bottom inset + centering gap).
  const offX = insets.left + (availW - drawW) / 2;

  const sx = (x: number) => offX + (x - minX) * scale;
  const sy = (y: number) => height - insets.bottom - (availH - drawH) / 2 - (y - minY) * scale;
  const invert = (px: number, py: number) => ({
    x: minX + (px - offX) / scale,
    y: minY + (height - insets.bottom - (availH - drawH) / 2 - py) / scale,
  });

  return { sx, sy, scale, invert };
}

/**
 * Envuelve un transform de autofit con el estado de cámara. La geometría escala
 * y se desplaza; todo lo que se dibuje en px (trazos, glifos, textos, hit) se
 * mantiene constante porque no pasa por aquí.
 *
 * Con la vista identidad devuelve el MISMO objeto: los consumidores que no usan
 * cámara (clones PDF) no pagan ni una indirección, y el invariante "k=1 es
 * exactamente el autofit" queda garantizado por identidad referencial.
 */
export function withView(t: Transform2D, view: CanvasView2D): Transform2D {
  if (isIdentityView(view)) return t;
  const { k, tx, ty } = view;
  return {
    sx: (x: number) => t.sx(x) * k + tx,
    sy: (y: number) => t.sy(y) * k + ty,
    scale: t.scale * k,
    invert: (px: number, py: number) => t.invert((px - tx) / k, (py - ty) / k),
  };
}

/** Satura k al rango permitido. */
export const clampZoom = (k: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(k) ? k : ZOOM_MIN));

/**
 * Normaliza una vista: satura el zoom y acota el encuadre para que el dibujo
 * nunca salga por completo del viewport (siempre quedan PAN_KEEP_VISIBLE_PX
 * visibles en cada eje).
 *
 * `bounds` es el rectángulo dibujable en px del transform SIN cámara — la unión
 * de las 5 vistas (ver drawableBounds.ts), de modo que cambiar de pestaña no
 * puede mutar el encuadre.
 *
 * En k = 1 fuerza tx = ty = 0: el suelo del zoom es el autofit exacto.
 */
export function clampView(
  view: CanvasView2D,
  viewport: { width: number; height: number },
  bounds: BoundsRect,
): CanvasView2D {
  const k = clampZoom(view.k);
  if (k === ZOOM_MIN) return IDENTITY_VIEW;

  const keep = PAN_KEEP_VISIBLE_PX;
  // Extremos del dibujo ya escalados; tx sólo los traslada.
  const left = bounds.minX * k;
  const right = bounds.maxX * k;
  const top = bounds.minY * k;
  const bottom = bounds.maxY * k;

  // El borde derecho no puede quedar antes de `keep`, ni el izquierdo pasar de
  // width - keep. Si el dibujo es más pequeño que ese margen, el clamp se
  // relaja al propio tamaño del dibujo (evita rangos invertidos).
  const spanX = Math.max(1, right - left);
  const spanY = Math.max(1, bottom - top);
  const keepX = Math.min(keep, spanX);
  const keepY = Math.min(keep, spanY);

  const txMin = keepX - right;
  const txMax = viewport.width - keepX - left;
  const tyMin = keepY - bottom;
  const tyMax = viewport.height - keepY - top;

  const tx = Math.min(txMax, Math.max(txMin, Number.isFinite(view.tx) ? view.tx : 0));
  const ty = Math.min(tyMax, Math.max(tyMin, Number.isFinite(view.ty) ? view.ty : 0));

  return { k, tx, ty };
}

/**
 * Zoom manteniendo fijo el punto de pantalla (px, py) — el gesto "zoom al
 * cursor". El punto del mundo bajo el cursor no se mueve.
 *
 * Deriva: para que la posición de pantalla P de un punto se conserve al pasar
 * de k a k', hace falta tx' = P - (P - tx)·k'/k.
 */
export function zoomAt(
  view: CanvasView2D,
  factor: number,
  px: number,
  py: number,
): CanvasView2D {
  const k = clampZoom(view.k * factor);
  const ratio = k / view.k;
  return {
    k,
    tx: px - (px - view.tx) * ratio,
    ty: py - (py - view.ty) * ratio,
  };
}

/**
 * Reencuadra tras un cambio de tamaño del contenedor conservando el punto del
 * mundo que estaba en el centro del viewport. Sin esto, redimensionar (abrir el
 * asistente, plegar el drawer, girar el móvil) desplazaría el encuadre.
 */
export function reanchorOnResize(
  view: CanvasView2D,
  prev: { width: number; height: number },
  next: { width: number; height: number },
): CanvasView2D {
  if (isIdentityView(view)) return IDENTITY_VIEW;
  const dx = (next.width - prev.width) / 2;
  const dy = (next.height - prev.height) / 2;
  return { k: view.k, tx: view.tx + dx, ty: view.ty + dy };
}
