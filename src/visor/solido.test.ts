/**
 * El sólido de I3 (`docs/fem3d/interfaz.md` §16, criterio 1 de §16.1) en Node:
 * - cada pieza es una superficie cerrada con la normal hacia fuera (su volumen no depende del
 *   origen y es positivo);
 * - su volumen es el de sus datos: A·L de su sección (o la huella por la altura) menos lo que tapa
 *   la losa, con las intersecciones de `poligonos.ts`, que no usan el dibujo;
 * - por planta, Σ γ·V de lo dibujado más lo que el dibujo no repite es el peso propio esperado de
 *   A3, y lo que se quita a las vigas rectangulares de hormigón bajo la losa es el solape de C2-g;
 * - los búferes son los de las piezas, en Float32 respecto al origen del alámbrico, y no dependen
 *   del orden de las listas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { areaRegion, gammaMaterial, pesoPropioEsperado, Plantas } from "../agente/sensatez.ts";
import { compilar } from "../compilador/compilar.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import type { ModeloFisico, Seccion, Vec2 } from "../compilador/fisico.ts";
import { areaConSigno, distanciaABorde, fraccionEnRegiones, momentosInterseccion, puntoEnPoligono, puntoEnRegion, type Region } from "../compilador/poligonos.ts";
import { edificioGeometria, FAMILIAS } from "../pruebas/geometrias.ts";
import { edificioObjetivoMuros, reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { edificioReticular, edificioUnidireccional } from "../../validacion/c4/modelos.ts";
import { alambrico } from "./alambrico.ts";
import { aristasDe, formaSeccion, huellaPilarSolido, huellasInglete, LADO_SIN_FORMA, piezasSolido, recortarBanda, solido, tramosDe, volumen, type CompiladoSolido, type PiezaSolida } from "./solido.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const leer = (r: string): ModeloFisico => JSON.parse(readFileSync(join(RAIZ, r), "utf8")).modelo;

/** Un modelo con lo raro: todas las formas de sección, vigas por el borde de la losa, por un hueco y a medias fuera, reticular con un ábaco que se sale, muros con quiebros, huecos y cerrados, y un apoyo. No compila (no hace falta). */
export function piezasRaras(): ModeloFisico {
  return {
    plantas: [
      { id: "N2", altura: null },
      { id: "N1", altura: 3.5 },
      { id: "N0", altura: 3 },
    ],
    materiales: [
      { id: "HA", tipo: "hormigon", fck: 25 },
      { id: "S275", tipo: "acero" },
      { id: "G", tipo: "general", E: 3e7, G: 1.2e7, peso: 20 },
    ],
    secciones: [
      { id: "r3050", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "c40", material: "HA", forma: "circular", D: 0.4 },
      { id: "ipe", material: "S275", forma: "I", perfil: { A: 53.8, Iy: 8356, Iz: 604, It: 20.1, h: 300, b: 150, tf: 10.7, tw: 7.1 } },
      { id: "t", material: "HA", forma: "T", bf: 0.6, hf: 0.1, bw: 0.25, h: 0.5 },
      { id: "gbh", material: "G", forma: "general", A: 0.1, Iy: 1e-3, Iz: 1e-3, J: 1e-3, b: 0.25, h: 0.4 },
      { id: "gx", material: "G", forma: "general", A: 0.02, Iy: 1e-4, Iz: 1e-4, J: 1e-4 },
    ],
    pilares: [
      { id: "P1", x: 0, y: 0, desde: "N0", hasta: "N2", seccion: "r3050" },
      { id: "P2", x: 6, y: 0, desde: "N0", hasta: "N2", seccion: "c40", giro: 30 },
      { id: "P3", x: 6, y: 5, desde: "N0", hasta: "N2", seccion: "ipe", giro: 90, tramos: [{ planta: "N2", seccion: "r3050" }] },
      { id: "P4", x: 0, y: 5, desde: "N0", hasta: "N2", seccion: "t", giro: 30 },
      { id: "P5", x: 3, y: 2.5, desde: "N0", hasta: "N1", seccion: "gbh" },
      { id: "P6", x: 9, y: 2.5, desde: "N0", hasta: "N2", seccion: "gx" },
    ],
    losas: [
      { id: "L1", planta: "N1", contorno: [[0, 0], [6, 0], [6, 5], [0, 5]], huecos: [[[2, 2], [3.5, 2], [3.5, 3.2], [2, 3.2]]], espesor: 0.25, material: "HA", eje1: 30 },
      {
        id: "L2",
        planta: "N2",
        contorno: [[0, 0], [6, 0], [6, 5], [0, 5]],
        espesor: 0.3,
        material: "HA",
        reticular: { intereje: 0.8, nervio: 0.12, capa: 0.05, caseton: "recuperable", abacos: [[[-1, -1], [1, -1], [1, 1], [-1, 1]], [[5, 4], [7, 4], [7, 6], [5, 6]]] },
      },
    ],
    vigas: [
      { id: "V1", planta: "N1", puntos: [[0, 0], [6, 0]], seccion: "r3050" },
      { id: "V2", planta: "N1", puntos: [[0, 2.6], [4, 2.6], [5, 4]], seccion: "r3050" },
      { id: "V3", planta: "N1", puntos: [[6, 0], [6, 5]], seccion: "ipe" },
      { id: "V4", planta: "N1", puntos: [[-2, 1], [3, 1]], seccion: "t" },
      { id: "V5", planta: "N1", puntos: [[1, 4], [1, -1]], seccion: "gbh" },
      { id: "V6", planta: "N1", puntos: [[7, 0], [9, 0]], seccion: "gx" },
      { id: "V7", planta: "N2", puntos: [[0, 2.5], [6, 2.5]], seccion: "r3050" },
    ],
    muros: [
      {
        id: "M1",
        puntos: [[-3, 0], [-3, 5], [-1, 5]],
        desde: "N0",
        hasta: "N2",
        espesor: 0.25,
        material: "HA",
        huecos: [
          { desde: 1, hasta: 2.5, z0: 0.5, z1: 2.5 },
          { desde: 5.5, hasta: 6.5, z0: 3.6, z1: 6 },
        ],
      },
      { id: "M2", puntos: [[10, 0], [12, 0], [12, 2], [10, 2], [10, 0]], desde: "N0", hasta: "N1", espesor: 0.2, material: "HA" },
      { id: "M3", puntos: [[0, 5], [6, 5]], desde: "N0", hasta: "N1", espesor: 0.3, material: "HA" },
    ],
    apoyos: [{ id: "A1", planta: "N0", x: 9, y: 5, coartados: [true, true, true, false, false, false] }],
    casos: [{ id: "G", pesoPropio: true }],
  };
}

const MODELOS: [string, () => ModeloFisico][] = [
  ["piezas raras", piezasRaras],
  ["ejemplo", () => leer(".claude/skills/fem/ejemplo.json")],
  ["1022", () => leer("validacion/a2/agente/1022/proyecto.json")],
  ["nucleo", () => leer("validacion/a2/agente/nucleo/proyecto.json")],
  ["edificio", () => leer("validacion/a2/agente/edificio/proyecto.json")],
  ["vivienda (reticular con casetón perdido)", () => leer("ejemplos/vivienda/proyecto.json")],
  ["reticulaConNucleo", reticulaConNucleo],
  ["edificio con muros (C3)", () => edificioObjetivoMuros(2, 4, 3)],
  ["reticular (C4)", () => edificioReticular(2, 4, 3)],
  ["unidireccional (C4)", () => edificioUnidireccional(2, 4, 3)],
  ...FAMILIAS.map((x): [string, () => ModeloFisico] => [`${x} (G)`, () => edificioGeometria(x, { hueco: true, circulares: x === "circular" })]),
];

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));

/** Lo que tapa una planta (como el sólido): losas con su espesor y paños con el canto de su vigueta. */
function tapasDe(f: ModeloFisico, planta: string): { region: Region; e: number }[] {
  const r: { region: Region; e: number }[] = [];
  for (const l of f.losas ?? []) if (l.planta === planta) r.push({ region: { contorno: l.contorno, huecos: l.huecos ?? [] }, e: l.espesor });
  for (const p of f.panos ?? []) {
    if (p.planta !== planta) continue;
    const s = f.secciones.find((x) => x.id === p.seccion);
    const fs = s ? formaSeccion(s) : null;
    if (fs && !fs.sinForma) r.push({ region: { contorno: p.contorno, huecos: p.huecos ?? [] }, e: fs.h });
  }
  return r;
}

const areaPol = (p: readonly Vec2[]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * a[1], 0)) / 2;

/** Área de la sección que se dibuja: la de sus datos, o b·h en una general (5 cm × 5 cm sin forma). */
function areaDibujada(s: Seccion): number {
  switch (s.forma) {
    case "rectangular":
      return s.b * s.h;
    case "circular":
      return (Math.PI * s.D * s.D) / 4;
    case "I":
      return s.perfil.A * 1e-4;
    case "T":
      return s.bf * s.hf + s.bw * (s.h - s.hf);
    case "general":
      return s.b !== undefined && s.h !== undefined ? s.b * s.h : LADO_SIN_FORMA ** 2;
  }
}

interface Esperado {
  /** Lo que mide la pieza sin quitarle nada (A·L, e·A, t·(L·H − huecos)). */
  nominal: number;
  /** Lo que le quita la losa (lo que no se dibuja dos veces). */
  quitado: number;
}

/** El volumen que tiene que tener cada pieza, de sus datos y sin el dibujo. Null: no se comprueba exacto (reticular, apoyo). */
function esperado(f: ModeloFisico, p: PiezaSolida, compilado: CompiladoSolido | null, conTapas: ModeloFisico = f): Esperado | null {
  const cotas = cotasPlantas(f.plantas);
  const k = p.planta;
  const planta = f.plantas[k]!.id;
  const tapas = tapasDe(conTapas, planta);
  const sec = (id: string) => f.secciones.find((x) => x.id === id)!;
  if (p.tipo === "pilar") {
    const x = f.pilares!.find((y) => y.id === p.id)!;
    const s = sec(p.seccion!);
    const H = cotas[k]! - cotas[k + 1]!;
    const huella = huellaPilarSolido(x, formaSeccion(s)!.poligono);
    expect(rel(areaPol(huella), areaDibujada(s))).toBeLessThan(1e-10);
    return { nominal: areaDibujada(s) * H, quitado: tapas.reduce((t, x) => t + momentosInterseccion(x.region, huella).A * x.e, 0) };
  }
  if (p.tipo === "viga") {
    const v = f.vigas!.find((y) => y.id === p.id)!;
    const s = sec(v.seccion);
    const fs = formaSeccion(s)!;
    const tr = tramosDe(v.puntos);
    const L = tr.reduce((t, x) => t + x.L, 0);
    let quitado = 0;
    if (s.forma === "rectangular" || s.forma === "general") {
      const hs = huellasInglete(tr, fs.b, false);
      for (const h of hs) for (const x of tapas) quitado += momentosInterseccion(x.region, h).A * Math.min(fs.h, x.e);
    } else {
      const S = fs.poligono.map(([a, u]) => [a, u - fs.h / 2] as Vec2);
      for (const t of tr)
        for (const x of tapas) {
          const fuera = recortarBanda(S, -Infinity, -x.e);
          quitado += (areaDibujada(s) - (fuera.length ? areaPol(fuera) : 0)) * t.L * fraccionEnRegiones(t.A, t.B, [x.region]);
        }
    }
    return { nominal: areaDibujada(s) * L, quitado };
  }
  if (p.tipo === "losa") {
    const l = f.losas!.find((y) => y.id === p.id)!;
    return l.reticular ? null : { nominal: l.espesor * areaRegion(l), quitado: 0 };
  }
  if (p.tipo === "pano") {
    const x = f.panos!.find((y) => y.id === p.id)!;
    const s = sec(x.seccion);
    if (!compilado) return { nominal: formaSeccion(s)!.h * areaRegion(x), quitado: 0 };
    let L = 0;
    // El macizo: la región menos lo que cubre la banda de un intereje de cada vigueta (no se solapan)
    let cubierta = 0;
    const region = { contorno: x.contorno, huecos: x.huecos ?? [] };
    for (const id of compilado.mapeo.panos![x.id]!) {
      // La banda va centrada en el eje del tramo flexible (con los offsets), de apoyo a apoyo
      const ns: Vec2[] = [];
      const ext: Vec2[] = [];
      for (const b of compilado.mapeo.piezas[id]!) {
        const br = compilado.modelo.barras![b]!;
        const [n0, n1] = br.nudos.map((n) => compilado.modelo.nudos[n]!);
        const [oi, oj] = [br.offsets?.i ?? [0, 0, 0], br.offsets?.j ?? [0, 0, 0]];
        L += Math.hypot(n1!.x - n0!.x, n1!.y - n0!.y);
        ns.push([n0!.x, n0!.y], [n1!.x, n1!.y]);
        ext.push([n0!.x + oi[0], n0!.y + oi[1]], [n1!.x + oj[0], n1!.y + oj[1]]);
      }
      ns.push(...ext);
      const [a, c] = [ext[0]!, ext[ext.length - 1]!];
      const Lv = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const u: Vec2 = [(c[0] - a[0]) / Lv, (c[1] - a[1]) / Lv];
      const ss = ns.map((q) => (q[0] - a[0]) * u[0] + (q[1] - a[1]) * u[1]);
      const [s0, s1] = [Math.min(...ss), Math.max(...ss)];
      const w: Vec2 = [(-u[1] * x.intereje) / 2, (u[0] * x.intereje) / 2];
      const P = (t: number, sg: number): Vec2 => [a[0] + t * u[0] + sg * w[0], a[1] + t * u[1] + sg * w[1]];
      cubierta += momentosInterseccion(region, [P(s0, -1), P(s1, -1), P(s1, 1), P(s0, 1)]).A;
    }
    const macizo = formaSeccion(s)!.h * (areaRegion(x) - cubierta);
    return { nominal: areaDibujada(s) * L + macizo, quitado: 0 };
  }
  if (p.tipo === "muro") {
    const m = f.muros!.find((y) => y.id === p.id)!;
    const tr = tramosDe(m.puntos);
    const L = tr.reduce((t, x) => t + x.L, 0);
    const zb = cotas[f.plantas.findIndex((x) => x.id === m.desde)]!;
    const [z0, z1] = [cotas[k + 1]! - zb, cotas[k]! - zb];
    const huecos = (m.huecos ?? []).reduce((s, h) => s + (h.hasta - h.desde) * Math.max(0, Math.min(z1, h.z1) - Math.max(z0, h.z0)), 0);
    const u = m.puntos[m.puntos.length - 1]!;
    const hs = huellasInglete(tr, m.espesor, m.puntos.length > 2 && u[0] === m.puntos[0]![0] && u[1] === m.puntos[0]![1]);
    for (const h of hs) expect(rel(areaPol(h), m.espesor * tr[hs.indexOf(h)]!.L)).toBeLessThan(1e-10);
    // Un hueco que llega a la cabeza bajo la losa: lo que quita la losa allí ya no está (no pasa en estos modelos)
    return { nominal: m.espesor * (L * (z1 - z0) - huecos), quitado: hs.reduce((t, h) => t + tapas.reduce((s, x) => s + momentosInterseccion(x.region, h).A * x.e, 0), 0) };
  }
  return null;
}

describe.each(MODELOS)("I3: el sólido de %s", (_nombre, modelo) => {
  const f = modelo();
  const c = compilar(f);
  const comp = c.valido ? c : null;
  const { piezas } = piezasSolido(f, comp);

  it("cada pieza es cerrada, con la normal hacia fuera", () => {
    expect(piezas.length).toBeGreaterThan(0);
    for (const p of piezas) {
      const v0 = volumen(p.caras);
      const v1 = volumen(p.caras, [123.4, -56.7, 89.1]);
      expect(v0, `${p.id} en ${p.planta}`).toBeGreaterThan(0);
      expect(Math.abs(v0 - v1), `${p.id} en ${p.planta}: abierta`).toBeLessThan(1e-9 * Math.max(1, v0));
    }
  });

  it("el volumen de cada pieza es el de sus datos menos lo que tapa la losa", () => {
    let n = 0;
    for (const p of piezas) {
      const e = esperado(f, p, comp);
      if (!e) continue;
      n++;
      expect(rel(volumen(p.caras), e.nominal - e.quitado), `${p.tipo} ${p.id} en ${f.plantas[p.planta]!.id}`).toBeLessThan(1e-9);
    }
    expect(n).toBeGreaterThan(0);
  });

  it("el reticular, macizo menos sus casetones: dentro de la losa, fuera de los ábacos y las huellas, sin zuncho, y el perdido con su cara inferior", () => {
    const cotas = cotasPlantas(f.plantas);
    let n = 0;
    for (const l of f.losas ?? []) {
      const ret = l.reticular;
      if (!ret) continue;
      const p = piezas.find((x) => x.id === l.id)!;
      const zc = cotas[f.plantas.findIndex((x) => x.id === l.planta)]!;
      const hueco = (z: number) => p.caras.filter((c) => Math.abs(c.p[0]![2] - z) < 1e-9 && c.p.every((q) => Math.abs(q[2] - z) < 1e-9));
      const area = (c: { p: number[][] }) => Math.abs(areaConSigno(c.p.map((q) => [q[0]!, q[1]!] as Vec2)));
      // El techo de los huecos de los casetones, bajo la capa
      const techos = hueco(zc - ret.capa).filter((c) => areaConSigno(c.p.map((q) => [q[0]!, q[1]!] as Vec2)) < 0);
      const Ac = techos.reduce((t, c) => t + area(c), 0);
      const A = areaRegion(l);
      expect(rel(volumen(p.caras), l.espesor * A - (l.espesor - ret.capa) * Ac), l.id).toBeLessThan(1e-9);
      expect(Ac / A, `${l.id}: aligerado`).toBeGreaterThan(0.2);
      const R = { contorno: l.contorno, huecos: l.huecos ?? [] } as Region;
      const reg = [l.contorno, ...(l.huecos ?? [])] as Vec2[][];
      const pilares = (f.pilares ?? []).filter((x) => x.hasta === l.planta).map((x) => [x.x, x.y] as Vec2);
      let alBorde = false;
      for (const c of techos) {
        const q = c.p.map((v) => [v[0]!, v[1]!] as Vec2);
        const m: Vec2 = [q.reduce((t, v) => t + v[0], 0) / q.length, q.reduce((t, v) => t + v[1], 0) / q.length];
        expect(puntoEnRegion(m, R), `${l.id}: casetón fuera de la losa`).toBe(true);
        for (const ab of (ret.abacos ?? []) as Vec2[][]) expect(puntoEnPoligono(m, ab), `${l.id}: casetón en un ábaco`).toBe(false);
        for (const p of pilares) expect(Math.hypot(m[0] - p[0], m[1] - p[1]), `${l.id}: casetón en un pilar`).toBeGreaterThan(0.05);
        if (q.some((v) => Math.min(...reg.map((r) => distanciaABorde(v, r))) < 1e-9)) alBorde = true;
      }
      // Sin zuncho en el modelo, ninguno en el dibujo: donde el borde no lleva viga, los casetones llegan a él
      const conViga = (f.vigas ?? []).some((v) => v.planta === l.planta);
      if (!conViga) expect(alBorde, `${l.id}: borde macizo sin viga`).toBe(true);
      // Casetón perdido: su cara inferior cubre los huecos, en la cara inferior de la losa y mirando abajo
      const perdido = (ret.caseton ?? "perdido") === "perdido";
      const cs = p.casetones ?? [];
      expect(cs.length > 0, l.id).toBe(perdido);
      if (perdido) {
        expect(rel(cs.reduce((t, c) => t + area(c), 0), Ac)).toBeLessThan(1e-9);
        for (const c of cs) {
          expect(c.p.every((q) => Math.abs(q[2] - (zc - l.espesor)) < 1e-9)).toBe(true);
          expect(areaConSigno(c.p.map((q) => [q[0], q[1]] as Vec2))).toBeLessThan(0);
        }
      }
      n++;
    }
    if (f.losas?.some((l) => l.reticular)) expect(n).toBeGreaterThan(0);
  });

  it("por planta, Σ γ·V más lo que no se repite es el peso propio esperado de A3; lo que se quita a las vigas es su solape (C2-g)", () => {
    // A3 sobre la geometría dibujada: las generales con b·h, las losas macizas sin pp y sin reticulares ni paños (su peso es su pp)
    const g: ModeloFisico = {
      ...f,
      secciones: f.secciones.map((s) => (s.forma === "general" ? { ...s, A: areaDibujada(s) } : s)),
      losas: (f.losas ?? []).filter((l) => !l.reticular).map(({ pp: _pp, ...l }) => l),
      panos: [],
    };
    const P = new Plantas(g);
    const a3 = pesoPropioEsperado(g, P);
    const gamma = (p: PiezaSolida) => {
      const id = p.tipo === "losa" ? g.losas!.find((x) => x.id === p.id)?.material : p.tipo === "muro" ? f.muros!.find((x) => x.id === p.id)!.material : p.seccion ? f.secciones.find((x) => x.id === p.seccion)!.material : null;
      const m = f.materiales.find((x) => x.id === id);
      return m ? gammaMaterial(m) : 0;
    };
    for (const [k, x] of a3.entries()) {
      const suma = { pilares: 0, vigas: 0, losas: 0, muros: 0, quitadoVigas: 0 };
      for (const p of piezas) {
        if (p.planta !== k || p.tipo === "pano" || p.tipo === "apoyo") continue;
        if (p.tipo === "losa" && !g.losas!.some((l) => l.id === p.id)) continue;
        const e = esperado(f, p, comp)!;
        const w = gamma(p);
        // Lo dibujado más lo que la losa le quita, por γ
        const bruto = (volumen(p.caras) + e.quitado) * w;
        if (p.tipo === "pilar") suma.pilares += bruto;
        else if (p.tipo === "viga") {
          suma.vigas += bruto;
          const s = f.secciones.find((y) => y.id === p.seccion)!;
          if (s.forma === "rectangular" && f.materiales.find((y) => y.id === s.material)!.tipo === "hormigon") suma.quitadoVigas += esperado(f, p, comp, g)!.quitado * w;
        } else if (p.tipo === "losa") suma.losas += bruto;
        else if (p.tipo === "muro") suma.muros += bruto;
      }
      const que = `planta ${x.planta}`;
      for (const t of ["pilares", "vigas", "losas", "muros"] as const) expect(Math.abs(suma[t] - x[t]), `${que}: ${t}`).toBeLessThan(1e-9 * Math.max(1, x[t]));
      // Sin muros, los solapes de A3 son sólo los de C2-g. A3 los mide con la huella a escuadra de cada tramo, y el dibujo une los quiebros a inglete
      const quiebros = (f.vigas ?? []).some((v) => v.planta === x.planta && v.puntos.length > 2);
      if (!(f.muros ?? []).length) expect(Math.abs(suma.quitadoVigas - x.solapes), `${que}: solapes`).toBeLessThan((quiebros ? 5e-3 : 1e-9) * Math.max(1, x.solapes));
    }
  });

  it("los búferes son los de las piezas, respecto al origen del alámbrico, y no dependen del orden de las listas", () => {
    const o = alambrico(f).origen;
    const s = solido(f, o, comp);
    const nt = piezas.reduce((t, p) => t + [...p.caras, ...(p.casetones ?? [])].reduce((u, x) => u + x.p.length - 2, 0), 0);
    expect(s.triangulos.length).toBe(9 * nt);
    expect(s.objeto.length).toBe(nt);
    expect(s.origen).toEqual(o);
    expect(s.caseton.length).toBe(nt);
    // Cada triángulo, de su objeto y su planta, y los de los casetones marcados
    let t = 0;
    for (const p of piezas)
      for (const [k, x] of [...p.caras, ...(p.casetones ?? [])].entries())
        for (let i = 1; i < x.p.length - 1; i++, t++) {
          expect(s.objetos[s.objeto[t]!]!.id).toBe(p.id);
          expect(s.planta[t]).toBe(p.planta);
          expect(s.caseton[t]).toBe(k < p.caras.length ? 0 : 1);
          const v = [x.p[0]!, x.p[i]!, x.p[i + 1]!];
          for (let j = 0; j < 3; j++) for (let a = 0; a < 3; a++) expect(s.triangulos[9 * t + 3 * j + a]).toBe(Math.fround(v[j]![a]! - o[a]!));
        }
    // Al revés las listas, los mismos búferes
    const r: ModeloFisico = { ...f, pilares: [...(f.pilares ?? [])].reverse(), vigas: [...(f.vigas ?? [])].reverse(), losas: [...(f.losas ?? [])].reverse(), muros: [...(f.muros ?? [])].reverse(), panos: [...(f.panos ?? [])].reverse(), secciones: [...f.secciones].reverse() };
    const s2 = solido(r, o, comp);
    expect(s2.triangulos).toEqual(s.triangulos);
    expect(s2.caseton).toEqual(s.caseton);
    expect(s2.aristas).toEqual(s.aristas);
  });
});

describe("I3: las aristas", () => {
  const caja = (b: number, h: number, H: number): PiezaSolida["caras"] => {
    const f: ModeloFisico = {
      plantas: [
        { id: "A", altura: null },
        { id: "B", altura: H },
      ],
      materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
      secciones: [{ id: "s", material: "HA", forma: "rectangular", b, h }],
      pilares: [{ id: "P", x: 0, y: 0, desde: "B", hasta: "A", seccion: "s" }],
      casos: [],
    };
    return piezasSolido(f).piezas[0]!.caras;
  };
  const longitud = (xs: ReturnType<typeof aristasDe>) => xs.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), 0);

  it("un prisma rectangular: sus 12 aristas", () => {
    const a = aristasDe(caja(0.3, 0.5, 3));
    expect(a.length).toBe(12);
    expect(longitud(a)).toBeCloseTo(4 * (0.3 + 0.5 + 3), 12);
  });

  it("un pilar circular: sólo las dos tapas (los lados del polígono son suaves)", () => {
    const f: ModeloFisico = {
      plantas: [
        { id: "A", altura: null },
        { id: "B", altura: 3 },
      ],
      materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
      secciones: [{ id: "c", material: "HA", forma: "circular", D: 0.4 }],
      pilares: [{ id: "P", x: 0, y: 0, desde: "B", hasta: "A", seccion: "c" }],
      casos: [],
    };
    const a = aristasDe(piezasSolido(f).piezas[0]!.caras);
    expect(a.length).toBe(64);
    expect(a.every(([u, v]) => Math.abs(u[2] - v[2]) < 1e-12)).toBe(true);
  });

  it("una viga bajo una losa: el descuelgue, con su escalón donde acaba la losa", () => {
    const f = piezasRaras();
    const v1 = piezasSolido(f).piezas.find((x) => x.id === "V1")!;
    // V1 va por el borde de la losa: media huella con el canto entero y media con el descuelgue
    const z = new Set(aristasDe(v1.caras).flatMap(([a, b]) => [a[2], b[2]].map((x) => x.toFixed(6))));
    expect([...z].sort()).toEqual(["2.500000", "2.750000", "3.000000"]);
  });
});

describe("I3: las viguetas de un paño", () => {
  it("la que pasa por la huella de un pilar se dibuja en su eje (el offset), no en el del pilar", () => {
    // Muestrario, cubierta: la vigueta de x = 11,9 cruza P3, P7 y P11 (x = 12) y cuelga de sus nudos
    // con un offset de −0,10 m. Antes salía en x = 12, a 0,6 y 0,8 m de sus vecinas.
    const f = leer("ejemplos/muestrario/proyecto.json");
    const c = compilar(f);
    expect(c.valido).toBe(true);
    if (!c.valido) return;
    const ids = c.mapeo.panos!.F1!;
    const ejes = ids.map((id) => {
      const b = c.modelo.barras![c.mapeo.piezas[id]![0]!]!;
      return c.modelo.nudos[b.nudos[0]!]!.x + (b.offsets?.i?.[0] ?? 0);
    });
    expect(ejes.some((x) => Math.abs(x - 11.9) < 1e-9)).toBe(true);
    const F1 = piezasSolido(f, c).piezas.find((p) => p.id === "F1")!;
    const xs = new Set(F1.caras.flatMap((k) => k.p.map((v) => Math.round(v[0] * 1e6))));
    // Las caras del alma (bw = 0,12) de cada vigueta, a su eje ± 0,06
    for (const x of ejes) for (const s of [-1, 1]) expect(xs.has(Math.round((x + s * 0.06) * 1e6)), `vigueta en ${x}`).toBe(true);
    expect(xs.has(Math.round(12.06 * 1e6))).toBe(false);
  });
});
