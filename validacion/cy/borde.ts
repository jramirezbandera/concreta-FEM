/**
 * CY-10: la viga de borde de un reticular, como la discretiza CYPECAD frente a como la compilamos.
 *
 * Un recuadro de 6s × 6s de 25+5 (intereje 0,72) con vigas de 30×30 en los cuatro lados y pilares
 * de 30×30 en las esquinas (3,35 m, base empotrada, cabeza al 0,3), con 10 kN/m² en la losa.
 *
 * - CYPECAD (memoria de cálculo, pp. 12–15): el emparrillado de barras de `reticular.ts` entre las
 *   caras interiores de las vigas; cada barra acaba en la cara de la viga, unida por un enlace rígido
 *   a su eje («de idéntica manera se tiene en cuenta el tamaño de las vigas»); la viga, en su eje,
 *   con nudos en los cruces y unida por un enlace rígido al pilar en su cara.
 * - Nosotros: el modelo físico con la losa hasta el eje de las vigas (la regla de «Vigas de borde»)
 *   y la carga sólo entre las caras, como en el emparrillado; y variantes para ver qué pesa.
 *
 * - Nuestra lámina con la topología de CYPECAD: la losa sólo entre las caras, con sus nudos de borde
 *   unidos por un enlace rígido al eje de la viga. Separa la lámina (criterio 6) de la topología.
 *
 * Se comparan la viga (momento en la cara del pilar y en el centro, cortante en la cara) y la losa
 * (flecha y momento en el centro, flecha junto a la viga).
 *
 *   bun validacion/cy/borde.ts > validacion/cy/out_borde.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion, Vec2 } from "../../src/compilador/fisico.ts";
import { sha256 } from "../../src/compilador/huella.ts";
import { KAPPA } from "../../src/elementos/dkmq.ts";
import { DiagramasBarras } from "../../src/motor/barras.ts";
import { calcular } from "../../src/motor/calcular.ts";
import type { Apoyo, BarraAnalitica, CargaNodal, ModeloAnalitico, Restriccion } from "../../src/motor/modelo.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { Constructor } from "../../src/pruebas/constructor.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { hormigon, rectangular } from "../../src/secciones/seccion3D.ts";
import { valorEnPunto } from "../../src/visor/datos.ts";
import { Sesion } from "../../src/visor/sesion.ts";
import { RET } from "./reticular.ts";

const WASM = readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(WASM);

const N = 6;
const { h, hf, bw, s } = RET;
const b = s / 3;
const L = N * s;
const e = 0.15; // medio ancho de la viga y del pilar
const H = 3.35;
const q = -10;
const HA = hormigon(30);
const ALFA = 0.3;
const TORSION_VIGA = 0.1; // D4

interface Resultado {
  viga: { mCara: number; mCentro: number; vCara: number };
  losa: { wCentro: number; mCentro: number; wBorde: number };
}

// Puntos de medida: cruces del emparrillado (b/2 + i·b) y centro de una barra
const iC = 3 * N / 2 - 1; // el cruce junto al centro
const xC = b / 2 + iC * b;
const xM = xC + b / 2; // centro de la barra según X que sale de él
const yB = b / 2; // el primer cruce junto a la viga y = −e

function cype(): Resultado {
  const m = new Constructor();
  const nudos = new Map<string, number>();
  const nudo = (x: number, y: number, z = 0) => {
    const k = `${x.toFixed(9)},${y.toFixed(9)},${z.toFixed(9)}`;
    let n = nudos.get(k);
    if (n === undefined) nudos.set(k, (n = m.nudo(x, y, z)));
    return n;
  };
  const pos = Array.from({ length: 3 * N }, (_, i) => b / 2 + i * b);
  const Iy = (0.5 * b * h ** 3) / 12;
  const nervio = { E: HA.E, G: HA.G, A: b * h, Iy, Iz: (h * b ** 3) / 12, J: 2 * Iy, Avy: KAPPA * b * h, Avz: KAPPA * h * b * (bw / s) };
  const v30 = rectangular(0.3, 0.3, HA);
  const viga = { ...v30, J: v30.J * TORSION_VIGA };
  // Pilares en las esquinas, con la cabeza al 0,3
  const esquinas: Vec2[] = [[-e, -e], [L + e, -e], [L + e, L + e], [-e, L + e]];
  for (const [x, y] of esquinas) {
    const base = nudo(x, y, -H);
    m.apoyo(base);
    m.barra(base, nudo(x, y), { ...v30, A: v30.A * 2 }, [1, 0, 0], { empotramiento: { j: ALFA } });
  }
  // Las cuatro vigas en su eje; cada una, de cara a cara de pilar, con nudos en los cruces y en el centro
  let barraCara = -1;
  let barraCentro = -1;
  const lados: { P: (t: number) => [number, number]; esq: [Vec2, Vec2] }[] = [
    { P: (t) => [t, -e], esq: [esquinas[0]!, esquinas[1]!] },
    { P: (t) => [L + e, t], esq: [esquinas[1]!, esquinas[2]!] },
    { P: (t) => [t, L + e], esq: [esquinas[3]!, esquinas[2]!] },
    { P: (t) => [-e, t], esq: [esquinas[0]!, esquinas[3]!] },
  ];
  const ts = [0, ...pos, L / 2, L].sort((p, t) => p - t);
  for (const [k, lado] of lados.entries()) {
    for (let i = 0; i + 1 < ts.length; i++) {
      const [a, t] = [ts[i]!, ts[i + 1]!];
      const br = m.barra(nudo(...lado.P(a)), nudo(...lado.P(t)), viga, [0, 0, 1]);
      if (k === 0 && i === 0) barraCara = br;
      if (k === 0 && Math.abs(t - L / 2) < 1e-9) barraCentro = br;
    }
    m.enlace(nudo(...lado.esq[0]), [nudo(...lado.P(0))]);
    m.enlace(nudo(...lado.esq[1]), [nudo(...lado.P(L))]);
  }
  // El emparrillado entre las caras, cada barra unida en la cara al eje de la viga
  const F: CargaNodal[] = [];
  for (const x of pos) for (const y of pos) F.push({ nudo: nudo(x, y), f: [0, 0, q * b * b, 0, 0, 0] });
  let barraM = -1;
  const cortes = [0, ...pos, L];
  for (const dir of [0, 1])
    for (const y of pos) {
      const P = (a: number) => (dir === 0 ? nudo(a, y) : nudo(y, a));
      const eje = (a: number) => (dir === 0 ? nudo(a === 0 ? -e : L + e, y) : nudo(y, a === 0 ? -e : L + e));
      m.enlace(eje(0), [P(0)]);
      m.enlace(eje(L), [P(L)]);
      for (let k = 0; k + 1 < cortes.length; k++) {
        const br = m.barra(P(cortes[k]!), P(cortes[k + 1]!), nervio, [0, 0, 1]);
        if (dir === 0 && Math.abs(y - xC) < 1e-9 && Math.abs(cortes[k]! - xC) < 1e-9) barraM = br;
      }
    }
  m.caso("q", F);
  const mod = m.modelo();
  const [c] = casosValidos(calcular(mod));
  const d = new DiagramasBarras(mod);
  const cara = d.diagrama(barraCara, 0, c!).esfuerzosEn(0, 1);
  const centro = d.diagrama(barraCentro, 0, c!).esfuerzosEn(L / 2 - ts[ts.indexOf(L / 2) - 1]!, -1);
  return {
    viga: { mCara: cara[4]!, mCentro: centro[4]!, vCara: cara[2]! },
    losa: { wCentro: c!.u[6 * nudo(xC, xC) + 2]!, mCentro: d.diagrama(barraM, 0, c!).esfuerzosEn(b / 2, 1)[4]! / b, wBorde: c!.u[6 * nudo(xC, yB) + 2]! },
  };
}

/** Nuestro modelo: la losa de `desde` a L − desde en las dos direcciones (−e: hasta el eje de las vigas). */
async function nuestro(desde: number, opciones: OpcionesCompilacion = {}): Promise<Resultado> {
  const [a, z] = [desde, L - desde];
  const f: ModeloFisico = {
    plantas: [{ id: "T", altura: null }, { id: "B", altura: H }],
    materiales: [{ id: "H", tipo: "hormigon", fck: 30, peso: 0 }],
    secciones: [
      { id: "P30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "V30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
    ],
    pilares: [[-e, -e], [L + e, -e], [L + e, L + e], [-e, L + e]].map(([x, y], i) => ({ id: `P${i + 1}`, x: x!, y: y!, desde: "B", hasta: "T", seccion: "P30" })),
    vigas: [
      { id: "V1", planta: "T", puntos: [[-e, -e], [L + e, -e]], seccion: "V30" },
      { id: "V2", planta: "T", puntos: [[L + e, -e], [L + e, L + e]], seccion: "V30" },
      { id: "V3", planta: "T", puntos: [[-e, L + e], [L + e, L + e]], seccion: "V30" },
      { id: "V4", planta: "T", puntos: [[-e, -e], [-e, L + e]], seccion: "V30" },
    ],
    losas: [{ id: "L", planta: "T", contorno: [[a, a], [z, a], [z, z], [a, z]], espesor: h, material: "H", reticular: { intereje: s, nervio: bw, capa: hf, caseton: "recuperable", abacos: [] } }],
    casos: [{ id: "q" }],
    cargas: [{ tipo: "superficie", id: "Q", caso: "q", planta: "T", q: [0, 0, q], zona: [[0, 0], [L, 0], [L, L], [0, L]] }],
  };
  const r = valido(compilar(f, opciones));
  const casos = casosValidos(calcular(r.modelo));
  const cons = new Consultas(f, r, casos, opciones);
  const dg = cons.diagrama("V1", [1]);
  if (!dg.valido) throw new Error(JSON.stringify(dg));
  const en = (sv: number, lado: "izquierda" | "derecha") => {
    const est = dg.valor;
    for (let i = 0; i + 1 < est.length; i++) {
      const [p, t] = [est[i]!, est[i + 1]!];
      if (sv >= p.s - 1e-9 && sv <= t.s + 1e-9 && t.s > p.s) {
        const w = (sv - p.s) / (t.s - p.s);
        return p[lado].map((v, k) => v * (1 - w) + t[lado][k]! * w);
      }
    }
    throw new Error(`estación ${sv}`);
  };
  const cara = en(2 * e, "derecha");
  const centro = en(L / 2 + e, "derecha");
  const sesion = Sesion.abrir(JSON.stringify({ esquema: "concreta-fem/proyecto@1", nombre: "borde", modelo: f, opciones }), sha256(new Uint8Array(WASM)));
  if (!sesion.valido) throw new Error(JSON.stringify(sesion.diagnosticos));
  const ss = sesion.sesion;
  const calc = await ss.calcular();
  if (!calc.ok) throw new Error(JSON.stringify(calc.diagnosticos));
  return {
    viga: { mCara: cara[4]!, mCentro: centro[4]!, vCara: cara[2]! },
    losa: {
      wCentro: punto(ss, "uz", xC, xC) / 1e3, // el mapa da mm
      mCentro: punto(ss, "m11", xM, xC),
      wBorde: punto(ss, "uz", xC, yB) / 1e3,
    },
  };
}

function punto(ss: Sesion, campo: "uz" | "m11", x: number, y: number): number {
  const r = valorEnPunto(ss, "T", campo, { tipo: "caso", caso: "q" }, x, y);
  if (!r.valido || !r.valor) throw new Error(`${campo} en (${x}, ${y})`);
  return r.valor.valor;
}

/**
 * Nuestra lámina con la topología de CYPECAD: la losa sólo entre las caras de las vigas (compilada
 * sola, con la rigidez «uniforme»), cada nudo de su borde unido por un enlace rígido al nudo del eje
 * de la viga que tiene enfrente (los de las esquinas, a la viga según Y), y vigas y pilares como en
 * el emparrillado.
 */
function laminasCype(): Resultado {
  const f: ModeloFisico = {
    plantas: [{ id: "T", altura: null, diafragma: "ninguno" }],
    materiales: [{ id: "H", tipo: "hormigon", fck: 30, peso: 0 }],
    secciones: [],
    losas: [{ id: "L", planta: "T", contorno: [[0, 0], [L, 0], [L, L], [0, L]], espesor: h, material: "H", reticular: { intereje: s, nervio: bw, capa: hf, caseton: "recuperable", abacos: [] } }],
    casos: [{ id: "q" }],
    cargas: [{ tipo: "superficie", id: "Q", caso: "q", planta: "T", q: [0, 0, q], losa: "L" }],
  };
  const r = valido(compilar(f, { tamanoMalla: b / 2 }));
  const base = r.modelo;
  const nudos = [...base.nudos];
  const barras: BarraAnalitica[] = [];
  const apoyos: Apoyo[] = [];
  const restricciones: Restriccion[] = [];
  const nuevo = (x: number, y: number, z = 0) => nudos.push({ id: `X${nudos.length}`, x, y, z }) - 1;
  const v30 = rectangular(0.3, 0.3, HA);
  const viga = { ...v30, J: v30.J * TORSION_VIGA };
  const tol = 1e-6;
  const esquinas: Vec2[] = [[-e, -e], [L + e, -e], [L + e, L + e], [-e, L + e]];
  const cabezas = esquinas.map(([x, y], i) => {
    const pie = nuevo(x, y, -H);
    const cab = nuevo(x, y);
    apoyos.push({ nudo: pie, coartados: [true, true, true, true, true, true] });
    barras.push({ id: `P${i}`, nudos: [pie, cab], seccion: { ...v30, A: v30.A * 2 }, vz: [1, 0, 0], empotramiento: { j: ALFA } });
    return cab;
  });
  // Lados: el borde de la losa (coordenada fija c en el eje k) y el eje de la viga, a e por fuera
  const lados = [
    { k: 1, c: 0, eje: -e, esq: [0, 1], X: true },
    { k: 0, c: L, eje: L + e, esq: [1, 2], X: false },
    { k: 1, c: L, eje: L + e, esq: [3, 2], X: true },
    { k: 0, c: 0, eje: -e, esq: [0, 3], X: false },
  ];
  let barraCara = -1;
  let barraCentro = -1;
  for (const [il, lado] of lados.entries()) {
    const coord = (n: { x: number; y: number }) => (lado.k === 1 ? [n.x, n.y] : [n.y, n.x]) as [number, number];
    const borde = base.nudos.map((n, i) => ({ i, t: coord(n)[0], c: coord(n)[1] })).filter((n) => Math.abs(n.c - lado.c) < tol);
    // Las esquinas de la losa, a las vigas según Y (lados 1 y 3)
    const propios = borde.filter((n) => lado.X ? n.t > tol && n.t < L - tol : true);
    const ts = [...new Set([0, L, L / 2, ...propios.map((n) => n.t)].map((t) => +t.toFixed(9)))].sort((p, t) => p - t);
    const P = (t: number): [number, number] => (lado.k === 1 ? [t, lado.eje] : [lado.eje, t]);
    const ejes = ts.map((t) => nuevo(...P(t)));
    for (let i = 0; i + 1 < ejes.length; i++) {
      barras.push({ id: `V${il}-${i}`, nudos: [ejes[i]!, ejes[i + 1]!], seccion: viga, vz: [0, 0, 1] });
      if (il === 0 && i === 0) barraCara = barras.length - 1;
      if (il === 0 && Math.abs(ts[i + 1]! - L / 2) < tol) barraCentro = barras.length - 1;
    }
    restricciones.push({ tipo: "enlace-rigido", id: `C${il}a`, maestro: cabezas[lado.esq[0]!]!, esclavos: [ejes[0]!] });
    restricciones.push({ tipo: "enlace-rigido", id: `C${il}b`, maestro: cabezas[lado.esq[1]!]!, esclavos: [ejes[ejes.length - 1]!] });
    for (const n of propios) restricciones.push({ tipo: "enlace-rigido", id: `E${il}-${n.i}`, maestro: ejes[ts.indexOf(+n.t.toFixed(9))]!, esclavos: [n.i] });
  }
  const mod: ModeloAnalitico = { ...base, nudos, barras: [...(base.barras ?? []), ...barras], apoyos: [...(base.apoyos ?? []), ...apoyos], restricciones: [...(base.restricciones ?? []), ...restricciones] };
  const [c] = casosValidos(calcular(mod));
  const d = new DiagramasBarras(mod);
  const nd = (x: number, y: number) => base.nudos.findIndex((n) => Math.abs(n.x - x) < tol && Math.abs(n.y - y) < tol);
  const [nC, nM, nB] = [nd(xC, xC), nd(xM, xC), nd(xC, yB)];
  if (nC < 0 || nM < 0 || nB < 0) throw new Error("la malla no tiene nudo en los puntos de medida");
  const campos = new CamposLaminas(mod);
  const l = mod.laminas!.findIndex((x) => x.nudos.includes(nM));
  const n0 = (base.barras ?? []).length; // las barras nuevas van detrás de las de la losa
  const cara = d.diagrama(n0 + barraCara, 0, c!).esfuerzosEn(0, 1);
  const bc = mod.barras![n0 + barraCentro]!;
  const centro = d.diagrama(n0 + barraCentro, 0, c!).esfuerzosEn(Math.hypot(nudos[bc.nudos[1]]!.x - nudos[bc.nudos[0]]!.x, nudos[bc.nudos[1]]!.y - nudos[bc.nudos[0]]!.y), -1);
  return {
    viga: { mCara: cara[4]!, mCentro: centro[4]!, vCara: cara[2]! },
    losa: { wCentro: c!.u[6 * nC + 2]!, mCentro: campos.enNudos(l, c!.u)[8 * mod.laminas![l]!.nudos.indexOf(nM) + 3]!, wBorde: c!.u[6 * nB + 2]! },
  };
}

const ref = cype();
const fila = (nombre: string, r: Resultado) => {
  const c = (v: number, w: number) => `${v.toFixed(3).padStart(8)} (${(v / w).toFixed(2)})`;
  console.log(
    `${nombre.padEnd(44)}${c(r.viga.mCara, ref.viga.mCara)}${c(r.viga.mCentro, ref.viga.mCentro)}${c(r.viga.vCara, ref.viga.vCara)}` +
      `${c(r.losa.wCentro * 1e3, ref.losa.wCentro * 1e3)}${c(r.losa.mCentro, ref.losa.mCentro)}${c(r.losa.wBorde * 1e3, ref.losa.wBorde * 1e3)}`,
  );
};
console.log(`Recuadro de ${L.toFixed(2)} m entre caras, vigas y pilares de 30×30, q = 10 kN/m²; entre paréntesis, frente al emparrillado de CYPECAD\n`);
console.log(`${"".padEnd(44)}${"viga: M cara".padStart(16)}${"M centro".padStart(16)}${"V cara".padStart(16)}${"losa: w centro".padStart(16)}${"m centro".padStart(16)}${"w junto viga".padStart(16)}`);
fila("Emparrillado de CYPECAD (barras)", ref);
fila("Nuestra lámina con la topología de CYPECAD", laminasCype());
fila("Nuestro: losa hasta el eje (por defecto)", await nuestro(-e));
fila("Nuestro: losa hasta el eje, malla 0,25", await nuestro(-e, { tamanoMalla: 0.25 }));
fila("Nuestro: losa hasta el eje, zona rígida 1", await nuestro(-e, { factorZonaRigida: 1 }));
fila("Nuestro: malla 0,12", await nuestro(-e, { tamanoMalla: 0.12 }));
fila("Nuestro: malla 0,10", await nuestro(-e, { tamanoMalla: 0.1 }));
