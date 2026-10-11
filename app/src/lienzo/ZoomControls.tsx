// Copiado de concreta-v2/src/components/ui/ZoomControls.tsx (© Javier Ramírez Bandera; V-a en docs/fem3d/visor.md).
// Grupo flotante de zoom del lienzo (− / % / + / Encuadrar), compartido por
// los lienzos de análisis (FEM 2D y FEM 1D).
//
// Anclado al CONTENEDOR (no al SVG, que se centra y cambia de alto entre
// vistas): espejo exacto de la paleta de herramientas, que vive en left-3 top-3.
//
// Lenguaje visual del toolbar del módulo, SIN acento: el sky está reservado al
// cálculo vivo (foco, nav activa, cotas del SVG) y este grupo flota justo sobre
// el lienzo del cálculo — pintarlo de acento diluiría ese significado.
//
// Estados por control (nunca se atenúa el grupo entero: a k=1, que es donde se
// pasa el 95 % del tiempo, un grupo apagado leería como "no hay zoom aquí",
// justo lo contrario de lo que se quiere comunicar):
//
//   k = 1 (autofit) │ −: off   %: on   +: on   Encuadrar: off
//   1 < k < 8       │ −: on    %: on   +: on   Encuadrar: on
//   k = 8 (máx)     │ −: on    %: on   +: off  Encuadrar: on
//   modelo vacío    │ todo off
//
// El chip % es un BOTÓN real (reencuadra), no un rótulo: su aria-label lleva el
// valor vivo. El anuncio por aria-live sólo se dispara en saltos discretos
// (botones/teclas), nunca durante la rueda — si no, ametralla al lector.

import { useEffect, useRef, useState, type JSX } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import { ZOOM_MAX, ZOOM_MIN } from './transform';

interface Props {
  /** Zoom actual (1 = encuadre completo). */
  k: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  /** Modelo vacío o lienzo no navegable ⇒ grupo entero deshabilitado. */
  disabled?: boolean;
}

const BTN =
  'grid place-items-center transition-colors text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-secondary';

export function ZoomControls({ k, onZoomIn, onZoomOut, onReset, disabled = false }: Props): JSX.Element {
  const atMin = k <= ZOOM_MIN + 1e-6;
  const atMax = k >= ZOOM_MAX - 1e-6;
  const pct = `${Math.round(k * 100)} %`;

  // Anuncio para lector de pantalla: sólo tras un salto discreto. La rueda
  // actualiza `k` continuamente y no debe llegar al live region.
  const [announced, setAnnounced] = useState('');
  const announceTimer = useRef<number | null>(null);
  const announce = (label: string) => {
    if (announceTimer.current !== null) window.clearTimeout(announceTimer.current);
    announceTimer.current = window.setTimeout(() => setAnnounced(label), 60);
  };
  useEffect(() => () => {
    if (announceTimer.current !== null) window.clearTimeout(announceTimer.current);
  }, []);

  const run = (fn: () => void, label: string) => () => {
    fn();
    announce(label);
  };

  return (
    <div
      className="canvas-zoom-controls absolute right-3 bottom-3 z-10 flex items-center overflow-hidden rounded-md border border-border-main bg-bg-elevated/90"
      role="group"
      aria-label="Zoom del lienzo"
    >
      <button
        type="button"
        onClick={run(onZoomOut, `Alejado, zoom ${pct}`)}
        disabled={disabled || atMin}
        title="Alejar (tecla −)"
        aria-label="Alejar"
        className={BTN}
      >
        <Minus size={14} />
      </button>
      <span className="canvas-zoom-sep" aria-hidden="true" />
      <button
        type="button"
        onClick={run(onReset, 'Lienzo reencuadrado')}
        disabled={disabled || atMin}
        title="Zoom respecto al encuadre completo — clic: reencuadrar"
        aria-label={`Reencuadrar — zoom actual ${pct}`}
        className="canvas-zoom-pct font-mono tabular-nums text-text-secondary transition-colors hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-secondary"
      >
        {pct}
      </button>
      <span className="canvas-zoom-sep" aria-hidden="true" />
      <button
        type="button"
        onClick={run(onZoomIn, `Acercado, zoom ${pct}`)}
        disabled={disabled || atMax}
        title="Acercar (tecla +)"
        aria-label="Acercar"
        className={BTN}
      >
        <Plus size={14} />
      </button>
      <span className="canvas-zoom-sep" aria-hidden="true" />
      <button
        type="button"
        onClick={run(onReset, 'Lienzo reencuadrado')}
        disabled={disabled || atMin}
        title="Encuadrar (tecla 0)"
        aria-label="Encuadrar"
        className={BTN}
      >
        <Maximize size={14} />
      </button>
      <span className="sr-only" aria-live="polite" role="status">{announced}</span>
    </div>
  );
}
