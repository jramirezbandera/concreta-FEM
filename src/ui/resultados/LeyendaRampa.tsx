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
import "./leyendaRampa.css";

// Gradiente CSS sobre las 5 paradas de tokens.css (--ramp-0..4): misma fuente de color
// que rampaIsovalores (colores.ts) en el lienzo.
const GRADIENTE_RAMPA =
  "linear-gradient(90deg, var(--ramp-0), var(--ramp-1), var(--ramp-2), var(--ramp-3), var(--ramp-4))";

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

function fmt(v: number, decimales: number): string {
  return v.toFixed(decimales);
}

export function LeyendaRampa({
  min,
  max,
  unidad,
  decimales = 1,
  ariaLabel,
}: LeyendaRampaProps) {
  const lo = fmt(min, decimales);
  const hi = fmt(max, decimales);
  const aria = ariaLabel ?? `${unidad}: de ${lo} a ${hi}`;
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
      <p className="cx-leyenda-rampa__unidad caps">{unidad}</p>
    </div>
  );
}
