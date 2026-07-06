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
import type { BordeApoyo, TipoDireccionViguetas } from "../../dominio";

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

// --- Campos del forjado UNIDIRECCIONAL ---------------------------------------
//
// Estos campos solo se muestran cuando el paño es de tipo "unidireccional"; el
// PanelHerramientaPano (creacion) y el InspectorPano (edicion) los rinden
// condicionalmente. Vocabulario de obra ("vigueta" SI es lenguaje de obra); cero
// jerga FEM.

// Direccion en que corren las viguetas, en ejes de OBRA. La luz de la vigueta es la
// dimension del paño en esta direccion; el intereje se mide en la perpendicular. Se
// nombran por el eje de obra (X / Y), no por jerga FEM.
const OPCIONES_DIRECCION: ReadonlyArray<{
  valor: TipoDireccionViguetas;
  etiqueta: string;
  titulo: string;
}> = [
  { valor: "x", etiqueta: "Eje X", titulo: "Viguetas paralelas al eje X (apoyan en los bordes izquierdo y derecho)" },
  { valor: "y", etiqueta: "Eje Y", titulo: "Viguetas paralelas al eje Y (apoyan en los bordes inferior y superior)" },
];

export interface CampoDireccionViguetasProps {
  valor: TipoDireccionViguetas;
  onValor: (v: TipoDireccionViguetas) => void;
  className?: string;
}

export function CampoDireccionViguetas({ valor, onValor, className }: CampoDireccionViguetasProps) {
  return (
    <div className={["cx-campo", className].filter(Boolean).join(" ")}>
      <span className="cx-campo__label">Dirección de viguetas</span>
      <Segmentado<TipoDireccionViguetas>
        opciones={OPCIONES_DIRECCION}
        valor={valor}
        onValor={onValor}
        aria-label="Dirección de viguetas del forjado"
      />
    </div>
  );
}

// Peso propio TABULADO del forjado (kN/m², unidad interna de carga superficial -> SIN
// conversion, §14). Es el peso del forjado COMPLETO (viguetas, bovedillas y capa de
// compresion), orientativo segun canto (CTE DB-SE-AE Tabla C.5). La ayuda resume la
// fuente sin exigir que el usuario la memorice; el valor es editable.
export const AYUDA_PESO_PROPIO =
  "Peso del forjado completo (viguetas, bovedillas y capa de compresión), orientativo según canto (CTE DB-SE-AE)";

export interface CampoPesoPropioProps {
  valor: number; // kN/m² (sistema interno; sin conversion)
  onValor: (v: number) => void;
  error?: string;
  className?: string;
}

export function CampoPesoPropio({ valor, onValor, error, className }: CampoPesoPropioProps) {
  return (
    <div className={["cx-campo-pp", className].filter(Boolean).join(" ")} title={AYUDA_PESO_PROPIO}>
      <CampoNumero
        etiqueta="Peso propio"
        sufijo="kN/m²"
        valor={valor}
        onCommit={onValor}
        error={error}
      />
      <p className="cx-note cx-campo-pp__ayuda">{AYUDA_PESO_PROPIO}</p>
    </div>
  );
}
