/**
 * Criterio 3 de C1: relaciones metamórficas del compilador sobre modelos físicos aleatorios
 * (`pruebas/fisicoAleatorio.ts`). Cada relación transforma el modelo físico y comprueba lo que le
 * tiene que pasar al resultado:
 * 1. reordenar las listas: el mismo modelo analítico, bit a bit;
 * 2. trasladar y girar la planta (90° exacto y un ángulo cualquiera): resultados transformados;
 * 3. un ruido menor que ε_geom: la misma topología y resultados a 1e-6;
 * 4. un ruido menor que ε_snap en las vigas: la misma topología, con avisos de fusión;
 * 5. partir una viga en dos colineales (sin diafragma): los mismos desplazamientos;
 * 6. invertir el sentido de las vigas: los mismos desplazamientos y los esfuerzos con el cambio
 *    de signo de Vz y Mz;
 * 7. partir una carga repartida en dos: el mismo resultado.
 */
import { describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import type { ModeloAnalitico, ResultadoCaso, Vec3 } from "../motor/modelo.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { azar, fisicoAleatorio, longitudPolilinea, puntoEnPolilinea } from "../pruebas/fisicoAleatorio.ts";
import { compilar, type ResultadoCompilacion } from "./compilar.ts";
import type { CargaFisica, ModeloFisico, Vec2, Viga } from "./fisico.ts";

const SEMILLAS = [1, 2, 5, 6, 9, 13, 14, 17, 21, 25, 29, 30];

function valido(r: ResultadoCompilacion) {
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  return r;
}
const resolver = (m: ModeloAnalitico) => casosValidos(calcular(m, { solver: "perfil" }));

/** Transformación de la planta: puntos, vectores globales (giro alrededor de Z) y giro de los pilares. */
interface Plano {
  p: (q: Vec2) => Vec2;
  v: (q: readonly number[]) => Vec3;
  giro: number;
}

function transformar(f: ModeloFisico, t: Plano): ModeloFisico {
  const v3 = (q?: readonly number[]) => (q ? t.v(q) : undefined);
  return {
    ...f,
    pilares: f.pilares!.map((p) => {
      const [x, y] = t.p([p.x, p.y]);
      return { ...p, x, y, giro: (p.giro ?? 0) + t.giro };
    }),
    vigas: f.vigas!.map((v) => ({ ...v, puntos: v.puntos.map(t.p) })),
    cargas: f.cargas!.map((c): CargaFisica => {
      if (c.tipo === "puntual") {
        const [x, y] = t.p([c.x, c.y]);
        return { ...c, x, y, F: v3(c.F), M: v3(c.M) };
      }
      return c.ejes === "global" ? { ...c, q: t.v(c.q), qb: v3(c.qb) } : c;
    }),
  };
}

/** Empareja los nudos con barras de A con los de B por posición transformada (a `tol`). */
function emparejar(a: ModeloAnalitico, b: ModeloAnalitico, p: (q: Vec2) => Vec2, tol = 1e-6): Map<number, number> {
  const conBarras = (m: ModeloAnalitico) => [...new Set((m.barras ?? []).flatMap((x) => [...x.nudos]))];
  const bs = conBarras(b);
  const r = new Map<number, number>();
  for (const i of conBarras(a)) {
    const n = a.nudos[i]!;
    const [x, y] = p([n.x, n.y]);
    const j = bs.find((k) => Math.abs(b.nudos[k]!.x - x) < tol && Math.abs(b.nudos[k]!.y - y) < tol && Math.abs(b.nudos[k]!.z - n.z) < tol);
    if (j === undefined) throw new Error(`el nudo ${n.id} no tiene pareja`);
    r.set(i, j);
  }
  return r;
}

/** Peor error relativo, por grupos de 3 (traslaciones y giros), de v(A) frente a B en los nudos emparejados. */
function errorNudos(ra: ResultadoCaso[], rb: ResultadoCaso[], pares: Map<number, number>, v: (q: readonly number[]) => Vec3, campo: "u" | "reacciones"): number {
  let peor = 0;
  ra.forEach((ca, c) => {
    for (const g of [0, 3]) {
      let dif = 0;
      let ref = 0;
      for (const [i, j] of pares) {
        const ta = v(Array.from(ca[campo].subarray(6 * i + g, 6 * i + g + 3)));
        for (let k = 0; k < 3; k++) {
          dif = Math.max(dif, Math.abs(ta[k]! - rb[c]![campo][6 * j + g + k]!));
          ref = Math.max(ref, Math.abs(rb[c]![campo][6 * j + g + k]!));
        }
      }
      peor = Math.max(peor, ref > 0 ? dif / ref : dif);
    }
  });
  return peor;
}

/** Peor error relativo de los esfuerzos de extremo de las barras emparejadas por sus nudos. */
function errorBarras(a: ModeloAnalitico, b: ModeloAnalitico, ra: ResultadoCaso[], rb: ResultadoCaso[], pares: Map<number, number>): number {
  const idx = new Map<string, number>();
  (b.barras ?? []).forEach((x, k) => idx.set(`${x.nudos[0]}-${x.nudos[1]}`, k));
  let peor = 0;
  ra.forEach((ca, c) => {
    let dif = [0, 0];
    let ref = [0, 0];
    (a.barras ?? []).forEach((x, k) => {
      const kb = idx.get(`${pares.get(x.nudos[0])}-${pares.get(x.nudos[1])}`);
      if (kb === undefined) throw new Error(`la barra ${x.id} no tiene pareja`);
      for (let e = 0; e < 12; e++) {
        const g = e % 6 < 3 ? 0 : 1;
        dif[g] = Math.max(dif[g]!, Math.abs(ca.esfuerzosBarras[12 * k + e]! - rb[c]!.esfuerzosBarras[12 * kb + e]!));
        ref[g] = Math.max(ref[g]!, Math.abs(rb[c]!.esfuerzosBarras[12 * kb + e]!));
      }
    });
    for (const g of [0, 1]) peor = Math.max(peor, ref[g]! > 0 ? dif[g]! / ref[g]! : dif[g]!);
    dif = [0, 0];
    ref = [0, 0];
  });
  return peor;
}

function barajar<T>(lista: readonly T[], r: () => number): T[] {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const identidad = (q: readonly number[]): Vec3 => [q[0]!, q[1]!, q[2]!];

describe("criterio 3 de C1: relaciones metamórficas del compilador", () => {
  it.each(SEMILLAS)("semilla %i: reordenar las listas da el mismo modelo analítico bit a bit", (s) => {
    const f = fisicoAleatorio(s);
    const r = azar(1000 + s);
    const g: ModeloFisico = {
      ...f,
      materiales: barajar(f.materiales, r),
      secciones: barajar(f.secciones, r),
      pilares: barajar(f.pilares!, r),
      vigas: barajar(f.vigas!, r),
      cargas: barajar(f.cargas!, r),
    };
    const a = valido(compilar(f));
    const b = valido(compilar(g));
    expect(JSON.stringify(b.modelo)).toBe(JSON.stringify(a.modelo));
    expect(JSON.stringify(b.mapeo)).toBe(JSON.stringify(a.mapeo));
    expect(b.diagnosticos).toEqual(a.diagnosticos);
  });

  it.each(SEMILLAS)("semilla %i: trasladar y girar la planta transforma los resultados (≤ 1e-9)", (s) => {
    for (const diafragma of [true, false]) {
      const f = fisicoAleatorio(s, { diafragma });
      const a = valido(compilar(f));
      const ra = resolver(a.modelo);
      const th = (37 * Math.PI) / 180;
      const [c, sn] = [Math.cos(th), Math.sin(th)];
      const planos: Plano[] = [
        { p: (q) => [q[0] + 123.4, q[1] - 56.7], v: identidad, giro: 0 },
        { p: (q) => [-q[1], q[0]], v: (q) => [-q[1]!, q[0]!, q[2]!], giro: 90 },
        { p: (q) => [c * q[0] - sn * q[1], sn * q[0] + c * q[1]], v: (q) => [c * q[0]! - sn * q[1]!, sn * q[0]! + c * q[1]!, q[2]!], giro: 37 },
      ];
      for (const t of planos) {
        const b = valido(compilar(transformar(f, t)));
        expect(b.modelo.barras!.length).toBe(a.modelo.barras!.length);
        const rb = resolver(b.modelo);
        const pares = emparejar(a.modelo, b.modelo, t.p);
        expect(errorNudos(ra, rb, pares, t.v, "u")).toBeLessThan(1e-9);
        expect(errorNudos(ra, rb, pares, t.v, "reacciones")).toBeLessThan(1e-9);
        expect(errorBarras(a.modelo, b.modelo, ra, rb, pares)).toBeLessThan(1e-9);
      }
    }
  });

  it.each(SEMILLAS)("semilla %i: un ruido de 1e-8 m (< ε_geom) no cambia la topología y los resultados quedan a 1e-6", (s) => {
    const f = fisicoAleatorio(s);
    const r = azar(2000 + s);
    const e = () => (2 * r() - 1) * 1e-8;
    const g: ModeloFisico = {
      ...f,
      pilares: f.pilares!.map((p) => ({ ...p, x: p.x + e(), y: p.y + e() })),
      vigas: f.vigas!.map((v) => ({ ...v, puntos: v.puntos.map((q) => [q[0] + e(), q[1] + e()] as Vec2) })),
    };
    const a = valido(compilar(f));
    const b = valido(compilar(g));
    expect(b.diagnosticos).toEqual(a.diagnosticos);
    expect(JSON.stringify(b.mapeo.piezas)).toBe(JSON.stringify(a.mapeo.piezas));
    const pares = emparejar(a.modelo, b.modelo, (q) => q, 1e-7);
    expect(errorNudos(resolver(a.modelo), resolver(b.modelo), pares, identidad, "u")).toBeLessThan(1e-6);
  });

  it.each(SEMILLAS)("semilla %i: un ruido de ±1,5 cm (< ε_snap) en las vigas da la misma topología, con avisos de fusión", (s) => {
    const f = fisicoAleatorio(s);
    const r = azar(3000 + s);
    const e = () => (2 * r() - 1) * 0.015;
    const g: ModeloFisico = { ...f, vigas: f.vigas!.map((v) => ({ ...v, puntos: v.puntos.map((q) => [q[0] + e(), q[1] + e()] as Vec2) })) };
    const a = valido(compilar(f));
    const b = valido(compilar(g));
    expect(b.modelo.nudos.length).toBe(a.modelo.nudos.length);
    expect(JSON.stringify(Object.values(b.mapeo.piezas).map((l) => l.length))).toBe(JSON.stringify(Object.values(a.mapeo.piezas).map((l) => l.length)));
    for (const d of b.diagnosticos) expect(["topologia/fusion"]).toContain(d.codigo);
    resolver(b.modelo);
  });

  it.each(SEMILLAS)("semilla %i: partir vigas en dos colineales (sin diafragma) no cambia los desplazamientos", (s) => {
    const f = fisicoAleatorio(s, { diafragma: false });
    const a = valido(compilar(f));
    // Parte las vigas de un solo tramo por la mitad de su primer tramo flexible
    const vigas: Viga[] = [];
    let cargas = [...f.cargas!];
    for (const v of f.vigas!) {
      if (v.puntos.length !== 2) {
        vigas.push(v);
        continue;
      }
      const ms = a.mapeo.barras[a.mapeo.piezas[v.id]![0]!]!.s;
      const sm = (ms[1] + ms[2]) / 2;
      const M = puntoEnPolilinea(v.puntos, sm);
      vigas.push({ ...v, id: `${v.id}a`, puntos: [v.puntos[0]!, M], liberaciones: v.liberaciones?.inicio ? { inicio: v.liberaciones.inicio } : undefined });
      vigas.push({ ...v, id: `${v.id}b`, puntos: [M, v.puntos[1]!], liberaciones: v.liberaciones?.fin ? { fin: v.liberaciones.fin } : undefined });
      const L = longitudPolilinea(v.puntos);
      cargas = cargas.flatMap((c): CargaFisica[] => {
        if (c.tipo !== "viga" || c.viga !== v.id) return [c];
        const [d, h] = [c.desde ?? 0, c.hasta ?? L];
        const q2 = c.qb ?? c.q;
        const qEn = (x: number): Vec3 => [0, 1, 2].map((k) => c.q[k]! + ((q2[k]! - c.q[k]!) * (x - d)) / (h - d)) as unknown as Vec3;
        const out: CargaFisica[] = [];
        if (d < sm) out.push({ ...c, id: `${c.id}a`, viga: `${v.id}a`, desde: d, hasta: Math.min(h, sm), q: qEn(d), qb: qEn(Math.min(h, sm)) });
        if (h > sm) out.push({ ...c, id: `${c.id}b`, viga: `${v.id}b`, desde: Math.max(d, sm) - sm, hasta: h - sm, q: qEn(Math.max(d, sm)), qb: qEn(h) });
        return out;
      });
    }
    const b = valido(compilar({ ...f, vigas, cargas }));
    expect(b.modelo.nudos.length).toBeGreaterThan(a.modelo.nudos.length);
    const ra = resolver(a.modelo);
    const rb = resolver(b.modelo);
    const pares = emparejar(a.modelo, b.modelo, (q) => q, 1e-9);
    expect(errorNudos(ra, rb, pares, identidad, "u")).toBeLessThan(1e-9);
    expect(errorNudos(ra, rb, pares, identidad, "reacciones")).toBeLessThan(1e-9);
  });

  it.each(SEMILLAS)("semilla %i: invertir el sentido de las vigas: mismos desplazamientos; Vz y Mz cambian de signo", (s) => {
    const f = fisicoAleatorio(s);
    const vigas = f.vigas!.map((v) => ({ ...v, puntos: [...v.puntos].reverse(), liberaciones: v.liberaciones ? { inicio: v.liberaciones.fin, fin: v.liberaciones.inicio } : undefined }));
    const largo = new Map(f.vigas!.map((v) => [v.id, longitudPolilinea(v.puntos)]));
    const cargas = f.cargas!.map((c): CargaFisica => {
      if (c.tipo !== "viga") return c;
      const L = largo.get(c.viga)!;
      const flip = (q: readonly number[]): Vec3 => (c.ejes === "local" ? [-q[0]!, -q[1]!, q[2]!] : [q[0]!, q[1]!, q[2]!]);
      return { ...c, q: flip(c.qb ?? c.q), qb: c.qb ? flip(c.q) : undefined, desde: c.hasta === undefined ? undefined : L - c.hasta, hasta: c.desde === undefined ? undefined : L - c.desde };
    });
    const a = valido(compilar(f));
    const b = valido(compilar({ ...f, vigas, cargas }));
    const ra = resolver(a.modelo);
    const rb = resolver(b.modelo);
    const pares = emparejar(a.modelo, b.modelo, (q) => q, 1e-9);
    expect(errorNudos(ra, rb, pares, identidad, "u")).toBeLessThan(1e-9);
    // Barras de viga: B va de j a i; en el mismo punto, N, Vy, T y My iguales, Vz y Mz con el signo cambiado
    const idx = new Map<string, number>();
    b.modelo.barras!.forEach((x, k) => idx.set(`${x.nudos[0]}-${x.nudos[1]}`, k));
    const signo = [1, 1, -1, 1, 1, -1];
    let dif = 0;
    let ref = 0;
    a.modelo.barras!.forEach((x, k) => {
      if (a.mapeo.barras[k]!.tipo !== "viga") return;
      const kb = idx.get(`${pares.get(x.nudos[1])}-${pares.get(x.nudos[0])}`)!;
      expect(kb).toBeDefined();
      ra.forEach((ca, c) => {
        for (let e = 0; e < 12; e++) {
          const eb = e < 6 ? e + 6 : e - 6;
          dif = Math.max(dif, Math.abs(signo[e % 6]! * ca.esfuerzosBarras[12 * k + e]! - rb[c]!.esfuerzosBarras[12 * kb + eb]!));
          ref = Math.max(ref, Math.abs(ca.esfuerzosBarras[12 * k + e]!));
        }
      });
    });
    expect(dif / ref).toBeLessThan(1e-9);
  });

  it.each(SEMILLAS)("semilla %i: partir cada carga repartida en dos da el mismo resultado", (s) => {
    const f = fisicoAleatorio(s);
    const largo = new Map([...f.vigas!.map((v) => [v.id, longitudPolilinea(v.puntos)] as const)]);
    const cargas = f.cargas!.flatMap((c): CargaFisica[] => {
      if (c.tipo !== "viga") return [c];
      const [d, h] = [c.desde ?? 0, c.hasta ?? largo.get(c.viga)!];
      const m = d + 0.37 * (h - d);
      const q2 = c.qb ?? c.q;
      const qm = [0, 1, 2].map((k) => c.q[k]! + 0.37 * (q2[k]! - c.q[k]!)) as unknown as Vec3;
      return [
        { ...c, id: `${c.id}a`, desde: d, hasta: m, qb: qm },
        { ...c, id: `${c.id}b`, desde: m, hasta: h, q: qm, qb: q2 },
      ];
    });
    const a = valido(compilar(f));
    const b = valido(compilar({ ...f, cargas }));
    const pares = emparejar(a.modelo, b.modelo, (q) => q, 1e-12);
    expect(errorNudos(resolver(a.modelo), resolver(b.modelo), pares, identidad, "u")).toBeLessThan(1e-12);
  });
});
