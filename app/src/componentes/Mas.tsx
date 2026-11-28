/**
 * UI2-21: lo que explica más de una línea en un panel va plegado tras «Más…»: el panel dice lo que
 * hay en una línea y el porqué queda a un clic. Un `<details>`: el texto sigue en la página (lo
 * encuentra el buscador del navegador y un lector de pantalla), y se abre con el teclado.
 */
import type { ReactNode } from "react";

export function Mas({ children, etiqueta = "Más…" }: { children: ReactNode; etiqueta?: string }) {
  return (
    <details className="mas">
      <summary>{etiqueta}</summary>
      <div className="mas-cuerpo">{children}</div>
    </details>
  );
}
