/**
 * A2-10 (`docs/fem3d/auditoria-2.md` §3.2): un mecanismo que el pivote no ve no pasa por válido. Una losa
 * de láminas sin diafragma, apoyada en uz y con un único punto fijo en horizontal, tiene un mecanismo:
 * el giro alrededor de ese punto. Su pivote cae en un giro de drilling y su redondeo relativo puede
 * salir positivo y por encima del umbral de mecanismo; entonces, con una carga horizontal excéntrica
 * (sin equilibrio posible), u se disparaba a 1e9–1e10 m y el equilibrio, referido a Σ|k·u|, se quedaba
 * en el redondeo: el cálculo salía válido. Ahora el equilibrio también se mide respecto a las cargas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { carga, Constructor } from "../pruebas/constructor.ts";
import { mallaRectangular } from "../pruebas/placa.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { calcular } from "./calcular.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

/** La losa del auditor (semilla 4, 64 × 64: su pivote del giro sale positivo), con uno o dos puntos fijos en horizontal. */
function losa(fijos: 1 | 2) {
  const nx = 64;
  const semilla = 4;
  const m = new Constructor();
  const ang = 0.3 * semilla;
  const malla = mallaRectangular(m, { a: 40.3, b: 31.7, nx, ny: nx, material: { E: 3e7, nu: 0.2, t: 0.25 }, origen: [11.234, 22.345, 3.1], ex: [Math.cos(ang), Math.sin(ang), 0], ey: [-Math.sin(ang), Math.cos(ang), 0] });
  let k = 0;
  for (let i = 1; i < nx; i++)
    for (let j = 1; j < nx; j++) {
      const v = m.nudos[malla.nudos[i]![j]!]!;
      k++;
      v.x += 0.2 * Math.sin(12.9898 * k * semilla) * (40.3 / nx);
      v.y += 0.2 * Math.cos(78.233 * k * semilla) * (31.7 / nx);
    }
  let n = 0;
  for (let i = 0; i <= nx; i += nx / 4)
    for (let j = 0; j <= nx; j += nx / 4) {
      const h = n++ < fijos;
      m.apoyo(malla.nudos[i]![j]!, [h, h, true, false, false, false]);
    }
  m.caso("viento-excentrico", [carga(malla.nudos[nx]![nx]!, { fx: 100 })]);
  return m.modelo();
}

describe("un mecanismo que el pivote no ve (A2-10)", () => {
  it("con un solo punto fijo en horizontal y una carga horizontal excéntrica, el cálculo no es válido", () => {
    const r = calcular(losa(1));
    expect(r.valido).toBe(false);
    expect(r.diagnosticos.some((d) => d.codigo === "solver/mecanismo" || d.codigo === "equilibrio/no-cumple")).toBe(true);
  }, 120_000);

  it("con dos puntos fijos (sin mecanismo), válido", () => {
    const r = calcular(losa(2));
    expect(r.valido).toBe(true);
  }, 120_000);
});
