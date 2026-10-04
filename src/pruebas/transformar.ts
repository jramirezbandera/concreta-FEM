/**
 * Transformaciones de modelos para las pruebas metamórficas (H38): giro + traslación rígidos y
 * renumeración de nudos y elementos. No es código del motor.
 */
import { marcoLamina } from "../elementos/lamina.ts";
import type { ModeloAnalitico, ResultadoCaso, Vec3 } from "../motor/modelo.ts";

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
    // el eje 1 de referencia gira; sin él, la regla de CSI sólo es invariante si R deja quieto Z
    laminas: m.laminas?.map((l) => ({ ...l, eje1: l.eje1 && girar(R, l.eje1) })),
    casos: m.casos.map((c) => ({
      ...c,
      nodales: c.nodales?.map((n) => ({ nudo: n.nudo, f: [...girar(R, n.f.slice(0, 3)), ...girar(R, n.f.slice(3))] as never })),
      // las cargas de barra en ejes locales no cambian; las globales giran
      barras: c.barras?.map((cb) => {
        if (cb.ejes === "local") return cb;
        if (cb.tipo === "puntual") return { ...cb, F: cb.F && girar(R, cb.F), M: cb.M && girar(R, cb.M) };
        return { ...cb, qa: girar(R, cb.qa), qb: cb.qb && girar(R, cb.qb) };
      }),
      // cargas de lámina: los puntos giran y se trasladan; los vectores globales giran
      laminas: c.laminas?.map((cl) => {
        const v = (q: Vec3): Vec3 => (cl.ejes === "local" ? q : girar(R, q));
        const p = (x: Vec3): Vec3 => {
          const g = girar(R, x);
          return [g[0] + t[0], g[1] + t[1], g[2] + t[2]];
        };
        if (cl.tipo === "superficie") return { ...cl, q: Array.isArray(cl.q[0]) ? ((cl.q as readonly Vec3[]).map(v) as never) : v(cl.q as Vec3) };
        if (cl.tipo === "linea") return { ...cl, a: p(cl.a), b: p(cl.b), qa: v(cl.qa), qb: cl.qb && v(cl.qb) };
        return { ...cl, punto: p(cl.punto), F: cl.F && v(cl.F), M: cl.M && v(cl.M) };
      }),
    })),
  };
}

/**
 * Invierte el orden de los nudos de todas las láminas ([a, b, c, d] → [a, d, c, b]): la normal
 * (eje 3) se invierte y, con ella, el eje 1 si la lámina sigue la regla de CSI o el 2 si tiene
 * `eje1`. Las cargas en ejes locales cambian de signo en esos dos ejes; las de superficie por nudo
 * se reordenan. `signos(l)` da el factor de cada resultante [Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy]:
 * Nxy, Mx y My cambian de signo, Mxy no, y de los cortantes cambia el del eje que no se invierte.
 */
export function invertirLaminas(m: ModeloAnalitico): { modelo: ModeloAnalitico; signos: (l: number) => number[] } {
  const conEje = (l: number) => m.laminas![l]!.eje1 !== undefined;
  const local = (l: number, q: Vec3): Vec3 => (conEje(l) ? [q[0], -q[1], -q[2]] : [-q[0], q[1], -q[2]]);
  return {
    modelo: {
      ...m,
      laminas: m.laminas?.map((l) => ({ ...l, nudos: [l.nudos[0], l.nudos[3], l.nudos[2], l.nudos[1]] as const })),
      casos: m.casos.map((c) => ({
        ...c,
        laminas: c.laminas?.map((cl) => {
          const v = (q: Vec3): Vec3 => (cl.ejes === "local" ? local(cl.lamina, q) : q);
          if (cl.tipo === "superficie") {
            if (!Array.isArray(cl.q[0])) return { ...cl, q: v(cl.q as Vec3) };
            const q = cl.q as readonly Vec3[];
            return { ...cl, q: [v(q[0]!), v(q[3]!), v(q[2]!), v(q[1]!)] as const };
          }
          if (cl.tipo === "linea") return { ...cl, qa: v(cl.qa), qb: cl.qb && v(cl.qb) };
          return { ...cl, F: cl.F && v(cl.F), M: cl.M && v(cl.M) };
        }),
      })),
    },
    signos: (l) => (conEje(l) ? [1, 1, -1, -1, -1, 1, -1, 1] : [1, 1, -1, -1, -1, 1, 1, -1]),
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
      // las láminas también, y empiezan por su segundo nudo: las cargas por nudo rotan
      laminas: c.laminas?.map((cl) => {
        const lamina = m.laminas!.length - 1 - cl.lamina;
        if (cl.tipo !== "superficie" || !Array.isArray(cl.q[0])) return { ...cl, lamina };
        const q = cl.q as readonly Vec3[];
        return { ...cl, lamina, q: [q[1]!, q[2]!, q[3]!, q[0]!] as const };
      }),
    })),
  };
}

/** Longitud del tramo flexible de cada barra (entre i' y j', tras los offsets). */
export function longitudesFlexibles(m: ModeloAnalitico): number[] {
  return (m.barras ?? []).map((b) => {
    const [i, j] = b.nudos;
    const di = b.offsets?.i ?? [0, 0, 0];
    const dj = b.offsets?.j ?? [0, 0, 0];
    const a = m.nudos[i]!;
    const c = m.nudos[j]!;
    return Math.hypot(c.x + dj[0] - a.x - di[0], c.y + dj[1] - a.y - di[1], c.z + dj[2] - a.z - di[2]);
  });
}

/**
 * Invierte el sentido de todas las barras (i ↔ j) con sus offsets, liberaciones y cargas. El
 * triedro local pasa a ser (−x, −y, z): las componentes locales de las cargas cambian de signo en
 * x e y, y las posiciones van de x a L' − x. En una sección, N, Vy, T y My no cambian; Vz y Mz
 * cambian de signo.
 */
export function invertirBarras(m: ModeloAnalitico): ModeloAnalitico {
  const Lf = longitudesFlexibles(m);
  const v = (q: Vec3, ejes: "local" | "global"): Vec3 => (ejes === "local" ? [-q[0], -q[1], q[2]] : q);
  return {
    ...m,
    barras: m.barras?.map((b) => ({
      ...b,
      nudos: [b.nudos[1], b.nudos[0]] as const,
      offsets: b.offsets && { i: b.offsets.j, j: b.offsets.i },
      liberaciones: b.liberaciones && { i: b.liberaciones.j, j: b.liberaciones.i },
    })),
    casos: m.casos.map((c) => ({
      ...c,
      barras: c.barras?.map((cb) => {
        const L = Lf[cb.barra]!;
        if (cb.tipo === "puntual") return { ...cb, x: L - cb.x, F: cb.F && v(cb.F, cb.ejes), M: cb.M && v(cb.M, cb.ejes) };
        const a = cb.a ?? 0;
        const b = cb.b ?? L;
        return { ...cb, a: L - b, b: L - a, qa: v(cb.qb ?? cb.qa, cb.ejes), qb: v(cb.qa, cb.ejes) };
      }),
    })),
  };
}

/** Fija el eje 1 de cada lámina que no lo tiene (el de la regla de CSI), para que gire con el modelo. */
export function fijarEjes(m: ModeloAnalitico): ModeloAnalitico {
  return {
    ...m,
    laminas: m.laminas?.map((l) => {
      if (l.eje1) return l;
      const X = l.nudos.flatMap((v) => [m.nudos[v]!.x, m.nudos[v]!.y, m.nudos[v]!.z]);
      const marco = marcoLamina(X);
      if (typeof marco === "string") throw new Error(marco);
      return { ...l, eje1: [marco.R[0]!, marco.R[1]!, marco.R[2]!] as const };
    }),
  };
}

/**
 * Cambio de unidades: longitudes ×a y fuerzas ×b (de kN–m a N–mm, a = b = 1000). Todo lo demás
 * sigue por análisis dimensional: E, G ×b/a²; áreas ×a², inercias ×a⁴; espesores y offsets ×a;
 * muelles ×b/a (traslación), ×b (cruzados) y ×b·a (giro); cargas puntuales ×b y sus momentos ×b·a,
 * de línea ×b/a y de superficie ×b/a²; desplazamientos impuestos ×a (los giros no cambian).
 */
export function escalarModelo(m: ModeloAnalitico, a: number, b: number): ModeloAnalitico {
  const L = (v: Vec3): Vec3 => [a * v[0], a * v[1], a * v[2]];
  const F = (v: Vec3 | undefined, f: number) => v && ([f * v[0], f * v[1], f * v[2]] as Vec3);
  const kMuelle = (k: readonly number[]) => {
    const s = (c: number) => (c < 3 ? -0.5 : 0.5); // k_ij ×b·a^(s_i + s_j)
    if (k.length === 6) return k.map((v, c) => v * b * a ** (2 * s(c)));
    return k.map((v, idx) => v * b * a ** (s(Math.floor(idx / 6)) + s(idx % 6)));
  };
  return {
    ...m,
    nudos: m.nudos.map((v) => ({ id: v.id, x: a * v.x, y: a * v.y, z: a * v.z })),
    barras: m.barras?.map((br) => {
      const s = br.seccion;
      return {
        ...br,
        seccion: {
          E: (s.E * b) / a ** 2,
          G: (s.G * b) / a ** 2,
          A: s.A * a ** 2,
          Iy: s.Iy * a ** 4,
          Iz: s.Iz * a ** 4,
          J: s.J * a ** 4,
          ...(s.Avy !== undefined ? { Avy: s.Avy * a ** 2 } : {}),
          ...(s.Avz !== undefined ? { Avz: s.Avz * a ** 2 } : {}),
        },
        offsets: br.offsets && { i: br.offsets.i && L(br.offsets.i), j: br.offsets.j && L(br.offsets.j) },
      };
    }),
    laminas: m.laminas?.map((l) => ({ ...l, material: { E: (l.material.E * b) / a ** 2, nu: l.material.nu, t: a * l.material.t } })),
    muelles: m.muelles?.map((mu) => ({ ...mu, k: kMuelle(mu.k) })),
    casos: m.casos.map((c) => ({
      ...c,
      nodales: c.nodales?.map((n) => ({ nudo: n.nudo, f: n.f.map((v, g) => v * (g < 3 ? b : b * a)) as never })),
      impuestos: c.impuestos?.map((d) => ({ ...d, valor: d.gdl < 3 ? a * d.valor : d.valor })),
      barras: c.barras?.map((cb) => {
        if (cb.tipo === "puntual") return { ...cb, x: a * cb.x, F: F(cb.F, b), M: F(cb.M, b * a) };
        return { ...cb, qa: F(cb.qa, b / a)!, qb: F(cb.qb, b / a), a: cb.a === undefined ? undefined : a * cb.a, b: cb.b === undefined ? undefined : a * cb.b };
      }),
      laminas: c.laminas?.map((cl) => {
        if (cl.tipo === "superficie") return { ...cl, q: Array.isArray(cl.q[0]) ? ((cl.q as readonly Vec3[]).map((q) => F(q, b / a ** 2)!) as never) : F(cl.q as Vec3, b / a ** 2)! };
        if (cl.tipo === "linea") return { ...cl, a: L(cl.a), b: L(cl.b), qa: F(cl.qa, b / a)!, qb: F(cl.qb, b / a) };
        return { ...cl, punto: L(cl.punto), F: F(cl.F, b), M: F(cl.M, b * a) };
      }),
    })),
  };
}

/** Resultados de un caso pasados a las unidades de `escalarModelo(m, a, b)`. */
export function escalarResultados(c: ResultadoCaso, a: number, b: number): Pick<ResultadoCaso, "u" | "reacciones" | "esfuerzosBarras" | "esfuerzosLaminas"> {
  return {
    u: c.u.map((v, i) => (i % 6 < 3 ? a * v : v)),
    reacciones: c.reacciones.map((v, i) => (i % 6 < 3 ? b * v : b * a * v)),
    esfuerzosBarras: c.esfuerzosBarras.map((v, i) => (i % 6 < 3 ? b * v : b * a * v)),
    esfuerzosLaminas: c.esfuerzosLaminas.map((v, i) => (i % 8 < 3 || i % 8 >= 6 ? (b / a) * v : b * v)),
  };
}
