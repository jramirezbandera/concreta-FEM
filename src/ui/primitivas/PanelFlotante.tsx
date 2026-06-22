import type { HTMLAttributes, ReactNode } from "react";

// Panel flotante "glass" sobre el lienzo (Spec Diseno UI §4.2 / §5: .cx-float).
// Props/herramientas que flotan sobre el viewport (no cromo fijo): efecto vidrio
// claro (--glass) + --shadow-float. Cabecera opcional (icono acento + titulo +
// tag mono) y cuerpo. NO se posiciona a si mismo: el llamante decide la posicion
// canonica (arriba-izq GroupRibbon, arriba-der segmented, etc.) via className.

export interface PanelFlotanteProps extends HTMLAttributes<HTMLDivElement> {
  /** Titulo de la cabecera. Si se omite, no se renderiza cabecera. */
  titulo?: ReactNode;
  /** Icono a la izquierda del titulo (acento). */
  icono?: ReactNode;
  /** Etiqueta mono a la derecha de la cabecera (p. ej. "V·nueva", "auto"). */
  tag?: ReactNode;
  children?: ReactNode;
}

export function PanelFlotante({
  titulo,
  icono,
  tag,
  children,
  className,
  ...rest
}: PanelFlotanteProps) {
  const clases = ["cx-float", className].filter(Boolean).join(" ");
  return (
    <div className={clases} {...rest}>
      {titulo !== undefined && (
        <div className="cx-panel-head">
          {icono && <span className="cx-panel-head__icon">{icono}</span>}
          <span className="cx-panel-head__title">{titulo}</span>
          {tag !== undefined && <span className="cx-panel-head__tag mono">{tag}</span>}
        </div>
      )}
      <div className="cx-float__body">{children}</div>
    </div>
  );
}
