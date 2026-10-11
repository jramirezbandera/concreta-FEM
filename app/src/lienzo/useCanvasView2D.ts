// Copiado de concreta-v2/src/hooks/useCanvasView2D.ts (© Javier Ramírez Bandera; V-a en docs/fem3d/visor.md) con el encuadre por arrastre izquierdo (`panIzquierdo`).
// Dueño ÚNICO del gesto de cámara (zoom + encuadre) de los lienzos de barras.
//
// Lo consumen los tres lienzos del análisis —el editor 2D, el de solo lectura
// N/V/M/δ y el strip del 1D—, así que el gesto no puede divergir: un ajuste de
// sensibilidad de rueda o un arreglo del pan se hace una vez. Nació dentro de
// `features/fem2d` y se promovió aquí sin tocar la mecánica cuando el 1D
// adoptó la misma cámara.
//
//   index.tsx  ── view (k,tx,ty) + setView ──┐
//                                            ▼
//                        useCanvasView2D({ svgRef, enabled, … })
//                          · wheel NATIVO no-pasivo (preventDefault real)
//                          · pan: botón central o Espacio+arrastre
//                          · atajos + / − / 0
//                          · coalescencia por requestAnimationFrame
//                          · clamp contra los límites dibujables
//                                            │
//                     ┌──────────────────────┴───────────────────┐
//                     ▼                                          ▼
//            Fem2DEditorCanvas                            Fem2DCanvas (screen)
//
// El clon del PDF pasa `enabled: false`: el hook se llama igual (las reglas de
// hooks no admiten llamadas condicionales) pero no engancha ni un listener y la
// vista queda en identidad, de modo que la figura exportada sigue siendo el
// autofit puro. La frontera la fija además un test de cuarentena.
//
// RATÓN vs TRACKPAD: la rueda de ratón amplía sin modificador (convención CAD:
// AutoCAD/CYPE). En trackpad, en cambio, el gesto de dos dedos significa
// "desplazar" para casi todo el mundo y llega como el MISMO evento wheel; sólo
// el pinch (que el navegador marca con ctrlKey) amplía. La heurística los
// distingue por deltaMode y por la firma del delta.

import { useCallback, useEffect, useRef } from 'react';
import {
  IDENTITY_VIEW,
  clampView,
  clampZoom,
  zoomAt,
  type BoundsRect,
  type CanvasView2D,
} from './transform';

/** Paso de los controles discretos (botones y teclas). */
export const ZOOM_STEP = 1.25;
/** Duración de la interpolación de los saltos discretos. */
export const ZOOM_ANIM_MS = 180;
/** Sensibilidad de la rueda: k ·= exp(−deltaY · c). */
const WHEEL_C_PIXEL = 0.0018;
/** Un "línea" de deltaMode=1 vale ~16 px; deltaMode=2 (página) ~1 pantalla. */
const LINE_TO_PX = 16;
const PAGE_TO_PX = 400;
/** Píxeles de arrastre antes de considerar que hay pan (no un clic). */
const PAN_THRESHOLD_PX = 3;

export interface UseCanvasView2DOptions {
  /** SVG sobre el que se escuchan los gestos. */
  svgRef: React.RefObject<SVGSVGElement | null>;
  /** Vista actual (k, tx, ty). */
  view: CanvasView2D;
  /** Publica una vista nueva (ya saneada por el hook). */
  setView: (next: CanvasView2D) => void;
  /** Límites navegables en px del transform SIN cámara. */
  bounds: BoundsRect;
  /** Viewport del SVG en px. */
  width: number;
  height: number;
  /** false ⇒ el hook no engancha nada (clon del PDF, modelo vacío). */
  enabled: boolean;
  /** Un marquee en curso desactiva el pan por Espacio (gesto en conflicto). */
  marqueeActive?: boolean;
  /**
   * Visor: el arrastre con el botón izquierdo también encuadra (no hay herramientas de dibujo).
   * Un clic sin arrastre sigue llegando a quien escucha `click`.
   */
  panIzquierdo?: boolean;
}

export interface CanvasViewApi {
  /** Acerca un paso desde el centro del lienzo (botón + / tecla +). */
  zoomIn: () => void;
  /** Aleja un paso desde el centro del lienzo (botón − / tecla −). */
  zoomOut: () => void;
  /** Vuelve al autofit (botón Encuadrar / tecla 0). */
  reset: () => void;
  /** true mientras se está encuadrando (cursor grabbing). */
  isPanning: () => boolean;
  /** true si hay un pan armado por Espacio (cursor grab). */
  isPanArmed: () => boolean;
  /** Visor: el pointerup que acaba de llegar cerraba un arrastre (su click no elige). */
  acabaDeArrastrar: () => boolean;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/**
 * Distingue el scroll de dos dedos de un trackpad (que NO debe ampliar) de la
 * rueda de un ratón (que sí). Señales: el pinch llega con ctrlKey; la rueda de
 * ratón llega en líneas o en pasos de píxel grandes y "redondos", mientras que
 * el trackpad emite muchos deltas pequeños y suele traer deltaX.
 */
export function isZoomIntent(e: {
  ctrlKey: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
}): boolean {
  if (e.ctrlKey) return true;            // pinch de trackpad o Ctrl+rueda
  if (e.deltaMode !== 0) return true;    // líneas/páginas ⇒ rueda de ratón
  if (Math.abs(e.deltaX) > 0.5) return false; // desplazamiento 2D ⇒ trackpad
  return Math.abs(e.deltaY) >= 40;       // saltos grandes ⇒ rueda de ratón
}

/** Delta del evento normalizado a píxeles, sea cual sea el deltaMode. */
export function wheelDeltaToPx(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * LINE_TO_PX;
  if (deltaMode === 2) return deltaY * PAGE_TO_PX;
  return deltaY;
}

/** Factor de zoom que corresponde a un delta de rueda. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  return Math.exp(-wheelDeltaToPx(deltaY, deltaMode) * WHEEL_C_PIXEL);
}

export function useCanvasView2D(opts: UseCanvasView2DOptions): CanvasViewApi {
  const { svgRef, view, setView, bounds, width, height, enabled, marqueeActive = false, panIzquierdo = false } = opts;

  // Refs espejo: los listeners nativos se montan una vez y leen el estado vivo
  // sin re-engancharse en cada render (re-enganchar un listener no-pasivo por
  // fotograma de rueda sería justo el coste que la coalescencia evita). Se
  // escriben en un effect, no en render: durante el render un ref todavía no
  // refleja el commit.
  const stateRef = useRef({ view, bounds, width, height, enabled, marqueeActive });
  const setViewRef = useRef(setView);
  useEffect(() => {
    stateRef.current = { view, bounds, width, height, enabled, marqueeActive };
    setViewRef.current = setView;
  });

  // Vista pendiente de publicar en el próximo fotograma (coalescencia).
  const pendingRef = useRef<CanvasView2D | null>(null);
  const rafRef = useRef<number | null>(null);
  // Animación en curso de un salto discreto.
  const animRef = useRef<number | null>(null);
  // Estado del arrastre de encuadre.
  const panRef = useRef<{ pointerId: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const spaceArmedRef = useRef(false);
  const panIzquierdoRef = useRef(panIzquierdo);
  useEffect(() => {
    panIzquierdoRef.current = panIzquierdo;
  });
  // El clic que cierra un arrastre no es un clic (no elige nada)
  const ultimoArrastreRef = useRef(0);

  const cancelAnim = useCallback(() => {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }, []);

  /** Publica una vista saneada, coalescida a un update por fotograma. */
  const commit = useCallback((next: CanvasView2D) => {
    const { bounds: b, width: w, height: h } = stateRef.current;
    pendingRef.current = clampView(next, { width: w, height: h }, b);
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const v = pendingRef.current;
      pendingRef.current = null;
      if (v) setViewRef.current(v);
    });
  }, []);

  /** Salto discreto: interpola ~180 ms para no perder el contexto espacial. */
  const animateTo = useCallback((target: CanvasView2D) => {
    const { bounds: b, width: w, height: h } = stateRef.current;
    const to = clampView(target, { width: w, height: h }, b);
    const from = stateRef.current.view;
    cancelAnim();
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      setViewRef.current(to);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ZOOM_ANIM_MS);
      const e = easeOut(p);
      setViewRef.current(
        p >= 1
          ? to
          : {
            k: from.k + (to.k - from.k) * e,
            tx: from.tx + (to.tx - from.tx) * e,
            ty: from.ty + (to.ty - from.ty) * e,
          },
      );
      animRef.current = p >= 1 ? null : requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  }, [cancelAnim]);

  const stepZoom = useCallback((factor: number) => {
    const { view: v, width: w, height: h, enabled: on } = stateRef.current;
    if (!on) return;
    animateTo(zoomAt(v, factor, w / 2, h / 2));
  }, [animateTo]);

  const zoomIn = useCallback(() => stepZoom(ZOOM_STEP), [stepZoom]);
  const zoomOut = useCallback(() => stepZoom(1 / ZOOM_STEP), [stepZoom]);
  const reset = useCallback(() => {
    if (!stateRef.current.enabled) return;
    animateTo(IDENTITY_VIEW);
  }, [animateTo]);

  // ── Rueda / pinch de trackpad ────────────────────────────────────────────
  // Listener NATIVO y no-pasivo: el onWheel sintético de React se registra como
  // pasivo en varios navegadores y ahí preventDefault no surte efecto.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !enabled) return;

    const onWheel = (e: WheelEvent) => {
      if (!isZoomIntent(e)) return; // scroll de dos dedos: no es zoom
      e.preventDefault();
      cancelAnim();
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const current = pendingRef.current ?? stateRef.current.view;
      const factor = wheelZoomFactor(e.deltaY, e.deltaMode);
      // En los límites el gesto es un no-op silencioso (nada de rebote).
      if (clampZoom(current.k * factor) === current.k) return;
      commit(zoomAt(current, factor, px, py));
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [svgRef, enabled, commit, cancelAnim]);

  // ── Encuadre: botón central, o Espacio + arrastre izquierdo ─────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !enabled) return;

    const startPan = (e: PointerEvent) => {
      cancelAnim();
      panRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY, moved: false };
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* el arrastre sigue valiendo mientras el cursor esté sobre el SVG */
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const middle = e.button === 1;
      const spaceDrag = e.button === 0 && spaceArmedRef.current && !stateRef.current.marqueeActive;
      if (e.button === 0 && panIzquierdoRef.current && !spaceDrag) {
        // Se arma sin capturar: si no se mueve más del umbral, es un clic
        panRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY, moved: false };
        return;
      }
      if (!middle && !spaceDrag) return;
      // Botón central: sin preventDefault, Windows abre el autoscroll.
      e.preventDefault();
      e.stopPropagation();
      startPan(e);
    };

    const onPointerMove = (e: PointerEvent) => {
      const pan = panRef.current;
      if (!pan || pan.pointerId !== e.pointerId) return;
      const dx = e.clientX - pan.lastX;
      const dy = e.clientY - pan.lastY;
      if (!pan.moved && Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return;
      if (!pan.moved) {
        try {
          svg.setPointerCapture(e.pointerId);
        } catch {
          /* sin captura, el arrastre sigue mientras el cursor esté sobre el SVG */
        }
      }
      pan.moved = true;
      pan.lastX = e.clientX;
      pan.lastY = e.clientY;
      const current = pendingRef.current ?? stateRef.current.view;
      commit({ k: current.k, tx: current.tx + dx, ty: current.ty + dy });
    };

    const endPan = (e: PointerEvent) => {
      const pan = panRef.current;
      if (!pan || pan.pointerId !== e.pointerId) return;
      if (pan.moved) ultimoArrastreRef.current = performance.now();
      panRef.current = null;
      try {
        svg.releasePointerCapture(e.pointerId);
      } catch {
        /* ya liberado */
      }
    };

    // El click que cierra un arrastre de botón central no debe llegar al
    // dispatch de herramientas del editor.
    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', endPan);
    svg.addEventListener('pointercancel', endPan);
    svg.addEventListener('auxclick', onAuxClick);
    return () => {
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', endPan);
      svg.removeEventListener('pointercancel', endPan);
      svg.removeEventListener('auxclick', onAuxClick);
      panRef.current = null;
    };
  }, [svgRef, enabled, commit, cancelAnim]);

  // ── Teclado: Espacio arma el pan; + / − / 0 son saltos discretos ─────────
  useEffect(() => {
    if (!enabled) return;

    const isTyping = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      const tag = el?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
    };

    const pointerIsOverSvg = (): boolean => {
      const svg = svgRef.current;
      if (!svg || typeof document === 'undefined') return false;
      return typeof svg.matches === 'function' && svg.matches(':hover');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === 'Space') {
        // El preventDefault va AQUÍ, no en pointerdown: para entonces el
        // navegador ya habría desplazado la página.
        if (!pointerIsOverSvg() || stateRef.current.marqueeActive) return;
        spaceArmedRef.current = true;
        e.preventDefault();
        return;
      }
      // Ctrl+± es el zoom del navegador: no se toca.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0' || e.code === 'Numpad0') {
        e.preventDefault();
        reset();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceArmedRef.current = false;
    };

    // Soltar el foco de la ventana con Espacio pulsado dejaría el pan armado.
    const onBlur = () => {
      spaceArmedRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      spaceArmedRef.current = false;
    };
  }, [svgRef, enabled, zoomIn, zoomOut, reset]);

  // Cancelar rAF pendientes al desmontar: sin esto, un setState llegaría a un
  // componente ya muerto.
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    rafRef.current = null;
    animRef.current = null;
    pendingRef.current = null;
  }, []);

  return {
    zoomIn,
    zoomOut,
    reset,
    isPanning: () => panRef.current?.moved ?? false,
    isPanArmed: () => spaceArmedRef.current,
    acabaDeArrastrar: () => performance.now() - ultimoArrastreRef.current < 50,
  };
}
