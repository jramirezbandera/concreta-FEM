/**
 * Muros del ejemplo 15 de ETABS (H48, S5 #1 y #18) con las láminas del motor.
 *
 * Fuente: CSI, «Software Verification — ETABS, Example 15: Wall object behavior – static lateral
 * loads analysis», rev. 2, pp. 15-1 a 15-12 (https://docs.csiamerica.com/manuals/etabs/Verification/
 * Analysis/Example%2015.pdf, leído el 2026-10-04). E = 3000 ksi, ν = 0,2; plantas de 120 in; 100 k
 * en la cabeza (las figuras 15-1 a 15-6 lo dan: la «carga de 100 k inferida» de S5 #18 queda
 * confirmada). La referencia es SAP2000 con mallas finas (pp. 15-8 a 15-11): código contra código.
 * El diafragma de cada planta se modeló en SAP2000 igualando el desplazamiento lateral de todos los
 * nudos de la planta (muros planos) o con «barras rígidas en el plano del forjado» (muros 3D); aquí,
 * con el diafragma rígido del motor, que en los muros planos es lo mismo.
 *
 * Los pies de las figuras 15-8 y 15-9 están cambiados: la malla del 15c (con huecos) es la de la
 * figura 15-8 y la del 15b (sobre pilares), la de la 15-9.
 *
 * Geometría (in), con el origen en el «global reference point» de cada figura:
 * - 15a: muro plano de longitud L (120, 360, 720) y 1, 3 o 6 plantas, t = 12.
 * - 15b: muro de 280 (x ∈ [−20, 260]) en las plantas 2 y 3, t = 12, sobre dos pilares de 40 × 20
 *   (x ∈ [−20, 20] y [220, 260]) en la planta 1; los pilares van como láminas de t = 20.
 * - 15c: dos machones (x ∈ [0, 240] y [240 + Lb, 360 + Lb]) unidos por dinteles de 40 de canto en lo
 *   alto de cada planta (hueco de 80), con Lb = 60 o 240, 3 o 6 plantas, t = 12.
 * - 15d: núcleo en C de t = 6: C1 (−140, −120), C2 (−140, −80), C3 (−60, 0), C4 (60, 0),
 *   C5 (140, −80) y C6 (140, −120); carga en (0, 0) en X o en Y.
 * - 15e: muro de 240 (x ∈ [−15, 225]) con extremos de 30 × 18 y alma de t = 8.
 * - 15f: muro en E de t = 6: alma de C1 (−120, 0) a C3 (120, 0) y alas de 120 hacia −Y en
 *   x = −120, 0 y 120; carga en C2 = (0, 0) en X o en Y.
 */
import type { MaterialLamina } from "../../src/elementos/dkmq.ts";
import { calcular, type OpcionesCalculo } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { carga, Constructor, EMPOTRADO } from "../../src/pruebas/constructor.ts";
import { IN, KIP } from "./csi.ts";

const E = (3000 * KIP) / IN ** 2;
const NU = 0.2;
const PLANTA = 120;
const P = 100 * KIP;

/** Paño rectangular vertical entre dos puntos de planta (in), de z0 a z1, con espesor t (in). */
interface Pano {
  p0: readonly [number, number];
  p1: readonly [number, number];
  z0: number;
  z1: number;
  t: number;
}

export interface MuroEtabs {
  /** Nombre corto: 15a-6-120, 15d-6… */
  id: string;
  panos: Pano[];
  plantas: number;
  /** Punto de planta del maestro del diafragma y de la carga (in). */
  carga: readonly [number, number];
  /** Direcciones cargadas: un caso por dirección. */
  direcciones: ("X" | "Y")[];
  /** Divisor de la malla: el lado del elemento tiene que dividir a todas las cotas de la geometría. */
  h: (nivel: number) => number;
  /** Resultados de SAP2000 y de ETABS de la tabla del PDF (in y rad), con la clave del resultado. */
  sap: Record<string, number>;
  etabs: Record<string, number>;
  pagina: string;
  /** Tramo en x (in) de los dinteles (15c): sus nudos de planta pueden quedar fuera del diafragma. */
  dinteles?: readonly [number, number];
  /**
   * Cómo se modeló de verdad en SAP2000 (E6-2), deducido de sus figuras y de que el motor reproduce
   * sus cifras: la malla (lado en in), si el diafragma tomaba los nudos de los dinteles y si los muros
   * eran sólo membrana.
   */
  modeladoSap: OpcionesMuro & { h: number };
}

export interface OpcionesMuro {
  /** El diafragma de cada planta toma también los nudos de los dinteles que están en la planta. Por defecto, sí. */
  diafragmaEnDinteles?: boolean;
  /** Muros sólo de membrana: la flexión de placa se multiplica por 1e-6. Por defecto, no. */
  soloMembrana?: boolean;
}

const muro = (x0: number, x1: number, z0: number, z1: number, t: number): Pano => ({ p0: [x0, 0], p1: [x1, 0], z0, z1, t });

/** Los muros del ejemplo 15 con su tabla de resultados (pp. 15-11 y 15-12). */
export function murosEtabs15(): MuroEtabs[] {
  const lista: MuroEtabs[] = [];
  // 15a (tabla 15-1): mallas de 20, 10 y 5 in
  const tabla1: Record<number, Record<number, [number, number]>> = {
    6: { 120: [2.3921, 2.4287], 360: [0.0986, 0.1031], 720: [0.0172, 0.0186] },
    3: { 120: [0.3071, 0.3205], 360: [0.017, 0.0187], 720: [0.0046, 0.0052] },
    1: { 120: [0.0145, 0.0185], 360: [0.0025, 0.0029], 720: [0.0011, 0.0013] },
  };
  for (const n of [6, 3, 1]) {
    for (const L of [120, 360, 720]) {
      const [et, sap] = tabla1[n]![L]!;
      lista.push({
        id: `15a-${n}-${L}`,
        panos: [muro(0, L, 0, PLANTA * n, 12)],
        plantas: n,
        carga: [0, 0],
        direcciones: ["X"],
        h: (k) => [20, 10, 5][k]!,
        sap: { X: sap },
        etabs: { X: et },
        pagina: "tabla 15-1, p. 15-11",
        modeladoSap: { h: 10 },
      });
    }
  }
  // 15b (tabla 15-2): mallas de 10, 5 y 2,5 in
  lista.push({
    id: "15b",
    panos: [muro(-20, 20, 0, 120, 20), muro(220, 260, 0, 120, 20), muro(-20, 260, 120, 360, 12)],
    plantas: 3,
    carga: [-20, 0],
    direcciones: ["X"],
    h: (k) => [10, 5, 2.5][k]!,
    sap: { X: 0.0671, X2: 0.053, X1: 0.0412 },
    etabs: { X: 0.0691, X2: 0.0524, X1: 0.039 },
    pagina: "tabla 15-2, p. 15-11",
    // la malla de la figura 15-9 (2 elementos en el ancho de cada pilar)
    modeladoSap: { h: 20 },
  });
  // 15c (tabla 15-3): dinteles de 40 in y huecos de 80: mallas de 10, 5 y 2,5 in
  const tabla3: Record<number, Record<number, [number, number]>> = { 6: { 60: [0.0844, 0.0869], 240: [0.1456, 0.1505] }, 3: { 60: [0.0188, 0.02], 240: [0.0313, 0.0332] } };
  for (const n of [6, 3]) {
    for (const Lb of [60, 240]) {
      const panos = [muro(0, 240, 0, PLANTA * n, 12), muro(240 + Lb, 360 + Lb, 0, PLANTA * n, 12)];
      for (let k = 0; k < n; k++) panos.push(muro(240, 240 + Lb, PLANTA * k + 80, PLANTA * (k + 1), 12));
      const [et, sap] = tabla3[n]![Lb]!;
      lista.push({
        id: `15c-${n}-${Lb}`,
        panos,
        plantas: n,
        carga: [0, 0],
        direcciones: ["X"],
        h: (k) => [10, 5, 2.5][k]!,
        sap: { X: sap },
        etabs: { X: et },
        pagina: "tabla 15-3, p. 15-12",
        dinteles: [240, 240 + Lb],
        // la malla de la figura 15-8 y el diafragma sólo en los machones
        modeladoSap: { h: 20, diafragmaEnDinteles: false },
      });
    }
  }
  // 15d (tabla 15-4): núcleo en C, t = 6; mallas de 20, 10 y 5 in
  const C: [number, number][] = [[-140, -120], [-140, -80], [-60, 0], [60, 0], [140, -80], [140, -120]];
  const tabla4: Record<number, [Record<string, number>, Record<string, number>]> = {
    6: [{ X: 0.8637, RZ: 0.0185, Y: 1.1447 }, { X: 0.8936, RZ: 0.0191, Y: 1.1882 }],
    3: [{ X: 0.1249, RZ: 0.0024, Y: 0.1623 }, { X: 0.1337, RZ: 0.0025, Y: 0.1733 }],
  };
  for (const n of [6, 3]) {
    lista.push({
      id: `15d-${n}`,
      panos: C.slice(1).map((p1, i) => ({ p0: C[i]!, p1, z0: 0, z1: PLANTA * n, t: 6 })),
      plantas: n,
      carga: [0, 0],
      direcciones: ["X", "Y"],
      h: (k) => [20, 10, 5][k]!,
      sap: tabla4[n]![1],
      etabs: tabla4[n]![0],
      pagina: "tabla 15-4, p. 15-12",
      // muros sólo de membrana: sin la torsión de Saint-Venant de la flexión de placa
      modeladoSap: { h: 10, soloMembrana: true },
    });
  }
  // 15e (tabla 15-5): extremos de 30 × 18 y alma de 8; mallas de 15, 7,5 y 3,75 in
  const tabla5: Record<number, [number, number]> = { 6: [0.2822, 0.2899], 3: [0.0464, 0.048] };
  for (const n of [6, 3]) {
    const H = PLANTA * n;
    lista.push({
      id: `15e-${n}`,
      panos: [muro(-15, 15, 0, H, 18), muro(15, 195, 0, H, 8), muro(195, 225, 0, H, 18)],
      plantas: n,
      carga: [-15, 0],
      direcciones: ["X"],
      h: (k) => [15, 7.5, 3.75][k]!,
      sap: { X: tabla5[n]![1] },
      etabs: { X: tabla5[n]![0] },
      pagina: "tabla 15-5, p. 15-12",
      modeladoSap: { h: 7.5 },
    });
  }
  // 15f (tabla 15-6): muro en E, t = 6; mallas de 20, 10 y 5 in
  const tabla6: Record<number, [Record<string, number>, Record<string, number>]> = {
    6: [{ X: 0.3707, RZ: 0.0042, Y: 0.7295 }, { X: 0.3655, RZ: 0.0039, Y: 0.749 }],
    3: [{ X: 0.0602, RZ: 0.0005, Y: 0.0993 }, { X: 0.0628, RZ: 0.0005, Y: 0.1058 }],
  };
  for (const n of [6, 3]) {
    const H = PLANTA * n;
    lista.push({
      id: `15f-${n}`,
      panos: [
        { p0: [-120, 0], p1: [0, 0], z0: 0, z1: H, t: 6 },
        { p0: [0, 0], p1: [120, 0], z0: 0, z1: H, t: 6 },
        { p0: [-120, 0], p1: [-120, -120], z0: 0, z1: H, t: 6 },
        { p0: [0, 0], p1: [0, -120], z0: 0, z1: H, t: 6 },
        { p0: [120, 0], p1: [120, -120], z0: 0, z1: H, t: 6 },
      ],
      plantas: n,
      carga: [0, 0],
      direcciones: ["X", "Y"],
      h: (k) => [20, 10, 5][k]!,
      sap: tabla6[n]![1],
      etabs: tabla6[n]![0],
      pagina: "tabla 15-6, p. 15-12",
      modeladoSap: { h: 10 },
    });
  }
  return lista;
}

export interface ModeloMuro {
  modelo: ModeloAnalitico;
  /** Maestro del diafragma de cada planta (índice 0 = planta 1). */
  maestros: number[];
  laminas: number;
}

/** Modelo del muro con elementos de lado ≤ h (in): la geometría del PDF o, con `op`, otro modelado. */
export function modeloMuro(m: MuroEtabs, h: number, op: OpcionesMuro = {}): ModeloMuro {
  const c = new Constructor();
  const nudos = new Map<string, number>();
  const clave = (x: number, y: number, z: number) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
  const nudo = (x: number, y: number, z: number) => {
    const k = clave(x, y, z);
    let v = nudos.get(k);
    if (v === undefined) nudos.set(k, (v = c.nudo(x * IN, y * IN, z * IN, `(${x},${y},${z})`)));
    return v;
  };
  const flexion = op.soloMembrana ? { multiplicadores: { m11: 1e-6, m22: 1e-6, m12: 1e-6 } } : {};
  let laminas = 0;
  for (const p of m.panos) {
    const L = Math.hypot(p.p1[0] - p.p0[0], p.p1[1] - p.p0[1]);
    const nh = Math.max(1, Math.round(L / h));
    const nv = Math.round((p.z1 - p.z0) / h);
    if (Math.abs(nv * h - (p.z1 - p.z0)) > 1e-9) throw new Error(`h = ${h} no divide la altura del paño`);
    const mat: MaterialLamina = { E, nu: NU, t: p.t * IN };
    const punto = (i: number, j: number) => {
      const s = i / nh;
      return nudo(p.p0[0] + s * (p.p1[0] - p.p0[0]), p.p0[1] + s * (p.p1[1] - p.p0[1]), p.z0 + (j * (p.z1 - p.z0)) / nv);
    };
    for (let i = 0; i < nh; i++) {
      for (let j = 0; j < nv; j++) {
        c.lamina([punto(i, j), punto(i + 1, j), punto(i + 1, j + 1), punto(i, j + 1)], mat, flexion);
        laminas++;
      }
    }
  }
  // Base empotrada y un diafragma por planta, con el maestro en el punto de la carga
  const porCota = new Map<number, number[]>();
  c.nudos.forEach((v, i) => {
    const z = Math.round(v.z / IN);
    if (Math.abs(v.z / IN - z) < 1e-6 && z % PLANTA === 0) {
      let l = porCota.get(z);
      if (!l) porCota.set(z, (l = []));
      l.push(i);
    }
  });
  for (const v of porCota.get(0) ?? []) c.apoyo(v, EMPOTRADO);
  const enDintel = (v: number) => {
    if (op.diafragmaEnDinteles !== false || !m.dinteles) return false;
    const x = c.nudos[v]!.x / IN;
    return x > m.dinteles[0] + 1e-6 && x < m.dinteles[1] - 1e-6;
  };
  const maestros: number[] = [];
  for (let k = 1; k <= m.plantas; k++) {
    const z = PLANTA * k;
    const maestro = nudos.get(clave(m.carga[0], m.carga[1], z)) ?? c.nudo(m.carga[0] * IN, m.carga[1] * IN, z * IN, `M${k}`);
    c.diafragma(maestro, porCota.get(z)!.filter((v) => v !== maestro && !enDintel(v)), `D${k}`);
    maestros.push(maestro);
  }
  const cabeza = maestros[maestros.length - 1]!;
  for (const d of m.direcciones) c.caso(d, [carga(cabeza, d === "X" ? { fx: P } : { fy: P })]);
  return { modelo: c.modelo(), maestros, laminas };
}

/** Resultados del muro en in y rad, con las claves de `sap` (X, RZ, Y y, en el 15b, X2 y X1). */
export function resultadosMuro(m: MuroEtabs, h: number, op: OpcionesMuro = {}, opciones: OpcionesCalculo = {}): Record<string, number> & { nudos: number; laminas: number } {
  const { modelo, maestros, laminas } = modeloMuro(m, h, op);
  return { ...lecturas(m, maestros, casosValidos(calcular(modelo, opciones)).map((c) => c.u)), nudos: modelo.nudos.length, laminas };
}

/** Lee del vector u de cada caso las magnitudes de la tabla del PDF (in y rad). */
export function lecturas(m: MuroEtabs, maestros: readonly number[], u: readonly ArrayLike<number>[]): Record<string, number> {
  const cabeza = maestros[maestros.length - 1]!;
  const r: Record<string, number> = {};
  m.direcciones.forEach((d, k) => {
    const v = u[k]!;
    if (d === "X") {
      r.X = v[6 * cabeza]! / IN;
      if (m.direcciones.length > 1) r.RZ = v[6 * cabeza + 5]!;
      if (m.id === "15b") {
        r.X2 = v[6 * maestros[1]!]! / IN;
        r.X1 = v[6 * maestros[0]!]! / IN;
      }
    } else r.Y = v[6 * cabeza + 1]! / IN;
  });
  return r;
}

/** Extrapolación de Richardson con el orden observado (mallas h, h/2, h/4). */
export function richardson(v1: number, v2: number, v3: number): { valor: number; orden: number } {
  const orden = Math.log2((v2 - v1) / (v3 - v2));
  if (!Number.isFinite(orden) || orden <= 0.3) return { valor: v3, orden };
  return { valor: v3 + (v3 - v2) / (2 ** orden - 1), orden };
}
