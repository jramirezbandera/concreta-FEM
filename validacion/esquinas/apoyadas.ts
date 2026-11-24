/**
 * Esquinas de un hueco que caen en un pilar o en una viga: ¿son esquinas entrantes de verdad?
 *
 * El aviso `franja/esquina-entrante` (`docs/fem3d/spr-abacos.md` §12) mira sólo la geometría del
 * hueco. Pero si su esquina cae dentro de la huella de un pilar o del ancho de una viga, la losa no
 * llega a ella: acaba en la cara del pilar o de la viga, y lo que queda junto al hueco es una esquina
 * de 90° de losa entre un borde libre y una cara apoyada (o la esquina de un recuadro entre dos vigas),
 * que no es singular. Se mide aquí: en el edificio objetivo de losas de 3 × 3 vanos y una planta
 * (`edificioObjetivoLosas`, vigas por los ejes y secundarias a media luz), con el hueco en el vano
 * central en cuatro posiciones, cada estación de franja cuya recta (en su franja o su ventana) pasa a
 * ≤ 1,5 m de una esquina del hueco, con h de 0,75 a 0,1 (ε_snap 0,01), por el tipo de la esquina más
 * cercana:
 *   - pilar: la esquina en la huella de un pilar (el hueco de eje a eje);
 *   - cruce: en el cruce de dos vigas sin pilar (el borde por el eje de la secundaria);
 *   - viga:  en el ancho de una sola viga, con el otro borde libre;
 *   - libre: la esquina en la losa, a más de 0,85 m de las vigas (el control: la de §12);
 *   - sin hueco: las estaciones junto a los cuatro pilares de A en la losa sin hueco (la referencia de
 *     lo que no converge junto a un pilar con hueco o sin él).
 * Uso: bun validacion/esquinas/apoyadas.ts > validacion/esquinas/out_apoyadas.txt
 */
import { prepararNucleo } from "../a3/revisar.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { conAcciones } from "../c5/modelos.ts";
import { conjuntoCombinaciones, seleccionPorDefecto } from "../../src/agente/combinaciones.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion, Vec2 } from "../../src/compilador/fisico.ts";
import { ejesArmado } from "../../src/compilador/franjas.ts";
import { calcular } from "../../src/motor/calcular.ts";

await prepararNucleo();

type Tipo = "pilar" | "cruce" | "viga" | "libre" | "sin hueco";
interface Variante {
  nombre: string;
  /** Sin hueco: la referencia de las estaciones junto a los mismos pilares. */
  hueco: Vec2[] | null;
  /** Sin la secundaria S1-1 (la que cruza el vano central por x = 9). */
  sinSecundaria: boolean;
  esquinas: { p: Vec2; tipo: Tipo }[];
}
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const VARIANTES: Variante[] = [
  {
    nombre: "A, de eje a eje",
    hueco: rect(6, 5, 12, 10),
    sinSecundaria: true,
    esquinas: [[6, 5], [12, 5], [12, 10], [6, 10]].map((p) => ({ p: p as Vec2, tipo: "pilar" })),
  },
  {
    nombre: "B, por el eje de la secundaria",
    hueco: rect(9, 5, 12, 10),
    sinSecundaria: false,
    esquinas: [
      { p: [9, 5], tipo: "cruce" },
      { p: [12, 5], tipo: "pilar" },
      { p: [12, 10], tipo: "pilar" },
      { p: [9, 10], tipo: "cruce" },
    ],
  },
  {
    nombre: "C, medio vano con un borde libre",
    hueco: rect(6, 5, 12, 7.5),
    sinSecundaria: true,
    esquinas: [
      { p: [6, 5], tipo: "pilar" },
      { p: [12, 5], tipo: "pilar" },
      { p: [12, 7.5], tipo: "viga" },
      { p: [6, 7.5], tipo: "viga" },
    ],
  },
  {
    nombre: "D, libre (control)",
    hueco: rect(7, 6, 11, 9),
    sinSecundaria: true,
    esquinas: [[7, 6], [11, 6], [11, 9], [7, 9]].map((p) => ({ p: p as Vec2, tipo: "libre" })),
  },
  {
    nombre: "E, sin hueco (los pilares de A)",
    hueco: null,
    sinSecundaria: true,
    esquinas: [[6, 5], [12, 5], [12, 10], [6, 10]].map((p) => ({ p: p as Vec2, tipo: "sin hueco" })),
  },
];

function modelo(v: Variante): ModeloFisico {
  const f = conAcciones(edificioObjetivoLosas(1, 3, 3));
  return {
    ...f,
    vigas: f.vigas!.filter((x) => !(v.sinSecundaria && x.id.startsWith("S1-1-"))),
    losas: f.losas!.map((l) => ({ ...l, huecos: v.hueco ? [v.hueco] : [] })),
  };
}

const RADIO = 1.5;
interface Fila {
  d: number;
  tipo: Tipo;
  /** Ancho en losa sobre el de la franja. */
  losa: number;
  sup: number;
  inf: number;
}

function medir(v: Variante, op: OpcionesCompilacion): Map<string, Fila> {
  const fisico = modelo(v);
  const c = compilar(fisico, op);
  if (!c.valido) throw new Error(c.diagnosticos.filter((d) => d.severidad === "error")[0]?.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  const q = new Consultas(fisico, c, k.casos, op);
  const cj = conjuntoCombinaciones(q, seleccionPorDefecto(fisico.casos, "esfuerzos"));
  if (!cj.valido) throw new Error(cj.diagnosticos[0]!.mensaje);
  const r = new Map<string, Fila>();
  for (const l of fisico.losas!) {
    const fs = q.franjas(l.id);
    if (!fs.valido) throw new Error(l.id);
    for (const f of fs.valor) {
      const { d, n } = ejesArmado(l)[f.direccion];
      const e = q.franja(f.id);
      const a = q.armadoFranja(f.id, cj.valor.factores);
      if (!e.valido || !a.valido) throw new Error(f.id);
      e.valor.estaciones.forEach((x, i) => {
        const [t0, t1] = x.ventana ?? [f.t0, f.t1];
        let mejor = { d: Infinity, tipo: "libre" as Tipo };
        for (const { p: P, tipo } of v.esquinas) {
          const sc = P[0] * d[0] + P[1] * d[1];
          const tc = P[0] * n[0] + P[1] * n[1];
          const dist = Math.hypot(x.s - sc, Math.max(0, t0 - tc, tc - t1));
          if (dist < mejor.d) mejor = { d: dist, tipo };
        }
        if (!(mejor.d <= RADIO)) return;
        const clave = `${f.id}|${x.tipo}|${x.s.toFixed(3)}|${x.lado}`;
        r.set(clave, { ...mejor, losa: x.anchoEnLosa / (t1 - t0), sup: a.valor[i]!.superior, inf: a.valor[i]!.inferior });
      });
    }
  }
  console.error(`  ${v.nombre} ${JSON.stringify(op)}: ${c.modelo.nudos.length} nudos`);
  return r;
}

const MALLAS: [string, OpcionesCompilacion][] = [
  ["0,75", { tamanoMalla: 0.75 }],
  ["0,375", { tamanoMalla: 0.375 }],
  ["0,25 ε.01", { tamanoMalla: 0.25, epsSnap: 0.01 }],
  ["0,15 ε.01", { tamanoMalla: 0.15, epsSnap: 0.01 }],
  ["0,1 ε.01", { tamanoMalla: 0.1, epsSnap: 0.01 }],
];
const pc = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)} %`;
const BANDAS = [
  [0, 0.25],
  [0.25, 0.5],
  [0.5, 0.75],
  [0.75, 1.5],
] as const;
/** Por tipo de esquina y banda de distancia, los errores de h = 0,75 y de h = 0,15 frente a h = 0,1 (las ≥ UMBRAL). */
const UMBRAL = 5;
const errores = new Map<string, { e75: number[]; e15: number[] }>();
const detalle: string[] = [];

for (const v of VARIANTES) {
  const res = MALLAS.map(([n, o]) => [n, medir(v, o)] as const);
  const ref = res[res.length - 1]![1];
  for (const [cl, f] of ref)
    for (const lado of ["sup", "inf"] as const) {
      if (f[lado] < UMBRAL) continue;
      const g75 = res[0]![1].get(cl)?.[lado];
      const g15 = res[3]![1].get(cl)?.[lado];
      const banda = BANDAS.findIndex(([a, b]) => f.d >= a && f.d < b);
      if (banda < 0) continue;
      const k = `${f.tipo}|${banda}`;
      const z = errores.get(k) ?? { e75: [], e15: [] };
      if (g75 !== undefined) z.e75.push((g75 - f[lado]) / f[lado]);
      if (g15 !== undefined) z.e15.push((g15 - f[lado]) / f[lado]);
      errores.set(k, z);
      if (f.d <= 0.5) {
        const vs = res.map(([, m]) => m.get(cl)?.[lado]);
        detalle.push(`  ${`${v.nombre.slice(0, 1)} ${f.tipo} ${cl} ${lado}`.padEnd(44)} ${f.d.toFixed(2).padStart(5)} ${f.losa.toFixed(2).padStart(5)}  ${vs.map((x) => (x === undefined ? "—" : x.toFixed(1)).padStart(9)).join("")}`);
      }
    }
}

const resumen = (es: number[]) => {
  if (!es.length) return "".padStart(30);
  const peor = es.reduce((x, y) => (Math.abs(y) > Math.abs(x) ? y : x));
  return `${pc(es.reduce((x, y) => x + Math.abs(y), 0) / es.length).padStart(8)} ${pc(peor).padStart(8)}`;
};
console.log(`Esquinas de un hueco en el edificio objetivo de losas de 3 × 3 vanos (una planta): estaciones de franja a ≤ ${RADIO} m,`);
console.log(`envolvente de ELU superior e inferior (kN·m/m, las ≥ ${UMBRAL} en la referencia), por el tipo de la esquina más cercana.`);
console.log(`Error frente a h = 0,1 (ε_snap 0,01): |media| y peor, con h = 0,75 y con h = 0,15.\n`);
console.log(`  ${"esquina".padEnd(9)} ${"distancia".padEnd(11)} ${"n".padStart(4)}   ${"h = 0,75: |media|  peor".padEnd(26)}   h = 0,15: |media|  peor`);
for (const tipo of ["pilar", "sin hueco", "cruce", "viga", "libre"] as const)
  BANDAS.forEach(([a, b], i) => {
    const z = errores.get(`${tipo}|${i}`);
    if (!z) return;
    console.log(`  ${tipo.padEnd(9)} ${`${a}–${b} m`.padEnd(11)} ${String(z.e75.length).padStart(4)}   ${resumen(z.e75).padEnd(26)}   ${resumen(z.e15)}`);
  });
console.log(`\nPor estación (a ≤ 0,5 m): variante, esquina, franja | tipo | s | lado, distancia, losa / ancho, y el valor en cada malla`);
console.log(`  ${"".padEnd(44)} ${"d".padStart(5)} ${"losa".padStart(5)}  ${MALLAS.map(([n]) => n.padStart(9)).join("")}`);
for (const l of detalle) console.log(l);
