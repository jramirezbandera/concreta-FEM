/**
 * Un grupo de radios o de pestañas con el teclado que promete su rol (C-18 de la auditoría de la
 * interfaz, como el selector de punto fijo de la plantilla): una sola parada de Tab, la opción
 * elegida (o la primera si no hay ninguna), y las flechas, Inicio y Fin pasan a la de al lado, le
 * llevan el foco y la eligen (la elección sigue al foco).
 *
 * Las opciones son los hijos directos con `role="radio"` o `role="tab"`, con su `aria-checked` o
 * `aria-selected` y su `onClick` de siempre: el grupo sólo pone su `tabIndex` y atiende las teclas,
 * así que cada sitio conserva su marcado (clases, iconos, insignias).
 */
import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

const OPCIONES = ':scope > [role="radio"], :scope > [role="tab"]';

/** Las opciones del grupo que se pueden elegir (sin las deshabilitadas). */
function opciones(g: HTMLElement): HTMLElement[] {
  return [...g.querySelectorAll<HTMLElement>(OPCIONES)].filter((x) => !(x as HTMLButtonElement).disabled);
}
const elegida = (x: HTMLElement) => x.getAttribute("aria-checked") === "true" || x.getAttribute("aria-selected") === "true";

/** Las teclas de un grupo de opciones: ← ↑ la anterior, → ↓ la siguiente (dando la vuelta), Inicio y Fin. */
export function teclasGrupo(e: KeyboardEvent<HTMLElement>): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const g = e.currentTarget;
  const xs = opciones(g);
  const i = xs.findIndex((x) => x === document.activeElement);
  if (i < 0) return;
  const n = xs.length;
  const j = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
  if (j < 0) return;
  e.preventDefault();
  e.stopPropagation();
  const x = xs[j]!;
  x.focus();
  if (!elegida(x)) x.click();
}

export function Grupo({ rol, etiqueta, className, style, children, ...resto }: { rol: "radiogroup" | "tablist"; etiqueta: string; className?: string; style?: CSSProperties; children: ReactNode; "data-testid"?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // El tabindex itinerante, tras cada render (las opciones son del que pinta el grupo)
  useLayoutEffect(() => {
    const g = ref.current;
    if (!g) return;
    const xs = [...g.querySelectorAll<HTMLElement>(OPCIONES)];
    const parada = xs.find((x) => elegida(x) && !(x as HTMLButtonElement).disabled) ?? opciones(g)[0];
    for (const x of xs) x.tabIndex = x === parada ? 0 : -1;
  });
  return (
    <div ref={ref} role={rol} aria-label={etiqueta} className={className} style={style} onKeyDown={teclasGrupo} {...resto}>
      {children}
    </div>
  );
}
