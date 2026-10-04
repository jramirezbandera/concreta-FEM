/**
 * Relaciones metamórficas del compilador (criterio 3 de C1): cada una transforma un modelo físico,
 * compila y calcula los dos y devuelve el error medido de lo que le tiene que pasar al resultado.
 * Las usan `src/compilador/metamorficas.test.ts` (con sus tolerancias) y
 * `validacion/c1/resumen.ts` (para dar los valores). No es código del compilador.
 */
import { compilar, type ResultadoCompilacion } from "../compilador/compilar.ts";
import type { CargaFisica, ModeloFisico, Vec2, Viga } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import type { ModeloAnalitico, ResultadoCaso, Vec3 } from "../motor/modelo.ts";
import { casosValidos } from "./comparar.ts";
import { azar, longitudPolilinea, puntoEnPolilinea } from "./fisicoAleatorio.ts";

type Valido = Extract<ResultadoCompilacion, { valido: true }>;

export function valido(r: ResultadoCompilacion): Valido {
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  return r;
}

const resolver = (m: ModeloAnalitico) => casosValidos(calcular(m, { solver: "perfil" }));
const identidad = (q: readonly number[]): Vec3 => [q[0]!, q[1]!, q[2]!];

/** Transformación de la planta: puntos, vectores globales (giro alrededor de Z) y giro de los pilares. */
export interface Plano {
  p: (q: Vec2) => Vec2;
  v: (q: readonly number[]) => Vec3;
  giro: number;
}

/**
 * Transforma la planta de un modelo físico. Los apoyos sólo se trasladan o giran de sitio: sus
 * coacciones globales no se giran (vale para apoyos simétricos en ux, uy).
 */
export function transformar(f: ModeloFisico, t: Plano): ModeloFisico {
  const v3 = (q?: readonly number[]) => (q ? t.v(q) : undefined);
  const g: ModeloFisico = {
    ...f,
    pilares: f.pilares?.map((p) => {
      const [x, y] = t.p([p.x, p.y]);
      return { ...p, x, y, giro: (p.giro ?? 0) + t.giro };
    }),
    vigas: f.vigas?.map((v) => ({ ...v, puntos: v.puntos.map(t.p) })),
    apoyos: f.apoyos?.map((a) => {
      const [x, y] = t.p([a.x, a.y]);
      return { ...a, x, y };
    }),
    losas: f.losas?.map((l) => ({ ...l, contorno: l.contorno.map(t.p), huecos: l.huecos?.map((h) => h.map(t.p)), eje1: (l.eje1 ?? 0) + t.giro })),
    apoyosLineales: f.apoyosLineales?.map((a) => ({ ...a, puntos: a.puntos.map(t.p) })),
    bandas: f.bandas?.map((b) => ({ ...b, desde: t.p(b.desde), hasta: t.p(b.hasta) })),
    cargas: f.cargas?.map((c): CargaFisica => {
      if (c.tipo === "puntual") {
        const [x, y] = t.p([c.x, c.y]);
        return { ...c, x, y, F: v3(c.F), M: v3(c.M) };
      }
      if (c.tipo === "superficie") return { ...c, q: t.v(c.q), zona: c.zona?.map(t.p) };
      if (c.tipo === "lineal") return { ...c, q: t.v(c.q), puntos: c.puntos.map(t.p) };
      return c.ejes === "global" ? { ...c, q: t.v(c.q), qb: v3(c.qb) } : c;
    }),
  };
  for (const k of ["pilares", "vigas", "apoyos", "losas", "apoyosLineales", "bandas", "cargas"] as const) if (g[k] === undefined) delete g[k];
  return g;
}

/** Traslación, giro exacto de 90° y giro de 37°. */
export function planos(): { nombre: string; t: Plano }[] {
  const th = (37 * Math.PI) / 180;
  const [c, s] = [Math.cos(th), Math.sin(th)];
  return [
    { nombre: "traslación", t: { p: (q) => [q[0] + 123.4, q[1] - 56.7], v: identidad, giro: 0 } },
    { nombre: "giro de 90°", t: { p: (q) => [-q[1], q[0]], v: (q) => [-q[1]!, q[0]!, q[2]!], giro: 90 } },
    { nombre: "giro de 37°", t: { p: (q) => [c * q[0] - s * q[1], s * q[0] + c * q[1]], v: (q) => [c * q[0]! - s * q[1]!, s * q[0]! + c * q[1]!, q[2]!], giro: 37 } },
  ];
}

/** Empareja los nudos con barras de A con los de B por posición transformada (a `tol`). */
export function emparejar(a: ModeloAnalitico, b: ModeloAnalitico, p: (q: Vec2) => Vec2, tol = 1e-6): Map<number, number> {
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
export function errorNudos(ra: ResultadoCaso[], rb: ResultadoCaso[], pares: Map<number, number>, v: (q: readonly number[]) => Vec3, campo: "u" | "reacciones"): number {
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

/**
 * Peor error relativo de los esfuerzos de extremo de las barras emparejadas por sus nudos. Con
 * `invertidas`, las barras de B van de j a i: se comparan con los extremos cruzados y el signo de
 * Vz y Mz cambiado (el resto, igual en el mismo punto). `soloVigas` deja fuera los pilares.
 */
export function errorBarras(a: Valido, b: Valido, ra: ResultadoCaso[], rb: ResultadoCaso[], pares: Map<number, number>, invertidas = false): number {
  const idx = new Map<string, number>();
  b.modelo.barras!.forEach((x, k) => idx.set(`${x.nudos[0]}-${x.nudos[1]}`, k));
  const signo = invertidas ? [1, 1, -1, 1, 1, -1] : [1, 1, 1, 1, 1, 1];
  let peor = 0;
  ra.forEach((ca, c) => {
    const dif = [0, 0];
    const ref = [0, 0];
    a.modelo.barras!.forEach((x, k) => {
      const inv = invertidas && a.mapeo.barras[k]!.tipo === "viga";
      const clave = inv ? `${pares.get(x.nudos[1])}-${pares.get(x.nudos[0])}` : `${pares.get(x.nudos[0])}-${pares.get(x.nudos[1])}`;
      const kb = idx.get(clave);
      if (kb === undefined) throw new Error(`la barra ${x.id} no tiene pareja`);
      for (let e = 0; e < 12; e++) {
        const g = e % 6 < 3 ? 0 : 1;
        const eb = inv ? (e < 6 ? e + 6 : e - 6) : e;
        const s = inv ? signo[e % 6]! : 1;
        dif[g] = Math.max(dif[g]!, Math.abs(s * ca.esfuerzosBarras[12 * k + e]! - rb[c]!.esfuerzosBarras[12 * kb + eb]!));
        ref[g] = Math.max(ref[g]!, Math.abs(rb[c]!.esfuerzosBarras[12 * kb + eb]!));
      }
    });
    for (const g of [0, 1]) peor = Math.max(peor, ref[g]! > 0 ? dif[g]! / ref[g]! : dif[g]!);
  });
  return peor;
}

export function barajar<T>(lista: readonly T[], r: () => number): T[] {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Relación 1: reordenar las listas. ¿Mismo modelo analítico, mapeo y diagnósticos, bit a bit? */
export function relacionOrden(f: ModeloFisico, semilla: number): boolean {
  const r = azar(1000 + semilla);
  const g: ModeloFisico = { ...f, materiales: barajar(f.materiales, r), secciones: barajar(f.secciones, r), pilares: barajar(f.pilares!, r), vigas: barajar(f.vigas!, r), cargas: barajar(f.cargas!, r) };
  const a = valido(compilar(f));
  const b = valido(compilar(g));
  return JSON.stringify(b.modelo) === JSON.stringify(a.modelo) && JSON.stringify(b.mapeo) === JSON.stringify(a.mapeo) && JSON.stringify(b.diagnosticos) === JSON.stringify(a.diagnosticos);
}

/** Relación 2: transformación de la planta. Errores de u, reacciones y esfuerzos transformados. */
export function relacionPlano(f: ModeloFisico, t: Plano): { u: number; reacciones: number; barras: number } {
  const a = valido(compilar(f));
  const b = valido(compilar(transformar(f, t)));
  if (b.modelo.barras!.length !== a.modelo.barras!.length) throw new Error("distinto número de barras");
  const [ra, rb] = [resolver(a.modelo), resolver(b.modelo)];
  const pares = emparejar(a.modelo, b.modelo, t.p);
  return { u: errorNudos(ra, rb, pares, t.v, "u"), reacciones: errorNudos(ra, rb, pares, t.v, "reacciones"), barras: errorBarras(a, b, ra, rb, pares) };
}

/** Relación 3: ruido de `amplitud` m en pilares y vigas. ¿Misma topología?, y error de u. */
export function relacionRuido(f: ModeloFisico, semilla: number, amplitud: number, soloVigas = false): { topologia: boolean; codigos: string[]; u: number } {
  const r = azar(2000 + semilla);
  const e = () => (2 * r() - 1) * amplitud;
  const g: ModeloFisico = {
    ...f,
    pilares: soloVigas ? f.pilares : f.pilares!.map((p) => ({ ...p, x: p.x + e(), y: p.y + e() })),
    vigas: f.vigas!.map((v) => ({ ...v, puntos: v.puntos.map((q) => [q[0] + e(), q[1] + e()] as Vec2) })),
  };
  const a = valido(compilar(f));
  const b = valido(compilar(g));
  const topologia = b.modelo.nudos.length === a.modelo.nudos.length && JSON.stringify(Object.values(b.mapeo.piezas).map((l) => l.length)) === JSON.stringify(Object.values(a.mapeo.piezas).map((l) => l.length));
  const pares = emparejar(a.modelo, b.modelo, (q) => q, 10 * amplitud + 1e-9);
  return { topologia, codigos: b.diagnosticos.map((d) => d.codigo), u: errorNudos(resolver(a.modelo), resolver(b.modelo), pares, identidad, "u") };
}

/** Relación 5: partir las vigas de un tramo por la mitad de su primer tramo flexible. Errores de u y reacciones. */
export function relacionPartirVigas(f: ModeloFisico): { u: number; reacciones: number; partidas: number } {
  const a = valido(compilar(f));
  const vigas: Viga[] = [];
  let cargas = [...f.cargas!];
  let partidas = 0;
  for (const v of f.vigas!) {
    if (v.puntos.length !== 2) {
      vigas.push(v);
      continue;
    }
    partidas++;
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
  const [ra, rb] = [resolver(a.modelo), resolver(b.modelo)];
  const pares = emparejar(a.modelo, b.modelo, (q) => q, 1e-9);
  return { u: errorNudos(ra, rb, pares, identidad, "u"), reacciones: errorNudos(ra, rb, pares, identidad, "reacciones"), partidas };
}

/** Relación 6: invertir el sentido de todas las vigas. Errores de u y de los esfuerzos de extremo. */
export function relacionInvertir(f: ModeloFisico): { u: number; barras: number } {
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
  const [ra, rb] = [resolver(a.modelo), resolver(b.modelo)];
  const pares = emparejar(a.modelo, b.modelo, (q) => q, 1e-9);
  return { u: errorNudos(ra, rb, pares, identidad, "u"), barras: errorBarras(a, b, ra, rb, pares, true) };
}

/** Relación 7: partir cada carga repartida de viga en dos (en el 37 % de su tramo). Error de u. */
export function relacionPartirCargas(f: ModeloFisico): number {
  const largo = new Map(f.vigas!.map((v) => [v.id, longitudPolilinea(v.puntos)] as const));
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
  return errorNudos(resolver(a.modelo), resolver(b.modelo), pares, identidad, "u");
}
