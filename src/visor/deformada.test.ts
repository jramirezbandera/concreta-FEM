/**
 * VC2 (`docs/fem3d/coherencia-vistas.md`): la deformada en planta y en alzado.
 * - Con escala 0, la deformada del alzado es el modelo analítico sin deformar (las barras del plano,
 *   nudo a nudo, las del modo «analítico»).
 * - En planta, las cabezas de los pilares de una planta con diafragma rígido se mueven como un sólido:
 *   u = u_maestro + rz × (r − r_maestro) (lo que da la consulta de la planta), a la precisión de Float32.
 * - El mayor d/h rotulado en cada planta es el de la tabla (`fem consultar deriva`) en esa combinación.
 * - La forma de un modo se dibuja sin rótulos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { deriva } from "../agente/consultas.ts";
import { planoDeEje } from "../agente/render/alzado.ts";
import { fraccionAltura } from "../agente/render/deformada.ts";
import type { Escena, Primitiva, Vec2 } from "../agente/render/escena.ts";
import { ejesDe } from "../compilador/ejes.ts";
import { sha256 } from "../compilador/huella.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { desplazamientos } from "./datos.ts";
import { Sesion, type EleccionCombinaciones } from "./sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
const MOTOR = sha256(new Uint8Array(WASM));
const D: EleccionCombinaciones = { tipo: "defecto" };

const valido = <T>(r: { valido: true; valor: T } | { valido: false; diagnosticos: unknown }): T => {
  if (!r.valido) throw new Error(JSON.stringify(r.diagnosticos));
  return r.valor;
};
const lineas = (e: Escena, estilo: string) => e.primitivas.filter((p): p is Extract<Primitiva, { tipo: "linea" }> => p.tipo === "linea" && p.estilo === estilo);
const clave = (a: Vec2, b: Vec2) => {
  const r = (p: Vec2) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const [x, y] = [r(a), r(b)];
  return x < y ? `${x}|${y}` : `${y}|${x}`;
};

beforeAll(async () => {
  await iniciarNucleo(WASM);
});

describe("VC2: la deformada en planta y en alzado", () => {
  let s: Sesion;
  let una: EleccionCombinaciones;
  beforeAll(async () => {
    const a = Sesion.abrir(readFileSync(join(RAIZ, "validacion/a2/agente/edificio/proyecto.json"), "utf8"), MOTOR);
    if (!a.valido) throw new Error("no abre");
    s = a.sesion;
    expect((await s.calcular()).ok).toBe(true);
    // La combinación del mayor desplome relativo (la que dibuja la pantalla)
    const conj = valido(s.conjunto(D, "desplazamientos"));
    const d = valido(deriva(s.q!, conj));
    const pesima = d.filter((x) => x.desplome).reduce((m, x) => (x.desplome!.v > m.desplome!.v ? x : m)).desplome!.comb;
    una = { tipo: "una", de: D, nombre: pesima };
  }, 120_000);

  it("alzado con escala 0: las barras deformadas son las del modelo analítico sin deformar", () => {
    const f = s.proyecto.modelo;
    for (const eje of ejesDe(f).ejes.slice(0, 3)) {
      const plano = { eje: eje.id, modo: "analitico" as const };
      const def = valido(s.alzadoA4(plano, undefined, undefined, undefined, { combinaciones: una, escala: 0 }));
      const base = valido(s.alzadoA4(plano));
      const sinDeformar = new Set<string>();
      // Las del modo analítico van de nudo a nudo con sus zonas rígidas aparte: el tramo entero, de nudo a nudo
      const q = s.q!;
      const pl = planoDeEje(f, eje.id)!;
      const L = Math.hypot(pl.hasta[0] - pl.desde[0], pl.hasta[1] - pl.desde[1]);
      const dir = [(pl.hasta[0] - pl.desde[0]) / L, (pl.hasta[1] - pl.desde[1]) / L];
      const u = (x: number, y: number) => (x - pl.desde[0]) * dir[0]! + (y - pl.desde[1]) * dir[1]!;
      const w = (x: number, y: number) => -(x - pl.desde[0]) * dir[1]! + (y - pl.desde[1]) * dir[0]!;
      const N = q.modelo.nudos;
      for (const b of q.modelo.barras ?? []) {
        const [A, C] = [N[b.nudos[0]]!, N[b.nudos[1]]!];
        if (Math.abs(w(A.x, A.y)) > 0.5 || Math.abs(w(C.x, C.y)) > 0.5) continue;
        const [pa, pc]: Vec2[] = [[u(A.x, A.y), A.z], [u(C.x, C.y), C.z]];
        if (Math.hypot(pc[0] - pa[0], pc[1] - pa[1]) <= 1e-6) continue;
        sinDeformar.add(clave(pa, pc));
      }
      const deformadas = lineas(def, "deformada").map((l) => clave(l.puntos[0]!, l.puntos[1]!));
      expect(deformadas.length, eje.id).toBe(sinDeformar.size);
      expect(new Set(deformadas), eje.id).toEqual(sinDeformar);
      // Y el modelo analítico del alzado tiene una barra flexible por cada una
      expect(lineas(base, "barra-analitica").length + lineas(base, "vigueta").length, eje.id).toBeGreaterThan(0);
    }
  });

  it("planta: las cabezas de los pilares se mueven como el diafragma (la consulta de la planta)", () => {
    const f = s.proyecto.modelo;
    const q = s.q!;
    const conj = valido(s.conjunto(una, "desplazamientos"));
    const fac = conj.factores[0]!;
    const umax = valido(desplazamientos(s, una)).u.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const escala = 100;
    let comprobados = 0;
    for (const p of f.plantas) {
      const m = valido(q.planta(p.id)).maestro;
      if (!m) continue;
      const [ux, uy, rz] = q.combinar(m.u, 3, fac, true);
      const e = valido(s.escenaA4(p.id, { vista: "deformada", deformada: { combinaciones: una, escala } }));
      for (const pi of f.pilares ?? []) {
        const n = q.mapeo.nudosPilar[`${pi.id}@${p.id}`];
        if (n === undefined) continue;
        const nudo = q.modelo.nudos[n]!;
        const marca = e.primitivas.find((x) => x.tipo === "marca" && x.estilo === "deformada-nudo" && x.objeto === pi.id);
        expect(marca, `${pi.id}@${p.id}`).toBeDefined();
        const pm = (marca as Extract<Primitiva, { tipo: "marca" }>).p;
        const esperado = [ux! - rz! * (nudo.y - m.punto[1]!), uy! + rz! * (nudo.x - m.punto[0]!)];
        // Float32 de los desplazamientos de la deformada (los del 3D)
        expect(Math.abs((pm[0] - nudo.x) / escala - esperado[0]!), `${pi.id}@${p.id} x`).toBeLessThan(1e-6 * umax + 1e-12);
        expect(Math.abs((pm[1] - nudo.y) / escala - esperado[1]!), `${pi.id}@${p.id} y`).toBeLessThan(1e-6 * umax + 1e-12);
        comprobados++;
      }
    }
    expect(comprobados).toBeGreaterThan(10);
  });

  it("el mayor d/h rotulado en cada planta es el de la tabla (deriva) en esa combinación", () => {
    const f = s.proyecto.modelo;
    const tabla = valido(deriva(s.q!, valido(s.conjunto(una, "desplazamientos"))));
    let n = 0;
    for (const t of tabla) {
      if (!t.desplome) continue;
      const e = valido(s.escenaA4(t.planta, { vista: "deformada", deformada: { combinaciones: una, escala: 50 } }));
      const max = e.extremos.filter((x) => x.que === "d/h").reduce((m, x) => Math.max(m, x.valor), 0);
      expect(max, t.planta).toBe(t.desplome.v);
      expect(e.primitivas.some((x) => x.tipo === "texto" && x.texto === fraccionAltura(t.desplome!.v)), t.planta).toBe(true);
      n++;
    }
    expect(n).toBe(f.plantas.length - 1);
  });

  it("la forma de un modo, sin rótulos de datos (si hay modal) o con su error", () => {
    const f = s.proyecto.modelo;
    const r = s.escenaA4(f.plantas[0]!.id, { vista: "deformada", deformada: { modo: 1, escala: 0.3 } });
    if (!s.q!.modal) {
      expect(r.valido).toBe(false);
      return;
    }
    const e = valido(r);
    expect(e.primitivas.some((x) => x.tipo === "texto" && x.clase === "dato")).toBe(false);
    expect(lineas(e, "deformada").length).toBeGreaterThan(0);
  });
});
