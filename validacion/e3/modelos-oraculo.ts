/**
 * Modelos de validación de E3 (láminas) frente a PyNite 3.2.0 (oraculo_pynite.py).
 *
 * PyNite tiene la misma flexión DKMQ (isótropa) y reparte la presión con las mismas funciones
 * bilineales: es un oráculo bit a bit de la flexión de placas planas en cualquier orientación. Su
 * membrana es otra (Q4 sin drilling real, H05), así que los modelos son placas planas con cargas
 * sólo normales a su plano y momentos sólo en el plano: la membrana queda descargada en los dos
 * programas. PyNite sólo admite presión uniforme normal por elemento.
 *
 * Lo que se valida: la flexión en el motor (ejes de usuario, rigidez en globales, presiones,
 * apoyos, reacciones) y las resultantes ya giradas a los ejes de usuario, que el oráculo calcula
 * por su cuenta en Python a partir de los momentos de PyNite en sus ejes (x = i→j).
 *
 * `bun validacion/e3/modelos-oraculo.ts` escribe validacion/e3/modelos-oraculo.json. El test
 * (src/motor/oraculos-e3.test.ts) construye los mismos modelos con estas funciones.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CargaLamina, CargaNodal, ModeloAnalitico, Vec3 } from "../../src/motor/modelo.ts";
import { carga, Constructor, EMPOTRADO } from "../../src/pruebas/constructor.ts";
import { mallaRectangular } from "../../src/pruebas/placa.ts";

const MAT = { E: 3e7, nu: 0.2, t: 0.2 };
const presion = (laminas: number[], p: number): CargaLamina[] => laminas.map((l) => ({ tipo: "superficie", lamina: l, ejes: "local", q: [0, 0, p] }));

/** Desplaza en su plano los nudos interiores de una malla (distorsión reproducible). */
function distorsionar(m: Constructor, nudos: number[][], punto: (x: number, y: number) => Vec3, dx: number, dy: number, f = 0.25): void {
  for (let i = 1; i < nudos.length - 1; i++) {
    for (let j = 1; j < nudos[0]!.length - 1; j++) {
      const s = Math.sin(7.1 * i + 3.3 * j);
      const c = Math.cos(5.3 * i - 2.9 * j);
      const p = punto(i * dx + f * dx * s, j * dy + f * dy * c);
      Object.assign(m.nudos[nudos[i]![j]!]!, { x: p[0], y: p[1], z: p[2] });
    }
  }
}

/** Losa horizontal de 4 × 3 con malla distorsionada: tres bordes apoyados y uno empotrado. */
function losaDistorsionada(): ModeloAnalitico {
  const m = new Constructor();
  const g = mallaRectangular(m, { a: 4, b: 3, nx: 8, ny: 6, material: MAT });
  distorsionar(m, g.nudos, g.punto, 0.5, 0.5);
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 6; j++) {
      const v = g.nudos[i]![j]!;
      if (i === 0) m.apoyo(v, EMPOTRADO);
      else if (i === 8 || j === 0 || j === 6) m.apoyo(v, [true, true, true, false, false, true]);
      else m.apoyo(v, [true, true, false, false, false, true]); // membrana y drilling fuera (PyNite)
    }
  }
  m.caso("presion", [], [], [], presion(g.laminas.flat(), -8.5));
  m.caso("nodales", [carga(g.nudos[4]![3]!, { fz: -30, mx: 4 }), carga(g.nudos[6]![2]!, { fz: 12, my: -6 }), carga(g.nudos[2]![5]!, { mx: -3, my: 2.5 })]);
  return m.modelo();
}

/**
 * Losa inclinada en el espacio (giros alrededor de dos ejes), con el eje 1 dado (los nervios de
 * un reticular, por ejemplo) y dos bordes opuestos articulados.
 */
function losaInclinada(): ModeloAnalitico {
  const m = new Constructor();
  const a = 0.5;
  const b = 0.3;
  const ex: Vec3 = [Math.cos(b), Math.sin(b), 0];
  const ey: Vec3 = [-Math.sin(b) * Math.cos(a), Math.cos(b) * Math.cos(a), Math.sin(a)];
  const g = mallaRectangular(m, { a: 5, b: 3, nx: 10, ny: 6, origen: [1, -2, 3], ex, ey, material: MAT, lamina: { eje1: [1, 1, 0.2] } });
  for (let j = 0; j <= 6; j++) {
    m.apoyo(g.nudos[0]![j]!, [true, true, true, false, false, false]);
    m.apoyo(g.nudos[10]![j]!, [true, true, true, false, false, false]);
  }
  // normal de la placa
  const n: Vec3 = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  const f = (v: number, s: number): CargaNodal => ({ nudo: v, f: [s * n[0], s * n[1], s * n[2], 0, 0, 0] });
  // momento en el plano: alrededor de ex
  const mom = (v: number, s: number): CargaNodal => ({ nudo: v, f: [0, 0, 0, s * ex[0], s * ex[1], s * ex[2]] });
  m.caso("presion", [], [], [], presion(g.laminas.flat(), 6));
  m.caso("nodales", [f(g.nudos[5]![3]!, -40), f(g.nudos[3]![1]!, 15), mom(g.nudos[7]![4]!, 5)]);
  return m.modelo();
}

/** Muro vertical (normal horizontal a 30° de X) empotrado en la base: viento y cargas en la cabeza. */
function muroViento(): ModeloAnalitico {
  const m = new Constructor();
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  const ex: Vec3 = [-s, c, 0];
  const g = mallaRectangular(m, { a: 4, b: 3, nx: 8, ny: 6, origen: [2, 1, 0], ex, ey: [0, 0, 1], material: { E: 3e7, nu: 0.2, t: 0.25 } });
  for (let i = 0; i <= 8; i++) m.apoyo(g.nudos[i]![0]!, EMPOTRADO);
  const n: Vec3 = [c, s, 0]; // ex × ez
  m.caso("viento", [], [], [], presion(g.laminas.flat(), -1.2));
  m.caso("cabeza", [{ nudo: g.nudos[8]![6]!, f: [7 * n[0], 7 * n[1], 0, 0, 0, 0] }, { nudo: g.nudos[4]![6]!, f: [0, 0, 0, 0, 0, 3] }]);
  return m.modelo();
}

/** Losa horizontal con la normal hacia −Z (nudos en sentido horario visto desde arriba): ejes 1 = −X. */
function losaNormalAbajo(): ModeloAnalitico {
  const m = new Constructor();
  const g = mallaRectangular(m, { a: 3, b: 3, nx: 6, ny: 6, ex: [0, 1, 0], ey: [1, 0, 0], material: MAT });
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 6; j++) {
      const borde = i === 0 || i === 6 || j === 0 || j === 6;
      m.apoyo(g.nudos[i]![j]!, borde ? [true, true, true, false, false, true] : [true, true, false, false, false, true]);
    }
  }
  m.caso("presion", [], [], [], presion(g.laminas.flat(), 10)); // +3 = −Z: gravedad
  m.caso("puntual", [carga(g.nudos[2]![3]!, { fz: -25 })]);
  return m.modelo();
}

export const MODELOS_PYNITE_E3: Record<string, () => ModeloAnalitico> = {
  "losa-distorsionada": losaDistorsionada,
  "losa-inclinada": losaInclinada,
  "muro-viento": muroViento,
  "losa-normal-abajo": losaNormalAbajo,
};

if (import.meta.main) {
  const salida = Object.fromEntries(Object.entries(MODELOS_PYNITE_E3).map(([k, f]) => [k, f()]));
  const ruta = join(import.meta.dirname, "modelos-oraculo.json");
  writeFileSync(ruta, JSON.stringify(salida, null, 1));
  console.log(`escrito ${ruta}`);
}
