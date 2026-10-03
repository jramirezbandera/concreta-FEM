/**
 * Modelos de validación de E1 frente a OpenSeesPy (oraculo_opensees.py). Sólo barras de
 * Euler–Bernoulli (la `elasticBeamColumn` de OpenSees es la misma formulación), muelles,
 * apoyos, restricciones y desplazamientos impuestos: lo que se valida aquí es el núcleo
 * (numeración, T, cadenas, cargas, reacciones), no los elementos.
 *
 * `bun validacion/e1/modelos-oraculo.ts` escribe validacion/e1/modelos-oraculo.json, que lee
 * el oráculo. El test (src/motor/oraculos.test.ts) construye los mismos modelos con estas
 * funciones y compara con src/motor/__fixtures__/opensees-e1.json.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { carga, Constructor, seccionRectangular } from "../../src/pruebas/constructor.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";

/** H07 (exp_diafragma.py): planta de 6×6, 4 pilares 30×50 de 3 m y 4 vigas, 100 kN en X en una esquina. */
function diafragmaH07(): ModeloAnalitico {
  const s = seccionRectangular(0.3, 0.5);
  const m = new Constructor();
  const esquinas = [
    [0, 0],
    [6, 0],
    [6, 6],
    [0, 6],
  ] as const;
  const cabezas = esquinas.map(([x, y]) => {
    const pie = m.nudo(x, y, 0);
    const cabeza = m.nudo(x, y, 3);
    m.barra(pie, cabeza, s, [1, 0, 0]);
    m.apoyo(pie);
    return cabeza;
  });
  for (let i = 0; i < 4; i++) m.barra(cabezas[i]!, cabezas[(i + 1) % 4]!, s, [0, 0, 1]);
  const cm = m.nudo(3, 3, 3, "CM");
  m.diafragma(cm, cabezas);
  m.caso("X", [carga(cabezas[0]!, { fx: 100 })]);
  m.caso("Y+Mz", [carga(cabezas[1]!, { fy: -40 }), carga(cm, { mz: 25 })]);
  return m.modelo();
}

/** Dos plantas, pilares irregulares, maestro fuera del centro, cargas en esclavos, maestro y fuera del plano. */
function diafragmaDosPlantas(): ModeloAnalitico {
  const pil = seccionRectangular(0.35, 0.45);
  const vig = seccionRectangular(0.3, 0.6);
  const m = new Constructor();
  const planta = [
    [0, 0],
    [5.2, 0.3],
    [9.7, -0.4],
    [0.2, 6.1],
    [5.5, 5.8],
    [10.1, 6.6],
  ] as const;
  let abajo = planta.map(([x, y]) => {
    const v = m.nudo(x, y, 0);
    m.apoyo(v);
    return v;
  });
  for (let k = 1; k <= 2; k++) {
    const z = k * 3.2;
    const arriba = planta.map(([x, y]) => m.nudo(x, y, z));
    arriba.forEach((v, i) => m.barra(abajo[i]!, v, pil, i % 2 ? [1, 0, 0] : [0.6, 0.8, 0]));
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5],
      [0, 3],
      [1, 4],
      [2, 5],
    ] as const)
      m.barra(arriba[a]!, arriba[b]!, vig, [0, 0, 1]);
    const cm = m.nudo(3.7, 2.2, z, `CM${k}`);
    m.diafragma(cm, arriba);
    abajo = arriba;
  }
  const n = (k: number, i: number) => 6 + 7 * (k - 1) + i; // nudos de la planta k
  m.caso("viento", [carga(n(1, 0), { fx: 30, fy: 5 }), carga(n(2, 2), { fx: 45, fy: -12, mz: 8 }), carga(14, { fy: 20 })]);
  m.caso("general", [carga(n(1, 4), { fx: -3, fy: 7, fz: -50, mx: 4, my: -6, mz: 2 }), carga(n(2, 5), { fz: -80, my: 12 }), carga(7 + 6, { mz: -15, fx: 9 })]);
  return m.modelo();
}

/** Enlaces rígidos con brazos en las tres direcciones y cargas de 6 componentes en los esclavos. */
function enlaceRigido(): ModeloAnalitico {
  const s = seccionRectangular(0.3, 0.4);
  const m = new Constructor();
  const a = m.nudo(0, 0, 0);
  const b = m.nudo(0, 0, 3);
  const c = m.nudo(4, 0, 3);
  const d = m.nudo(4, 0, 0);
  m.barra(a, b, s, [1, 0, 0]);
  m.barra(b, c, s, [0, 0, 1]);
  m.barra(d, c, s, [0, 1, 0]);
  m.apoyo(a);
  m.apoyo(d);
  const e1 = m.nudo(0.5, -0.4, 3.3);
  const e2 = m.nudo(-0.2, 0.7, 2.6);
  const e3 = m.nudo(4.3, 0.25, 3.15);
  m.enlace(b, [e1, e2]);
  m.enlace(c, [e3]);
  // una barra que cuelga de un esclavo: el esclavo tiene rigidez propia
  const f = m.nudo(-0.2, 0.7, 1.0);
  m.barra(f, e2, s, [1, 0, 0]);
  m.apoyo(f, [true, true, true, false, false, false]);
  m.caso("C1", [{ nudo: e1, f: [10, -5, 3, 2, -1, 4] }, { nudo: e3, f: [-7, 12, -20, 0, 3, -2] }]);
  m.caso("C2", [{ nudo: e2, f: [0, 0, -15, 6, 0, 0] }, carga(b, { fy: 8 })]);
  return m.modelo();
}

/** Cadenas: huella → cabeza de pilar → diafragma, y un enlace de enlace (A ← B ← C). */
function cadenas(): ModeloAnalitico {
  const s = seccionRectangular(0.4, 0.4);
  const vig = seccionRectangular(0.3, 0.5);
  const m = new Constructor();
  const xs = [
    [0, 0],
    [6, 0],
    [6, 5],
    [0, 5],
  ] as const;
  const cabezas = xs.map(([x, y]) => {
    const pie = m.nudo(x, y, 0);
    const cab = m.nudo(x, y, 3);
    m.barra(pie, cab, s, [1, 0, 0]);
    m.apoyo(pie);
    return cab;
  });
  // huella de la cabeza 0: dos nudos a los que llegan vigas
  const h1 = m.nudo(0.3, 0, 3);
  const h2 = m.nudo(0, 0.3, 3);
  m.enlace(cabezas[0]!, [h1, h2]);
  m.barra(h1, cabezas[1]!, vig, [0, 0, 1]);
  m.barra(h2, cabezas[3]!, vig, [0, 0, 1]);
  m.barra(cabezas[1]!, cabezas[2]!, vig, [0, 0, 1]);
  m.barra(cabezas[2]!, cabezas[3]!, vig, [0, 0, 1]);
  const cm = m.nudo(3, 2.5, 3, "CM");
  m.diafragma(cm, cabezas);
  // cadena de enlaces: la cabeza 2 manda en B y B manda en C (ménsula rígida en dos tramos)
  const B = m.nudo(6.8, 5.6, 3.4);
  const C = m.nudo(7.5, 6.0, 3.1);
  m.enlace(B, [C], "RBC");
  m.enlace(cabezas[2]!, [B], "R2B");
  m.caso("C1", [{ nudo: C, f: [5, -8, -12, 1, 2, -3] }, carga(h1, { fx: 20, fz: -6 }), carga(cm, { fy: 15 })]);
  m.caso("C2", [carga(h2, { fy: -10, mz: 4 }), carga(B, { fz: -30 })]);
  return m.modelo();
}

/** Muelles a tierra en ejes girados, muelles de longitud nula entre nudos coincidentes y barras. */
function muelles(): ModeloAnalitico {
  const s = seccionRectangular(0.3, 0.5);
  const m = new Constructor();
  const c = Math.cos(0.4);
  const n = Math.sin(0.4);
  const giroZ = [c, n, 0, -n, c, 0, 0, 0, 1];
  // triedro general: giro de 0,4 rad alrededor de Z y luego de 0,3 alrededor del nuevo x
  const c2 = Math.cos(0.3);
  const s2 = Math.sin(0.3);
  const general = [c, n, 0, -n * c2, c * c2, s2, n * s2, -c * s2, c2];
  const a = m.nudo(0, 0, 0);
  const b = m.nudo(5, 0, 0);
  const b2 = m.nudo(5, 0, 0);
  const d = m.nudo(5, 4, 0);
  m.barra(a, b, s, [0, 0, 1]);
  m.barra(b2, d, s, [0, 0, 1]);
  m.muelle([a], [1e5, 2e5, 3e5, 4e4, 5e4, 6e4], giroZ);
  m.muelle([b, b2], [8e4, 9e4, 7e4, 1e4, 2e4, 3e4], general);
  m.muelle([d], [3e4, 1e4, 5e4, 2e3, 3e3, 4e3], general);
  m.caso("C1", [{ nudo: b, f: [3, 4, -10, 1, -2, 0.5] }, { nudo: d, f: [-6, 2, -8, 0, 1, -1] }]);
  return m.modelo();
}

/** Desplazamientos impuestos en varios GDL junto con cargas. */
function impuestos(): ModeloAnalitico {
  const s = seccionRectangular(0.3, 0.5);
  const m = new Constructor();
  const a = m.nudo(0, 0, 0);
  const b = m.nudo(0, 0, 3);
  const c = m.nudo(5, 0, 3);
  const d = m.nudo(5, 0, 0);
  const e = m.nudo(5, 4, 3);
  const f = m.nudo(5, 4, 0);
  m.barra(a, b, s, [1, 0, 0]);
  m.barra(b, c, s, [0, 0, 1]);
  m.barra(d, c, s, [1, 0, 0]);
  m.barra(c, e, s, [0, 0, 1]);
  m.barra(f, e, s, [0, 1, 0]);
  m.apoyo(a);
  m.apoyo(d);
  m.apoyo(f, [true, true, true, true, false, true]);
  m.caso("asiento", [], [{ nudo: d, gdl: 2, valor: -0.01 }]);
  m.caso("mixto", [carga(e, { fx: 10, fz: -20 })], [
    { nudo: a, gdl: 0, valor: 0.002 },
    { nudo: a, gdl: 4, valor: -0.001 },
    { nudo: f, gdl: 5, valor: 0.0005 },
  ]);
  return m.modelo();
}

export const MODELOS_ORACULO: Record<string, () => ModeloAnalitico> = {
  "diafragma-h07": diafragmaH07,
  "diafragma-dos-plantas": diafragmaDosPlantas,
  "enlace-rigido": enlaceRigido,
  cadenas,
  muelles,
  impuestos,
};

if (import.meta.main) {
  const salida = Object.fromEntries(Object.entries(MODELOS_ORACULO).map(([k, f]) => [k, f()]));
  const ruta = join(import.meta.dirname, "modelos-oraculo.json");
  writeFileSync(ruta, JSON.stringify(salida, null, 1));
  console.log(`escrito ${ruta}`);
}
