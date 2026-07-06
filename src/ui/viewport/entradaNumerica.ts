// entradaNumerica: parser PURO de la barra de coordenadas de la colocacion
// (UX-2.5, spec §6 "entrada numerica al dibujar"). Tres gramaticas CAD:
//   "x,y"    -> punto ABSOLUTO en coordenadas de obra (m)
//   "@dx,dy" -> punto RELATIVO al punto de referencia de la herramienta (extremo I
//               de la viga, esquina A del paño, ultimo pilar colocado)
//   "d<a"    -> POLAR: distancia d (m) y angulo a (grados, 0 = +X, antihorario)
//               desde el punto de referencia ("@d<a" es equivalente; el polar
//               siempre es relativo — sin referencia no tiene sentido)
// Separador de coordenadas: coma. Decimal: punto. Sin React ni stores: testeable
// en Node. Los errores van en lenguaje de obra (los muestra la barra de estado).

export type ExprNumerica =
  | { tipo: "absoluta"; x: number; y: number }
  | { tipo: "relativa"; dx: number; dy: number }
  | { tipo: "polar"; d: number; anguloGrados: number };

export type ResultadoParse =
  | { ok: true; expr: ExprNumerica }
  | { ok: false; error: string };

const FORMATO = 'Formato: "x,y" · "@dx,dy" · "d<a" (p. ej. "3.5,2" o "5<90")';

// Numero estricto: "" y no-finitos son null (Number("") seria 0 silencioso).
function numero(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parsearEntradaNumerica(texto: string): ResultadoParse {
  const t = texto.trim();
  if (t === "") return { ok: false, error: "Escribe unas coordenadas" };

  const relativa = t.startsWith("@");
  const cuerpo = relativa ? t.slice(1) : t;

  // Polar "d<a" (con o sin "@": el polar siempre es relativo a la referencia).
  const iAng = cuerpo.indexOf("<");
  if (iAng >= 0) {
    const d = numero(cuerpo.slice(0, iAng));
    const a = numero(cuerpo.slice(iAng + 1));
    if (d === null || a === null) return { ok: false, error: FORMATO };
    if (d < 0) return { ok: false, error: "La distancia no puede ser negativa" };
    return { ok: true, expr: { tipo: "polar", d, anguloGrados: a } };
  }

  const partes = cuerpo.split(",");
  if (partes.length !== 2) return { ok: false, error: FORMATO };
  const a = numero(partes[0]!);
  const b = numero(partes[1]!);
  if (a === null || b === null) return { ok: false, error: FORMATO };

  return relativa
    ? { ok: true, expr: { tipo: "relativa", dx: a, dy: b } }
    : { ok: true, expr: { tipo: "absoluta", x: a, y: b } };
}

// Limpieza numerica del polar: cos(90 grados) = 6e-17, no 0 (mismo criterio que orto).
const EPS = 1e-12;

// Resuelve la expresion a un punto de obra. `base` es el punto de referencia de la
// herramienta (o null si aun no lo hay): relativa y polar lo EXIGEN.
export function resolverPuntoEntrada(
  expr: ExprNumerica,
  base: { x: number; y: number } | null,
): { ok: true; x: number; y: number } | { ok: false; error: string } {
  if (expr.tipo === "absoluta") return { ok: true, x: expr.x, y: expr.y };
  if (base === null) {
    return {
      ok: false,
      error:
        "Sin punto de referencia para @ o d<a: fija primero el punto inicial o usa x,y absolutas",
    };
  }
  if (expr.tipo === "relativa") {
    return { ok: true, x: base.x + expr.dx, y: base.y + expr.dy };
  }
  const rad = (expr.anguloGrados * Math.PI) / 180;
  let ux = Math.cos(rad);
  let uy = Math.sin(rad);
  if (Math.abs(ux) < EPS) ux = 0;
  if (Math.abs(uy) < EPS) uy = 0;
  return { ok: true, x: base.x + ux * expr.d, y: base.y + uy * expr.d };
}
