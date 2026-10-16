/**
 * LV2-h (`docs/fem3d/refinamiento-vigas.md` §11–§12): dónde se toman my y mxy de las estaciones de
 * cara y de apoyo de las franjas. Antes, a δ = 1 mm de la cara; ahora, donde detrás de la recta hay un
 * borde rígido (el ancho de una viga, la huella de un pilar, un apoyo lineal con giros), a un número
 * de cantos de la losa (o a la mitad de lo libre hasta el siguiente apoyo). Mide, sobre los mismos
 * cálculos, la regla de antes (`muestrasEnCara: true`) y la nueva con 1, 1,5 y 2 cantos
 * (`cantosMuestras`):
 * 1. **Oráculo analítico:** una losa continua de dos vanos en flexión cilíndrica con ν = 0,2 (los
 *    bordes largos con θx coartado, que en w = w(x) no reacciona; el apoyo interior también, para que
 *    sea un borde rígido). En las dos estaciones de apoyo del apoyo interior, mx es −qL²/8 con
 *    cualquier regla, my tiene que ser ν·M(x) en el punto donde cada regla dice tomarlo y mxy, 0: la
 *    regla nueva mide lo que dice medir;
 * 2. **H25** (la losa plana y su reticular con ábacos): la superior de Wood–Armer en las caras y los
 *    apoyos con h = 0,75 y 0,375 frente a 0,1875 (las estaciones que hay en las tres mallas y valen al
 *    menos el 20 % de la mayor), y cuánto cambia la superior con cada regla en la malla de 0,75;
 * 3. **La retícula de 4 × 4 de LV2:** el criterio 3 (estaciones de apoyo por encima del 10 y del
 *    20 % frente a h = 0,125, con la misma regla) con cada regla.
 *
 *   bun validacion/f/muestras.ts > validacion/f/out_muestras.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosFranjas } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { losaPlanaFisica, OPCIONES_LOSA_PLANA } from "../c2/losaPlana.ts";
import { edificioReticular } from "../c4/modelos.ts";
import { conAcciones, reticularH25 } from "../c5/modelos.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const pc = (x: number, n = 2) => `${(100 * x).toFixed(n)} %`;
const med = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? NaN;

const REGLAS: [string, { muestrasEnCara?: boolean; cantosMuestras?: number }][] = [
  ["antes (δ)", { muestrasEnCara: true }],
  ["1 canto", { cantosMuestras: 1 }],
  ["1,5 cantos", { cantosMuestras: 1.5 }],
  ["2 cantos", { cantosMuestras: 2 }],
];

/** Un modelo calculado con las franjas por cada regla (los mismos cortes y campos). */
interface Varios {
  por: Map<string, EsfuerzosFranjas>;
  nudos: number;
  nc: number;
}

function calcularVarios(f: ModeloFisico, op: OpcionesCompilacion = {}): Varios {
  const r = compilar(f, op);
  if (!r.valido) throw new Error(r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join("\n"));
  const c = calcular(r.modelo);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const casos = casosValidos(c);
  const ctx = validar(f, resolverOpciones(op), new Diagnosticos())!;
  const cortes = new Cortes(r.modelo);
  const campos = new CamposLaminas(r.modelo);
  return { por: new Map(REGLAS.map(([n, o]) => [n, new EsfuerzosFranjas(ctx, r, casos, { cortes, campos, ...o })])), nudos: r.modelo.nudos.length, nc: casos.length };
}

// ─── 1. El oráculo ────────────────────────────────────────────────────────────────────────────
console.log("# LV2-h: my y mxy de las estaciones de cara y de apoyo, a δ (antes) y a un número de cantos (ahora)\n");
console.log("## 1. Losa continua de dos vanos en flexión cilíndrica (L = 5 m, t = 0,3, ν = 0,2, q = 10 kN/m²): las estaciones del apoyo interior\n");
console.log("M(x) = (3qL/8)·x − q·x²/2; en el apoyo, −qL²/8 = −31,25. Error sobre qL²/8 en las 8 estaciones (4 franjas × 2 lados), con h = 0,25 y 0,125.\n");
console.log("h | regla | d (m) | mx: error máx | my frente a ν·M(L ∓ d): error máx | my frente a ν·M(L): error máx | |mxy| máx");
{
  const [L, B, q, nu, t] = [5, 4, 10, 0.2, 0.3];
  const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const f: ModeloFisico = {
    plantas: [{ id: "P0", altura: null }],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25, nu, peso: 0 }],
    secciones: [],
    losas: [{ id: "L", planta: "P0", contorno: rect(0, 0, 2 * L, B), espesor: t, material: "H" }],
    apoyosLineales: [
      { id: "A", planta: "P0", puntos: [[0, 0], [0, B]], coartados: [true, true, true, false, false, false] },
      // El apoyo interior coarta también θx (en w = w(x) no reacciona): es un borde rígido, y las estaciones toman my y mxy a un canto
      { id: "C", planta: "P0", puntos: [[L, 0], [L, B]], coartados: [false, false, true, true, false, false] },
      { id: "B", planta: "P0", puntos: [[2 * L, 0], [2 * L, B]], coartados: [false, false, true, false, false, false] },
      { id: "G0", planta: "P0", puntos: [[0, 0], [2 * L, 0]], coartados: [false, false, false, true, false, false] },
      { id: "G1", planta: "P0", puntos: [[0, B], [2 * L, B]], coartados: [false, false, false, true, false, false] },
    ],
    casos: [{ id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P0", losa: "L", q: [0, 0, -q] }],
  };
  const M = (x: number) => ((3 * q * L) / 8) * x - (q * x * x) / 2;
  const ref = Math.abs(M(L));
  for (const h of [0.25, 0.125]) {
    const v = calcularVarios(f, { tamanoMalla: h });
    for (const [nombre, ef] of v.por) {
      const err = { mx: 0, my: 0, myCara: 0, mxy: 0 };
      const ds = new Set<string>();
      let n = 0;
      for (const fr of ef.franjas("L").filter((x) => x.direccion === 1))
        for (const e of ef.estaciones(fr.id)!.estaciones) {
          if (e.tipo !== "apoyo" || Math.abs(e.s - L) > 1e-9 || !e.valido) continue;
          n++;
          ds.add(e.distanciaMuestras.toFixed(3));
          err.mx = Math.max(err.mx, Math.abs(e.medios[0]! - M(L)) / ref);
          err.my = Math.max(err.my, Math.abs(e.medios[1]! - nu * M(L - e.distanciaMuestras)) / ref);
          err.myCara = Math.max(err.myCara, Math.abs(e.medios[1]! - nu * M(L)) / ref);
          err.mxy = Math.max(err.mxy, Math.abs(e.medios[2]!) / ref);
        }
      console.log(`${h} | ${nombre} | ${[...ds].join(", ")} | ${pc(err.mx)} | ${pc(err.my)} | ${pc(err.myCara)} | ${pc(err.mxy)}   (${n} estaciones)`);
    }
  }
}

// ─── 2. H25 ───────────────────────────────────────────────────────────────────────────────────
console.log("\n## 2. H25: la superior en las caras y los apoyos con h = 0,75 y 0,375 frente a 0,1875, por regla\n");
console.log("Suma de los casos; las estaciones que hay en las tres mallas y valen al menos el 20 % de la mayor con 0,1875. «Cambio en 0,75»: la superior con la regla frente a la de antes en la misma malla (mediana y rango, en las que valen al menos el 20 %). d: la distancia de las muestras con 0,75 (mín / mediana / máx) y cuántas quedan a δ.\n");
console.log("losa | regla | comparadas | 0,75 frente a 0,1875: media / máx | 0,375 frente a 0,1875: media / máx | cambio en 0,75: mediana, mín … máx | d (m)");

interface Caras {
  v: Map<string, number>;
  d: number[];
  enDelta: number;
}
function caras(ef: EsfuerzosFranjas, nc: number, losa?: string): Caras {
  const v = new Map<string, number>();
  const d: number[] = [];
  let enDelta = 0;
  const comb = [Array.from({ length: nc }, () => 1)];
  for (const f of ef.franjas(losa)) {
    const r = ef.estaciones(f.id)!;
    const env = ef.envolvente(f.id, comb)!;
    r.estaciones.forEach((e, i) => {
      if (!e.valido || e.tipo === "paso") return;
      v.set(`${f.id} ${e.tipo}${e.s.toFixed(6)}:${e.lado}`, env[i]!.superior);
      d.push(e.distanciaMuestras);
      if (e.distanciaMuestras <= 1e-3) enDelta++;
    });
  }
  return { v, d, enDelta };
}
const desvio = (a: Caras, b: Caras, c: Caras) => {
  // a, b frente a c (la fina), en las estaciones de las tres
  const max = Math.max(...c.v.values());
  const da: number[] = [];
  const db: number[] = [];
  for (const [k, z] of c.v) {
    const x = a.v.get(k);
    const y = b.v.get(k);
    if (x === undefined || y === undefined || z < 0.2 * max) continue;
    da.push(Math.abs(x / z - 1));
    db.push(Math.abs(y / z - 1));
  }
  const res = (ds: number[]) => `${pc(ds.reduce((s, x) => s + x, 0) / Math.max(1, ds.length), 1)} / ${pc(Math.max(0, ...ds), 1)}`;
  return { n: da.length, a: res(da), b: res(db) };
};
for (const [nombre, f, op] of [
  ["H25 losa plana", losaPlanaFisica(), { ...OPCIONES_LOSA_PLANA }],
  ["H25 reticular con ábacos", reticularH25(), { ...OPCIONES_LOSA_PLANA }],
] as [string, ModeloFisico, OpcionesCompilacion][]) {
  const sinBandas = { ...f, bandas: undefined };
  const mallas = [0.75, 0.375, 0.1875].map((h) => calcularVarios(sinBandas, { ...op, tamanoMalla: h }));
  const antes = caras(mallas[0]!.por.get("antes (δ)")!, mallas[0]!.nc);
  const maxA = Math.max(...antes.v.values());
  for (const [regla] of REGLAS) {
    const [c0, c1, c2] = mallas.map((m) => caras(m.por.get(regla)!, m.nc)) as [Caras, Caras, Caras];
    const dv = desvio(c0, c1, c2);
    const ratios: number[] = [];
    for (const [k, x] of antes.v) if (x >= 0.2 * maxA) ratios.push(c0.v.get(k)! / x);
    console.log(`${nombre} | ${regla} | ${dv.n} | ${dv.a} | ${dv.b} | ${med(ratios).toFixed(3)}, ${Math.min(...ratios).toFixed(3)} … ${Math.max(...ratios).toFixed(3)} | ${Math.min(...c0.d).toFixed(3)} / ${med(c0.d).toFixed(3)} / ${Math.max(...c0.d).toFixed(3)}, ${c0.enDelta} a δ`);
  }
}

// ─── 3. La retícula de 4 × 4 ──────────────────────────────────────────────────────────────────
console.log("\n## 3. La retícula de 4 × 4 de LV2: el criterio 3 con cada regla\n");
console.log("Superior de ELU en las estaciones de apoyo frente a h = 0,125 (con la misma regla), sobre el máximo de la franja.\n");
console.log("malla | regla | estaciones | mediana | máx | > 10 % | > 20 %");
const ELU = [1.35, 1.5, 0, 0];
const reticula = conAcciones(edificioReticular(1, 3, 3));
interface Apoyos {
  v: Map<string, number>;
  maxFranja: Map<string, number>;
}
function apoyos(ef: EsfuerzosFranjas): Apoyos {
  const v = new Map<string, number>();
  const maxFranja = new Map<string, number>();
  for (const f of ef.franjas("L-N1")) {
    const r = ef.estaciones(f.id)!;
    const env = ef.envolvente(f.id, [ELU])!;
    maxFranja.set(f.id, Math.max(1, ...env.map((x) => x.superior)));
    r.estaciones.forEach((e, i) => {
      if (e.tipo === "apoyo" && e.valido) v.set(`${f.id} ${e.s.toFixed(3)}:${e.lado}`, env[i]!.superior);
    });
  }
  return { v, maxFranja };
}
const refR = calcularVarios(reticula, { tamanoMalla: 0.125, refinoEsquinas: true });
for (const [nombre, op] of [
  ["LV2, h = 0,75", { refinoEsquinas: true }],
  ["LV1, h = 0,5 uniforme", { tamanoMalla: 0.5, refinoEsquinas: false }],
] as [string, OpcionesCompilacion][]) {
  const g = calcularVarios(reticula, op);
  for (const [regla] of REGLAS) {
    const a = apoyos(g.por.get(regla)!);
    const ref = apoyos(refR.por.get(regla)!);
    const errs: number[] = [];
    for (const [k, x] of a.v) {
      const y = ref.v.get(k);
      if (y === undefined) continue;
      errs.push(Math.abs(x - y) / ref.maxFranja.get(k.split(" ")[0]!)!);
    }
    console.log(`${nombre} | ${regla} | ${errs.length} | ${pc(med(errs), 1)} | ${pc(Math.max(...errs), 1)} | ${errs.filter((x) => x > 0.1).length} | ${errs.filter((x) => x > 0.2).length}`);
  }
}
