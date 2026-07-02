// LeyendaRampa: leyenda de rampa de color GENERICA y reutilizable. Extraida de
// LeyendaEscala (que era de deformada: amplitud + animacion) para que la pestana
// Isovalores (F3) y la deformada (feature-14) compartan la MISMA presentacion de rampa
// (color + min/max + unidad) sin duplicar el gradiente ni los rotulos. Esto es SOLO la
// rampa: NO incluye controles especificos (la amplificacion/animacion de la deformada
// los pone LeyendaEscala alrededor de esta; el selector de magnitud de isovalores lo
// pone su panel).
//
// La rampa usa las mismas 5 paradas de tokens.css (--ramp-0..4) que rampaIsovalores en
// el lienzo: una sola fuente de verdad del color (no se duplica hex aqui).
//
// SIN conversion de unidades: el llamante entrega min/max YA en la unidad de presentacion
// y la etiqueta de unidad como texto (CLAUDE.md §14: la conversion vive en el borde del
// llamante, no aqui).
import { RAMPA_PARADAS_POS } from "../viewport/colores";
import "./leyendaRampa.css";

// Gradiente CSS sobre las 5 paradas de tokens.css (--ramp-0..4), en las MISMAS posiciones
// (no equidistantes) que rampaIsovalores en el lienzo 3D (Spec §1.4): asi la leyenda y el
// coloreado del modelo coinciden pixel a pixel. RAMPA_PARADAS_POS es la unica fuente de las
// posiciones (colores.ts); aqui solo las mapeamos a %.
const GRADIENTE_RAMPA = `linear-gradient(90deg, ${RAMPA_PARADAS_POS.map(
  (p, i) => `var(--ramp-${i}) ${(p * 100).toFixed(0)}%`,
).join(", ")})`;

// Separa la unidad entre parentesis del resto de la etiqueta, para NO aplicarle el
// text-transform: uppercase de la cabecera (mm != MM: una unidad no debe transformarse).
// "desplazamiento (mm)" -> { texto: "desplazamiento", unidad: "mm" }. Sin parentesis, todo
// va como texto (se mantiene el comportamiento previo del resto de la etiqueta).
function partirUnidad(etiqueta: string): { texto: string; unidad: string | null } {
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(etiqueta);
  if (!m) return { texto: etiqueta, unidad: null };
  return { texto: m[1]!.trim(), unidad: m[2]! };
}

export interface LeyendaRampaProps {
  // Limites del rango YA en la unidad de presentacion (la conversion la hace el llamante).
  min: number;
  max: number;
  // Texto de la unidad mostrada bajo la rampa (p. ej. "desplazamiento (mm)",
  // "momento (kN·m/m)"). Va tal cual: lenguaje de obra, lo decide el llamante.
  unidad: string;
  // Decimales para formatear los limites min/max. Default 1.
  decimales?: number;
  // aria-label de la barra de color; describe la magnitud y el rango para lectores de
  // pantalla. Si se omite, se compone uno generico con la unidad y los limites.
  ariaLabel?: string;
}

// Umbral de rango "pequeño" (en la unidad de presentacion) bajo el cual el formato con los
// decimales por defecto pierde toda resolucion ("-0.0 … 0.0"): con flechas sub-milimetricas
// min y max colapsan al mismo texto. Por debajo de este umbral se muestran mas decimales.
const RANGO_PEQUENO = 0.05;
const DECIMALES_FINOS = 3;

// Formatea un limite normalizando el "-0.0"/"-0.00" residual (redondeo de un valor ~0
// negativo) al positivo equivalente: -0 no aporta informacion y se lee como error.
function fmt(v: number, decimales: number): string {
  const r = v.toFixed(decimales);
  const cero = (0).toFixed(decimales);
  return r === `-${cero}` ? cero : r;
}

export function LeyendaRampa({
  min,
  max,
  unidad,
  decimales = 1,
  ariaLabel,
}: LeyendaRampaProps) {
  // Formato ADAPTATIVO: si el rango es diminuto (|max-min| < umbral), los decimales por
  // defecto colapsan min y max al mismo "0.0" ilegible; subimos la precision para que la
  // leyenda diga algo (p. ej. "-0.004 … 0.002" en vez de "-0.0 … 0.0").
  const decimalesEfectivos =
    Math.abs(max - min) < RANGO_PEQUENO ? Math.max(decimales, DECIMALES_FINOS) : decimales;
  const lo = fmt(min, decimalesEfectivos);
  const hi = fmt(max, decimalesEfectivos);
  const aria = ariaLabel ?? `${unidad}: de ${lo} a ${hi}`;
  // La unidad entre parentesis va SIN uppercase (mm != MM); el resto del rotulo si.
  const { texto, unidad: ud } = partirUnidad(unidad);
  return (
    <div className="cx-leyenda-rampa">
      <div className="cx-leyenda-rampa__fila">
        <span className="cx-leyenda-rampa__lim mono tnum">{lo}</span>
        <div
          className="cx-leyenda-rampa__barra"
          style={{ background: GRADIENTE_RAMPA }}
          role="img"
          aria-label={aria}
        />
        <span className="cx-leyenda-rampa__lim mono tnum">{hi}</span>
      </div>
      <p className="cx-leyenda-rampa__unidad">
        {/* Solo el texto se pone en mayusculas; la unidad conserva su caja original. */}
        {ud === null ? (
          <span className="caps">{texto}</span>
        ) : (
          <>
            <span className="caps">{texto}</span>{" "}
            <span className="cx-leyenda-rampa__ud">({ud})</span>
          </>
        )}
      </p>
    </div>
  );
}
