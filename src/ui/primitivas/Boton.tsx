import type { ButtonHTMLAttributes } from "react";

// Boton de accion. Variantes del Spec Diseno UI §5: primary (acento, peso 600)
// y ghost (surface + borde). Altura fija 30 px (densidad CAD). Estilado solo con
// tokens via las clases .cx-btn (ver primitivas.css); sin colores hardcodeados.
export type VarianteBoton = "primary" | "ghost";

export interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton;
}

export function Boton({ variante = "primary", className, type, ...rest }: BotonProps) {
  const clases = ["cx-btn", `cx-btn--${variante}`, className].filter(Boolean).join(" ");
  return <button type={type ?? "button"} className={clases} {...rest} />;
}
