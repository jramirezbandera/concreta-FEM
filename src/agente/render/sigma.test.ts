/**
 * Fase LC2 (`docs/fem3d/losa-cimentacion.md` §9): la tensión en el terreno en los mapas y en el informe.
 * - El mapa `sigma` es k·(−uz) en los nudos de la losa de cimentación: sus extremos son los de
 *   `fem consultar terreno` en las mismas combinaciones, bit a bit, y las demás losas no tienen mapa.
 * - Lo que despega (σ < 0) va rayado y con su borde, y sólo cuando despega.
 * - En una planta de cimentación, uz rotula el asiento.
 * - Con el sismo del programa, σ va sin μ (es la fuerza del muelle) y el asiento, por μ (LC2-1).
 * - El informe lleva la sección del terreno y las figuras de σ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compilar } from "../../compilador/compilar.ts";
import { Consultas } from "../../compilador/consultas.ts";
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { calcular } from "../../motor/calcular.ts";
import { iniciarNucleo } from "../../nucleo/index.ts";
import { conjuntoCombinaciones, type ConjuntoCombinaciones } from "../combinaciones.ts";
import { VERSION_ESQUEMA, type Proyecto } from "../proyecto.ts";
import { revisar } from "../revision.ts";
import { terreno } from "../terreno.ts";
import { isovalores3D } from "../../visor/isovalores3d.ts";
import { envolventeCampo, ResultadosRender, valoresCampo, vistaCampo } from "./resultados.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const rect = (a: number, b: number, x0 = 0, y0 = 0): Vec2[] => [
  [x0, y0],
  [x0 + a, y0],
  [x0 + a, y0 + b],
  [x0, y0 + b],
];
const K = 40000;

/** Cuatro pilares sobre una losa de cimentación, con un forjado encima; W vuelca la losa y una parte despega. */
function modelo(o: { sismo?: boolean } = {}): ModeloFisico {
  const pilares = (
    [
      [2, 1.5],
      [8, 1.5],
      [2, 4.5],
      [8, 4.5],
    ] as Vec2[]
  ).map(([x, y], i) => ({ id: `P${i + 1}`, x, y, desde: "C", hasta: "N1", seccion: "p30" }));
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 30 }],
    secciones: [{ id: "p30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 }],
    losas: [
      { id: "LN", planta: "N1", contorno: rect(10, 6), espesor: 0.25, material: "H" },
      { id: "LC", planta: "C", contorno: rect(10, 6), espesor: 0.6, material: "H", cimentacion: { balasto: K } },
    ],
    pilares,
    casos: [
      { id: "G", pesoPropio: true, accion: { tipo: "G" } },
      { id: "Q", accion: { tipo: "Q", psi: "uso-A" } },
      ...(o.sismo ? [] : [{ id: "W", accion: { tipo: "W" as const, psi: "viento" as const, direccion: "X" as const, signo: 1 as const, familia: "viento" } }]),
    ],
    cargas: [
      { tipo: "superficie", id: "QN", caso: "Q", planta: "N1", losa: "LN", q: [0, 0, -3] },
      ...(o.sismo ? [] : [{ tipo: "puntual" as const, id: "WX", caso: "W", planta: "N1", x: 5, y: 3, F: [400, 0, 0] as [number, number, number] }]),
    ],
    ...(o.sismo ? { acciones: { sismo: { ab: 0.16, K: 1, terreno: "III" as const, mu: 2 } } } : {}),
  };
}

function calculado(f: ModeloFisico) {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return { c, r, q: new Consultas(f, c, r.casos, {}, r.modal) };
}

const conj = (q: Consultas, s: Parameters<typeof conjuntoCombinaciones>[1]): ConjuntoCombinaciones => {
  const x = conjuntoCombinaciones(q, s);
  if (!x.valido) throw new Error(x.diagnosticos.map((d) => d.mensaje).join(" "));
  return x.valor;
};
const d = { huella: "x" };

describe("LC2: el mapa de σ del terreno", () => {
  const f = modelo();
  let c: ReturnType<typeof calculado>["c"];
  let r: ReturnType<typeof calculado>["r"];
  let q: Consultas;
  let rr: ResultadosRender;
  beforeAll(() => {
    ({ c, r, q } = calculado(f));
    rr = new ResultadosRender(q, c);
  });
  it("σ = −k·uz en cada nudo de la losa, y sus extremos son los de la consulta terreno, bit a bit", () => {
    const cj = conj(q, { tipo: "casos" });
    const uz = valoresCampo(rr, "C", "uz", { base: 0 });
    const s = valoresCampo(rr, "C", "sigma", { base: 0 });
    for (let j = 0; j < s.v.length; j++) expect(Math.abs(s.v[j]! + (K * uz.v[j]!) / 1000)).toBeLessThan(1e-9 * Math.abs(s.v[j]!) + 1e-12);
    const t = terreno(q, cj);
    if (!t.valido) throw new Error("sin terreno");
    const L = t.valor[0]!;
    const max = envolventeCampo(rr, "C", "sigma", cj, "max");
    const min = envolventeCampo(rr, "C", "sigma", cj, "min");
    expect(Math.max(...max.v)).toBe(L.sigmaMax.v);
    expect(Math.min(...min.v)).toBe(L.sigmaMin.v);
    const e = vistaCampo(rr, "C", "sigma", cj, d, {}, "max");
    expect(e.extremos.map((x) => x.que)).toEqual(["σ máxima"]);
    expect(e.extremos[0]!.valor).toBe(L.sigmaMax.v);
  });
  it("lo que despega, rayado y con su borde; donde no despega, nada", () => {
    // W solo vuelca la losa: una parte sube
    const cw = conj(q, { tipo: "casos" });
    const t = terreno(q, cw);
    if (!t.valido) throw new Error("sin terreno");
    expect(t.valor[0]!.sigmaMin.v).toBeLessThan(0);
    const e = vistaCampo(rr, "C", "sigma", cw, d, {}, "min");
    expect(e.primitivas.some((p) => p.tipo === "linea" && p.estilo === "despegue")).toBe(true);
    expect(e.primitivas.some((p) => p.tipo === "linea" && p.estilo === "despegue-rayado")).toBe(true);
    expect(e.extremos.map((x) => x.que)).toEqual(["σ mínima (despega)"]);
    expect(e.leyenda.some((x) => /despega/.test(x.texto))).toBe(true);
    // La ELS característica (por defecto en el mapa de σ) no despega
    const els = conj(q, { tipo: "situaciones", situaciones: ["ELS-C"] });
    const t2 = terreno(q, els);
    if (!t2.valido) throw new Error("sin terreno");
    if (t2.valor[0]!.sigmaMin.v >= 0) {
      const e2 = vistaCampo(rr, "C", "sigma", els, d, {}, "min");
      expect(e2.primitivas.some((p) => p.tipo === "linea" && (p.estilo === "despegue" || p.estilo === "despegue-rayado"))).toBe(false);
    }
  });
  it("en la planta del forjado no hay σ; en la de la cimentación, uz rotula el asiento", () => {
    const cj = conj(q, { tipo: "casos" });
    const e = vistaCampo(rr, "N1", "sigma", cj, d, {}, "max");
    expect(e.notas.some((x) => /no tiene losas de cimentación/.test(x))).toBe(true);
    expect(e.extremos).toEqual([]);
    const u = vistaCampo(rr, "C", "uz", cj, d, {}, "min");
    expect(u.extremos[0]!.que).toBe("asiento máximo");
    expect(vistaCampo(rr, "N1", "uz", cj, d, {}, "min").extremos[0]!.que).toBe("flecha máxima");
  });
  it("en el 3D, sólo la losa de cimentación, con los mismos extremos", () => {
    const cj = conj(q, { tipo: "casos" });
    const i = isovalores3D(rr, [0, 0, 0], "sigma", cj, { planta: null, envolvente: "max" });
    expect(i.plantas).toEqual(["C"]);
    expect(i.sinMapa.length).toBe(0);
    expect(i.extremos.find((x) => x.texto?.startsWith("σ máxima"))!.valor).toBe(Math.max(...envolventeCampo(rr, "C", "sigma", cj, "max").v));
  });
  it("el informe lleva el terreno de la losa y las figuras de σ", () => {
    const p: Proyecto = { esquema: VERSION_ESQUEMA, modelo: f };
    const rev = revisar(p, c, q, { motor: "x", diagnosticos: [], equilibrio: [] });
    expect(rev.markdown).toMatch(/## Terreno bajo las losas de cimentación/);
    expect(rev.markdown).toMatch(/Planta C: σ del terreno \(kN\/m²\), envolvente máxima/);
    const fila = rev.documento.find((b) => b.tipo === "tabla" && b.cabecera[0] === "Losa" && b.cabecera.includes("Distorsión angular"));
    expect(fila && fila.tipo === "tabla" ? fila.filas.map((x) => x[0]) : []).toEqual(["LC"]);
    void r;
  });
});

describe("LC2-1: con el sismo, σ sin μ y el asiento por μ", () => {
  it("un caso del sismo solo: el asiento máximo es μ veces σ máxima / k", () => {
    const f = modelo({ sismo: true });
    const { c, q } = calculado(f);
    const solo = conj(q, { tipo: "expresiones", expresiones: ["EX+e"] });
    const t = terreno(q, solo);
    if (!t.valido) throw new Error(t.diagnosticos.map((x) => x.mensaje).join(" "));
    const L = t.valor[0]!;
    expect(L.sigmaMax.v).toBeGreaterThan(0);
    expect(Math.abs(L.asientoMax.v / (L.sigmaMax.v / K) - 2)).toBeLessThan(1e-9);
    // El mapa da lo mismo que la consulta: σ sin μ
    const rr = new ResultadosRender(q, c);
    expect(Math.abs(Math.max(...envolventeCampo(rr, "C", "sigma", solo, "max").v) / L.sigmaMax.v - 1)).toBeLessThan(1e-10);
    // y uz, por μ: la del asiento
    expect(Math.abs(-Math.min(...envolventeCampo(rr, "C", "uz", solo, "min").v) / 1000 / L.asientoMax.v - 1)).toBeLessThan(1e-10);
  });
});
