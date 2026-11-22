/**
 * Fase CO5 (`docs/fem3d/comprobaciones.md` §8.9, criterios 8, 9 y 13): las zapatas de un proyecto.
 *
 * - En el edificio de SO (3 × 3 pilares de 40 × 40 con viento), todas se proponen y cumplen.
 * - Girado el edificio 90° (sin la imperfección global, CO3-5), las mismas zapatas y los mismos
 *   aprovechamientos: sus ejes son los de los pilares, que giran con él.
 * - Con el sismo del programa, una zapata dada nunca sale con menos que con un solo signo del sismo.
 * - Lo que no se comprueba se dice: sin zapata en el proyecto, sin la tensión admisible, las zapatas que
 *   se pisan.
 * - La zapata como dato: lo que no vale es error, y sigue a su pilar y a su material en el editor.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioZapatas } from "../../validacion/co/modelosZapatas.ts";
import { comprobarArmado, seguirZapatas } from "../agente/armaduraBase.ts";
import { comprobarObra } from "../agente/obra.ts";
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import type { ModeloFisico } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { erroresZapata, type Zapata } from "./armado.ts";
import { comprobarZapata, datosZapata, type ZapataCompleta } from "./comprobar/zapatas.ts";
import { demandasZapata, type DemandasZapata } from "./demandas/zapatas.ts";
import { armadoPropuestoZapatas, comprobarZapatas, contornoZapata } from "./zapatas.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function consultas(f: ModeloFisico): Consultas {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return new Consultas(f, c, r.casos, {}, r.modal);
}

const OBRA = { terreno: { tensionAdmisible: 200, pesoEspecifico: 18, rozamiento: 0.5, tierras: 0.5 }, armado: { recubrimientoZapatas: 50 }, materiales: { zapatas: "H" } };

describe("CO5: las zapatas de un proyecto", () => {
  it("en el edificio con viento, todas se proponen y cumplen; sin los datos del terreno, se dice", () => {
    const q = consultas(edificioZapatas());
    const r = comprobarZapatas(q, undefined, OBRA, { proponer: true });
    if (!r.valido) throw new Error("zapatas");
    expect(r.valor.resumen).toMatchObject({ zapatas: 9, cumplen: 9, noCumplen: 0, sinZapata: 0, pendientes: 0 });
    expect(r.valor.zapatas.every((z) => z.origen === "propuesto" && z.hormigon === "H" && z.tipo === "centrada")).toBe(true);
    expect(r.diagnosticos.map((d) => d.codigo)).toEqual([]);
    // Sin la obra: la tensión admisible, el resto por defecto y el hormigón
    const s = comprobarZapatas(q, undefined, undefined, { proponer: true });
    if (!s.valido) throw new Error("zapatas");
    expect(s.valor.resumen).toMatchObject({ zapatas: 9, cumplen: 0 });
    expect(s.valor.zapatas.every((z) => z.origen === "sin-zapata" && z.pendientes[0]!.motivo.includes("tensión admisible"))).toBe(true);
    expect(s.diagnosticos.map((d) => d.codigo)).toEqual(["comprobacion/sin-tension-admisible", "comprobacion/zapatas-por-defecto", "comprobacion/zapatas-hormigon-por-defecto"]);
    // Sin zapatas en el proyecto, comprobar no las da por buenas
    const c = comprobarZapatas(q, undefined, OBRA);
    if (!c.valido) throw new Error("zapatas");
    expect(c.valor.resumen).toMatchObject({ zapatas: 9, cumplen: 0, sinZapata: 9 });
    expect(c.diagnosticos.some((d) => d.codigo === "comprobacion/sin-zapata")).toBe(true);
    // Con las propuestas en el proyecto, las mismas filas
    const escritas = armadoPropuestoZapatas(r.valor, undefined);
    const d = comprobarZapatas(q, escritas, OBRA, { filas: true });
    if (!d.valido) throw new Error("zapatas");
    expect(d.valor.zapatas.map((z) => [z.pilar, z.origen, z.texto, z.cumple, z.aprovechamiento])).toEqual(r.valor.zapatas.map((z) => [z.pilar, "proyecto", z.texto, true, z.aprovechamiento]));
    expect(comprobarArmado({ zapatas: escritas }, q.fisico)).toEqual([]);
  });

  it("girado el edificio 90°, las mismas zapatas y los mismos aprovechamientos", () => {
    const filas = (giro: number) => {
      const q = consultas(edificioZapatas({ giro, sinImperfeccion: true }));
      const r = comprobarZapatas(q, undefined, OBRA, { proponer: true, filas: true });
      if (!r.valido) throw new Error("zapatas");
      return r.valor.zapatas;
    };
    const [a, b] = [filas(0), filas(90)];
    expect(b.map((z) => z.texto)).toEqual(a.map((z) => z.texto));
    a.forEach((z, i) => {
      const w = b[i]!;
      expect(w.filas!.map((f) => f.id)).toEqual(z.filas!.map((f) => f.id));
      z.filas!.forEach((f, k) => expect(Math.abs((w.filas![k]!.aprovechamiento ?? 0) - (f.aprovechamiento ?? 0)), `${z.pilar} ${f.id}`).toBeLessThanOrEqual(1e-6));
    });
  });

  it("con el sismo del programa, una zapata dada nunca sale con menos que con un solo signo", () => {
    const q = consultas(edificioZapatas({ sismo: true }));
    const z: ZapataCompleta = { B: 2.6, L: 2.6, h: 0.7, inferior: { x: { diametro: 16, separacion: 150 }, y: { diametro: 16, separacion: 150 } } };
    const d = datosZapata(25, OBRA.armado, OBRA.terreno);
    for (const id of ["P1", "P2", "P5"]) {
      const D = demandasZapata(q, id);
      if (!D.valido) throw new Error("demanda");
      // Un solo signo: de las ternas de cada combinación sísmica, sólo la primera (N, Mx y My con +A)
      const uno: DemandasZapata = {
        ...D.valor,
        cargas: (h) => {
          const c = D.valor.cargas(h);
          const solo = (l: typeof c.elu) => {
            const vistas = new Set<string>();
            return l.filter((x) => {
              if (!x.pesimos) return true;
              if (vistas.has(x.comb)) return false;
              vistas.add(x.comb);
              return true;
            });
          };
          return { geo: solo(c.geo), elu: solo(c.elu) };
        },
      };
      for (const linderos of [[], ["-x"], ["+x", "+y"]] as const) {
        const zz = { ...z, ...(linderos.length ? { linderos: [...linderos] } : {}) };
        const todas = new Map(comprobarZapata(D.valor, zz, d).filas.map((f) => [f.id, f.aprovechamiento]));
        for (const f of comprobarZapata(uno, zz, d).filas) expect(todas.get(f.id)!, `${id} ${linderos.join(",")} ${f.id}`).toBeGreaterThanOrEqual(f.aprovechamiento - 1e-12);
      }
    }
  });

  it("dos zapatas que se pisan, con su aviso; su contorno sigue los linderos y el giro del pilar", () => {
    const q = consultas(edificioZapatas());
    // P2 y P5, a 6 m, con zapatas de 6,5 m: se pisan; P1, con una de 2 m, no
    const grande = (B: number): Zapata => ({ B, L: B, h: 1, inferior: { x: { diametro: 16, separacion: 200 }, y: { diametro: 16, separacion: 200 } } });
    const r = comprobarZapatas(q, { P1: grande(2), P2: grande(6.5), P5: grande(6.5) }, OBRA, { ids: ["P1", "P2", "P5"] });
    if (!r.valido) throw new Error("zapatas");
    const aviso = r.diagnosticos.find((x) => x.codigo === "comprobacion/zapatas-solapadas");
    expect(aviso?.ids).toEqual(["P2", "P5"]);
    // El contorno: centrada, alrededor del pilar; con lindero +x, hacia −x; girada 90°, según y
    const D = { punto: [10, 20, 0] as const, giro: 0, cx: 0.4, cy: 0.3, circular: false };
    expect(contornoZapata(D, { B: 2, L: 1 })).toEqual([[9, 19.5], [11, 19.5], [11, 20.5], [9, 20.5]]);
    expect(contornoZapata(D, { B: 2, L: 1, linderos: ["+x"] }).map((p) => p.map((x) => Math.round(x * 1e9) / 1e9))).toEqual([[8.2, 19.5], [10.2, 19.5], [10.2, 20.5], [8.2, 20.5]]);
    const g = contornoZapata({ ...D, giro: 90 }, { B: 2, L: 1, linderos: ["-y"] }).map((p) => p.map((x) => Math.round(x * 1e9) / 1e9));
    expect(g).toEqual([[10.15, 19], [10.15, 21], [9.15, 21], [9.15, 19]]);
  });

  it("la zapata como dato: lo que no vale, error; sigue a su pilar y a su material", () => {
    expect(erroresZapata({ B: 2, L: 2 })).toEqual(["las dimensiones van juntas: B, L y h"]);
    expect(erroresZapata({ linderos: ["-x", "+x"] })).toEqual(["los dos linderos de una zapata de esquina son contiguos: uno según x y otro según y"]);
    expect(erroresZapata({ linderos: ["-z" as never] })[0]).toContain("no es un lindero");
    expect(erroresZapata({ centradoras: ["P2"] })[0]).toContain("centrada no lleva vigas centradoras");
    expect(erroresZapata({ B: 2, L: 2, h: 0.5, inferior: { x: { diametro: 14, separacion: 200 }, y: { diametro: 12, separacion: 0 } } })).toEqual([expect.stringContaining("Ø14"), expect.stringContaining("separación 0")]);
    const m = edificioZapatas();
    const conHormigon = { ...m, materiales: [...m.materiales, { id: "S", tipo: "acero" as const }] } as ModeloFisico;
    const z: Record<string, Zapata> = { P1: { linderos: ["-x"], centradoras: ["P4"], material: "H" }, P2: { centradoras: [] }, P99: {}, P3: { linderos: ["-x"], centradoras: ["P3"], material: "S" } };
    const e = comprobarArmado({ zapatas: z }, conHormigon).map((d) => d.mensaje);
    expect(e).toEqual([expect.stringContaining("«P99», que no es un pilar"), expect.stringContaining("es de «S», que no es un hormigón"), expect.stringContaining("va a él mismo")]);
    // Renombrar P4 a P40 y borrar P1: su zapata se va; la centradora de P3 a P4 pasa a P40
    const antes = m;
    const despues = { ...m, pilares: m.pilares!.filter((p) => p.id !== "P1").map((p) => (p.id === "P4" ? { ...p, id: "P40" } : p)) };
    const s = seguirZapatas({ zapatas: { P1: { linderos: ["-x"] }, P3: { linderos: ["-x"], centradoras: ["P4"], material: "H" }, P4: { B: 2, L: 2, h: 0.5 } } }, new Map([["P4", "P40"]]), antes, despues);
    expect(s?.zapatas).toEqual({ P3: { linderos: ["-x"], centradoras: ["P40"], material: "H" }, P40: { B: 2, L: 2, h: 0.5 } });
    // Borrar el pilar de la centradora la quita; renombrar o borrar el material, lo mismo
    const sinP4 = { ...m, pilares: m.pilares!.filter((p) => p.id !== "P4"), materiales: [{ id: "H2", tipo: "hormigon" as const, fck: 30 }] } as ModeloFisico;
    const t = seguirZapatas({ zapatas: { P3: { linderos: ["-x"], centradoras: ["P4"], material: "H" } } }, new Map([["H", "H2"]]), antes, sinP4);
    expect(t?.zapatas).toEqual({ P3: { linderos: ["-x"], material: "H2" } });
    // El terreno de la obra
    expect(comprobarObra({ terreno: { tensionAdmisible: 2 } }, m).map((d) => d.codigo)).toEqual(["obra/terreno"]);
    expect(comprobarObra({ terreno: { tensionAdmisible: 200, rozamiento: 0.6, tierras: 1 }, armado: { recubrimientoZapatas: 50 }, materiales: { zapatas: "H" } }, m)).toEqual([]);
  });
});
