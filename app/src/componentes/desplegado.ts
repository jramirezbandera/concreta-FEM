/**
 * Cómo se cierra lo que se despliega sobre la página (menús, listas y paneles flotantes; C-33): con
 * Esc, que no sigue (no suelta lo elegido ni anula la herramienta de dibujo) y devuelve el foco al
 * botón que lo abrió, y con un clic fuera de lo desplegado y de su botón.
 */
import { useEffect, useRef, type RefObject } from "react";

export function useDesplegado(abierto: boolean, cerrar: () => void, dentro: readonly RefObject<HTMLElement | null>[], boton?: RefObject<HTMLElement | null>) {
  const ultimo = useRef({ cerrar, dentro, boton });
  ultimo.current = { cerrar, dentro, boton };
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      const { cerrar, dentro, boton } = ultimo.current;
      const t = e.target as Node;
      if (![...dentro, ...(boton ? [boton] : [])].some((r) => r.current?.contains(t))) cerrar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Un diálogo abierto encima se cierra él antes (escucha también en captura, en la ventana)
      if (document.querySelector(".dialogo-fondo")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const { cerrar, boton } = ultimo.current;
      cerrar();
      boton?.current?.focus();
    };
    window.addEventListener("pointerdown", fuera, true);
    window.addEventListener("keydown", tecla, true);
    return () => {
      window.removeEventListener("pointerdown", fuera, true);
      window.removeEventListener("keydown", tecla, true);
    };
  }, [abierto]);
}
