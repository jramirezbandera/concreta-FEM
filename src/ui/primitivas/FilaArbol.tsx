import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

// Fila del arbol de obra del sidebar (Spec Diseno UI §3.3 / §5: .cx-row).
// Altura 26 px. Composicion: swatch semantico de 9 px (color del elemento, p.
// ej. var(--pilar)) + label + contador/accion a la derecha (mono). Fila
// seleccionada (`seleccionada`) en acento. El swatch recibe el color por prop
// para no hardcodear: el llamante pasa el token semantico (var(--pilar), ...).
//
// AFORDANCIA (Krug): una fila solo "parece pulsable" si LO ES. Por defecto la
// fila es interactiva (<button>, hover, foco, seleccion). Cuando es una mera
// etiqueta/cabecera o un dato sin accion (`interactiva={false}`) se renderiza
// como <div> inerte (.cx-row--label): sin hover, sin cursor pointer, sin realce
// de seleccion ni rol interactivo. Asi no prometemos funciones inexistentes.

interface FilaArbolBaseProps {
  label: ReactNode;
  /** Color del swatch (token semantico, p. ej. "var(--pilar)"). Si se omite, sin swatch. */
  swatch?: string;
  /** Contador a la derecha (mono), p. ej. numero de elementos. */
  contador?: ReactNode;
  seleccionada?: boolean;
  /**
   * Si la fila responde a una accion. `true` (defecto) -> fila pulsable (<button>).
   * `false` -> etiqueta/cabecera/dato inerte (<div>, sin afordancia de pulsado).
   */
  interactiva?: boolean;
}

export type FilaArbolProps = FilaArbolBaseProps &
  Omit<HTMLAttributes<HTMLDivElement>, keyof FilaArbolBaseProps> &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof FilaArbolBaseProps>;

export function FilaArbol({
  label,
  swatch,
  contador,
  seleccionada = false,
  interactiva = true,
  className,
  ...rest
}: FilaArbolProps) {
  const contenido = (
    <>
      {swatch && (
        <span
          className="cx-row__swatch"
          style={{ backgroundColor: swatch }}
          aria-hidden="true"
        />
      )}
      <span className="cx-row__label">{label}</span>
      {contador !== undefined && (
        <span className="cx-row__count mono">{contador}</span>
      )}
    </>
  );

  if (!interactiva) {
    // Etiqueta inerte: ni rol interactivo ni estado de seleccion.
    const clases = ["cx-row", "cx-row--label", className]
      .filter(Boolean)
      .join(" ");
    return (
      <div className={clases} {...(rest as HTMLAttributes<HTMLDivElement>)}>
        {contenido}
      </div>
    );
  }

  const clases = ["cx-row", "cx-row--btn", seleccionada && "cx-row--sel", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={clases}
      aria-pressed={seleccionada}
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {contenido}
    </button>
  );
}
