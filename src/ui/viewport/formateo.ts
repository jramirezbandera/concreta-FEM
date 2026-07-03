// formateo: formateadores PUROS de texto para los rotulos del lienzo (D7b cargas, D8a cota
// viva). NO convierten unidades (las cargas ya estan en kN/m·kN/m², las longitudes en m:
// sistema interno, §14); solo componen la cadena de presentacion (decimales + sufijo).
// La conversion de unidades vive en /src/unidades; aqui es puro formato.

// Redondea a `dec` decimales devolviendo un numero (evita "-0" y ruido de coma flotante).
function redondear(v: number, dec: number): number {
  const f = 10 ** dec;
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r; // normaliza -0 -> 0
}

// Formatea una longitud en metros: "5.00 m" (2 decimales, como una cota CAD). No negativa
// en la practica (longitudes), pero se respeta el signo por si acaso.
export function formatearLongitud(m: number): string {
  return `${redondear(m, 2).toFixed(2)} m`;
}

// Formatea un angulo en grados en [0, 360): "0.0°", "45.0°", "270.0°" (1 decimal).
// DECISION (D8a): rango [0,360) en vez de [-180,180]. Un arquitecto lee acimutes/replanteos
// en [0,360) (0°=Este/eje X+, sentido antihorario), mas natural que angulos con signo. El
// llamador calcula el angulo con atan2 (que da (-180,180]) y este helper lo normaliza.
export function formatearAngulo(grados: number): string {
  let g = grados % 360;
  if (g < 0) g += 360;
  // -0 tras el modulo -> 0.
  const r = redondear(g, 1);
  return `${(r === 0 ? 0 : r).toFixed(1)}°`;
}

// Angulo en grados de un vector (dx,dy) respecto al eje X+ de planta, normalizado a
// [0,360). Puro: base de la cota viva (D8a) y testeable sin escena.
export function anguloXY(dx: number, dy: number): number {
  const g = (Math.atan2(dy, dx) * 180) / Math.PI;
  return g < 0 ? g + 360 : g;
}

// Cadena de cota viva de una BANDA (viga en tendido): "5.00 m · 45.0°".
export function cotaBanda(dx: number, dy: number): string {
  const largo = Math.hypot(dx, dy);
  return `${formatearLongitud(largo)} · ${formatearAngulo(anguloXY(dx, dy))}`;
}

// Cadena de cota viva de un RECTANGULO (paño en tendido): "3.00 × 2.00 m" (ancho × alto en
// valor absoluto: al usuario le da igual el sentido del arrastre).
export function cotaRectangulo(dx: number, dy: number): string {
  return `${redondear(Math.abs(dx), 2).toFixed(2)} × ${redondear(Math.abs(dy), 2).toFixed(2)} m`;
}

// --- Cargas (D7b) -------------------------------------------------------------

// Numero de carga con hasta 2 decimales SIN ceros colgando: 10 -> "10", 10.5 -> "10.5".
// Un rotulo de lienzo es mas limpio sin ".00" superfluo.
function numeroCarga(v: number): string {
  const r = redondear(v, 2);
  return Number.isInteger(r) ? String(r) : String(r);
}

// Etiqueta de carga LINEAL: "10 kN/m". `sumada` antepone "Σ " (varias cargas sobre el
// mismo elemento se suman, decision D7b).
export function etiquetaCargaLineal(valor: number, sumada = false): string {
  return `${sumada ? "Σ " : ""}${numeroCarga(valor)} kN/m`;
}

// Etiqueta de carga SUPERFICIAL: "5 kN/m²".
export function etiquetaCargaSuperficial(valor: number, sumada = false): string {
  return `${sumada ? "Σ " : ""}${numeroCarga(valor)} kN/m²`;
}
