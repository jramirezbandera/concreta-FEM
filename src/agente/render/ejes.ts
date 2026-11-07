/**
 * Ejes de replanteo en las vistas de planta (I2, `docs/fem3d/interfaz.md` §8, §9 y §14): los del
 * modelo o, si no tiene, los propuestos (`compilador/ejes.ts`).
 *
 * - Cada eje, una recta fina de trazo y punto, con una burbuja en cada extremo que dice su nombre
 *   (o su id). Las burbujas tienen tamaño en píxeles; la recta, la geometría exacta del eje.
 * - Cotas (sólo en la vista `modelo`): por cada grupo de ejes paralelos, una cadena con la distancia
 *   entre ejes consecutivos, a COTA_DENTRO del extremo de los ejes donde empiezan, entre las
 *   burbujas y la estructura.
 * - Los rótulos no engañan (CT1, `docs/fem3d/cotas.md` §2.4): una distancia que no es un número
 *   entero de centímetros (a más de 0,5 mm) va en milímetros, y la cota junto a un eje propuesto
 *   cuyos pilares no están en su recta (a más de 1 mm) lleva «≈», con una nota.
 * - Lo guardado es la directriz; el dibujo la alarga (`ejesVistos`) para que las burbujas no tapen
 *   lo que se clicó: MARGEN_EJES más allá de sus extremos y de lo que la recta atraviesa (contornos
 *   y huecos de losas y paños, vigas, muros, apoyos lineales y pilares a menos de BANDA_PILAR). Los
 *   propuestos ya llevan su margen en sus extremos: sólo se alargan si la recta atraviesa algo más allá.
 *
 * Puro: sin IO.
 */
import { ejesDe, MARGEN_EJES } from "../../compilador/ejes.ts";
import type { EjeReplanteo, ModeloFisico } from "../../compilador/fisico.ts";
import type { EntradaLeyenda, Primitiva, Vec2 } from "./escena.ts";
import { giroTexto } from "./modelo.ts";

/** Distancia de la cadena de cotas al extremo de los ejes, m. */
export const COTA_DENTRO = 1;
/** Radio de las burbujas, px. */
export const RADIO_BURBUJA = 11;

const degenerado = (e: EjeReplanteo) => !(Number.isFinite(e.desde[0]) && Number.isFinite(e.desde[1]) && Number.isFinite(e.hasta[0]) && Number.isFinite(e.hasta[1])) || (e.desde[0] === e.hasta[0] && e.desde[1] === e.hasta[1]);

/** Lo que un pilar se puede separar de su eje propuesto sin que su cota lleve «≈», m. */
export const DISPERSION_EJE = 1e-3;

/** Una distancia, m, con coma: con dos decimales («6,00») o, si no es un número entero de cm (a más de 0,5 mm), con tres («5,397»). */
export function rotuloCota(d: number): string {
  const cm = d * 100;
  return d.toFixed(Math.abs(cm - Math.round(cm)) > 0.05 ? 3 : 2).replace(".", ",");
}

/** Un pilar cuenta en el alargamiento de un eje si su punto está a menos de esto de la recta, m. */
export const BANDA_PILAR = 0.5;

/** Los tramos que un eje puede atravesar: contornos y huecos de losas y paños, vigas, muros y apoyos lineales. */
function tramosModelo(f: ModeloFisico): [Vec2, Vec2][] {
  const T: [Vec2, Vec2][] = [];
  const abierta = (ps: readonly Vec2[]) => {
    for (let i = 1; i < ps.length; i++) T.push([ps[i - 1]!, ps[i]!]);
  };
  const cerrada = (ps: readonly Vec2[]) => {
    abierta(ps);
    if (ps.length > 2) T.push([ps[ps.length - 1]!, ps[0]!]);
  };
  for (const l of f.losas ?? []) for (const r of [l.contorno, ...(l.huecos ?? [])]) cerrada(r);
  for (const p of f.panos ?? []) cerrada(p.contorno);
  for (const x of [...(f.vigas ?? []), ...(f.muros ?? []), ...(f.apoyosLineales ?? [])]) abierta(x.puntos);
  return T.filter(([a, b]) => Number.isFinite(a[0] + a[1] + b[0] + b[1]));
}

/**
 * Los ejes como se dibujan: la directriz alargada (ver la cabecera). Con la dirección de la directriz,
 * así que un eje según X o Y conserva su coordenada fija tal cual.
 */
export function ejesVistos(f: ModeloFisico, ejes: readonly EjeReplanteo[], propuestos: boolean): EjeReplanteo[] {
  const tramos = tramosModelo(f);
  const pilares = (f.pilares ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  return ejes.map((e) => {
    if (degenerado(e)) return e;
    const [ax, ay] = e.desde;
    const L = Math.hypot(e.hasta[0] - ax, e.hasta[1] - ay);
    const d: Vec2 = [(e.hasta[0] - ax) / L, (e.hasta[1] - ay) / L];
    let gmin = Infinity;
    let gmax = -Infinity;
    const ver = (t: number) => {
      if (t < gmin) gmin = t;
      if (t > gmax) gmax = t;
    };
    for (const [a, b] of tramos) {
      // La recta del eje, p = desde + t·d, contra el tramo a + s·(b − a), s en [0, 1]
      const [ux, uy] = [b[0] - a[0], b[1] - a[1]];
      const den = d[0] * uy - d[1] * ux;
      if (Math.abs(den) < 1e-12) continue;
      const [wx, wy] = [a[0] - ax, a[1] - ay];
      const sv = (wx * d[1] - wy * d[0]) / den;
      if (sv < -1e-9 || sv > 1 + 1e-9) continue;
      ver((wx * uy - wy * ux) / den);
    }
    for (const p of pilares) {
      const [wx, wy] = [p.x - ax, p.y - ay];
      if (Math.abs(wx * d[1] - wy * d[0]) <= BANDA_PILAR) ver(wx * d[0] + wy * d[1]);
    }
    const propio = propuestos ? 0 : MARGEN_EJES;
    const t0 = Math.min(-propio, gmin - MARGEN_EJES);
    const t1 = Math.max(L + propio, gmax + MARGEN_EJES);
    const punto = (t: number): Vec2 => (t === 0 ? e.desde : t === L ? e.hasta : [ax + t * d[0], ay + t * d[1]]);
    return t0 === 0 && t1 === L ? e : { ...e, desde: punto(t0), hasta: punto(t1) };
  });
}

/** Los ejes que se dibujan (alargados), ordenados por id y sin los degenerados, y los de pilares desalineados con su dispersión. */
function ejesDibujados(f: ModeloFisico): { validos: EjeReplanteo[]; degenerados: string[]; propuestos: boolean; disperso: Map<string, number> } {
  const { ejes: directrices, propuestos, dispersion } = ejesDe(f);
  const ejes = ejesVistos(f, directrices, propuestos);
  const disperso = new Map<string, number>();
  ejes.forEach((e, i) => {
    const x = dispersion?.[i] ?? 0;
    if (x > DISPERSION_EJE) disperso.set(e.id, x);
  });
  const degenerados: string[] = [];
  const validos = [...ejes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).filter((e) => {
    if (!degenerado(e)) return true;
    degenerados.push(e.id);
    return false;
  });
  return { validos, degenerados, propuestos, disperso };
}

export function capaEjes(f: ModeloFisico, o: { cotas: boolean }): { primitivas: Primitiva[]; leyenda: EntradaLeyenda[]; notas: string[] } {
  const { validos, degenerados, propuestos, disperso } = ejesDibujados(f);
  const P: Primitiva[] = [];
  const notas = degenerados.map((id) => `El eje ${id} no tiene dos extremos distintos: no se dibuja.`);
  if (!validos.length) return { primitivas: [], leyenda: [], notas };
  for (const e of validos) P.push({ tipo: "linea", puntos: [e.desde, e.hasta], estilo: "eje", objeto: e.id });
  if (o.cotas) P.push(...cotas(cadenasCotas(validos, disperso)));
  for (const e of validos)
    for (const p of [e.desde, e.hasta]) {
      P.push({ tipo: "marca", p, forma: "circulo", radio: RADIO_BURBUJA, estilo: "eje-burbuja", objeto: e.id });
      P.push({ tipo: "texto", p, texto: e.nombre ?? e.id, tamano: 12, negrita: true, ancla: "medio", dy: 4, prioridad: 95, clase: "eje", objeto: e.id });
    }
  if (propuestos) notas.push("Ejes propuestos con las alineaciones de los pilares: el modelo no tiene ejes de replanteo.");
  for (const e of validos) {
    const x = disperso.get(e.id);
    if (x !== undefined) notas.push(`Los pilares del eje ${e.nombre ?? e.id} no están en su recta: hasta ${rotuloCota(x)} m. Sus cotas llevan «≈».`);
  }
  return { primitivas: P, leyenda: [{ estilo: "eje", texto: propuestos ? "Eje de replanteo propuesto" : "Eje de replanteo" }, ...(o.cotas ? [{ estilo: "cota" as const, texto: "Cota entre ejes paralelos (m)" }] : [])], notas };
}

/**
 * Una cadena de cotas entre ejes paralelos (CT2: cada cota se elige por su número). Los ejes van en
 * la dirección d y se miden por t = p·n, con n = d girado 90° y d en [0°, 180°).
 */
export interface CadenaCotas {
  d: Vec2;
  n: Vec2;
  /** La cadena va por s = p·d = s. */
  s: number;
  /** Los valores de t de los ejes, crecientes (redondeados a 1e-9: los ejes del mismo t son uno). */
  ts: number[];
  /** Los ids de los ejes de cada t. */
  ejes: string[][];
  /** Si algún eje de ese t es propuesto con los pilares desalineados (su cota lleva «≈»). */
  aprox: boolean[];
}

/** Una cota de una cadena: la i-ésima, entre `ts[i − 1]` y `ts[i]`. */
export interface CotaCadena {
  cadena: CadenaCotas;
  i: number;
  /** Sus extremos en la línea de la cadena y el centro del rótulo, m. */
  a: Vec2;
  b: Vec2;
  p: Vec2;
  valor: number;
  texto: string;
}

/** El punto de la línea de una cadena con ese t. */
export const puntoCadena = (c: CadenaCotas, t: number): Vec2 => [c.s * c.d[0] + t * c.n[0], c.s * c.d[1] + t * c.n[1]];

/** Las cadenas de cotas de unos ejes (ya sin los degenerados); las de un eje de `disperso`, con «≈». */
export function cadenasCotas(ejes: readonly EjeReplanteo[], disperso: ReadonlyMap<string, number> = new Map()): CadenaCotas[] {
  const grupos = new Map<number, { e: EjeReplanteo; d: Vec2 }[]>();
  for (const e of ejes) {
    let [dx, dy] = [e.hasta[0] - e.desde[0], e.hasta[1] - e.desde[1]];
    const l = Math.hypot(dx, dy);
    [dx, dy] = [dx / l, dy / l];
    // La dirección, en [0°, 180°)
    let a = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (a < 0 || a >= 180 - 1e-9) {
      a = (a + 180) % 180;
      [dx, dy] = [-dx, -dy];
    }
    const k = Math.round(a * 1e4) / 1e4;
    const g = grupos.get(k) ?? [];
    g.push({ e, d: [dx, dy] });
    grupos.set(k, g);
  }
  const r: CadenaCotas[] = [];
  for (const k of [...grupos.keys()].sort((a, b) => a - b)) {
    const g = grupos.get(k)!;
    if (g.length < 2) continue;
    const d = g[0]!.d;
    const n: Vec2 = [-d[1], d[0]];
    const dot = (p: Vec2, v: Vec2) => p[0] * v[0] + p[1] * v[1];
    const tDe = (e: EjeReplanteo) => Math.round(dot(e.desde, n) * 1e9) / 1e9;
    const ts = [...new Set(g.map((x) => tDe(x.e)))].sort((a, b) => a - b);
    if (ts.length < 2) continue;
    const s = Math.min(...g.flatMap((x) => [dot(x.e.desde, d), dot(x.e.hasta, d)])) + COTA_DENTRO;
    r.push({
      d,
      n,
      s,
      ts,
      ejes: ts.map((t) => g.filter((x) => tDe(x.e) === t).map((x) => x.e.id)),
      aprox: ts.map((t) => g.some((x) => tDe(x.e) === t && disperso.has(x.e.id))),
    });
  }
  return r;
}

/** Las cotas de una cadena, en orden. */
export function cotasCadena(c: CadenaCotas): CotaCadena[] {
  const r: CotaCadena[] = [];
  for (let i = 1; i < c.ts.length; i++) {
    const [ta, tb] = [c.ts[i - 1]!, c.ts[i]!];
    r.push({ cadena: c, i, a: puntoCadena(c, ta), b: puntoCadena(c, tb), p: puntoCadena(c, (ta + tb) / 2), valor: tb - ta, texto: (c.aprox[i - 1] || c.aprox[i] ? "≈" : "") + rotuloCota(tb - ta) });
  }
  return r;
}

/** Las cadenas de cotas de la vista `modelo` de un modelo. */
export const cadenasDe = (f: ModeloFisico): CadenaCotas[] => {
  const { validos, disperso } = ejesDibujados(f);
  return cadenasCotas(validos, disperso);
};

/** Las primitivas de unas cadenas de cotas. */
function cotas(cadenas: readonly CadenaCotas[]): Primitiva[] {
  const P: Primitiva[] = [];
  for (const c of cadenas) {
    const { d, n, ts } = c;
    P.push({ tipo: "linea", puntos: [puntoCadena(c, ts[0]!), puntoCadena(c, ts[ts.length - 1]!)], estilo: "cota" });
    const m = 0.12;
    for (const t of ts) {
      const p = puntoCadena(c, t);
      P.push({ tipo: "linea", puntos: [[p[0] - m * (d[0] + n[0]), p[1] - m * (d[1] + n[1])], [p[0] + m * (d[0] + n[0]), p[1] + m * (d[1] + n[1])]], estilo: "cota" });
    }
    const giro = giroTexto(n);
    for (const k of cotasCadena(c)) P.push({ tipo: "texto", p: k.p, texto: k.texto, tamano: 11, giro, ancla: "medio", dy: -4, fondo: true, prioridad: 15, clase: "cota" });
  }
  return P;
}

/**
 * Los ejes que cruzan el plano de un alzado (`alzado.ts`): una vertical en su cruce, de `z[0]` a
 * `z[1]`, con una burbuja en cada extremo. `plano.eje` (el eje del alzado) no se dibuja.
 */
export function capaEjesAlzado(f: ModeloFisico, plano: { eje?: string }, c: { u: (p: Vec2) => number; w: (p: Vec2) => number }, u: [number, number], z: [number, number]): Primitiva[] {
  const P: Primitiva[] = [];
  const { ejes: directrices, propuestos } = ejesDe(f);
  const ejes = ejesVistos(f, directrices, propuestos).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of ejes) {
    if (e.id === plano.eje || degenerado(e)) continue;
    const [wa, wb] = [c.w(e.desde), c.w(e.hasta)];
    if (wa === wb || (wa > 0 && wb > 0) || (wa < 0 && wb < 0)) continue;
    const t = wa / (wa - wb);
    const uc = c.u(e.desde) + t * (c.u(e.hasta) - c.u(e.desde));
    if (uc < u[0] || uc > u[1]) continue;
    const [p0, p1]: Vec2[] = [
      [uc, z[0]],
      [uc, z[1]],
    ];
    P.push({ tipo: "linea", puntos: [p0, p1], estilo: "eje", objeto: e.id });
    for (const p of [p0, p1]) {
      P.push({ tipo: "marca", p, forma: "circulo", radio: RADIO_BURBUJA, estilo: "eje-burbuja", objeto: e.id });
      P.push({ tipo: "texto", p, texto: e.nombre ?? e.id, tamano: 12, negrita: true, ancla: "medio", dy: 4, prioridad: 95, clase: "eje", objeto: e.id });
    }
  }
  return P;
}
