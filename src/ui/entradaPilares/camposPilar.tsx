import { Segmentado } from "../primitivas";
import type { Pilar } from "../../dominio";

// Controles de formulario COMPARTIDOS entre el panel de creacion
// (PanelHerramientaPilar, fija defaultsPilar) y el de edicion (InspectorPilar,
// edita el pilar seleccionado). Consolidacion del review de ingenieria: antes cada
// panel tenia su propia copia de OPCIONES_ARRANQUE/OPCIONES_SI_NO y del Segmentado
// envuelto. Son controles de HOJA (no un formulario monolitico): cada panel los
// compone en su propio orden y con su propia clase de envoltorio (se pasa por
// `className` para no alterar el CSS existente de cada panel).
//
// Vocabulario de obra (Arranque empotrado/articulado/elastico, Vinculacion
// exterior Si/No); cero jerga FEM (CLAUDE.md §17).

type Arranque = Pilar["arranque"];

const OPCIONES_ARRANQUE = [
  { valor: "empotrado", etiqueta: "Empotrado" },
  { valor: "articulado", etiqueta: "Articulado" },
  { valor: "elastico", etiqueta: "Elástico" },
] as const;

const OPCIONES_SI_NO = [
  { valor: "si", etiqueta: "Sí" },
  { valor: "no", etiqueta: "No" },
] as const;

// Tipo de arranque del pilar (empotrado/articulado/elastico), via Segmentado.
export function CampoArranque({
  valor,
  onValor,
  className,
}: {
  valor: Arranque;
  onValor: (v: Arranque) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="cx-campo__label">Arranque</span>
      <Segmentado
        aria-label="Arranque"
        opciones={OPCIONES_ARRANQUE}
        valor={valor}
        onValor={onValor}
      />
    </div>
  );
}

// Vinculacion exterior Si/No (mapea el boolean del dominio a las opciones del
// Segmentado y de vuelta).
export function CampoVinculacion({
  valor,
  onValor,
  className,
}: {
  valor: boolean;
  onValor: (v: boolean) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="cx-campo__label">Vinculación exterior</span>
      <Segmentado
        aria-label="Vinculación exterior"
        opciones={OPCIONES_SI_NO}
        valor={valor ? "si" : "no"}
        onValor={(v) => onValor(v === "si")}
      />
    </div>
  );
}
