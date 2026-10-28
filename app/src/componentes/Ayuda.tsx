/**
 * El «?» de un campo y su ayuda en un globo flotante al pasar el ratón (de la prueba de uso del
 * 2026-10-28: el texto bajo el campo empujaba los demás). El globo va en `document.body` con
 * posición fija, así que no lo recorta el panel que se desplaza ni un diálogo; sale debajo del «?»
 * y, si no cabe, encima, sin salirse de la ventana.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Lo que tarda en salir, para que no salten globos al cruzar el panel con el ratón. */
const ESPERA_MS = 120;
const MARGEN = 8;

export function Ayuda({ texto }: { texto: string }) {
  const ancla = useRef<HTMLElement>(null);
  const globo = useRef<HTMLDivElement>(null);
  const espera = useRef<number>(0);
  const [abierta, setAbierta] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; arriba: boolean; flecha: number } | null>(null);

  const cerrar = useCallback(() => {
    clearTimeout(espera.current);
    setAbierta(false);
    setPos(null);
  }, []);

  useEffect(() => () => clearTimeout(espera.current), []);

  // Medido ya pintado (invisible), para saber su alto y no salirse de la ventana
  useLayoutEffect(() => {
    if (!abierta || !ancla.current || !globo.current) return;
    const a = ancla.current.getBoundingClientRect();
    const g = globo.current.getBoundingClientRect();
    const cx = a.left + a.width / 2;
    const left = Math.min(Math.max(MARGEN, cx - 18), window.innerWidth - g.width - MARGEN);
    const arriba = a.bottom + 6 + g.height > window.innerHeight - MARGEN && a.top - 6 - g.height >= MARGEN;
    setPos({ left, top: arriba ? a.top - 6 - g.height : a.bottom + 6, arriba, flecha: cx - left });
  }, [abierta]);

  // Al desplazar o cambiar el tamaño, el «?» se mueve: el globo se cierra
  useEffect(() => {
    if (!abierta) return;
    window.addEventListener("scroll", cerrar, true);
    window.addEventListener("resize", cerrar);
    return () => {
      window.removeEventListener("scroll", cerrar, true);
      window.removeEventListener("resize", cerrar);
    };
  }, [abierta, cerrar]);

  return (
    <>
      <i
        ref={ancla}
        className="campo-q"
        data-abierta={abierta || undefined}
        aria-hidden="true"
        onMouseEnter={() => {
          clearTimeout(espera.current);
          espera.current = window.setTimeout(() => setAbierta(true), ESPERA_MS);
        }}
        onMouseLeave={cerrar}
      >
        ?
      </i>
      {abierta &&
        createPortal(
          <div
            ref={globo}
            className="globo-ayuda"
            role="tooltip"
            data-arriba={pos?.arriba || undefined}
            style={pos ? { left: pos.left, top: pos.top, ["--flecha" as string]: `${pos.flecha}px` } : { left: 0, top: 0, visibility: "hidden" }}
          >
            {texto}
          </div>,
          document.body,
        )}
    </>
  );
}
