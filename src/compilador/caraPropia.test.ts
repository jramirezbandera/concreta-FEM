/**
 * Fase F3 (`docs/fem3d/cara-propia.md`): el metro de cada pilar en su cara propia (F2-8).
 * - Seguridad: ninguna estación de cara de un pilar cae dentro de su huella; la del metro de un
 *   pilar mayor que el menor de su línea va en su cara propia.
 * - El escalón (la recta común con la huella, trasladada) y el corte recto por la cara propia, con
 *   la misma ventana de nudo a nudo, sólo difieren en las tiras entre las dos rectas.
 * - Convergencia: con h = 0,75, a ≤ 2 % de la malla fina (h = 0,1) en la losa de 3 × 3 mezclada; la
 *   estación de antes (la cara común) daba un 50 % menos.
 * - Respaldo: sin el enlace de la huella, la estación de antes con el aviso `franja/cara-comun-dentro`.
 * - F3-d: en la cara de cualquier pilar, lo que transmite su huella por los nudos rígidos delante de
 *   ella (F2-9); junto al hueco del edificio, de −25…−43 % a ≤ 7 %. Sin nudos delante, bit a bit.
 * - La malla: tercios de un largo de h como mucho y la esquina fina con la transición en su tramo
 *   exterior, sin avisos con h = 0,75, 0,5 y 0,375, conforme, y la misma al trasladar o girar.
 * La medida completa, en `validacion/f3/convergencia.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { losa3x3Mezclada } from "../../validacion/f3/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { Cortes } from "../motor/cortes.ts";
import { Diagnosticos } from "../motor/diagnosticos.ts";
import type { ResultadoCaso } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { planos, transformar } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import { EsfuerzosFranjas, type EstacionFranja } from "./esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion, type Vec2 } from "./fisico.ts";
import { validar } from "./validar.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

type Compilado = Extract<ReturnType<typeof compilar>, { valido: true }>;
function compilado(f: ModeloFisico, op: OpcionesCompilacion = {}): Compilado {
  const r = compilar(f, op);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return r;
}
const avisosMalla = (r: Compilado) => r.diagnosticos.filter((d) => d.codigo.startsWith("malla/"));
const clave = (x: number, y: number, z: number) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;

/** Las estaciones de cara con ventana de la losa, con su franja. */
function metros(f: ModeloFisico, r: Compilado, casos: readonly ResultadoCaso[], sinEnlaces = false): { e: EstacionFranja; dir: 1 | 2; franja: string; diag: string[] }[] {
  const ctx = validar(f, resolverOpciones({}), new Diagnosticos())!;
  const ef = new EsfuerzosFranjas(ctx, { modelo: r.modelo, mapeo: sinEnlaces ? { ...r.mapeo, restricciones: [] } : r.mapeo }, casos, { cortes: new Cortes(r.modelo) });
  return ef.franjas("L").flatMap((fr) =>
    ef
      .estaciones(fr.id)!
      .estaciones.filter((e) => e.tipo === "cara" && e.ventana)
      .map((e) => ({ e, dir: fr.direccion, franja: fr.id, diag: e.diagnosticos.map((d) => d.codigo) })),
  );
}
/** El metro de un pilar en una dirección y un lado (la del centro de la ventana en el pilar). */
const delPilar = (m: ReturnType<typeof metros>, f: ModeloFisico, id: string, dir: 1 | 2, lado: -1 | 1) => {
  const p = f.pilares!.find((x) => x.id === id)!;
  const tc = dir === 1 ? p.y : p.x;
  return m.find((x) => x.dir === dir && x.e.lado === lado && x.e.piezas.includes(id) && Math.abs((x.e.ventana![0] + x.e.ventana![1]) / 2 - tc) < 1e-9)!;
};

describe("la losa de 3 × 3 con P6-5 de 40 × 40 y P12-10 de 30 × 50", () => {
  const f = losa3x3Mezclada();
  const r = compilado(f);
  let casos: ResultadoCaso[];
  let m: ReturnType<typeof metros>;
  beforeAll(() => {
    casos = casosValidos(calcular(r.modelo));
    m = metros(f, r, casos);
  });
  /** Cara propia de cada pilar: [x−, x+, y−, y+]. */
  const caraPropia = (id: string): [number, number, number, number] => {
    const p = f.pilares!.find((x) => x.id === id)!;
    const s = f.secciones.find((x) => x.id === p.seccion)! as { b: number; h: number };
    return [p.x - s.h / 2, p.x + s.h / 2, p.y - s.b / 2, p.y + s.b / 2];
  };

  it("seguridad: cada metro va en la cara propia de su pilar, nunca dentro de una huella", () => {
    expect(m.length).toBeGreaterThan(0);
    for (const x of m) {
      const p = f.pilares!.find((q) => {
        const t = x.dir === 1 ? q.y : q.x;
        return Math.abs((x.e.ventana![0] + x.e.ventana![1]) / 2 - t) < 1e-9 && x.e.piezas.includes(q.id);
      })!;
      const [x0, x1, y0, y1] = caraPropia(p.id);
      expect(x.e.s, `${x.franja} ${p.id}`).toBeCloseTo(x.dir === 1 ? (x.e.lado < 0 ? x0 : x1) : x.e.lado < 0 ? y0 : y1, 12);
      expect(x.diag).not.toContain("franja/cara-comun-dentro");
    }
    // Las de los mayores, en su cara (la común va 5 y 10 cm por dentro)
    expect(delPilar(m, f, "P6-5", 1, -1).e.s).toBeCloseTo(5.8, 12);
    expect(delPilar(m, f, "P6-5", 2, 1).e.s).toBeCloseTo(5.2, 12);
    expect(delPilar(m, f, "P12-10", 1, 1).e.s).toBeCloseTo(12.25, 12);
  });

  it("convergencia: con h = 0,75, a ≤ 2 % de la malla fina; la estación de antes, un 50 % menos", () => {
    // Referencia: h = 0,1 (validacion/f3/out_convergencia.txt); con h = 0,125, a ≤ 0,7 %
    const ref: [string, 1 | 2, -1 | 1, number][] = [
      ["P6-5", 1, -1, -76.64],
      ["P6-5", 1, 1, -64.58],
      ["P6-5", 2, -1, -66.09],
      ["P6-5", 2, 1, -59.17],
      ["P12-10", 1, -1, -61.93],
      ["P12-10", 1, 1, -75.89],
    ];
    const antes = metros(f, r, casos, true);
    for (const [id, dir, lado, v] of ref) {
      expect(Math.abs(delPilar(m, f, id, dir, lado).e.medios[0]! / v - 1), `${id} ${dir} ${lado}`).toBeLessThan(0.02);
      const a = delPilar(antes, f, id, dir, lado);
      expect(a.e.medios[0]! / v - 1).toBeLessThan(-0.4);
      expect(a.diag).toContain("franja/cara-comun-dentro");
    }
  });

  it("el escalón y el corte recto por la cara propia, con la misma ventana de nudo a nudo, a ≤ 2 %", () => {
    // P12-10, caras x: la red de su plantilla lleva la cara propia (x = 12 ± 0,25) y la común (± 0,15)
    const ct = new Cortes(r.modelo);
    const huella = r.modelo.restricciones!.find((x) => x.id.startsWith("P12-10@"))!.id;
    for (const [lado, propia, comun] of [
      [-1, 11.75, 11.85],
      [1, 12.25, 12.15],
    ] as const) {
      const ys = (x0: number) => new Set(r.modelo.nudos.filter((n) => Math.abs(n.x - x0) < 1e-9 && Math.abs(n.y - 10) < 0.6).map((n) => Math.round(n.y * 1e9)));
      const comunes = [...ys(propia)].filter((y) => ys(comun).has(y)).map((y) => y / 1e9);
      const [w0, w1] = [Math.min(...comunes), Math.max(...comunes)];
      expect(w1 - w0).toBeGreaterThan(0.9);
      const sx = lado === -1 ? 1 : -1;
      const corte = (s: number) => {
        const res = ct.cortar({ origen: [s, w0, 0], x: [sx, 0, 0], vz: [0, 0, 1], y: sx > 0 ? [0, w1 - w0] : [w0 - w1, 0], soloLaminas: true, restricciones: [huella] }, casos);
        expect(res.valido).toBe(true);
        return res.esfuerzos[4]! - (propia - s) * sx * res.esfuerzos[2]!;
      };
      expect(Math.abs(corte(comun) / corte(propia) - 1)).toBeLessThan(0.02);
    }
  });

  it("la malla: sin avisos con h = 0,75, 0,5 y 0,375 (con 0,75, las 16 plantillas refinadas), conforme", () => {
    expect(r.estadisticas.malla.plantillasRefinadas).toBe(16);
    for (const h of [0.75, 0.5, 0.375]) expect(avisosMalla(compilado(f, { tamanoMalla: h })), `h = ${h}`).toEqual([]);
    const uso = new Map<string, number>();
    for (const l of r.modelo.laminas!)
      for (let k = 0; k < 4; k++) {
        const [a, b] = [l.nudos[k]!, l.nudos[(k + 1) % 4]!];
        const c = a < b ? `${a},${b}` : `${b},${a}`;
        uso.set(c, (uso.get(c) ?? 0) + 1);
      }
    const N = r.modelo.nudos;
    const borde = (x: number, y: number) => Math.abs(x + 0.5) < 1e-9 || Math.abs(x - 18.5) < 1e-9 || Math.abs(y + 0.5) < 1e-9 || Math.abs(y - 15.5) < 1e-9;
    expect([...uso].filter(([c, n]) => {
      const [a, b] = c.split(",").map(Number) as [number, number];
      return n !== 2 && !borde((N[a]!.x + N[b]!.x) / 2, (N[a]!.y + N[b]!.y) / 2);
    })).toEqual([]);
  });

  it("trasladar, girar 90° o 37° la planta, o reordenar sus listas, da la misma malla", () => {
    const nudos = new Set(r.modelo.nudos.map((n) => clave(n.x, n.y, n.z)));
    const variantes: [string, ModeloFisico, (q: Vec2) => Vec2][] = [
      ...planos().map(({ nombre, t }): [string, ModeloFisico, (q: Vec2) => Vec2] => {
        const [p0, p1, p2] = [t.p([0, 0]), t.p([1, 0]), t.p([0, 1])];
        const [a, b, c, d] = [p1[0] - p0[0], p2[0] - p0[0], p1[1] - p0[1], p2[1] - p0[1]];
        const det = a * d - b * c;
        return [nombre, transformar(f, t), (q) => [(d * (q[0] - p0[0]) - b * (q[1] - p0[1])) / det, (-c * (q[0] - p0[0]) + a * (q[1] - p0[1])) / det]];
      }),
      ["listas al revés", { ...f, pilares: [...f.pilares!].reverse(), secciones: [...f.secciones].reverse() }, (q) => q],
    ];
    for (const [nombre, g, inv] of variantes) {
      const s = compilado(g);
      expect(s.modelo.nudos.length, nombre).toBe(r.modelo.nudos.length);
      expect(s.modelo.laminas!.length, nombre).toBe(r.modelo.laminas!.length);
      expect(s.modelo.nudos.filter((n) => {
        const [x, y] = inv([n.x, n.y]);
        return !nudos.has(clave(x, y, n.z));
      }).length, nombre).toBe(0);
    }
  });
});

describe("el edificio objetivo de una planta con losa plana", () => {
  it("sin avisos de malla con h = 0,75 y 0,5 (con 0,5, tres plantillas de F3 sin calidad van como en F2)", () => {
    const f = edificioObjetivoLosas(1);
    const g = { ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") };
    for (const h of [0.75, 0.5]) {
      const s = compilado(g, { tamanoMalla: h });
      expect(avisosMalla(s), `h = ${h}`).toEqual([]);
    }
  });

  it("F3-d: junto al hueco, el metro cuenta lo que pasa por los nudos de la huella delante de la cara; lo demás, bit a bit", () => {
    const f = edificioObjetivoLosas(1);
    const g = { ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") };
    const s = compilado(g);
    const casos = casosValidos(calcular(s.modelo));
    const ctx = validar(g, resolverOpciones({}), new Diagnosticos())!;
    const cortes = new Cortes(s.modelo);
    const [con, sin] = [true, false].map((huellaDelante) => new EsfuerzosFranjas(ctx, s, casos, { cortes, huellaDelante }));
    const suma = (e: EstacionFranja) => casos.reduce((a, _, k) => a + e.medios[3 * k]!, 0);
    // Referencia: h = 0,15 con F3-d, suma de los casos (validacion/f3/out_f3d.txt)
    const ref: [string, -1 | 1, number][] = [
      ["P30-15", -1, -47.5],
      ["P30-15", 1, -35.78],
      ["P24-20", -1, -42.7],
      ["P24-20", 1, -51.94],
    ];
    let cambian = 0;
    const caras = new Set<string>();
    for (const fr of con!.franjas("L-N1")) {
      const [a, b] = [con!.estaciones(fr.id)!.estaciones, sin!.estaciones(fr.id)!.estaciones];
      expect(a.length).toBe(b.length);
      a.forEach((e, j) => {
        expect(e.diagnosticos.map((d) => d.codigo)).not.toContain("franja/cara-sin-huella");
        if (e.medios.every((v, q) => Object.is(v, b[j]!.medios[q])) && e.anchoEnLosa === b[j]!.anchoEnLosa) return;
        cambian++;
        const x = fr.direccion === 2 && e.ventana ? ref.find(([id, lado]) => e.piezas.includes(id) && e.lado === lado && Math.abs((e.ventana![0] + e.ventana![1]) / 2 - g.pilares!.find((p) => p.id === id)!.x) < 1e-9) : undefined;
        expect(x, `${fr.id} s = ${e.s} (${e.piezas.join(", ")})`).toBeDefined();
        const [, , v] = x!;
        caras.add(`${x![0]} ${x![1]}`);
        expect(Math.abs(suma(e) / v - 1), `${x![0]} ${x![1]}`).toBeLessThan(0.07);
        expect(suma(b[j]!) / v - 1, `${x![0]} ${x![1]}, sin F3-d`).toBeLessThan(-0.2);
      });
    }
    // Las cuatro caras, cada una en las dos franjas que tocan el pilar (F-h)
    expect(caras.size).toBe(4);
    expect(cambian).toBe(8);
  });
});
