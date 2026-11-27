/**
 * Un estado vacío (`auditoria-ui-2.md`, UI2-22): lo que no hay, en pocas palabras, y debajo, más
 * tenue, cómo se consigue. Antes eran más de veinte párrafos `.nota`, cada uno con su fórmula
 * («Ninguna:», «Nada aún:», «Sin…»).
 *
 * - `titulo`: lo que falta («Sin vistas guardadas»), sin punto final.
 * - `children`: una frase con el camino («Se guardan desde la barra de cada vista.»).
 * - `accion`: si el camino es un clic, su botón.
 */
import type { ReactNode } from "react";

export function Vacio({ titulo, children, accion }: { titulo: string; children?: ReactNode; accion?: { texto: string; alPulsar: () => void } }) {
  return (
    <div className="vacio" role="note">
      <span className="vacio-titulo">{titulo}</span>
      {children && <span className="vacio-como">{children}</span>}
      {accion && (
        <button type="button" className="enlace" onClick={accion.alPulsar}>
          {accion.texto}
        </button>
      )}
    </div>
  );
}
