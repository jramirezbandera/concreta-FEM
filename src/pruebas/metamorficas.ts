/**
 * Batería metamórfica de E6 (H38) sobre los modelos aleatorios de `aleatorio.ts`: no es código del
 * motor. Cada relación compara dos cálculos que tienen que dar lo mismo (o lo mismo transformado):
 * - solvers: el núcleo (faer) y el solver de perfil;
 * - determinismo: dos cálculos seguidos, bit a bit;
 * - giro: giro + traslación rígidos (alrededor de Z si hay diafragmas o desplazamientos impuestos);
 * - renumeración de nudos, del orden de los elementos y del nudo inicial de cada lámina;
 * - inversión de las barras (i ↔ j) y del orden de los nudos de las láminas;
 * - superposición: un caso Σ λₖ·casoₖ (con todos los tipos de carga y los impuestos) da Σ λₖ·resultadoₖ;
 * - Betti: f_A·u_B = f_B·u_A con dos casos de cargas nodales;
 * - unidades: el modelo en N–mm da los mismos resultados pasados a N–mm.
 * Los errores son relativos, por grupos (fuerzas y momentos, traslaciones y giros, N/M/Q de lámina).
 */
import { calcular, type OpcionesCalculo } from "../motor/calcular.ts";
import type { CargaBarra, CargaLamina, CasoCarga, DesplazamientoImpuesto, ModeloAnalitico, ResultadoCaso, Vec3 } from "../motor/modelo.ts";
import { generador, type ModeloAleatorio } from "./aleatorio.ts";
import { casosValidos, errorLaminas, errorPorGrupos } from "./comparar.ts";
import {
  escalarModelo,
  escalarResultados,
  fijarEjes,
  girarModelo,
  girarVector6,
  invertirBarras,
  invertirLaminas,
  matrizGiro,
  permutacion,
  renumerarModelo,
} from "./transformar.ts";

export const RELACIONES = ["solvers", "determinismo", "giro", "renumeracion", "invertirBarras", "invertirLaminas", "superposicion", "betti", "unidades"] as const;
export type Relacion = (typeof RELACIONES)[number];

type Salidas = Pick<ResultadoCaso, "u" | "reacciones" | "esfuerzosBarras" | "esfuerzosLaminas">;

/** Error relativo entre dos resultados completos de un caso (el peor grupo). */
export function errorResultados(a: Salidas, b: Salidas): number {
  return Math.max(
    errorPorGrupos(a.u, b.u),
    errorPorGrupos(a.reacciones, b.reacciones),
    b.esfuerzosBarras.length ? errorPorGrupos(a.esfuerzosBarras, b.esfuerzosBarras) : 0,
    b.esfuerzosLaminas.length ? errorLaminas(a.esfuerzosLaminas, b.esfuerzosLaminas) : 0,
  );
}

const peor = (a: readonly Salidas[], b: readonly Salidas[]) => a.reduce((e, x, k) => Math.max(e, errorResultados(x, b[k]!)), 0);

/** Caso Σ λₖ·casoₖ con todas las cargas y los impuestos (sumados por GDL). */
export function combinarCasos(casos: readonly CasoCarga[], lambda: readonly number[]): CasoCarga {
  const f = (v: Vec3 | undefined, x: number) => v && (v.map((y) => x * y) as unknown as Vec3);
  const impuestos = new Map<string, DesplazamientoImpuesto>();
  casos.forEach((c, k) => {
    for (const d of c.impuestos ?? []) {
      const clave = `${d.nudo},${d.gdl}`;
      const prev = impuestos.get(clave);
      impuestos.set(clave, { ...d, valor: (prev?.valor ?? 0) + lambda[k]! * d.valor });
    }
  });
  return {
    id: "combinado",
    nodales: casos.flatMap((c, k) => (c.nodales ?? []).map((n) => ({ nudo: n.nudo, f: n.f.map((x) => lambda[k]! * x) as never }))),
    impuestos: [...impuestos.values()],
    barras: casos.flatMap((c, k) =>
      (c.barras ?? []).map((cb): CargaBarra => (cb.tipo === "puntual" ? { ...cb, F: f(cb.F, lambda[k]!), M: f(cb.M, lambda[k]!) } : { ...cb, qa: f(cb.qa, lambda[k]!)!, qb: f(cb.qb, lambda[k]!) })),
    ),
    laminas: casos.flatMap((c, k) =>
      (c.laminas ?? []).map((cl): CargaLamina => {
        const x = lambda[k]!;
        if (cl.tipo === "superficie") return { ...cl, q: Array.isArray(cl.q[0]) ? ((cl.q as readonly Vec3[]).map((q) => f(q, x)!) as never) : f(cl.q as Vec3, x)! };
        if (cl.tipo === "linea") return { ...cl, qa: f(cl.qa, x)!, qb: f(cl.qb, x) };
        return { ...cl, F: f(cl.F, x), M: f(cl.M, x) };
      }),
    ),
  };
}

/** Errores de cada relación en un modelo aleatorio. `semilla` elige el giro, la permutación y las cargas de Betti. */
export function erroresMetamorficos(ma: ModeloAleatorio, semilla: number, opciones: OpcionesCalculo = {}): Record<Relacion, number> {
  const m = ma.modelo;
  const r = generador(semilla ^ 0x5bd1e995);
  const entre = (a: number, b: number) => a + (b - a) * r();
  const calc = (x: ModeloAnalitico, op: OpcionesCalculo = opciones) => casosValidos(calcular(x, op));
  const a = calc(m);
  const nb = m.barras?.length ?? 0;
  const nl = m.laminas?.length ?? 0;
  const e = {} as Record<Relacion, number>;

  e.solvers = peor(calc(m, { ...opciones, solver: opciones.solver === "perfil" ? "nucleo" : "perfil" }), a);
  const otra = calc(m);
  e.determinismo = a.reduce((d, c, k) => Math.max(d, ...c.u.map((v, i) => Math.abs(v - otra[k]!.u[i]!))), 0);

  // giro y traslación
  const R = ma.diafragmas || ma.impuestos ? matrizGiro([0, 0, 1], entre(-3, 3)) : matrizGiro([entre(-1, 1), entre(-1, 1), entre(-1, 1)], entre(-3, 3));
  const g = calc(girarModelo(fijarEjes(m), R, [entre(-50, 50), entre(-50, 50), entre(-5, 5)]));
  e.giro = peor(
    g,
    a.map((c) => ({ ...c, u: girarVector6(R, c.u), reacciones: girarVector6(R, c.reacciones) })),
  );

  // renumeración: barras y láminas en orden inverso, y cada lámina empieza por su segundo nudo
  const nuevo = permutacion(m.nudos.length, semilla + 17);
  const ren = calc(renumerarModelo(m, nuevo));
  e.renumeracion = peor(
    ren,
    a.map((c) => {
      const u = new Float64Array(c.u.length);
      const re = new Float64Array(c.u.length);
      nuevo.forEach((nv, v) => {
        u.set(c.u.subarray(6 * v, 6 * v + 6), 6 * nv);
        re.set(c.reacciones.subarray(6 * v, 6 * v + 6), 6 * nv);
      });
      const eb = new Float64Array(12 * nb);
      for (let b = 0; b < nb; b++) eb.set(c.esfuerzosBarras.subarray(12 * b, 12 * b + 12), 12 * (nb - 1 - b));
      const el = new Float64Array(8 * nl);
      for (let l = 0; l < nl; l++) el.set(c.esfuerzosLaminas.subarray(8 * l, 8 * l + 8), 8 * (nl - 1 - l));
      return { u, reacciones: re, esfuerzosBarras: eb, esfuerzosLaminas: el };
    }),
  );

  // inversión de las barras: el triedro local pasa a (−x, −y, z); Vz y Mz cambian de signo y los extremos se cambian
  const signo = [1, 1, -1, 1, 1, -1];
  e.invertirBarras = peor(
    calc(invertirBarras(m)),
    a.map((c) => {
      const eb = new Float64Array(12 * nb);
      for (let b = 0; b < nb; b++) {
        for (let k = 0; k < 6; k++) {
          eb[12 * b + k] = signo[k]! * c.esfuerzosBarras[12 * b + 6 + k]!;
          eb[12 * b + 6 + k] = signo[k]! * c.esfuerzosBarras[12 * b + k]!;
        }
      }
      return { ...c, esfuerzosBarras: eb };
    }),
  );

  // inversión del orden de los nudos de las láminas
  const inv = invertirLaminas(m);
  e.invertirLaminas = peor(
    calc(inv.modelo),
    a.map((c) => {
      const el = new Float64Array(8 * nl);
      for (let l = 0; l < nl; l++) {
        const s = inv.signos(l);
        for (let k = 0; k < 8; k++) el[8 * l + k] = s[k]! * c.esfuerzosLaminas[8 * l + k]!;
      }
      return { ...c, esfuerzosLaminas: el };
    }),
  );

  // superposición
  const lambda = m.casos.map(() => entre(-2, 2));
  const [s] = calc({ ...m, casos: [combinarCasos(m.casos, lambda)] });
  const suma = (sel: (c: ResultadoCaso) => Float64Array) => {
    const t = new Float64Array(sel(a[0]!).length);
    a.forEach((c, k) => sel(c).forEach((v, i) => (t[i] += lambda[k]! * v)));
    return t;
  };
  e.superposicion = errorResultados(s!, {
    u: suma((c) => c.u),
    reacciones: suma((c) => c.reacciones),
    esfuerzosBarras: suma((c) => c.esfuerzosBarras),
    esfuerzosLaminas: suma((c) => c.esfuerzosLaminas),
  });

  // Betti con dos casos de cargas nodales sobre nudos que admiten cualquier carga
  const nodal = (id: string): CasoCarga => ({
    id,
    nodales: Array.from({ length: 3 }, () => ({
      nudo: ma.cargables[Math.floor(r() * ma.cargables.length)]!,
      f: [entre(-50, 50), entre(-50, 50), entre(-50, 50), entre(-20, 20), entre(-20, 20), entre(-20, 20)] as never,
    })),
  });
  const casosBetti = [nodal("A"), nodal("B")];
  const [uA, uB] = calc({ ...m, casos: casosBetti }).map((c) => c.u);
  const trabajo = (c: CasoCarga, u: Float64Array) => {
    let w = 0;
    let mag = 0;
    for (const n of c.nodales ?? []) {
      for (let k = 0; k < 6; k++) {
        w += n.f[k]! * u[6 * n.nudo + k]!;
        mag += Math.abs(n.f[k]! * u[6 * n.nudo + k]!);
      }
    }
    return [w, mag] as const;
  };
  const [wAB, mAB] = trabajo(casosBetti[0]!, uB!);
  const [wBA, mBA] = trabajo(casosBetti[1]!, uA!);
  // con las cargas en partes del modelo sin unir, los dos trabajos son 0 exactos: Betti se cumple
  e.betti = Math.max(mAB, mBA) > 0 ? Math.abs(wAB - wBA) / Math.max(mAB, mBA) : Math.abs(wAB - wBA);

  // unidades: de kN–m a N–mm
  const [ka, kb] = [1000, 1000];
  e.unidades = peor(
    calc(escalarModelo(m, ka, kb)),
    a.map((c) => escalarResultados(c, ka, kb)),
  );
  return e;
}
