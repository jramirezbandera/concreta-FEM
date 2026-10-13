/**
 * Fase F2 (`docs/fem3d/refinamiento.md`): refinamiento de la malla junto a las caras de los pilares.
 * - R0: la cara común que va por un lado de la huella de un pilar ajeno sigue por él, y la que pasa
 *   por dentro se corta en la huella; en el edificio objetivo, los pilares de borde recuperan su
 *   plantilla.
 * - La plantilla refinada: la malla sin refinar está entera dentro de la refinada (sólo se añaden
 *   nudos, y sólo dentro de los bloques), conforme y convexa.
 * - Con un h pequeño no se refina (un nudo nuevo quedaría a menos de 2·ε_snap de la cara).
 * - Respaldo por pilar (calidad) y por planta (validador), con el aviso `malla/cara-sin-refinar`.
 * - Trasladar, girar 90° y 37° y reordenar dan la misma malla.
 * - El metro centrado en un pilar interior, a ≤ 2 % de la malla fina (criterio 1; la medida
 *   completa, en `validacion/f2/convergencia.ts`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { losa3x3 } from "../../validacion/f2/convergencia.ts";
import { calcular } from "../motor/calcular.ts";
import { Cortes } from "../motor/cortes.ts";
import { Diagnosticos } from "../motor/diagnosticos.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { planos, transformar } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import { EsfuerzosFranjas } from "./esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion, type Vec2 } from "./fisico.ts";
import { carasFranjas } from "./franjas.ts";
import { conRespaldoRefino, type ResultadoMalla } from "./mallado.ts";
import { UMBRAL_REFINO } from "./rejilla.ts";
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
const clave = (x: number, y: number, z: number) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
const avisosMalla = (r: Compilado) => r.diagnosticos.filter((d) => d.codigo.startsWith("malla/"));
const sinVigas = (f: ModeloFisico): ModeloFisico => ({ ...f, vigas: [], cargas: f.cargas!.filter((c) => c.tipo !== "viga") });

describe("R0: las caras comunes junto a los pilares ajenos", () => {
  // Una alineación en x = 6 con un pilar interior de 30 × 30 (con caras) entre dos de borde, sin
  // caras: uno de 30 de ancho (su lado va por la cara común) y otro de 40 (la cara pasa por dentro)
  const f: ModeloFisico = {
    plantas: [{ id: "P1", altura: null }, { id: "C", tipo: "sotano", altura: 3 }],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
    ],
    pilares: [
      { id: "PA", x: 6, y: 0, desde: "C", hasta: "P1", seccion: "p30" },
      { id: "PB", x: 6, y: 5, desde: "C", hasta: "P1", seccion: "p30" },
      { id: "PC", x: 6, y: 10, desde: "C", hasta: "P1", seccion: "p40" },
      { id: "PD", x: 0, y: 5, desde: "C", hasta: "P1", seccion: "p30" },
      { id: "PE", x: 12, y: 5, desde: "C", hasta: "P1", seccion: "p30" },
    ],
    losas: [{ id: "L", planta: "P1", contorno: [[0, 0], [12, 0], [12, 10], [0, 10]], espesor: 0.25, material: "HA" }],
    casos: [{ id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -10] }],
  };

  it("por el lado de un pilar ajeno sigue hasta el borde; por dentro de otro, se corta en su huella", () => {
    const d = new Diagnosticos();
    const ctx = validar(f, resolverOpciones({}), d);
    if (!ctx) throw new Error(d.lista.map((x) => x.mensaje).join(" | "));
    const caras = carasFranjas(ctx, ctx.losas[0]!).filter((c) => c.direccion === 1);
    expect(caras.map((c) => c.s)).toEqual([5.85, 6.15]);
    // Antes, a h = 0,75 de A y de C: [0,95, 9,05]
    for (const c of caras) expect(c.tramos).toEqual([[0, 9.8]]);
  });

  it("en el edificio objetivo, los pilares de borde recuperan su plantilla", () => {
    const r = compilado(sinVigas(edificioObjetivoLosas(1)), { refinoCaras: false });
    // F1.1: 10 161 nudos y 48 plantillas (las de borde, en la triangulación)
    expect(r.estadisticas.malla.plantillas).toBe(76);
    expect(r.modelo.nudos.length).toBeLessThan(7100);
    expect(avisosMalla(r)).toEqual([]);
  });
});

describe("la plantilla refinada", () => {
  const f = losa3x3();
  const sin = compilado(f, { refinoCaras: false });
  const con = compilado(f);

  it("refina las 16 plantillas sin ningún aviso, y no con refinoCaras: false", () => {
    expect(con.estadisticas.malla.plantillasRefinadas).toBe(16);
    expect(con.estadisticas.malla.plantillas).toBe(16);
    expect(sin.estadisticas.malla.plantillasRefinadas).toBe(0);
    expect(avisosMalla(con)).toEqual([]);
  });

  it("la malla sin refinar está entera dentro de la refinada, y lo nuevo sólo junto a los pilares", () => {
    const enCon = new Set(con.modelo.nudos.map((n) => clave(n.x, n.y, n.z)));
    expect(sin.modelo.nudos.filter((n) => !enCon.has(clave(n.x, n.y, n.z)))).toEqual([]);
    const enSin = new Set(sin.modelo.nudos.map((n) => clave(n.x, n.y, n.z)));
    const nuevos = con.modelo.nudos.filter((n) => !enSin.has(clave(n.x, n.y, n.z)));
    expect(nuevos.length).toBeGreaterThan(0);
    // Cada nudo nuevo, dentro del bloque de un pilar (a menos de una celda y media de su eje)
    for (const n of nuevos) expect(f.pilares!.some((p) => Math.max(Math.abs(n.x - p.x), Math.abs(n.y - p.y)) < 1.6)).toBe(true);
  });

  it("es conforme: cada arista de una lámina, salvo en el contorno de la losa, la comparten dos", () => {
    const uso = new Map<string, number>();
    for (const l of con.modelo.laminas!)
      for (let m = 0; m < 4; m++) {
        const [a, b] = [l.nudos[m]!, l.nudos[(m + 1) % 4]!];
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        uso.set(k, (uso.get(k) ?? 0) + 1);
      }
    const N = con.modelo.nudos;
    const borde = (x: number, y: number) => Math.abs(x + 0.5) < 1e-9 || Math.abs(x - 18.5) < 1e-9 || Math.abs(y + 0.5) < 1e-9 || Math.abs(y - 15.5) < 1e-9;
    const sueltas = [...uso].filter(([k, n]) => {
      const [a, b] = k.split(",").map(Number) as [number, number];
      return n !== 2 && !borde((N[a]!.x + N[b]!.x) / 2, (N[a]!.y + N[b]!.y) / 2);
    });
    expect(sueltas).toEqual([]);
  });

  it("es convexa y el jacobiano no baja de 0,3; el cálculo es válido", () => {
    expect(con.estadisticas.malla.jacobianoMin).toBeGreaterThanOrEqual(0.3);
    expect(calcular(con.modelo).valido).toBe(true);
  });

  it("con h = 0,125 no se refina (el primer tercio quedaría a menos de 2·ε_snap de la cara)", () => {
    expect(compilado(f, { tamanoMalla: 0.125 }).estadisticas.malla.plantillasRefinadas).toBe(0);
  });
});

describe("respaldo", () => {
  afterEach(() => {
    UMBRAL_REFINO.jacobiano = 0.2;
  });

  it("por pilar: una plantilla refinada sin calidad se queda sin refinar, con el aviso", () => {
    UMBRAL_REFINO.jacobiano = 1.01;
    const r = compilado(losa3x3());
    expect(r.estadisticas.malla.plantillasRefinadas).toBe(0);
    expect(r.modelo.nudos.length).toBe(compilado(losa3x3(), { refinoCaras: false }).modelo.nudos.length);
    const av = avisosMalla(r);
    expect(av.map((d) => d.codigo)).toEqual(["malla/cara-sin-refinar"]);
    expect(av[0]!.mensaje).toContain("P6-5");
  });

  it("por planta: si la malla refinada falla, la de sin refinar con el aviso", () => {
    const sinRef: ResultadoMalla = { ok: true, nudos: [], quads: [], piezas: [], lados: [], nudosLado: [], regiones: [], calidad: { jacobianoMin: 1, bajos: 0 }, rejilla: { celdas: 0, plantillas: 0, refinadas: 0, quads: 0, cobertura: 1 }, problemas: [] };
    const conError: ResultadoMalla = { ...sinRef, problemas: [{ losa: 0, severidad: "error", codigo: "malla/lado-perdido", mensaje: "x" }] };
    for (const intento of [() => conError, (): ResultadoMalla => { throw new Error("roto"); }]) {
      const r = conRespaldoRefino(intento, () => ({ ...sinRef, problemas: [] }), ["P2", "P1"]);
      expect(r.ok && r.problemas.map((p) => [p.codigo, p.severidad])).toEqual([["malla/cara-sin-refinar", "aviso"]]);
      expect(r.ok && r.problemas[0]!.mensaje).toContain("P1, P2");
    }
    // Sin fallo, la refinada tal cual
    expect(conRespaldoRefino(() => sinRef, () => conError, [])).toBe(sinRef);
  });
});

describe("determinismo", () => {
  it("trasladar, girar 90° o 37° la planta, o reordenar sus listas, da la misma malla refinada", () => {
    const f = losa3x3();
    const r = compilado(f);
    const nudos = new Set(r.modelo.nudos.map((n) => clave(n.x, n.y, n.z)));
    const variantes: [string, ModeloFisico, (q: Vec2) => Vec2][] = [
      ...planos().map(({ nombre, t }): [string, ModeloFisico, (q: Vec2) => Vec2] => {
        const [p0, p1, p2] = [t.p([0, 0]), t.p([1, 0]), t.p([0, 1])];
        const [a, b, c, d] = [p1[0] - p0[0], p2[0] - p0[0], p1[1] - p0[1], p2[1] - p0[1]];
        const det = a * d - b * c;
        return [nombre, transformar(f, t), (q) => [(d * (q[0] - p0[0]) - b * (q[1] - p0[1])) / det, (-c * (q[0] - p0[0]) + a * (q[1] - p0[1])) / det]];
      }),
      ["listas al revés", { ...f, pilares: [...f.pilares!].reverse() }, (q) => q],
    ];
    for (const [nombre, g, inv] of variantes) {
      const s = compilado(g);
      expect(s.estadisticas.malla.plantillasRefinadas, nombre).toBe(16);
      expect(s.modelo.nudos.length, nombre).toBe(r.modelo.nudos.length);
      expect(s.modelo.laminas!.length, nombre).toBe(r.modelo.laminas!.length);
      expect(s.modelo.nudos.filter((n) => {
        const [x, y] = inv([n.x, n.y]);
        return !nudos.has(clave(x, y, n.z));
      }).length, nombre).toBe(0);
    }
  });
});

describe("criterio 1, en un pilar interior", () => {
  it("el metro centrado en P6-5, en sus caras x = 6,15 e y = 5,15, a ≤ 2 % de la malla fina", () => {
    // Referencia: h = 0,125 sin refinar (validacion/f2/out_convergencia.txt); con h = 0,75 sin refinar, −5,7 y −4,2 %
    const ref = { x: -68.6175, y: -62.6346 };
    const f = losa3x3();
    const r = compilado(f);
    const casos = casosValidos(calcular(r.modelo));
    const ef = new EsfuerzosFranjas(validar(f, resolverOpciones({}), new Diagnosticos())!, r, casos, { cortes: new Cortes(r.modelo) });
    const cara = (dir: 1 | 2, s: number) =>
      ef
        .franjas("L")
        .filter((x) => x.direccion === dir)
        .flatMap((x) => ef.estaciones(x.id)!.estaciones)
        .find((e) => e.tipo === "cara" && Math.abs(e.s - s) < 1e-9 && e.lado === 1 && e.ventana && e.piezas.includes("P6-5"))!.medios[0]!;
    expect(Math.abs(cara(1, 6.15) / ref.x - 1)).toBeLessThan(0.02);
    expect(Math.abs(cara(2, 5.15) / ref.y - 1)).toBeLessThan(0.02);
  });
});
