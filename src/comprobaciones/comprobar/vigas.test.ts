/**
 * Fase CO2 (`docs/fem3d/comprobaciones.md` §7, criterios 7 a 9): comprobar una viga con un armado dado.
 *
 * - Identidad: cada fila es la del módulo de vigas llamado con una entrada escrita a mano, y la del
 *   cortante, además, la de las fórmulas del Código Estructural escritas aquí.
 * - Una cara que no tracciona no lleva las filas de la flexión.
 * - La flecha es la elástica del modelo por el factor de sección fisurada del módulo.
 * - Girar el pórtico 90° no cambia nada; con el sismo, ninguna fila baja.
 * - Lo que no se comprueba va a `pendientes` y el vano no cumple.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { porticoVigas, vigaBiapoyada, type VariantePortico } from "../../../validacion/co/modelosVigas.ts";
import { compilar } from "../../compilador/compilar.ts";
import { Consultas } from "../../compilador/consultas.ts";
import type { ModeloFisico } from "../../compilador/fisico.ts";
import { calcular } from "../../motor/calcular.ts";
import { iniciarNucleo } from "../../nucleo/index.ts";
import { armadoViga, type ArmadoVanoViga } from "../armado.ts";
import { calcRCBeam } from "../concreta/lib/calculations/rcBeams.ts";
import { beamMNCapacity } from "../concreta/lib/calculations/rcBeamMN.ts";
import { crackedDeflectionFactor } from "../concreta/lib/calculations/crackedDeflection.ts";
import { demandasViga, type DemandasVano, type DemandasViga, type DemandasZona, type ExtremoViga } from "../demandas/vigas.ts";
import { comprobarVano, comprobarViga, flechaVano, type ComprobacionVano } from "./vigas.ts";

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

/** 30 × 50: 3Ø16 abajo, 2Ø12 de montaje, 3Ø16 y 4Ø16 en los apoyos, cercos Ø8 a 200 y a 150 en el del fin. */
const ARMADO: ArmadoVanoViga = { inferior: { n: 3, diametro: 16 }, superior: { n: 2, diametro: 12 }, superiorInicio: { n: 3, diametro: 16 }, superiorFin: { n: 4, diametro: 16 }, cercos: { diametro: 8, separacion: 200 }, cercosFin: { diametro: 8, separacion: 150 } };

const u = (c: ComprobacionVano, id: string) => c.filas.find((f) => f.id === id)?.aprovechamiento;

describe("CO2: comprobar un vano de viga", () => {
  it("cada fila es la del módulo con la entrada escrita a mano (criterio 7)", () => {
    const d = demandas(portico(), "F1-X0");
    const v = d.vanos[0]!;
    const c = comprobarVano(d, v, armadoViga(ARMADO));
    expect(c.cumple).toBe(true);
    expect(c.pendientes).toEqual([]);
    expect(c.llamadas).toBe(3);
    const superior = { inicio: [3, 16], centro: [2, 12], fin: [4, 16] } as const;
    const separacion = { inicio: 200, centro: 200, fin: 150 } as const;
    for (const z of v.zonas) {
      const [ns, ds] = superior[z.zona];
      // La entrada del módulo, campo a campo: «vano» es la tracción abajo y «apoyo», la tracción arriba
      const r = calcRCBeam({
        mode: "portico",
        title: "",
        b: 300,
        h: 500,
        cover: 30,
        fck: 25,
        fyk: 500,
        exposureClass: "XC2",
        loadType: "custom",
        psi2Custom: 0,
        L: 0,
        structSystem: "ss",
        vano_Md: Math.max(0, z.positivo.valor),
        vano_VEd: z.cortante.valor,
        vano_M_G: Math.max(0, z.cpPositivo!.valor),
        vano_M_Q: 0,
        vano_bot_nBars: 3,
        vano_bot_barDiam: 16,
        vano_top_nBars: ns,
        vano_top_barDiam: ds,
        vano_stirrupDiam: 8,
        vano_stirrupSpacing: separacion[z.zona],
        vano_stirrupLegs: 2,
        apoyo_Md: Math.max(0, -z.negativo.valor),
        apoyo_VEd: z.cortante.valor,
        apoyo_M_G: Math.max(0, -z.cpNegativo!.valor),
        apoyo_M_Q: 0,
        apoyo_top_nBars: ns,
        apoyo_top_barDiam: ds,
        apoyo_bot_nBars: 3,
        apoyo_bot_barDiam: 16,
        apoyo_stirrupDiam: 8,
        apoyo_stirrupSpacing: separacion[z.zona],
        apoyo_stirrupLegs: 2,
      });
      expect(r.valid).toBe(true);
      const del = (sec: typeof r.vano, id: string) => sec.checks.find((f) => f.id === id)!.utilization;
      for (const id of ["bending", "as-min", "bar-spacing", "cracking"]) {
        expect(u(c, `${z.zona}/inf-${id}`)).toBe(del(r.vano, id));
        expect(u(c, `${z.zona}/sup-${id}`)).toBe(del(r.apoyo, id));
      }
      expect(u(c, `${z.zona}/as-max`)).toBe(del(r.vano, "as-max"));
      // El cortante, de la sección cuya cara tracciona donde es mayor
      const sec = z.cortante.esfuerzos[4]! >= 0 ? r.vano : r.apoyo;
      for (const id of ["shear", "shear-max", "rho-w-min", "stirrup-spacing-max", "stirrup-legs-spacing"]) expect(u(c, `${z.zona}/${id}`)).toBe(del(sec, id));
      // Cada fila de agotamiento, con la combinación y la estación de su demanda
      const fila = (id: string) => c.filas.find((f) => f.id === `${z.zona}/${id}`)!;
      expect([fila("sup-bending").comb, fila("sup-bending").s]).toEqual([z.negativo.comb, z.negativo.s]);
      expect([fila("inf-bending").comb, fila("inf-bending").s]).toEqual([z.positivo.comb, z.positivo.s]);
      expect(fila("inf-cracking").comb).toBe(z.cpPositivo!.comb);
      expect(fila("shear").comb).toBe(z.cortante.comb);
      expect(fila("as-max").comb).toBeUndefined();
    }
    expect(c.aprovechamiento).toBe(Math.max(...c.filas.map((f) => f.aprovechamiento)));
  });

  it("el cortante es el de las fórmulas del CE (Anejo 19 §6.2.3), escritas aparte", () => {
    const d = demandas(portico(), "F1-X0");
    const v = d.vanos[0]!;
    const c = comprobarVano(d, v, armadoViga(ARMADO));
    const fyd = 500 / 1.15;
    const fcd = 16.7; // el de la tabla del módulo con fck = 25
    for (const z of v.zonas) {
      const s = z.zona === "fin" ? 150 : 200;
      // La cara que tracciona donde el cortante es mayor fija el canto útil
      const diametro = z.cortante.esfuerzos[4]! >= 0 ? 16 : z.zona === "centro" ? 12 : 16;
      const dUtil = 500 - 30 - 8 - diametro / 2;
      const zeta = 0.9 * dUtil;
      const VRds = (((2 * 50.3) / s) * zeta * fyd * 2) / 1000;
      const VRdmax = (0.6 * (1 - 25 / 250) * fcd * 300 * zeta) / (2 + 1 / 2) / 1000;
      expect(u(c, `${z.zona}/shear`)!).toBeCloseTo(z.cortante.valor / Math.min(VRds, VRdmax), 9);
      expect(u(c, `${z.zona}/shear-max`)!).toBeCloseTo(z.cortante.valor / VRdmax, 9);
      expect(u(c, `${z.zona}/stirrup-spacing-max`)!).toBeCloseTo(s / Math.min(0.75 * dUtil, 300), 9);
    }
  });

  it("una cara que no tracciona no lleva las filas de la flexión; el voladizo sólo arma arriba", () => {
    const d = demandas(portico(), "F1-X0");
    const voladizo = d.vanos[2]!;
    expect(voladizo.apoyos).toEqual(["P5", null]);
    const c = comprobarVano(d, voladizo, armadoViga(ARMADO));
    expect(c.filas.filter((f) => /\/inf-/.test(f.id))).toEqual([]);
    expect(c.filas.filter((f) => /\/sup-bending$/.test(f.id)).length).toBe(3);
    expect(c.filas.some((f) => f.id === "inicio/shear")).toBe(true);
    // Y la flecha del voladizo se arma con la cara superior de su apoyo
    expect(c.filas.find((f) => f.id === "flecha-total")!.grupo).toBe("superiorInicio");
    expect(c.filas.find((f) => f.id === "flecha-total")!.fila.limit).toContain("2L/300");
  });

  it("con poco acero fallan las filas que tocan, y cada una dice qué armadura le falta", () => {
    const d = demandas(portico({ cm: 40, q: 25 }), "F1-X0");
    const c = comprobarVano(d, d.vanos[0]!, armadoViga({ inferior: { n: 2, diametro: 12 }, superior: { n: 2, diametro: 12 }, cercos: { diametro: 6, separacion: 300 } }));
    expect(c.cumple).toBe(false);
    const fallan = Object.fromEntries(c.filas.filter((f) => f.estado === "fail").map((f) => [f.id, f.grupo]));
    expect(fallan).toMatchObject({ "centro/inf-bending": "inferior", "inicio/sup-bending": "superiorInicio", "fin/sup-bending": "superiorFin", "inicio/shear": "cercosInicio", "fin/shear": "cercosFin" });
    expect(c.aprovechamiento).toBeGreaterThan(1);
    // Sin cercos, la cuantía mínima transversal falla sin cociente
    const sin = comprobarVano(d, d.vanos[0]!, armadoViga({ ...ARMADO, cercos: { diametro: 8, separacion: 0 } }));
    expect(sin.filas.find((f) => f.id === "centro/rho-w-min")).toMatchObject({ estado: "fail", aprovechamiento: Infinity });
  });

  it("la flecha: la elástica del modelo por el factor de sección fisurada del módulo (CO-k)", () => {
    const q = consultas(vigaBiapoyada());
    const d = demandas(q, "V1");
    const v = d.vanos[0]!;
    const a = armadoViga(ARMADO);
    const c = comprobarVano(d, v, a);
    const f = v.flecha!;
    // La cara inferior: 3Ø16 (603,3 mm² tabulados), d = 500 − 30 − 8 − 8
    const base = { b: 300, h: 500, fck: 25, As: 3 * 201.1, d: 454 };
    const kDif = crackedDeflectionFactor({ ...base, Mcp: Math.max(...f.cuasipermanente.map((x) => x.momento)), phiEf: 2 }).k;
    const kInst = crackedDeflectionFactor({ ...base, Mcp: Math.max(...f.caracteristica.map((x) => x.momento)), phiEf: 0 }).k;
    const kPp = crackedDeflectionFactor({ ...base, Mcp: f.pesoPropio!.momento, phiEf: 0 }).k;
    // El peso propio solo no fisura la sección (16,9 kN·m frente a 32 de fisuración): su factor es 1
    expect(kPp).toBe(1);
    expect(kDif).toBeGreaterThan(3);
    const centro = MUESTRAS_CENTRO;
    const cp = f.cuasipermanente.at(-1)!.relativa[centro]!;
    const car = f.caracteristica.at(-1)!.relativa[centro]!;
    const pp = f.pesoPropio!.relativa[centro]!;
    const total = kDif * cp;
    const activa = kDif * cp + kInst * (car - cp) - kPp * pp;
    const fl = flechaVano({ b: 300, h: 500, fck: 25 }, a, v)!;
    expect(fl.total.valor).toBeCloseTo(total, 12);
    expect(fl.activa.valor).toBeCloseTo(activa, 12);
    expect(fl.total.s).toBe(3);
    expect(u(c, "flecha-total")!).toBeCloseTo(total / (6 / 300), 10);
    expect(u(c, "flecha-activa")!).toBeCloseTo(activa / (6 / 400), 10);
    // Con tabiques frágiles, L/500; sin fluencia, la total baja a la instantánea fisurada
    expect(u(comprobarVano(d, v, armadoViga(ARMADO, { flechaActiva: 500 })), "flecha-activa")!).toBeCloseTo(activa / (6 / 500), 10);
    const sinFluencia = flechaVano({ b: 300, h: 500, fck: 25 }, armadoViga(ARMADO, { phiEf: 0 }), v)!;
    expect(sinFluencia.kDiferida).toBe(crackedDeflectionFactor({ ...base, Mcp: Math.max(...f.cuasipermanente.map((x) => x.momento)), phiEf: 0 }).k);
    expect(sinFluencia.kDiferida).toBeLessThan(kDif);
    // Sin fisurar (una carga pequeña), la total es la elástica por 1 + φef, exacta
    const poco = demandas(consultas(vigaBiapoyada({ cm: 1, q: 1 })), "V1").vanos[0]!;
    const flPoco = flechaVano({ b: 300, h: 500, fck: 25 }, a, poco)!;
    expect(flPoco.zeta).toBe(0);
    expect(flPoco.kDiferida).toBeCloseTo(3, 12);
    expect(flPoco.total.valor).toBeCloseTo(3 * Math.max(...poco.flecha!.cuasipermanente.map((x) => x.relativa[centro]!)), 12);
  });

  it("girar el pórtico 90° no cambia ninguna fila (criterio 8)", () => {
    const [a, b] = [portico(), portico({ girado: true })];
    for (const id of ["F1-X0", "F2-X1", "F1-Y1"]) {
      const [da, db] = [demandas(a, id), demandas(b, id)];
      da.vanos.forEach((v, i) => {
        const [ca, cb] = [comprobarVano(da, v, armadoViga(ARMADO)), comprobarVano(db, db.vanos[i]!, armadoViga(ARMADO))];
        expect(cb.filas.map((f) => `${f.id}:${f.estado}`)).toEqual(ca.filas.map((f) => `${f.id}:${f.estado}`));
        ca.filas.forEach((f, k) => expect(Math.abs(cb.filas[k]!.aprovechamiento - f.aprovechamiento)).toBeLessThanOrEqual(1e-7 * Math.max(1, f.aprovechamiento)));
      });
    }
  });

  it("con el sismo del programa, ninguna fila baja (criterio 9)", () => {
    const [sin, con] = [portico(), portico({ sismo: true })];
    let suben = 0;
    for (const id of ["F1-X0", "F1-Y1"]) {
      const [da, db] = [demandas(sin, id), demandas(con, id)];
      da.vanos.forEach((v, i) => {
        const [ca, cb] = [comprobarVano(da, v, armadoViga(ARMADO)), comprobarVano(db, db.vanos[i]!, armadoViga(ARMADO))];
        for (const f of ca.filas) {
          if (f.id.startsWith("flecha-") || f.informativa) continue;
          const g = cb.filas.find((x) => x.id === f.id);
          expect(g, f.id).toBeDefined();
          expect(g!.aprovechamiento).toBeGreaterThanOrEqual(f.aprovechamiento - 1e-7);
          if (g!.aprovechamiento > f.aprovechamiento + 1e-3) suben++;
          if (g!.pesimos) expect(g!.comb!.startsWith("ELU-SIS")).toBe(true);
        }
      });
    }
    expect(suben).toBeGreaterThan(0);
  });

  it("un vano sin armado no cumple", () => {
    const d = demandas(portico(), "F1-X0");
    const c = comprobarViga(d, (v) => (v.indice === 0 ? armadoViga(ARMADO) : null));
    expect(c.cumple).toBe(false);
    expect(c.vanos.map((v) => v.cumple)).toEqual([true, false, false]);
    expect(c.vanos[1]!.pendientes).toEqual([{ motivo: "el vano no tiene armado" }]);
  });
});

/** La muestra del centro del vano (21 muestras). */
const MUESTRAS_CENTRO = 10;

// ─── Con demandas hechas a mano: lo que el pórtico no tiene ─────────────────────────────────────────

const extremo = (valor: number, esfuerzos: number[]): ExtremoViga => ({ valor, s: 1, comb: "ELU-1", esfuerzos });
/** Una zona con My entre `neg` y `pos`, cortante V y torsor T (los concomitantes, los que se dan). */
function zona(nombre: DemandasZona["zona"], o: { pos?: number; neg?: number; V?: number; T?: number; N?: number; Mz?: number; Vy?: number; cp?: boolean } = {}): DemandasZona {
  const { pos = 60, neg = -40, V = 80, T = 0, N = 0, Mz = 0, Vy = 0 } = o;
  const e = (My: number) => [N, Vy, V, T, My, Mz];
  return {
    zona: nombre,
    desde: 0,
    hasta: 1,
    positivo: extremo(pos, e(pos)),
    negativo: extremo(neg, e(neg)),
    cortante: extremo(V, e(neg)),
    torsion: extremo(T, e(neg)),
    cpPositivo: o.cp === false ? null : extremo(pos / 2, e(pos / 2)),
    cpNegativo: o.cp === false ? null : extremo(neg / 2, e(neg / 2)),
  };
}
const vano = (o: Parameters<typeof zona>[1] = {}, torsionEquilibrio = false): DemandasVano => ({
  indice: 0,
  desde: 0,
  hasta: 5,
  apoyos: ["P1", "P2"],
  torsionEquilibrio,
  zonas: [zona("inicio", o), zona("centro", o), zona("fin", o)],
  flecha: null,
  sinFlecha: "sin flecha en esta prueba",
});
const viga = (o: Partial<DemandasViga> = {}): DemandasViga => ({
  viga: "V",
  seccion: { id: "v", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
  material: { id: "H", tipo: "hormigon", fck: 25 },
  axilSinValor: true,
  situaciones: ["ELU-PT"],
  combinaciones: 1,
  vanos: [],
  ...o,
});
const motivos = (c: ComprobacionVano) => c.pendientes.map((p) => p.motivo);

describe("CO2: lo que una viga no puede comprobar va a pendientes", () => {
  it("lo que no es hormigón rectangular", () => {
    const acero = comprobarVano(viga({ material: { id: "S", tipo: "acero" } as DemandasViga["material"] }), vano(), armadoViga(ARMADO));
    expect(acero.cumple).toBe(false);
    expect(acero.filas).toEqual([]);
    expect(motivos(acero)).toEqual(["el material S no es hormigón"]);
    const te = comprobarVano(viga({ seccion: { id: "t", material: "H", forma: "T", bf: 1, hf: 0.1, bw: 0.3, h: 0.5 } }), vano(), armadoViga(ARMADO));
    expect(motivos(te)).toEqual(["la sección t (T) no es rectangular"]);
  });

  it("sin ELS no hay fisuración ni flecha; con flexión lateral o compresión de pilar, tampoco se da por buena", () => {
    const sinEls = comprobarVano(viga(), vano({ cp: false }), armadoViga(ARMADO));
    expect(sinEls.filas.some((f) => f.id.endsWith("cracking"))).toBe(false);
    expect(sinEls.filas.some((f) => f.id === "centro/inf-bending")).toBe(true);
    expect(motivos(sinEls)).toContain("sin combinaciones de ELS (casos sin su acción): la fisuración no se comprueba");
    expect(sinEls.cumple).toBe(false);
    expect(motivos(comprobarVano(viga(), vano({ Mz: 20 }), armadoViga(ARMADO)))).toContain("la viga tiene flexión lateral (Mz, Vy) que el módulo de vigas no comprueba");
    expect(motivos(comprobarVano(viga(), vano({ Vy: 30 }), armadoViga(ARMADO)))).toContain("la viga tiene flexión lateral (Mz, Vy) que el módulo de vigas no comprueba");
    // 0,1·fcd·Ac = 0,1·16,7·150 000 = 250,5 kN: con el axil sin valor (diafragma rígido) no se mira
    const comprimida = vano({ N: -300 });
    expect(motivos(comprobarVano(viga(), comprimida, armadoViga(ARMADO))).some((m) => m.includes("compresión"))).toBe(false);
    expect(motivos(comprobarVano(viga({ axilSinValor: false }), comprimida, armadoViga(ARMADO))).some((m) => m.includes("trabaja como un pilar"))).toBe(true);
    expect(motivos(comprobarVano(viga({ axilSinValor: false }), vano({ N: -200 }), armadoViga(ARMADO))).some((m) => m.includes("trabaja como un pilar"))).toBe(false);
  });

  it("con tracción, la flexión se comprueba con su axil (el M–N del módulo)", () => {
    const c = comprobarVano(viga({ axilSinValor: false }), vano({ N: 100 }), armadoViga(ARMADO));
    const mn = beamMNCapacity({ b: 300, h: 500, fck: 25, fyk: 500, cover: 30, stirrupDiam: 8, tensNBars: 3, tensBarDiam: 16, compNBars: 2, compBarDiam: 12 }, -100);
    expect(u(c, "centro/inf-flexotraccion")!).toBeCloseTo(60 / mn.MRd, 12);
    // Menos que sin axil: la tracción quita capacidad
    expect(u(c, "centro/inf-flexotraccion")!).toBeGreaterThan(u(c, "centro/inf-bending")!);
    // Con el axil sin valor no hay fila
    expect(comprobarVano(viga(), vano({ N: 100 }), armadoViga(ARMADO)).filas.some((f) => f.id.endsWith("flexotraccion"))).toBe(false);
  });

  it("la torsión de equilibrio se comprueba; la de compatibilidad, sólo se da si no es ruido (CO-h)", () => {
    // (con el montaje de 2Ø12, el cordón superior del centro no da para la flexión y la torsión: 3Ø16 corridos)
    const a = armadoViga({ ...ARMADO, superior: { n: 3, diametro: 16 }, cercos: { diametro: 8, separacion: 100 }, cercosFin: { diametro: 8, separacion: 100 }, piel: { n: 1, diametro: 12 } });
    const eq = comprobarVano(viga(), vano({ T: 12 }, true), a);
    const ids = eq.filas.filter((f) => f.zona === "centro" && f.id.includes("torsion")).map((f) => f.id);
    expect(ids).toEqual(["centro/torsion-biela", "centro/torsion-cercos", "centro/torsion-longitudinal", "centro/torsion-separacion", "centro/torsion-barras"]);
    expect(eq.filas.filter((f) => f.id.includes("torsion")).every((f) => f.estado !== "fail")).toBe(true);
    // Sin barras de piel, entre la cara de arriba y la de abajo hay 500 − 2·46 = 408 mm > 350: falla, y pide piel
    const sinPiel = comprobarVano(viga(), vano({ T: 12 }, true), armadoViga({ ...ARMADO, cercos: { diametro: 8, separacion: 100 } }));
    expect(sinPiel.filas.find((f) => f.id === "centro/torsion-barras")).toMatchObject({ estado: "fail", grupo: "piel" });
    // Con más torsor y los cercos a 200 (su separación, u/8 = 200, cumple justo), falla el acero por rama, y el montaje
    const flojo = comprobarVano(viga(), vano({ T: 30 }, true), armadoViga({ ...ARMADO, piel: { n: 1, diametro: 12 } }));
    expect(flojo.filas.find((f) => f.id === "centro/torsion-cercos")).toMatchObject({ estado: "fail", grupo: "cercos" });
    expect(flojo.filas.find((f) => f.id === "centro/torsion-separacion")!.estado).toBe("ok");
    expect(flojo.filas.find((f) => f.id === "centro/torsion-longitudinal")).toMatchObject({ estado: "fail", grupo: "superior" });
    // Compatibilidad: informativa desde el 5 % del torsor de fisuración (18,8 kN·m con esta sección)
    const comp = comprobarVano(viga(), vano({ T: 12 }), a);
    expect(comp.filas.filter((f) => f.id.includes("torsion")).map((f) => [f.id, f.estado, f.informativa])).toEqual([
      ["inicio/torsion-compatibilidad", "neutral", true],
      ["centro/torsion-compatibilidad", "neutral", true],
      ["fin/torsion-compatibilidad", "neutral", true],
    ]);
    expect(comprobarVano(viga(), vano({ T: 0.5 }), a).filas.some((f) => f.id.includes("torsion"))).toBe(false);
  });

  it("un armado que el módulo rechaza no se da por comprobado", () => {
    // Un canto de 10 cm no deja sitio a la barra
    const c = comprobarVano(viga({ seccion: { id: "v", material: "H", forma: "rectangular", b: 0.3, h: 0.04 } }), vano(), armadoViga(ARMADO));
    expect(c.cumple).toBe(false);
    expect(motivos(c).some((m) => m.startsWith("el módulo no admite la entrada"))).toBe(true);
  });
});
