/**
 * Alzado (I2, criterio 4 de `docs/fem3d/interfaz.md` §14.1): lo dibujado es lo del modelo. En el
 * edificio objetivo y la retícula con núcleo, por cada eje: los pilares del plano tramo a tramo con
 * su posición, su ancho visto y las cotas de sus plantas; las vigas paralelas con su canto y la cara
 * superior en la planta; las losas cortadas con su espesor; y nada que esté fuera de la profundidad.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cotasPlantas } from "../../compilador/cotas.ts";
import { compilar } from "../../compilador/compilar.ts";
import { ejesDe } from "../../compilador/ejes.ts";
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import type { Proyecto } from "../proyecto.ts";
import { cantoSeccion, planoDeEje, PROFUNDIDAD_ALZADO, vistaAlzado } from "./alzado.ts";
import { cajaDe, type Escena, type Primitiva } from "./escena.ts";
import { huellaSeccion } from "./modelo.ts";
import { escenaASvg } from "./svg.ts";

const RAIZ = join(import.meta.dirname, "..", "..", "..");
const leer = (ruta: string) => (JSON.parse(readFileSync(join(RAIZ, ruta), "utf8")) as Proyecto).modelo;
const MODELOS: [string, ModeloFisico][] = [
  ["edificio", leer("validacion/a2/agente/edificio/proyecto.json")],
  ["núcleo", leer("validacion/a2/agente/nucleo/proyecto.json")],
];
const d = { huella: "0123456789abcdef" };

const poligonos = (e: Escena, objeto: string, estilo: string) => e.primitivas.filter((p): p is Extract<Primitiva, { tipo: "poligono" }> => p.tipo === "poligono" && p.objeto === objeto && p.estilo === estilo);
const caja = (p: Extract<Primitiva, { tipo: "poligono" }>) => cajaDe(p.anillos[0]!);
const cerca = (a: readonly number[], b: readonly number[]) => a.every((x, i) => Math.abs(x - b[i]!) < 1e-9);

describe.each(MODELOS)("alzados de %s", (_nombre, f) => {
  const cotas = cotasPlantas(f.plantas);
  const k = new Map(f.plantas.map((p, i) => [p.id, i]));
  const ejes = ejesDe(f).ejes;

  it("pilares: tramo a tramo, con su posición, su ancho visto y las cotas de sus plantas; nada fuera de la profundidad", () => {
    for (const eje of ejes) {
      const plano = planoDeEje(f, eje.id)!;
      const e = vistaAlzado(f, plano, d);
      const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
      const dir: Vec2 = [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L];
      for (const p of f.pilares ?? []) {
        const w = (p.x - plano.desde[0]) * -dir[1] + (p.y - plano.desde[1]) * dir[0];
        const tramos = poligonos(e, p.id, "pilar-alzado");
        if (Math.abs(w) > PROFUNDIDAD_ALZADO) {
          expect(tramos, `${eje.id} ${p.id}`).toEqual([]);
          continue;
        }
        const a = k.get(p.desde)!;
        const b = k.get(p.hasta)!;
        expect(tramos.length, `${eje.id} ${p.id}`).toBe(a - b);
        const u = (p.x - plano.desde[0]) * dir[0] + (p.y - plano.desde[1]) * dir[1];
        tramos.forEach((t, i) => {
          const cabeza = b + (a - b - 1 - i);
          const s = f.secciones.find((x) => x.id === (p.tramos?.find((q) => q.planta === f.plantas[cabeza]!.id)?.seccion ?? p.seccion));
          const h = huellaSeccion(p, s)!;
          const us = "anillo" in h ? h.anillo.map((q) => u + (q[0] - p.x) * dir[0] + (q[1] - p.y) * dir[1]) : [u - h.radio, u + h.radio];
          expect(cerca(caja(t), [Math.min(...us), cotas[cabeza + 1]!, Math.max(...us), cotas[cabeza]!]), `${eje.id} ${p.id} tramo ${i}: ${caja(t)}`).toBe(true);
        });
      }
    }
  });

  it("vigas paralelas con su canto y la cara superior en su planta; losas cortadas con su espesor", () => {
    for (const eje of ejes) {
      const plano = planoDeEje(f, eje.id)!;
      const e = vistaAlzado(f, plano, d);
      const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
      const dir: Vec2 = [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L];
      const u = (q: Vec2) => (q[0] - plano.desde[0]) * dir[0] + (q[1] - plano.desde[1]) * dir[1];
      const w = (q: Vec2) => (q[0] - plano.desde[0]) * -dir[1] + (q[1] - plano.desde[1]) * dir[0];
      for (const v of f.vigas ?? []) {
        const z = cotas[k.get(v.planta)!]!;
        const h = cantoSeccion(f.secciones.find((s) => s.id === v.seccion));
        const tramos = poligonos(e, v.id, "viga-alzado");
        const paralelos = v.puntos.slice(1).filter((q, i) => {
          const a = v.puntos[i]!;
          const l = Math.hypot(q[0] - a[0], q[1] - a[1]);
          return Math.abs(w(a)) < 1e-9 && Math.abs(w(q)) < 1e-9 && l > 0;
        });
        if (!paralelos.length) continue;
        expect(tramos.length, `${eje.id} ${v.id}`).toBe(paralelos.length);
        const us = v.puntos.map(u);
        expect(cerca(cajaDe(tramos.flatMap((t) => t.anillos[0]!)), [Math.min(...us), z - h, Math.max(...us), z]), `${eje.id} ${v.id}`).toBe(true);
      }
      for (const l of f.losas ?? []) {
        const z = cotas[k.get(l.planta)!]!;
        for (const t of poligonos(e, l.id, "losa-cortada")) {
          const [, z0, , z1] = caja(t);
          expect([z0, z1]).toEqual([z - l.espesor, z]);
        }
      }
    }
  });

  it("no depende del orden de las listas del modelo", () => {
    const g: ModeloFisico = { ...f, pilares: [...(f.pilares ?? [])].reverse(), vigas: [...(f.vigas ?? [])].reverse(), losas: [...(f.losas ?? [])].reverse(), muros: [...(f.muros ?? [])].reverse() };
    for (const eje of ejes.slice(0, 3)) expect(escenaASvg(vistaAlzado(g, planoDeEje(g, eje.id)!, d)).svg).toBe(escenaASvg(vistaAlzado(f, planoDeEje(f, eje.id)!, d)).svg);
  });
});

// ─── Alámbrico y analítico ──────────────────────────────────────────────────────────────────────

const lineas = (e: Escena, estilo: string) => e.primitivas.filter((p): p is Extract<Primitiva, { tipo: "linea" }> => p.tipo === "linea" && p.estilo === estilo);

describe.each(MODELOS)("alzados alámbrico y analítico de %s", (_nombre, f) => {
  const cotas = cotasPlantas(f.plantas);
  const k = new Map(f.plantas.map((p, i) => [p.id, i]));
  const ejes = ejesDe(f).ejes;
  const c = compilar(f);
  if (!c.valido) throw new Error("no compila");
  const analitico = { modelo: c.modelo, mapeo: c.mapeo };

  it("alámbrico: los pilares por su eje tramo a tramo y las vigas paralelas en la cota de su planta, sin cantos", () => {
    for (const eje of ejes) {
      const plano = planoDeEje(f, eje.id)!;
      const e = vistaAlzado(f, plano, d, { modo: "alambrico" });
      expect(e.primitivas.some((p) => p.tipo === "poligono" && ["pilar-alzado", "viga-alzado", "losa-cortada", "seccion-cortada"].includes(p.estilo))).toBe(false);
      const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
      const dir: Vec2 = [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L];
      const u = (q: Vec2) => (q[0] - plano.desde[0]) * dir[0] + (q[1] - plano.desde[1]) * dir[1];
      const w = (q: Vec2) => (q[0] - plano.desde[0]) * -dir[1] + (q[1] - plano.desde[1]) * dir[0];
      for (const p of f.pilares ?? []) {
        const tramos = lineas(e, "eje-pilar").filter((x) => x.objeto === p.id);
        if (Math.abs(w([p.x, p.y])) > PROFUNDIDAD_ALZADO) {
          expect(tramos).toEqual([]);
          continue;
        }
        const [a, b] = [k.get(p.desde)!, k.get(p.hasta)!];
        expect(tramos.length).toBe(a - b);
        // Sin punto fijo en estos modelos: el eje es (x, y)
        for (const t of tramos) expect(t.puntos.every((q) => Math.abs(q[0] - u([p.x, p.y])) < 1e-9)).toBe(true);
        expect(Math.min(...tramos.flatMap((t) => t.puntos.map((q) => q[1])))).toBeCloseTo(cotas[a]!, 9);
        expect(Math.max(...tramos.flatMap((t) => t.puntos.map((q) => q[1])))).toBeCloseTo(cotas[b]!, 9);
      }
      for (const l of lineas(e, "eje-viga")) {
        const v = f.vigas!.find((x) => x.id === l.objeto)!;
        expect(l.puntos.every((q) => Math.abs(q[1] - cotas[k.get(v.planta)!]!) < 1e-9)).toBe(true);
      }
    }
  });

  it("analítico: cada barra del plano con su tramo flexible y sus zonas rígidas, y las losas cortadas en la cota de sus nudos", () => {
    for (const eje of ejes) {
      const plano = planoDeEje(f, eje.id)!;
      const e = vistaAlzado(f, plano, d, { modo: "analitico", analitico });
      expect(e.primitivas.some((p) => p.tipo === "poligono" && p.estilo === "pilar-alzado")).toBe(false);
      const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
      const dir: Vec2 = [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L];
      const uz = (x: number, y: number, z: number): Vec2 => [(x - plano.desde[0]) * dir[0] + (y - plano.desde[1]) * dir[1], z];
      const w = (x: number, y: number) => (x - plano.desde[0]) * -dir[1] + (y - plano.desde[1]) * dir[0];
      // Lo esperado, barra a barra
      const flexibles: [Vec2, Vec2][] = [];
      let rigidas = 0;
      c.modelo.barras!.forEach((b) => {
        const [A, C] = [c.modelo.nudos[b.nudos[0]]!, c.modelo.nudos[b.nudos[1]]!];
        if (Math.abs(w(A.x, A.y)) > PROFUNDIDAD_ALZADO || Math.abs(w(C.x, C.y)) > PROFUNDIDAD_ALZADO) return;
        const [di, dj] = [b.offsets?.i ?? [0, 0, 0], b.offsets?.j ?? [0, 0, 0]];
        const pI = uz(A.x + di[0], A.y + di[1], A.z + di[2]);
        const pJ = uz(C.x + dj[0], C.y + dj[1], C.z + dj[2]);
        if (Math.hypot(pJ[0] - pI[0], pJ[1] - pI[1]) <= 1e-6) return;
        flexibles.push([pI, pJ]);
        if (Math.hypot(...uz(di[0], di[1], di[2]).map((x, i) => x - uz(0, 0, 0)[i]!) as [number, number]) > 1e-6) rigidas++;
        if (Math.hypot(...uz(dj[0], dj[1], dj[2]).map((x, i) => x - uz(0, 0, 0)[i]!) as [number, number]) > 1e-6) rigidas++;
      });
      const dibujadas = [...lineas(e, "barra-analitica"), ...lineas(e, "vigueta")];
      expect(dibujadas.length, eje.id).toBe(flexibles.length);
      for (const [pI, pJ] of flexibles) expect(dibujadas.some((l) => cerca(l.puntos.flat(), [...pI, ...pJ]))).toBe(true);
      expect(lineas(e, "zona-rigida").length, eje.id).toBe(rigidas);
      // Con el plano del forjado en su cara superior (RV-b), las losas cortadas van en la cota de su planta
      for (const l of lineas(e, "lamina-cortada").filter((x) => f.losas?.some((y) => y.id === x.objeto))) for (const q of l.puntos) expect(cotas.some((z) => z !== null && Math.abs(q[1] - z) < 1e-9), `${eje.id} ${l.objeto} z = ${q[1]}`).toBe(true);
    }
    // Los pilares del edificio llevan la cabeza rígida (en el canto del forjado): hay zonas rígidas
    expect(lineas(vistaAlzado(f, planoDeEje(f, ejes[0]!.id)!, d, { modo: "analitico", analitico }), "zona-rigida").length).toBeGreaterThan(0);
  });

  it("sin modo, lo de siempre; el analítico sin la compilación sólo dibuja plantas y ejes", () => {
    const plano = planoDeEje(f, ejes[0]!.id)!;
    expect(escenaASvg(vistaAlzado(f, plano, d, { modo: "solido" })).svg).toBe(escenaASvg(vistaAlzado(f, plano, d)).svg);
    const e = vistaAlzado(f, plano, d, { modo: "analitico" });
    expect(e.primitivas.every((p) => p.tipo === "texto" || ["nivel", "eje", "eje-burbuja"].includes(p.estilo))).toBe(true);
  });
});
