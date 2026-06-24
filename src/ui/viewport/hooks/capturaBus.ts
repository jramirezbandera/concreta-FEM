// capturaBus: canal ligero entre la barra de herramientas (HTML, fuera del Canvas)
// y la escena R3F (dentro del Canvas) para la captura PNG del viewport (F3). El
// boton no tiene acceso al contexto de three.js; en lugar de elevar el renderer a
// estado React, emitimos un evento y un componente interno (ControlCaptura) lo
// aplica leyendo el framebuffer via useThree. Mismo patron que zoomBus/coordsBus.
//
// REGLA #11 (CLAUDE.md / feature-9): el bus no programa ningun re-render; la
// captura fuerza un render explicito (frameloop="demand") dentro de la escena.
type Oyente = (nombre?: string) => void;

const oyentes = new Set<Oyente>();

// `nombre` opcional: base del fichero descargado (sin extension ni fecha).
export function emitirCaptura(nombre?: string): void {
  for (const o of oyentes) o(nombre);
}

export function suscribirCaptura(o: Oyente): () => void {
  oyentes.add(o);
  return () => {
    oyentes.delete(o);
  };
}
