import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

// Chip y Pill (Spec Diseno UI §5).
//  - Chip (.cx-chip): TOGGLE (p. ej. hipotesis G/Q/V/N/E). Activo (`activo`) en
//    acento. Es un boton; controlado por el llamante via onClick/activo.
//  - Pill (.cx-pill): etiqueta INFORMATIVA mono (ambito, seccion). No interactiva.

export interface ChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  activo?: boolean;
  children?: ReactNode;
}

export function Chip({ activo = false, className, type, children, ...rest }: ChipProps) {
  const clases = ["cx-chip", activo && "cx-chip--on", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type ?? "button"} aria-pressed={activo} className={clases} {...rest}>
      {children}
    </button>
  );
}

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  children?: ReactNode;
}

export function Pill({ className, children, ...rest }: PillProps) {
  const clases = ["cx-pill", "mono", className].filter(Boolean).join(" ");
  return (
    <span className={clases} {...rest}>
      {children}
    </span>
  );
}
