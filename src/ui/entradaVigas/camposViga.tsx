import { Segmentado } from "../primitivas";
import type { Viga } from "../../dominio";

// Controles de formulario COMPARTIDOS entre el panel de creacion
// (PanelHerramientaViga, fija defaults de la viga) y el de edicion (InspectorViga,
// edita la viga seleccionada). Espejo de camposPilar: son controles de HOJA (no un
// formulario monolitico); cada panel los compone en su propio orden y con su propia
// clase de envoltorio (se pasa por `className` para no alterar el CSS de cada panel).
//
// Vocabulario de obra (Extremo empotrado/articulado, Tirante Si/No); cero jerga FEM
// (CLAUDE.md §17): el discretizador traduce extremo articulado -> release en feature-4,
// pero la UI nunca lo expone.

type Extremo = Viga["extremoI"];

const OPCIONES_EXTREMO = [
  { valor: "empotrado", etiqueta: "Empotrado" },
  { valor: "articulado", etiqueta: "Articulado" },
] as const;

const OPCIONES_SI_NO = [
  { valor: "si", etiqueta: "Sí" },
  { valor: "no", etiqueta: "No" },
] as const;

// Extremo de viga (empotrado/articulado), via Segmentado. Reutilizable para el
// extremo I y el J: el llamante pasa la `etiqueta` ("Extremo I" / "Extremo J").
export function CampoExtremo({
  valor,
  onValor,
  etiqueta = "Extremo",
  className,
  disabled = false,
}: {
  valor: Extremo;
  onValor: (v: Extremo) => void;
  etiqueta?: string;
  className?: string;
  // Deshabilitado cuando la viga es tirante: el discretizador fuerza ambos extremos
  // articulados, asi que el control se muestra fijo (no se ignora en silencio).
  disabled?: boolean;
}) {
  return (
    <div className={className}>
      <span className="cx-campo__label">{etiqueta}</span>
      <Segmentado
        aria-label={etiqueta}
        opciones={OPCIONES_EXTREMO}
        valor={valor}
        onValor={onValor}
        disabled={disabled}
      />
    </div>
  );
}

// Tirante Si/No (mapea el boolean del dominio a las opciones del Segmentado y de
// vuelta; espejo de CampoVinculacion).
export function CampoTirante({
  valor,
  onValor,
  etiqueta = "Tirante",
  className,
}: {
  valor: boolean;
  onValor: (v: boolean) => void;
  etiqueta?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="cx-campo__label">{etiqueta}</span>
      <Segmentado
        aria-label={etiqueta}
        opciones={OPCIONES_SI_NO}
        valor={valor ? "si" : "no"}
        onValor={(v) => onValor(v === "si")}
      />
    </div>
  );
}
