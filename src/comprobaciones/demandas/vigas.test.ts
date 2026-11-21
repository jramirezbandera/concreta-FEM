/**
 * Fase CO2 (`docs/fem3d/comprobaciones.md` §4.2 y §7): las demandas de las vigas.
 *
 * - Las zonas son los cuartos del vano junto a los apoyos y el centro, y sus extremos, los del
 *   diagrama de cada combinación leído por otro camino (`Consultas.diagrama` y `diagramaBarra`).
 * - Juntas, las tres zonas dan los extremos del vano entero (`Consultas.vano`).
 * - Con el sismo del programa, los extremos llevan los signos pésimos (VS-o) y nunca bajan.
 * - La flecha elástica de una biapoyada es la de su fórmula (con la deformación por cortante), y la de
 *   un voladizo se mide respecto a su apoyo, con el doble de su vuelo como luz.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { porticoVigas, vigaBiapoyada, type VariantePortico } from "../../../validacion/co/modelosVigas.ts";
import { conjuntoCombinaciones } from "../../agente/combinaciones.ts";
import { compilar } from "../../compilador/compilar.ts";
import { Consultas } from "../../compilador/consultas.ts";
import type { ModeloFisico } from "../../compilador/fisico.ts";
import { calcular } from "../../motor/calcular.ts";
import { iniciarNucleo } from "../../nucleo/index.ts";
import { hormigon } from "../../secciones/seccion3D.ts";
import { SITUACIONES_ELU } from "./pilares.ts";
import { demandasViga, FRACCIONES_ZONAS, MUESTRAS_FLECHA, ZONAS, type DemandasViga } from "./vigas.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function consultas(f: ModeloFisico): Consultas {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return new Consultas(f, c, r.casos, {}, r.modal);
}

function demandas(q: Consultas, id: string): DemandasViga {
  const d = demandasViga(q, id);
  if (!d.valido) throw new Error(d.diagnosticos.map((x) => x.mensaje).join("\n"));
  return d.valor;
}

const portico = (v: VariantePortico = {}) => consultas(porticoVigas(v));

describe("CO2: las demandas de una viga, por zonas", () => {
  it("los vanos, entre las caras de los apoyos, y sus zonas, en los cuartos de la luz", () => {
    const d = demandas(portico(), "F1-X0");
    expect(d.axilSinValor).toBe(true);
    expect(d.situaciones).toEqual([...SITUACIONES_ELU]);
    // Pilares de 40 en x = 0, 6 y 11, y el voladizo hasta 12,5
    expect(d.vanos.map((v) => [v.desde, v.hasta].map((x) => Math.round(1000 * x) / 1000))).toEqual([[0.2, 5.8], [6.2, 10.8], [11.2, 12.5]]);
    expect(d.vanos.map((v) => v.apoyos)).toEqual([["P1", "P3"], ["P3", "P5"], ["P5", null]]);
    for (const v of d.vanos) {
      expect(v.zonas.map((z) => z.zona)).toEqual([...ZONAS]);
      const L = v.hasta - v.desde;
      const limites = [v.desde, ...FRACCIONES_ZONAS.map((x) => v.desde + x * L), v.hasta];
      v.zonas.forEach((z, k) => {
        expect(z.desde).toBeCloseTo(limites[k]!, 12);
        expect(z.hasta).toBeCloseTo(limites[k + 1]!, 12);
      });
      expect(v.torsionEquilibrio).toBe(false);
    }
  });

  it("los extremos de cada zona son los del diagrama de cada combinación, leído por otro camino", () => {
    const q = portico();
    const id = "F1-X0";
    const d = demandas(q, id);
    const elu = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: [...SITUACIONES_ELU] });
    if (!elu.valido) throw new Error("sin ELU");
    const tramos = q.esfuerzosPiezas.tramos(id);
    /** Los seis esfuerzos de la viga en s, por la izquierda y por la derecha, con `diagramaBarra`. */
    const en = (f: ArrayLike<number>, s: number) => {
      const r: number[][] = [];
      for (const t of tramos) if (s >= t.s0 - 1e-9 && s <= t.s1 + 1e-9) for (const lado of [-1, 1] as const) r.push(Array.from(q.diagramaBarra(t.barra, f).esfuerzosEn(Math.min(t.s1 - t.s0, Math.max(0, s - t.s0)), lado)));
      return r;
    };
    for (const v of d.vanos)
      for (const z of v.zonas) {
        const maximos = { pos: -Infinity, neg: Infinity, V: 0, T: 0 };
        elu.valor.factores.forEach((f, kc) => {
          // Las estaciones del diagrama dentro de la zona, y sus dos extremos
          const dg = q.diagrama(id, f);
          if (!dg.valido) throw new Error("sin diagrama");
          const dentro = dg.valor.filter((e) => e.s > z.desde + 1e-9 && e.s < z.hasta - 1e-9).flatMap((e) => [Array.from(e.izquierda), Array.from(e.derecha)]);
          const todos = [...dentro, ...en(f, z.desde), ...en(f, z.hasta)];
          for (const e of todos) {
            maximos.pos = Math.max(maximos.pos, e[4]!);
            maximos.neg = Math.min(maximos.neg, e[4]!);
            maximos.V = Math.max(maximos.V, Math.abs(e[2]!));
            maximos.T = Math.max(maximos.T, Math.abs(e[3]!));
          }
          // El extremo que es de esta combinación lleva los esfuerzos del diagrama en su estación
          for (const x of [z.positivo, z.negativo, z.cortante, z.torsion]) {
            if (x.comb !== elu.valor.nombres[kc]) continue;
            const candidatos = en(f, x.s);
            expect(candidatos.some((e) => e.every((y, c) => Math.abs(y - x.esfuerzos[c]!) <= 1e-9 * Math.max(1, Math.abs(y))))).toBe(true);
          }
        });
        // (los extremos de la zona pueden caer un poco fuera por el lado del salto: los de la zona no pasan de éstos)
        const tol = (x: number) => 1e-9 * Math.max(1, Math.abs(x));
        expect(z.positivo.valor).toBeLessThanOrEqual(maximos.pos + tol(maximos.pos));
        expect(z.negativo.valor).toBeGreaterThanOrEqual(maximos.neg - tol(maximos.neg));
        expect(z.cortante.valor).toBeLessThanOrEqual(maximos.V + tol(maximos.V));
        expect(z.torsion.valor).toBeLessThanOrEqual(maximos.T + tol(maximos.T));
        // Y los de las estaciones interiores de la zona no pasan de los suyos
        elu.valor.factores.forEach((f) => {
          const dg = q.diagrama(id, f);
          if (!dg.valido) throw new Error("sin diagrama");
          for (const e of dg.valor.filter((y) => y.s > z.desde + 1e-9 && y.s < z.hasta - 1e-9))
            for (const lado of [e.izquierda, e.derecha]) {
              expect(lado[4]!).toBeLessThanOrEqual(z.positivo.valor + tol(z.positivo.valor));
              expect(lado[4]!).toBeGreaterThanOrEqual(z.negativo.valor - tol(z.negativo.valor));
              expect(Math.abs(lado[2]!)).toBeLessThanOrEqual(z.cortante.valor + tol(z.cortante.valor));
            }
        });
      }
  });

  it("las tres zonas juntas dan los extremos del vano entero, y `vano` es `vanoZonas` sin partir", () => {
    const q = portico();
    const elu = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: [...SITUACIONES_ELU] });
    if (!elu.valido) throw new Error("sin ELU");
    for (const id of ["F1-X0", "F2-Y1"]) {
      const d = demandas(q, id);
      for (const v of d.vanos) {
        let [pos, neg, V] = [-Infinity, Infinity, 0];
        for (const f of elu.valor.factores) {
          const e = q.vano(id, v.indice, f);
          const z = q.vanoZonas(id, v.indice, f);
          if (!e.valido || !z.valido) throw new Error("sin vano");
          expect(z.valor.length).toBe(1);
          expect(z.valor[0]).toEqual(e.valor);
          pos = Math.max(pos, e.valor.maxMy.valor);
          neg = Math.min(neg, e.valor.minMy.valor);
          V = Math.max(V, Math.abs(e.valor.maxVz.valor), Math.abs(e.valor.minVz.valor));
        }
        expect(Math.max(...v.zonas.map((z) => z.positivo.valor))).toBe(pos);
        expect(Math.min(...v.zonas.map((z) => z.negativo.valor))).toBe(neg);
        expect(Math.max(...v.zonas.map((z) => z.cortante.valor))).toBe(V);
      }
    }
    // Fracciones que no valen
    const f0 = elu.valor.factores[0]!;
    expect(q.vanoZonas("F1-X0", 0, f0, [0.75, 0.25]).valido).toBe(false);
    expect(q.vanoZonas("F1-X0", 0, f0, [0, 0.5]).valido).toBe(false);
    expect(q.vanoZonas("F1-X0", 9, f0).valido).toBe(false);
  });

  it("una viga que no existe, o que es un pilar, no tiene demandas", () => {
    const q = portico();
    expect(demandasViga(q, "V99").valido).toBe(false);
    expect(demandasViga(q, "P1").valido).toBe(false);
  });

  it("con el sismo del programa, los extremos llevan los signos pésimos y ninguno baja (criterio 9)", () => {
    const sin = portico();
    const con = portico({ sismo: true });
    let pesimos = 0;
    for (const id of ["F1-X0", "F1-Y1", "F2-X1"]) {
      const [a, b] = [demandas(sin, id), demandas(con, id)];
      expect(b.combinaciones).toBeGreaterThan(a.combinaciones);
      a.vanos.forEach((va, i) =>
        va.zonas.forEach((za, k) => {
          const zb = b.vanos[i]!.zonas[k]!;
          const tol = 1e-7;
          expect(zb.positivo.valor).toBeGreaterThanOrEqual(za.positivo.valor - tol);
          expect(zb.negativo.valor).toBeLessThanOrEqual(za.negativo.valor + tol);
          expect(zb.cortante.valor).toBeGreaterThanOrEqual(za.cortante.valor - tol);
          for (const x of [zb.positivo, zb.negativo, zb.cortante, zb.torsion]) {
            expect(x.pesimos === true).toBe(x.comb.startsWith("ELU-SIS"));
            if (x.pesimos) pesimos++;
          }
          // La cuasipermanente no lleva sismo
          expect(zb.cpPositivo!.pesimos).toBeUndefined();
          expect(zb.cpPositivo!.valor).toBeCloseTo(za.cpPositivo!.valor, 6);
        }),
      );
    }
    expect(pesimos).toBeGreaterThan(0);
  });
});

describe("CO2: la flecha elástica de un vano (CO-k)", () => {
  const [b, h, L] = [0.3, 0.5, 6];
  const m = hormigon(25);
  const EI = (m.E * b * h ** 3) / 12;
  const GAv = m.G * (5 / 6) * b * h;
  /** La flecha de una biapoyada con carga uniforme w en x, con la deformación por cortante. */
  const analitica = (w: number, x: number) => (w * x * (L ** 3 - 2 * L * x * x + x ** 3)) / (24 * EI) + (w * x * (L - x)) / (2 * GAv);
  const pp = 25 * b * h;

  it("la de una biapoyada es la de su fórmula, en cada muestra y en cada combinación", () => {
    const q = consultas(vigaBiapoyada());
    const d = demandas(q, "V1");
    expect(d.vanos.length).toBe(1);
    const v = d.vanos[0]!;
    expect([v.desde, v.hasta, v.apoyos]).toEqual([0, 6, ["A1", "A2"]]);
    const f = v.flecha!;
    expect(f.luz).toBe(6);
    expect(f.voladizo).toBeNull();
    expect(f.s.length).toBe(MUESTRAS_FLECHA + 1);
    // ELS cuasipermanente: G + CM + ψ₂·Q (uso A: 0,3); característica: G + CM + Q; y el peso propio solo
    const casos: [number[], number, number][] = [
      [f.cuasipermanente.at(-1)!.relativa, pp + 15 + 0.3 * 10, f.cuasipermanente.at(-1)!.momento],
      [f.caracteristica.at(-1)!.relativa, pp + 15 + 10, f.caracteristica.at(-1)!.momento],
      [f.pesoPropio!.relativa, pp, f.pesoPropio!.momento],
    ];
    for (const [rel, w, M] of casos) {
      f.s.forEach((x, j) => expect(Math.abs(rel[j]! - analitica(w, x))).toBeLessThanOrEqual(1e-9 * analitica(w, L / 2)));
      expect(M).toBeCloseTo((w * L * L) / 8, 8);
    }
    expect(f.pesoPropio!.comb).toBe("G");
    // Los momentos de la zona central: w·L²/8 en ELU (1,35·(G + CM) + 1,5·Q) y en la cuasipermanente
    const centro = v.zonas[1]!;
    expect(centro.positivo.valor).toBeCloseTo(((1.35 * (pp + 15) + 1.5 * 10) * L * L) / 8, 8);
    expect(centro.cpPositivo!.valor).toBeCloseTo(((pp + 15 + 3) * L * L) / 8, 8);
    expect(v.zonas[0]!.cortante.valor).toBeCloseTo(((1.35 * (pp + 15) + 1.5 * 10) * L) / 2, 8);
  });

  it("la de un voladizo va respecto a su apoyo, con el doble del vuelo como luz", () => {
    const q = consultas(vigaBiapoyada({ vuelo: 2 }));
    const d = demandas(q, "V1");
    expect(d.vanos.map((v) => v.apoyos)).toEqual([["A1", "A2"], ["A2", null]]);
    const f = d.vanos[1]!.flecha!;
    expect(f.voladizo).toBe("fin");
    expect(f.luz).toBe(4);
    for (const c of [...f.cuasipermanente, ...f.caracteristica]) expect(c.relativa[0]).toBe(0);
    // Con el peso propio solo: el giro en el apoyo, del vano y del momento del voladizo, más la ménsula
    const w = pp;
    const a = 2;
    // (el momento del voladizo da en el vano un cortante constante M/L, que gira la sección M/(L·G·Av) más)
    const M = (w * a * a) / 2;
    const giro = (w * L ** 3) / (24 * EI) - ((M * L) / (3 * EI) + M / (L * GAv)); // hacia abajo en el vano: levanta la punta
    const punta = (w * a ** 4) / (8 * EI) + (w * a * a) / (2 * GAv) - giro * a;
    expect(f.pesoPropio!.relativa.at(-1)!).toBeCloseTo(punta, 9);
    expect(f.pesoPropio!.momento).toBeCloseTo((w * a * a) / 2, 8);
  });

  it("si el caso del peso propio lleva cargas del usuario, no se descuenta; sin apoyos, no hay flecha", () => {
    const f = vigaBiapoyada();
    const conCargas: ModeloFisico = { ...f, cargas: f.cargas!.map((c) => (c.id === "CM-1" ? { ...c, caso: "G" } : c)) };
    expect(demandas(consultas(conCargas), "V1").vanos[0]!.flecha!.pesoPropio).toBeNull();
  });
});
