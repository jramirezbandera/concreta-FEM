import { useEffect, useRef, useState } from "react";
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
  // UX-C8: bandera para que el blur que dispara Escape NO commitee. Escape revierte
  // (sin guardar); pero al hacer blur() se dispararia onBlur y commitearia el valor
  // (ademas el `local` recien reseteado aun no se ha aplicado en ese tick). Un ref
  // evita ese commit espurio sin acoplar el timing de setState.
  const revirtiendo = useRef(false);
  // Dato numerico -> mono tabular alineado a la derecha (Spec Diseno UI §1.5/§5).
  // Se fusiona con la clase del llamante (p. ej. anchos del dialogo).
  const clases = ["cx-input--num", className].filter(Boolean).join(" ");
  return (
    <Campo
      etiqueta={etiqueta}
      type="number"
      inputMode="decimal"
      value={local}
      error={error}
      sufijo={sufijo}
      className={clases}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (revirtiendo.current) {
          // Blur provocado por Escape: se descarta (ya se resincronizo el local).
          revirtiendo.current = false;
          return;
        }
        onCommit(local.trim() === "" ? NaN : Number(local));
      }}
      // UX-C8: teclado explicito. Enter -> blur (dispara el commit en onBlur ya
      // existente, sin duplicar la logica). Escape -> descarta lo tecleado
      // resincronizando el estado local con el valor del modelo y hace blur SIN
      // commit; ademas detiene la propagacion para que ESE Esc no cierre el dialogo
      // ni cancele la herramienta de introduccion (el listener global veria el
      // defaultPrevented). Sin esto, editar un numero y pulsar Esc cerraba el panel.
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          revirtiendo.current = true;
          setLocal(String(valor));
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
