// CotaVivaOverlay: etiqueta HTML de COTA VIVA junto al cursor mientras se tiende una viga
// ("5.00 m · 45.0°") o se dibuja un paño ("3.00 × 2.00 m") (D8a, spec §6.1). Antes la banda
// elastica se dibujaba a ciegas: la longitud solo se deducia restando coords de la
// statusbar.
//
// RENDIMIENTO (regla #11, patron coordsBus): la herramienta EMITE la cota por cotaBus en el
// mismo pointermove que mueve el marcador. Este overlay NO hace setState por frame: se
// suscribe al bus, throttlea con rAF y POSICIONA/RELLENA su <div> mutando refs
// (style.transform + textContent). El unico re-render de React ocurre al aparecer/
// desaparecer la etiqueta (montar el <div>), no al mover el cursor.
//
// Se monta en el HUD del Viewport (position: absolute sobre el canvas). El <div> lleva
// pointer-events:none: no captura el puntero (no estorba a la colocacion). Estilo glass +
// acento por tokens (.cx-cota-viva en viewport.css).
import { useEffect, useRef, useState } from "react";
import { suscribirCota, leerCota } from "./hooks/cotaBus";

// Desplazamiento del <div> respecto al cursor (px): a la derecha y abajo para no quedar bajo
// el propio cursor/marcador.
const OFFSET_X = 14;
const OFFSET_Y = 14;

export function CotaVivaOverlay() {
  // Solo un flag de visibilidad en estado React (cambia al aparecer/desaparecer la banda,
  // no por frame). El texto y la posicion se mutan por ref.
  const [visible, setVisible] = useState<boolean>(() => leerCota() !== null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    let pendiente = leerCota();

    // Vuelca la ultima cota pendiente al <div> (posicion + texto) una vez por frame.
    const volcar = () => {
      frame = 0;
      const el = ref.current;
      if (!el || pendiente === null) return;
      el.style.transform = `translate(${pendiente.px + OFFSET_X}px, ${pendiente.py + OFFSET_Y}px)`;
      el.textContent = pendiente.texto;
    };

    const unsub = suscribirCota((cota) => {
      pendiente = cota;
      if (cota === null) {
        // Cierre inmediato (no esperamos rAF): ocultar la etiqueta al fijar/cancelar.
        setVisible(false);
        return;
      }
      // Al (re)aparecer, montar el <div> (setVisible) y programar el volcado; mientras ya
      // este visible, solo se throttlea el volcado por rAF (sin setState).
      setVisible(true);
      if (frame === 0) frame = requestAnimationFrame(volcar);
    });

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      unsub();
    };
  }, []);

  if (!visible) return null;
  return (
    <div
      ref={ref}
      className="cx-cota-viva mono"
      role="status"
      aria-live="off"
    />
  );
}
