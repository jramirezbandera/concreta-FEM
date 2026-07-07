// Campos de UI del muro/pantalla (F3, muros): espesor/tamaño de malla en mm y la
// vinculación al terreno (base empotrada). Reutilizados por el PanelHerramientaMuro
// (creación) y el InspectorMuro (edición), espejo de camposPano/camposPilar.
//
// UNIDADES (CLAUDE.md §14): espesor y tamaño de malla se INTRODUCEN en mm y el dominio
// trabaja en m: la conversión mm<->m ocurre AQUÍ (borde), vía CampoLongitudMm de los
// paños (fuente única de ese control). El callback `onValorM` entrega/recibe METROS.
//
// Vocabulario de obra (Espesor, Tamaño de malla, Vinculación al terreno); cero jerga FEM.
import { Segmentado } from "../primitivas";

// Reuso del control mm<->m ya probado de los paños (no se duplica la conversión).
export { CampoLongitudMm } from "../entradaPanos/camposPano";

const OPCIONES_SI_NO: ReadonlyArray<{ valor: "si" | "no"; etiqueta: string; titulo: string }> = [
  { valor: "si", etiqueta: "Sí", titulo: "La base del muro se ancla al terreno (empotrada)" },
  { valor: "no", etiqueta: "No", titulo: "El muro apoya solo en la estructura (sin anclaje propio)" },
];

// Vinculación exterior del muro: si la fila base se empotra al terreno. Es el caso
// normal de una pantalla (arranca de la cimentación); sin ella, el muro debe quedar
// cosido al pórtico (lo exige MURO_SIN_SUJECION).
export function CampoVinculacionMuro({
  valor,
  onValor,
  className,
}: {
  valor: boolean;
  onValor: (v: boolean) => void;
  className?: string;
}) {
  return (
    <div className={["cx-campo", className].filter(Boolean).join(" ")}>
      <span className="cx-campo__label">Anclado al terreno</span>
      <Segmentado
        aria-label="Anclado al terreno"
        opciones={OPCIONES_SI_NO}
        valor={valor ? "si" : "no"}
        onValor={(v) => onValor(v === "si")}
      />
    </div>
  );
}
