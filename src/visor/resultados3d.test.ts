/**
 * I4 (`docs/fem3d/interfaz.md` §7): los diagramas de las barras en el 3D y en el alzado, y los
 * isovalores de las losas en el 3D, sobre los proyectos de ejemplo:
 * - los valores son los de la consulta (`envolventePieza`), bit a bit: los extremos de cada pieza,
 *   los de lo que se ve (con la combinación que los da) y, en el alzado, el momento en el plano de
 *   las vigas del pórtico, que es su My;
 * - cada diagrama va del lado de su convenio: My > 0 bajo las vigas, en el 3D y en el alzado;
 * - el 3D de una planta es su mapa en planta: la misma combinación, los mismos límites y colores, los
 *   mismos extremos y la misma área;
 * - sin resultados no hay diagramas ni isovalores.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { canonico3D, tramosEspacio } from "../agente/render/diagramas.ts";
import { area, type Vec2 } from "../agente/render/escena.ts";
import { planoDeEje, vistaCampo } from "../agente/render/index.ts";
import { envolventePieza, envolventeTramo } from "../agente/render/resultados.ts";
import { sha256 } from "../compilador/huella.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Atendedor } from "./atender.ts";
import { ESFUERZOS_3D } from "./diagramas3d.ts";
import { Sesion, type EleccionCombinaciones } from "./sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
const MOTOR = sha256(new Uint8Array(WASM));
const PROYECTOS: [string, string][] = [
  ["ejemplo", ".claude/skills/fem/ejemplo.json"],
  ["1022", "validacion/a2/agente/1022/proyecto.json"],
  ["nucleo", "validacion/a2/agente/nucleo/proyecto.json"],
  ["edificio", "validacion/a2/agente/edificio/proyecto.json"],
];
const D: EleccionCombinaciones = { tipo: "defecto" };
const COMP = { N: 0, Vy: 1, Vz: 2, T: 3, My: 4, Mz: 5 } as const;

const valido = <T>(r: { valido: true; valor: T } | { valido: false; diagnosticos: unknown }): T => {
  if (!r.valido) throw new Error(JSON.stringify(r.diagnosticos));
  return r.valor;
};

beforeAll(async () => {
  await iniciarNucleo(WASM);
});

describe.each(PROYECTOS)("I4 con %s", (_nombre, ruta) => {
  let s: Sesion;
  beforeAll(async () => {
    const a = Sesion.abrir(readFileSync(join(RAIZ, ruta), "utf8"), MOTOR);
    if (!a.valido) throw new Error("no abre");
    s = a.sesion;
    expect((await s.calcular()).ok).toBe(true);
  }, 120_000);

  it("la envolvente por tramos es la de la pieza, bit a bit", () => {
    const rr = s.rr!;
    const conj = valido(s.conjunto(D, "esfuerzos"));
    for (const id of Object.keys(rr.c.mapeo.piezas).slice(0, 40)) {
      const porTramos = rr.ep.tramos(id).flatMap((t) => envolventeTramo(rr, t, conj, COMP.My));
      const pieza = envolventePieza(rr, id, conj, COMP.My);
      // envolventePieza sólo quita el primer punto de un tramo si repite el último del anterior
      const sinRepetir = porTramos.filter((e, i) => !(i > 0 && porTramos[i - 1]!.s === e.s && porTramos[i - 1]!.max === e.max && porTramos[i - 1]!.min === e.min));
      expect(sinRepetir).toEqual(pieza);
    }
  });

  it.each(ESFUERZOS_3D)("3D, %s: los extremos de cada pieza y de lo que se ve son los de envolventePieza", (esf) => {
    const rr = s.rr!;
    const conj = valido(s.conjunto(D, "esfuerzos"));
    const d = valido(s.diagramas3D({ esfuerzo: esf, combinaciones: D, planta: null, piezas: "todas" }));
    let [gmax, gmin] = [-Infinity, Infinity];
    for (const x of d.piezas) {
      const c = envolventePieza(rr, x.id, conj, COMP[esf]);
      const [mx, mn] = [Math.max(...c.map((p) => p.max)), Math.min(...c.map((p) => p.min))];
      expect(x.max?.valor).toBe(mx);
      expect(x.min?.valor).toBe(mn);
      [gmax, gmin] = [Math.max(gmax, mx), Math.min(gmin, mn)];
    }
    const max = d.extremos.find((e) => e.que === "máximo");
    const min = d.extremos.find((e) => e.que === "mínimo");
    if (gmax > 0) expect(max?.valor).toBe(gmax);
    else expect(max).toBeUndefined();
    if (gmin < 0) expect(min?.valor).toBe(gmin);
    else expect(min).toBeUndefined();
    // La combinación de cada extremo lo da en su estación
    for (const e of d.extremos) expect(conj.nombres).toContain(e.comb);
    // La escala: el mayor |valor| ocupa 1,5 m
    expect(d.escala.valor).toBe(Math.max(gmax, -gmin, 0));
    expect(d.positivo.length % 9).toBe(0);
    expect(d.negativo.length % 9).toBe(0);
    expect(d.lineas.length).toBe(6 * d.signoLinea.length);
  });

  it("3D: My > 0 bajo las vigas, Mz y los cortantes en su eje; filtros por planta y por piezas", () => {
    const rr = s.rr!;
    const d = valido(s.diagramas3D({ esfuerzo: "My", combinaciones: D, planta: null, piezas: "todas" }));
    for (const x of d.piezas) {
      if (x.tipo === "pilar" || !x.max || x.max.valor <= 0) continue;
      const tr = tramosEspacio(rr, x.id, canonico3D).find((t) => x.max!.s >= t.t.s0 - 1e-9 && x.max!.s <= t.t.s1 + 1e-9)!;
      // Una viga horizontal con el canto vertical: la punta, por debajo de su eje
      if (Math.abs(tr.e3[2] - 1) > 1e-9 || Math.abs(tr.a[2] - tr.b[2]) > 1e-9) continue;
      expect(x.max.punta[2]).toBeLessThan(tr.a[2]);
      expect(x.max.punta[2]).toBeCloseTo(tr.a[2] - (x.max.valor / d.escala.valor) * d.escala.m, 9);
    }
    const plantas = s.proyecto.modelo.plantas.map((p) => p.id);
    const vigas = valido(s.diagramas3D({ esfuerzo: "My", combinaciones: D, planta: null, piezas: "vigas" }));
    expect(vigas.piezas.every((x) => x.tipo !== "pilar")).toBe(true);
    const pilares = valido(s.diagramas3D({ esfuerzo: "My", combinaciones: D, planta: null, piezas: "pilares" }));
    expect(pilares.piezas.every((x) => x.tipo === "pilar")).toBe(true);
    expect(vigas.piezas.length + pilares.piezas.length).toBe(d.piezas.length);
    for (const p of plantas.slice(0, 2)) {
      const x = valido(s.diagramas3D({ esfuerzo: "My", combinaciones: D, planta: p, piezas: "todas" }));
      for (const q of x.piezas) expect(tramosEspacio(rr, q.id, canonico3D).some((t) => t.planta === p)).toBe(true);
    }
    // La escala ×2 duplica la ordenada
    const doble = valido(s.diagramas3D({ esfuerzo: "My", combinaciones: D, planta: null, piezas: "todas", escala: 2 }));
    expect(doble.escala.m).toBe(2 * d.escala.m);
  });

  it("alzado: M en el plano es el My de las vigas del pórtico, bit a bit, y va bajo ellas si es positivo", () => {
    const rr = s.rr!;
    const conj = valido(s.conjunto(D, "esfuerzos"));
    const vigas = new Set((s.proyecto.modelo.vigas ?? []).map((v) => v.id));
    let comprobadas = 0;
    for (const eje of s.estado().ejes) {
      const plano = planoDeEje(s.proyecto.modelo, eje.id)!;
      const e = valido(s.alzadoA4({ eje: eje.id }, { esfuerzo: "M", combinaciones: D }));
      const n = [-(plano.hasta[1] - plano.desde[1]), plano.hasta[0] - plano.desde[0]];
      const ln = Math.hypot(n[0]!, n[1]!);
      for (const x of e.extremos) {
        if (!vigas.has(x.objeto!)) continue;
        // Sólo las vigas enteras en el plano y en sus ejes (las de un pórtico ortogonal)
        const ts = tramosEspacio(rr, x.objeto!, canonico3D);
        const enEjes = ts.every((t) => Math.abs(Math.abs((t.e2[0] * n[0]! + t.e2[1] * n[1]!) / ln) - 1) < 1e-12 && Math.abs((t.a[0] - plano.desde[0]) * n[0]! + (t.a[1] - plano.desde[1]) * n[1]!) / ln <= 0.5);
        if (!enEjes) continue;
        const c = envolventePieza(rr, x.objeto!, conj, COMP.My);
        if (x.que.includes("máximo")) expect(x.valor).toBe(Math.max(...c.map((p) => p.max)));
        else expect(x.valor).toBe(Math.min(...c.map((p) => p.min)));
        comprobadas++;
      }
      // Los rellenos positivos de las vigas, por debajo de su eje (la cara superior en la planta)
      for (const p of e.primitivas) {
        if (p.tipo !== "poligono" || p.estilo !== "diagrama-positivo" || !vigas.has(p.objeto ?? "")) continue;
        const ts = tramosEspacio(rr, p.objeto!, canonico3D);
        const z = Math.max(...ts.map((t) => Math.max(t.a[2], t.b[2])));
        for (const q of p.anillos[0]!) expect(q[1]).toBeLessThanOrEqual(z + 1e-9);
      }
    }
    if ((s.proyecto.modelo.vigas ?? []).length && s.estado().ejes.length) expect(comprobadas).toBeGreaterThan(0);
  });

  it("isovalores 3D de una planta: su mapa en planta (combinación, límites, colores, extremos y área)", () => {
    const rr = s.rr!;
    for (const campo of ["uz", "m11"] as const) {
      const conj = valido(s.conjunto(D, campo === "uz" ? "desplazamientos" : "esfuerzos"));
      for (const p of s.proyecto.modelo.plantas.map((x) => x.id)) {
        if (!rr.laminas(p).laminas.length) continue;
        const i = valido(s.isovalores3D({ campo, combinaciones: D, planta: p }));
        const e = vistaCampo(rr, p, campo, conj, { huella: s.huella });
        expect(i.mapa).toEqual(e.mapa);
        expect(i.combinacion?.nombre).toBe(e.extremos[0]?.comb);
        const max = e.extremos.find((x) => x.que.endsWith("máximo"))!;
        const min = e.extremos.find((x) => x.que.endsWith("mínimo"))!;
        expect(i.extremos.map((x) => [x.valor, x.losa, x.punto[0], x.punto[1]])).toEqual([
          [max.valor, max.objeto, max.punto![0], max.punto![1]],
          [min.valor, min.objeto, min.punto![0], min.punto![1]],
        ]);
        // Los colores de las bandas que se ven, los de la planta
        const enPlanta = new Map<number, string>();
        for (const q of e.primitivas) if (q.tipo === "region") enPlanta.set(q.banda, q.relleno);
        for (const b of new Set(i.banda)) expect(i.colores[b]).toBe(enPlanta.get(b));
        // El área de las bandas, la de las láminas con mapa
        let a3 = 0;
        for (let t = 0; t < i.triangulos.length; t += 9) {
          const [x0, y0, x1, y1, x2, y2] = [i.triangulos[t]!, i.triangulos[t + 1]!, i.triangulos[t + 3]!, i.triangulos[t + 4]!, i.triangulos[t + 6]!, i.triangulos[t + 7]!];
          a3 += Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
        }
        let a2 = 0;
        const { laminas, region } = campo === "uz" ? { ...rr.laminas(p), region: null } : rr.valores(p);
        laminas.forEach((l, k) => {
          if (region && !region[k]) return;
          a2 += Math.abs(area(rr.c.modelo.laminas![l]!.nudos.map((n) => [rr.c.modelo.nudos[n]!.x, rr.c.modelo.nudos[n]!.y] as Vec2)));
        });
        expect(a3 / a2).toBeCloseTo(1, 5);
      }
    }
  });

  it("isovalores 3D de todas las plantas: una escala común que cubre todas", () => {
    const i = valido(s.isovalores3D({ campo: "uz", combinaciones: D, planta: null }));
    const conPlanta = s.proyecto.modelo.plantas.map((x) => x.id).filter((p) => s.rr!.laminas(p).laminas.length);
    expect(i.plantas).toEqual(conPlanta);
    if (!i.mapa) return;
    const [vmin, vmax] = [Math.min(...i.extremos.map((x) => x.valor)), Math.max(...i.extremos.map((x) => x.valor))];
    expect(i.mapa.minimo).toBe(vmin);
    expect(i.mapa.maximo).toBe(vmax);
  });
});

describe("I4 por el protocolo", () => {
  it("sin resultados no hay diagramas ni isovalores; con ellos, sí", async () => {
    const a = new Atendedor(MOTOR);
    expect((await a.atender({ tipo: "abrir", texto: readFileSync(join(RAIZ, "validacion/a2/agente/1022/proyecto.json"), "utf8") })).ok).toBe(true);
    const pedidos = [
      { tipo: "diagramas3d", esfuerzo: "My", combinaciones: D, planta: null, piezas: "todas" },
      { tipo: "isovalores3d", campo: "uz", combinaciones: D, planta: null },
      { tipo: "alzado", plano: { desde: [0, 0], hasta: [10, 0] }, diagramas: { esfuerzo: "M", combinaciones: D } },
    ] as const;
    for (const p of pedidos) {
      const r = await a.atender(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.diagnosticos[0]!.codigo).toBe("visor/sin-resultados");
    }
    expect((await a.atender({ tipo: "calcular" })).ok).toBe(true);
    for (const p of pedidos) expect((await a.atender(p)).ok).toBe(true);
    // El alzado sin diagramas sigue siendo el del modelo, sin cálculo
    expect((await a.atender({ tipo: "alzado", plano: { desde: [0, 0], hasta: [10, 0] } })).ok).toBe(true);
    // Una planta que no existe
    const r = await a.atender({ tipo: "diagramas3d", esfuerzo: "My", combinaciones: D, planta: "no-existe", piezas: "todas" });
    expect(r.ok).toBe(false);
  }, 60_000);
});
