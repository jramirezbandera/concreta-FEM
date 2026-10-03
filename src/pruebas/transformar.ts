/**
 * Transformaciones de modelos para las pruebas metamórficas (H38): giro + traslación rígidos y
 * renumeración de nudos y elementos. No es código del motor.
 */
import type { ModeloAnalitico, Vec3 } from "../motor/modelo.ts";

/** Matriz de giro 3×3 por filas a partir de un eje (unitario) y un ángulo (Rodrigues). */
export function matrizGiro(eje: Vec3, angulo: number): number[] {
  const [x, y, z] = eje;
  const n = Math.hypot(x, y, z);
  const [a, b, c] = [x / n, y / n, z / n];
  const co = Math.cos(angulo);
  const s = Math.sin(angulo);
  const t = 1 - co;
  return [t * a * a + co, t * a * b - s * c, t * a * c + s * b, t * a * b + s * c, t * b * b + co, t * b * c - s * a, t * a * c - s * b, t * b * c + s * a, t * c * c + co];
}

export function girar(R: readonly number[], v: readonly number[]): [number, number, number] {
  return [0, 1, 2].map((i) => R[3 * i]! * v[0]! + R[3 * i + 1]! * v[1]! + R[3 * i + 2]! * v[2]!) as [number, number, number];
}

/** Gira cada terna (traslaciones y giros) de un vector de 6 por nudo. */
export function girarVector6(R: readonly number[], u: ArrayLike<number>): Float64Array {
  const r = new Float64Array(u.length);
  for (let b = 0; b < u.length; b += 3) r.set(girar(R, [u[b]!, u[b + 1]!, u[b + 2]!]), b);
  return r;
}

/**
 * Modelo girado con R y trasladado con t. Los apoyos tienen que ser invariantes (todas las
 * traslaciones y todos los giros iguales) y no se admiten desplazamientos impuestos salvo si R
 * deja quieto el GDL (lo comprueba quien lo usa). Un diafragma sólo admite giros alrededor de Z.
 */
export function girarModelo(m: ModeloAnalitico, R: readonly number[], t: Vec3): ModeloAnalitico {
  const RT = [R[0]!, R[3]!, R[6]!, R[1]!, R[4]!, R[7]!, R[2]!, R[5]!, R[8]!];
  const mul = (A: readonly number[], B: readonly number[]) =>
    [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => A[3 * i]! * B[j]! + A[3 * i + 1]! * B[3 + j]! + A[3 * i + 2]! * B[6 + j]!));
  return {
    ...m,
    nudos: m.nudos.map((v) => {
      const p = girar(R, [v.x, v.y, v.z]);
      return { id: v.id, x: p[0] + t[0], y: p[1] + t[1], z: p[2] + t[2] };
    }),
    barras: m.barras?.map((b) => ({
      ...b,
      vz: girar(R, b.vz),
      offsets: b.offsets && { i: b.offsets.i && girar(R, b.offsets.i), j: b.offsets.j && girar(R, b.offsets.j) },
    })),
    // ejes del muelle: filas eᵢ → R·eᵢ, es decir E' = E·Rᵀ
    muelles: m.muelles?.map((mu) => ({ ...mu, ejes: mul(mu.ejes ?? [1, 0, 0, 0, 1, 0, 0, 0, 1], RT) })),
    casos: m.casos.map((c) => ({
      ...c,
      nodales: c.nodales?.map((n) => ({ nudo: n.nudo, f: [...girar(R, n.f.slice(0, 3)), ...girar(R, n.f.slice(3))] as never })),
      // las cargas de barra en ejes locales no cambian; las globales giran
      barras: c.barras?.map((cb) => {
        if (cb.ejes === "local") return cb;
        if (cb.tipo === "puntual") return { ...cb, F: cb.F && girar(R, cb.F), M: cb.M && girar(R, cb.M) };
        return { ...cb, qa: girar(R, cb.qa), qb: cb.qb && girar(R, cb.qb) };
      }),
    })),
  };
}

/** Permutación pseudoaleatoria reproducible (LCG) de 0..n−1. */
export function permutacion(n: number, semilla = 12345): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  let s = semilla >>> 0;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return p;
}

/**
 * Renumera: el nudo v pasa a ser `nuevo[v]`; invierte el orden de los elementos, de los muelles,
 * de las restricciones y de sus esclavos, y rota el nudo inicial de cada lámina.
 */
export function renumerarModelo(m: ModeloAnalitico, nuevo: readonly number[]): ModeloAnalitico {
  const nudos = new Array(m.nudos.length);
  m.nudos.forEach((v, i) => (nudos[nuevo[i]!] = v));
  const N = (v: number) => nuevo[v]!;
  return {
    nudos,
    barras: m.barras?.map((b) => ({ ...b, nudos: [N(b.nudos[0]), N(b.nudos[1])] as const })).reverse(),
    laminas: m.laminas?.map((l) => ({ ...l, nudos: [N(l.nudos[1]), N(l.nudos[2]), N(l.nudos[3]), N(l.nudos[0])] as const })).reverse(),
    muelles: m.muelles?.map((mu) => ({ ...mu, nudos: mu.nudos.map(N) as never })).reverse(),
    apoyos: m.apoyos?.map((a) => ({ ...a, nudo: N(a.nudo) })).reverse(),
    restricciones: m.restricciones?.map((r) => ({ ...r, maestro: N(r.maestro), esclavos: r.esclavos.map(N).reverse() })).reverse(),
    casos: m.casos.map((c) => ({
      ...c,
      nodales: c.nodales?.map((n) => ({ ...n, nudo: N(n.nudo) })),
      impuestos: c.impuestos?.map((d) => ({ ...d, nudo: N(d.nudo) })),
      // las barras van en orden inverso
      barras: c.barras?.map((cb) => ({ ...cb, barra: m.barras!.length - 1 - cb.barra })),
    })),
  };
}
