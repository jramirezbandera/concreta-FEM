/**
 * Modelos analíticos aleatorios (reproducibles por semilla) con todos los objetos del motor, para
 * las pruebas metamórficas de E6 (H38): no es código del motor.
 *
 * Cada modelo es un edificio irregular, estable por construcción:
 * - pilares (barras) continuos con secciones, ejes, Timoshenko, modificadores y offsets al azar;
 * - en la base, empotramiento, muelle a tierra (con ejes) o muelle entre nudos coincidentes contra
 *   un nudo empotrado;
 * - forjados de láminas en algunos vanos, con malla conforme por planta, nudos interiores movidos
 *   (cuadriláteros distorsionados), normal hacia arriba o hacia abajo, eje 1, multiplicadores y
 *   opciones de membrana al azar;
 * - vigas entre cabezas de pilar con liberaciones, offsets laterales y zonas rígidas;
 * - paños de muro de 2 × 2 láminas entre dos pilares;
 * - diafragma por planta (con maestro auxiliar o en una cabeza de pilar) y «huellas» de enlace
 *   rígido alrededor de las cabezas, encadenadas al diafragma;
 * - casos con cargas nodales, de barra (puntuales y distribuidas parciales, locales y globales), de
 *   lámina (superficie uniforme y por nudo, línea y puntual con momento) y desplazamientos impuestos
 *   en uz y rz (invariantes en un giro alrededor de Z).
 * Las propiedades se mueven en rangos de obra, para que el condicionamiento sea el de un edificio.
 */
import type { SeccionBarra } from "../elementos/barra.ts";
import type { MultiplicadoresLamina } from "../elementos/lamina.ts";
import type { CargaBarra, CargaLamina, CargaNodal, DesplazamientoImpuesto, ModeloAnalitico, Vec3 } from "../motor/modelo.ts";
import { Constructor, EMPOTRADO, seccionRectangular, seccionRectangularTimoshenko } from "./constructor.ts";
import { longitudesFlexibles, matrizGiro } from "./transformar.ts";

/** Generador mulberry32: números en [0, 1) reproducibles. */
export function generador(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ModeloAleatorio {
  modelo: ModeloAnalitico;
  /** ¿Tiene diafragmas? (sólo admite giros alrededor de Z). */
  diafragmas: boolean;
  /** ¿Tiene desplazamientos impuestos? (sólo en uz y rz). */
  impuestos: boolean;
  /** Nudos que admiten cualquier carga nodal (no son maestros auxiliares ni están coartados). */
  cargables: number[];
}

export function modeloAleatorio(semilla: number): ModeloAleatorio {
  const r = generador(semilla);
  const entre = (a: number, b: number) => a + (b - a) * r();
  const entero = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const si = (p: number) => r() < p;
  const elegir = <T>(l: readonly T[]) => l[Math.floor(r() * l.length)]!;
  const m = new Constructor();

  const nx = entero(2, 3);
  const ny = entero(2, 3);
  const plantas = entero(1, 3);
  const xs = [0];
  for (let i = 1; i < nx; i++) xs.push(xs[i - 1]! + entre(3, 6));
  const ys = [0];
  for (let j = 1; j < ny; j++) ys.push(ys[j - 1]! + entre(3, 6));
  const zs = [0];
  for (let k = 1; k <= plantas; k++) zs.push(zs[k - 1]! + entre(2.8, 4));
  const E = entre(2.5e7, 3.5e7);
  const nu = entre(0.15, 0.25);
  const seccion = (b: number, h: number): SeccionBarra => (si(0.5) ? seccionRectangularTimoshenko(b, h, E, nu) : seccionRectangular(b, h, E, nu));
  const horizontal = (): Vec3 => {
    const a = entre(0, 2 * Math.PI);
    return [Math.cos(a), Math.sin(a), 0];
  };
  const auxiliares = new Set<number>();
  const coartados = new Set<number>();
  const apoyosEmpotrados: number[] = [];

  // Pilares: cabezas[k][i][j] es el nudo del pilar (i, j) en la cota zs[k]
  const cabezas: number[][][] = [];
  for (let k = 0; k <= plantas; k++) {
    cabezas.push([]);
    for (let i = 0; i < nx; i++) {
      cabezas[k]!.push([]);
      for (let j = 0; j < ny; j++) cabezas[k]![i]!.push(m.nudo(xs[i]!, ys[j]!, zs[k]!, `P${i}${j}-${k}`));
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const pie = cabezas[0]![i]![j]!;
      const tipo = r();
      if (tipo < 0.5) {
        m.apoyo(pie, EMPOTRADO);
        coartados.add(pie);
        apoyosEmpotrados.push(pie);
      } else if (tipo < 0.75) {
        const k = [entre(1e6, 1e7), entre(1e6, 1e7), entre(1e6, 1e7), entre(1e5, 1e6), entre(1e5, 1e6), entre(1e5, 1e6)];
        m.muelle([pie], k, si(0.5) ? matrizGiro([entre(-1, 1), entre(-1, 1), entre(0.2, 1)], entre(-2, 2)) : undefined);
      } else {
        // muelle entre nudos coincidentes contra un nudo empotrado: k = Aᵀ·A + diagonal, simétrica y definida
        const fijo = m.nudo(xs[i]!, ys[j]!, 0, `F${i}${j}`);
        m.apoyo(fijo, EMPOTRADO);
        coartados.add(fijo);
        apoyosEmpotrados.push(fijo);
        const A = Array.from({ length: 36 }, () => entre(-1, 1));
        const escala = [1e6, 1e6, 1e6, 1e5, 1e5, 1e5];
        const k: number[] = [];
        for (let a = 0; a < 6; a++) {
          for (let b = 0; b < 6; b++) {
            let s = a === b ? 3 : 0;
            for (let c = 0; c < 6; c++) s += A[6 * c + a]! * A[6 * c + b]!;
            k.push(s * Math.sqrt(escala[a]! * escala[b]!));
          }
        }
        m.muelle([fijo, pie], k, si(0.5) ? matrizGiro([entre(-1, 1), entre(-1, 1), entre(-1, 1)], entre(-2, 2)) : undefined);
      }
      for (let k = 1; k <= plantas; k++) {
        const b = entre(0.25, 0.5);
        const h = entre(0.25, 0.6);
        const offsets = si(0.3) ? { j: [0, 0, -entre(0.15, 0.35)] as Vec3 } : si(0.15) ? { i: [0.04, -0.03, 0] as Vec3, j: [0.04, -0.03, 0] as Vec3 } : undefined;
        const modificadores = si(0.3) ? { A: 2, J: 0.3 } : undefined;
        m.barra(cabezas[k - 1]![i]![j]!, cabezas[k]![i]![j]!, seccion(b, h), horizontal(), { offsets, modificadores });
      }
    }
  }

  // Plantas: forjado de láminas, vigas, muros, huellas y diafragma
  const laminasCargables: number[] = [];
  const nudosMuro = new Map<string, number>();
  const restringidos = new Set<number>(); // esclavos de huellas
  for (let k = 1; k <= plantas; k++) {
    const z = zs[k]!;
    const divX = xs.slice(1).map(() => entero(1, 3));
    const divY = ys.slice(1).map(() => entero(1, 3));
    const gx: number[] = [];
    const colP: number[] = [];
    xs.forEach((x, i) => {
      colP.push(gx.length);
      if (i < nx - 1) for (let s = 0; s < divX[i]!; s++) gx.push(x + ((xs[i + 1]! - x) * s) / divX[i]!);
      else gx.push(x);
    });
    const gy: number[] = [];
    const colQ: number[] = [];
    ys.forEach((y, j) => {
      colQ.push(gy.length);
      if (j < ny - 1) for (let s = 0; s < divY[j]!; s++) gy.push(y + ((ys[j + 1]! - y) * s) / divY[j]!);
      else gy.push(y);
    });
    const rejilla = new Map<string, number>();
    const nudoRejilla = (p: number, q: number): number => {
      const i = colP.indexOf(p);
      const j = colQ.indexOf(q);
      if (i >= 0 && j >= 0) return cabezas[k]![i]![j]!;
      const clave = `${p},${q}`;
      let v = rejilla.get(clave);
      if (v === undefined) {
        // movido hasta un 12 % de las separaciones vecinas: cuadriláteros distorsionados pero convexos
        const dx = Math.min(gx[p]! - (gx[p - 1] ?? -Infinity), (gx[p + 1] ?? Infinity) - gx[p]!);
        const dy = Math.min(gy[q]! - (gy[q - 1] ?? -Infinity), (gy[q + 1] ?? Infinity) - gy[q]!);
        rejilla.set(clave, (v = m.nudo(gx[p]! + entre(-0.12, 0.12) * dx, gy[q]! + entre(-0.12, 0.12) * dy, z, `S${p}.${q}-${k}`)));
      }
      return v;
    };
    const mat = { E, nu, t: entre(0.15, 0.35) };
    for (let i = 0; i < nx - 1; i++) {
      for (let j = 0; j < ny - 1; j++) {
        if (!si(0.6)) continue;
        const multiplicadores: MultiplicadoresLamina | undefined = si(0.4)
          ? { f11: entre(0.3, 1), f22: entre(0.3, 1), f12: entre(0.3, 1), m11: entre(0.2, 1), m22: entre(0.2, 1), m12: entre(0.1, 1), v13: entre(0.2, 1), v23: entre(0.2, 1) }
          : undefined;
        const eje1 = si(0.6) ? horizontal() : undefined;
        const membrana = si(0.2) ? { gamma: entre(0.3, 1.5) } : undefined;
        const arriba = si(0.6);
        for (let p = colP[i]!; p < colP[i + 1]!; p++) {
          for (let q = colQ[j]!; q < colQ[j + 1]!; q++) {
            const n: [number, number, number, number] = [nudoRejilla(p, q), nudoRejilla(p + 1, q), nudoRejilla(p + 1, q + 1), nudoRejilla(p, q + 1)];
            laminasCargables.push(m.lamina(arriba ? n : [n[0], n[3], n[2], n[1]], mat, { eje1, multiplicadores, membrana }));
          }
        }
      }
    }
    // Vigas entre cabezas
    const viga = (a: number, b: number, dir: Vec3) => {
      const des = si(0.3) ? -entre(0.1, 0.25) : 0;
      const zona = si(0.3) ? entre(0.1, 0.2) : 0;
      const offsets = des || zona ? { i: [zona * dir[0], zona * dir[1], des] as Vec3, j: [-zona * dir[0], -zona * dir[1], des] as Vec3 } : undefined;
      const lib = si(0.3) ? elegir([[false, false, false, false, true, false], [false, false, false, false, true, true], [false, false, false, true, false, false]] as const) : undefined;
      const liberaciones = lib ? (si(0.5) ? { i: lib } : { j: lib }) : undefined;
      const vz: Vec3 = si(0.7) ? [0, 0, 1] : [entre(-0.2, 0.2), entre(-0.2, 0.2), 1];
      m.barra(a, b, seccion(entre(0.25, 0.4), entre(0.4, 0.7)), vz, { offsets, liberaciones });
    };
    for (let i = 0; i < nx - 1; i++) for (let j = 0; j < ny; j++) if (si(0.6)) viga(cabezas[k]![i]![j]!, cabezas[k]![i + 1]![j]!, [1, 0, 0]);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny - 1; j++) if (si(0.6)) viga(cabezas[k]![i]![j]!, cabezas[k]![i]![j + 1]!, [0, 1, 0]);
    // Paño de muro de 2 × 2 entre dos pilares de una línea de X
    if (si(0.35)) {
      const i = entero(0, nx - 2);
      const j = entero(0, ny - 1);
      const [x0, x1, y, z0, z1] = [xs[i]!, xs[i + 1]!, ys[j]!, zs[k - 1]!, z];
      const w: number[][] = [];
      for (let a = 0; a <= 2; a++) {
        w.push([]);
        for (let b = 0; b <= 2; b++) {
          const esquina = (a === 0 || a === 2) && (b === 0 || b === 2);
          if (esquina) w[a]!.push(cabezas[b === 0 ? k - 1 : k]![a === 0 ? i : i + 1]![j]!);
          else {
            // el nudo central del borde de un muro de la planta de abajo se comparte
            const clave = `${i},${j},${k - 1 + b / 2},${a}`;
            const previo = nudosMuro.get(clave);
            if (previo !== undefined) {
              w[a]!.push(previo);
              continue;
            }
            const v = m.nudo(x0 + ((x1 - x0) * a) / 2, y, z0 + ((z1 - z0) * b) / 2, `W${i}${j}-${k}.${a}${b}`);
            nudosMuro.set(clave, v);
            if (k === 1 && b === 0) {
              m.apoyo(v, EMPOTRADO);
              coartados.add(v);
              apoyosEmpotrados.push(v);
            }
            w[a]!.push(v);
          }
        }
      }
      const matMuro = { E, nu, t: entre(0.2, 0.3) };
      const eje1 = si(0.5) ? ([0, 0, 1] as Vec3) : undefined;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) laminasCargables.push(m.lamina([w[a]![b]!, w[a + 1]![b]!, w[a + 1]![b + 1]!, w[a]![b + 1]!], matMuro, { eje1 }));
    }
    // Huellas: enlace rígido de la cabeza con los nudos de forjado cercanos
    const radio = 0.45 * Math.min(...xs.slice(1).map((x, i) => x - xs[i]!), ...ys.slice(1).map((y, j) => y - ys[j]!));
    const libres = [...rejilla.values()];
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        if (!si(0.4)) continue;
        const c = cabezas[k]![i]![j]!;
        const cerca = libres.filter((v) => !restringidos.has(v) && Math.hypot(m.nudos[v]!.x - xs[i]!, m.nudos[v]!.y - ys[j]!) < radio);
        if (!cerca.length) continue;
        m.enlace(c, cerca);
        for (const v of cerca) restringidos.add(v);
      }
    }
  }

  // Diafragmas por planta (con los nudos a esa cota que no son esclavos de una huella)
  let diafragmas = false;
  for (let k = 1; k <= plantas; k++) {
    if (!si(0.5)) continue;
    diafragmas = true;
    const z = zs[k]!;
    let maestro: number;
    if (si(0.5)) {
      maestro = m.nudo(entre(0, xs[nx - 1]!), entre(0, ys[ny - 1]!), z, `CM${k}`);
      auxiliares.add(maestro);
    } else maestro = cabezas[k]![entero(0, nx - 1)]![entero(0, ny - 1)]!;
    const esclavos = m.nudos.map((_, i) => i).filter((v) => v !== maestro && !restringidos.has(v) && Math.abs(m.nudos[v]!.z - z) < 1e-9);
    m.diafragma(maestro, esclavos);
  }

  // Casos
  const cargables = m.nudos.map((_, i) => i).filter((v) => !auxiliares.has(v) && !coartados.has(v));
  const Lf = longitudesFlexibles(m.modelo());
  const vec = (a: number): Vec3 => [entre(-a, a), entre(-a, a), entre(-a, a)];
  const puntoEn = (l: number): Vec3 => {
    const [xi, eta] = [entre(-0.8, 0.8), entre(-0.8, 0.8)];
    const N = [(1 - xi) * (1 - eta), (1 + xi) * (1 - eta), (1 + xi) * (1 + eta), (1 - xi) * (1 + eta)].map((n) => n / 4);
    const p = [0, 0, 0];
    m.laminas[l]!.nudos.forEach((v, a) => {
      p[0] += N[a]! * m.nudos[v]!.x;
      p[1] += N[a]! * m.nudos[v]!.y;
      p[2] += N[a]! * m.nudos[v]!.z;
    });
    return p as unknown as Vec3;
  };
  let impuestos = false;
  const ncasos = entero(2, 4);
  for (let c = 0; c < ncasos; c++) {
    const nodales: CargaNodal[] = Array.from({ length: entero(1, 4) }, () => ({ nudo: elegir(cargables), f: [...vec(50), ...vec(20)] as unknown as CargaNodal["f"] }));
    if (auxiliares.size && si(0.5)) nodales.push({ nudo: elegir([...auxiliares]), f: [entre(-30, 30), entre(-30, 30), 0, 0, 0, entre(-10, 10)] });
    const barras: CargaBarra[] = [];
    for (let n = entero(0, 4); n > 0; n--) {
      const b = entero(0, m.barras.length - 1);
      const L = Lf[b]!;
      const ejes = si(0.5) ? "local" : "global";
      if (si(0.4)) barras.push({ tipo: "puntual", barra: b, ejes, x: entre(0, L), F: vec(30), M: si(0.5) ? vec(10) : undefined });
      else {
        const [a, bb] = si(0.5) ? [undefined, undefined] : [entre(0, 0.4) * L, entre(0.6, 1) * L];
        barras.push({ tipo: "distribuida", barra: b, ejes, qa: vec(10), qb: si(0.5) ? vec(10) : undefined, a, b: bb });
      }
    }
    const laminas: CargaLamina[] = [];
    if (laminasCargables.length) {
      for (let n = entero(0, 5); n > 0; n--) {
        const l = elegir(laminasCargables);
        const ejes = si(0.5) ? "local" : "global";
        const t = r();
        if (t < 0.4) laminas.push({ tipo: "superficie", lamina: l, ejes, q: si(0.5) ? vec(8) : ([vec(8), vec(8), vec(8), vec(8)] as const) });
        else if (t < 0.7) laminas.push({ tipo: "linea", lamina: l, ejes, a: puntoEn(l), b: puntoEn(l), qa: vec(10), qb: si(0.5) ? vec(10) : undefined });
        else laminas.push({ tipo: "puntual", lamina: l, ejes, punto: puntoEn(l), F: vec(20), M: si(0.5) ? vec(5) : undefined });
      }
    }
    const imp: DesplazamientoImpuesto[] = [];
    if (apoyosEmpotrados.length && si(0.25)) {
      impuestos = true;
      imp.push({ nudo: elegir(apoyosEmpotrados), gdl: si(0.5) ? 2 : 5, valor: entre(-2e-3, 2e-3) });
    }
    m.caso(`C${c}`, nodales, imp, barras, laminas);
  }
  return { modelo: m.modelo(), diafragmas, impuestos, cargables };
}
