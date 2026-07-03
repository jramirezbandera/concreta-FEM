// cotaBus: canal ligero entre la herramienta de colocacion (dentro del Canvas) y la
// etiqueta HTML de COTA VIVA (fuera del Canvas), para D8a (spec §6.1). Hermano de
// coordsBus/zoomBus: un Set de oyentes + emitir/limpiar, sin meter la cota en estado React.
//
// REGLA #11: la cota viva (longitud+angulo de la banda elastica, dimensiones del rectangulo
// del paño) se recalcula en el MISMO onPointerMove que ya mueve el marcador. En vez de
// setState por frame, se EMITE por aqui; el overlay se suscribe y posiciona su <div> por
// MUTACION de ref en un rAF (un re-render de React solo al aparecer/desaparecer la etiqueta,
// no por movimiento). El bus no programa ningun re-render.
//
// La posicion se emite en PIXELES DE PANTALLA (screenX/screenY relativos al viewport): la
// herramienta ya tiene el evento de puntero con coordenadas de cliente; el overlay las usa
// tal cual para colocar el <div> junto al cursor. `texto` ya viene formateado (formateo.ts).
export interface CotaViva {
  texto: string;
  // Posicion del cursor en pixeles relativos al contenedor del viewport (para el overlay).
  px: number;
  py: number;
}

type Oyente = (cota: CotaViva | null) => void;

const oyentes = new Set<Oyente>();

// Ultima cota emitida (null = sin banda activa): snapshot inicial para un oyente tardio.
let ultima: CotaViva | null = null;

// Emite una cota viva (banda/rectangulo en tendido). La herramienta la llama en cada move
// mientras haya extremo/esquina pendiente.
export function emitirCota(cota: CotaViva): void {
  ultima = cota;
  for (const o of oyentes) o(cota);
}

// Limpia la cota (al fijar el segundo punto o cancelar): oculta la etiqueta.
export function limpiarCota(): void {
  ultima = null;
  for (const o of oyentes) o(null);
}

export function suscribirCota(o: Oyente): () => void {
  oyentes.add(o);
  return () => {
    oyentes.delete(o);
  };
}

export function leerCota(): CotaViva | null {
  return ultima;
}
