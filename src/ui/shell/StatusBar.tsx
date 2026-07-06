// Status bar (Spec Diseno UI §2 / §6.5): "firma de ingenieria". Mensaje de guia
// contextual en acento (izquierda) + coordenadas vivas x/y + (opcional) escala +
// estado de snap (todo mono, a la derecha). API minima en F9: el mensaje, coords y
// escala llegan por props (otras features los escriben desde su propio estado). Sin
// stores nuevos.

export interface StatusBarProps {
  /** Linea de guia contextual (acento). La escriben las features de introduccion. */
  mensaje?: string;
  /** Coordenadas vivas del cursor en el lienzo (m). Las actualiza el viewport. */
  coords?: { x: number; y: number };
  /** Escala de presentacion, p. ej. "1:100". SOLO se muestra si se recibe: con zoom
   *  continuo no hay una escala 1:N fija, asi que sin un valor real NO se rotula (un
   *  "1:100" hardcodeado seria siempre falso — auditoria UX-A9). */
  escala?: string;
  /** A que esta enganchando el iman ahora mismo ("Pilar P3", "Extremo de V2"), o
   *  null/ausente si no engancha. Lo emite la colocacion via imanBus (UX-2.2). */
  enganche?: string | null;
  /** Estado del snap (referencia a objetos). */
  snapActivo?: boolean;
}

export function StatusBar({
  mensaje = "Listo",
  coords = { x: 0, y: 0 },
  escala,
  enganche = null,
  snapActivo = true,
}: StatusBarProps) {
  return (
    <footer className="cx-status" aria-label="Barra de estado">
      <span className="cx-status__msg">{mensaje}</span>
      {enganche !== null && (
        <span className="cx-status__snap">
          <span className="cx-status__dot" aria-hidden="true" />
          <span className="mono caps">{enganche}</span>
        </span>
      )}
      <span className="cx-status__item mono">
        {coords.x.toFixed(3)}, {coords.y.toFixed(3)} m
      </span>
      {escala !== undefined && (
        <span className="cx-status__item mono">{escala}</span>
      )}
      <span className="cx-status__snap">
        {snapActivo && <span className="cx-status__dot" aria-hidden="true" />}
        <span className="mono caps">{snapActivo ? "Snap" : "Snap off"}</span>
      </span>
    </footer>
  );
}
