// Status bar (Spec Diseno UI §2 / §6.5): "firma de ingenieria". Mensaje de guia
// contextual en acento (izquierda) + coordenadas vivas x/y + escala + estado de
// snap (todo mono, a la derecha). API minima en F9: el mensaje, coords y escala
// llegan por props (otras features los escriben desde su propio estado). Sin
// stores nuevos. Los datos de ejemplo son placeholders neutros.

export interface StatusBarProps {
  /** Linea de guia contextual (acento). La escriben las features de introduccion. */
  mensaje?: string;
  /** Coordenadas vivas del cursor en el lienzo (m). Las actualiza el viewport. */
  coords?: { x: number; y: number };
  /** Escala de presentacion, p. ej. "1:100". */
  escala?: string;
  /** Estado del snap (referencia a objetos). */
  snapActivo?: boolean;
}

export function StatusBar({
  mensaje = "Listo",
  coords = { x: 0, y: 0 },
  escala = "1:100",
  snapActivo = true,
}: StatusBarProps) {
  return (
    <footer className="cx-status" aria-label="Barra de estado">
      <span className="cx-status__msg">{mensaje}</span>
      <span className="cx-status__item mono">
        {coords.x.toFixed(3)}, {coords.y.toFixed(3)} m
      </span>
      <span className="cx-status__item mono">{escala}</span>
      <span className="cx-status__snap">
        {snapActivo && <span className="cx-status__dot" aria-hidden="true" />}
        <span className="mono caps">{snapActivo ? "Snap" : "Snap off"}</span>
      </span>
    </footer>
  );
}
