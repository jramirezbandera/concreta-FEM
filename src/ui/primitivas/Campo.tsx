import { useId } from "react";
import type { InputHTMLAttributes } from "react";

// Campo de formulario controlado (Spec Diseno UI §5): <label> + <input> con
// mensaje de error opcional y sufijo de unidad visual ("m", "kN/m²"). La
// conversion de unidades NO ocurre aqui (vive en /src/unidades, en los bordes);
// `sufijo` es solo decorativo. Estilado solo con tokens via .cx-campo / .cx-input.
export interface CampoProps extends InputHTMLAttributes<HTMLInputElement> {
  etiqueta: string;
  error?: string;
  sufijo?: string;
}

export function Campo({ etiqueta, error, sufijo, className, id, ...rest }: CampoProps) {
  const generado = useId();
  const inputId = id ?? generado;
  const errorId = `${inputId}-error`;
  const clasesInput = ["cx-input", error && "cx-input--error", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="cx-campo">
      <label className="cx-campo__label" htmlFor={inputId}>
        {etiqueta}
      </label>
      <div className="cx-campo__control">
        <input
          id={inputId}
          className={clasesInput}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        />
        {sufijo ? <span className="cx-campo__sufijo">{sufijo}</span> : null}
      </div>
      {error ? (
        <div id={errorId} className="cx-campo__error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
