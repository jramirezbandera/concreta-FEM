import { useEffect, useState } from "react";
import { Campo } from "./Campo";

// Input NUMERICO controlado-local con commit en blur. Primitiva compartida
// (feature-11, consolidacion del review): unifica las copias que vivian en
// DialogoGruposYPlantas, InspectorPilar y PanelHerramientaPilar (cierra la deuda
// T-dialogo-1). Mantiene estado LOCAL string mientras se teclea (permite "-",
// "1.", vacio transitorio); se resincroniza si el `valor` entrante cambia desde
// fuera (undo/redo, cambio de elemento seleccionado). En blur parsea con Number y
// llama onCommit; el padre valida y decide si despacha.
//
// Number("") y Number("   ") son 0 (no NaN): un campo vaciado commitearia 0 en
// silencio. Por eso vacio/espacios -> NaN, para que la validacion del padre salte
// en vez de guardar un cero accidental. El padre que NO quiera fijar NaN (p. ej.
// defaults sin validacion) filtra con Number.isFinite en su onCommit.
export interface CampoNumeroProps {
  etiqueta: string;
  valor: number;
  onCommit: (v: number) => void;
  error?: string;
  sufijo?: string;
  className?: string;
}

export function CampoNumero({
  etiqueta,
  valor,
  onCommit,
  error,
  sufijo,
  className,
}: CampoNumeroProps) {
  const [local, setLocal] = useState(String(valor));
  useEffect(() => {
    setLocal(String(valor));
  }, [valor]);
  return (
    <Campo
      etiqueta={etiqueta}
      type="number"
      inputMode="decimal"
      value={local}
      error={error}
      sufijo={sufijo}
      className={className}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(local.trim() === "" ? NaN : Number(local))}
    />
  );
}
