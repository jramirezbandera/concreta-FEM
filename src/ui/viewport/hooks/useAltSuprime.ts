// useAltSuprime: mientras una herramienta de colocacion esta activa, Alt mantenido
// suprime momentaneamente iman/snap (D8b, convencion CAD "osnap off"). Este hook
// solo se ocupa del GOTCHA de Windows: keydown de Alt mueve el foco al menu de la
// ventana/navegador (y el keyup dispara el menu ALT de Chrome/Edge), robando el
// puntero a mitad de colocacion. preventDefault en ambos mientras la herramienta
// este montada. La lectura del estado (e.nativeEvent.altKey) la hace cada handler
// de puntero: no hace falta estado propio.
import { useEffect } from "react";

export function useAltSuprime(): void {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Alt") ev.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);
}
