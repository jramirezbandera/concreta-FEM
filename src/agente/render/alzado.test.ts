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
