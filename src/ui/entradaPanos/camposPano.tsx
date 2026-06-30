// Campos de UI del paño (F3): apoyo de borde + espesor/malla en mm. Reutilizados por el
// PanelHerramientaPano (creacion) y el InspectorPano (edicion), espejo de camposViga.
//
// Vocabulario de obra (Apoyo de borde, Espesor, Tamaño de malla); cero jerga FEM. El
// apoyo de borde es una propiedad de OBRA ("como descansa el borde"), no un release FEM.
//
// UNIDADES (CLAUDE.md §14): espesor y tamaño de malla se INTRODUCEN en mm (la unidad
// natural para un arquitecto) y el dominio trabaja en m: la conversion mm<->m ocurre AQUI,
// en el borde del campo, nunca en mitad de la logica. El callback `onValorM` siempre
// entrega/recibe METROS; el control muestra mm.
import { Segmentado } from "../primitivas";
import { CampoNumero } from "../primitivas";
import { mToMm, mmToM } from "../../unidades";
import type { BordeApoyo } from "../../dominio";

// Opciones del apoyo de borde en lenguaje de obra. El orden replica "de mas a menos
// sujecion": simple (apoyado) -> empotrado (encastrado) -> libre (voladizo).
const OPCIONES_BORDE: ReadonlyArray<{ valor: BordeApoyo; etiqueta: string; titulo: string }> = [
  { valor: "simple", etiqueta: "Apoyado", titulo: "Borde simplemente apoyado (impide la flecha)" },
  { valor: "empotrado", etiqueta: "Empotrado", titulo: "Borde empotrado (impide flecha y giro)" },
  { valor: "libre", etiqueta: "Libre", titulo: "Borde sin apoyo (voladizo)" },
];

export interface CampoBordeApoyoProps {
  valor: BordeApoyo;
  onValor: (v: BordeApoyo) => void;
  className?: string;
}

export function CampoBordeApoyo({ valor, onValor, className }: CampoBordeApoyoProps) {
  return (
    <div className={["cx-campo", className].filter(Boolean).join(" ")}>
      <span className="cx-campo__label">Apoyo de borde</span>
      <Segmentado<BordeApoyo>
        opciones={OPCIONES_BORDE}
        valor={valor}
        onValor={onValor}
        aria-label="Apoyo de borde del paño"
      />
    </div>
  );
}

// Campo de longitud que el usuario teclea en mm pero el dominio guarda en m. Encapsula la
// conversion mm<->m (borde, §14): `valorM` entra en metros, el control muestra mm; al
// commitear, mmToM lo devuelve en metros (o NaN si el campo quedo vacio, para que la
// validacion del padre salte en vez de guardar un cero accidental).
export interface CampoLongitudMmProps {
  etiqueta: string;
  valorM: number; // m (sistema interno)
  onValorM: (m: number) => void;
  error?: string;
  className?: string;
}

export function CampoLongitudMm({
  etiqueta,
  valorM,
  onValorM,
  error,
  className,
}: CampoLongitudMmProps) {
  return (
    <CampoNumero
      etiqueta={etiqueta}
      sufijo="mm"
      valor={mToMm(valorM)}
      onCommit={(mm) => onValorM(Number.isFinite(mm) ? mmToM(mm) : NaN)}
      error={error}
      className={className}
    />
  );
}
