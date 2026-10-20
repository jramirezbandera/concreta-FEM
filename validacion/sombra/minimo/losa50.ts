/**
 * Prueba en sombra, modelo A con vigas planas de 50 × 30 (`modelos.py`, variantes `a50*`): la losa en
 * peso propio frente a las capturas de CYPE (sin listado): la flecha en el centro, Momento X (m11) a
 * mitad de vano junto a las vigas paralelas a X, Momento Y (m22) junto a las paralelas a Y, y los
 * extremos de m11, m22 y Cortante X (v13) en una rejilla de 5 cm dentro de la losa.
 *
 *   bun validacion/sombra/minimo/losa50.ts <carpeta de la variante> [<x0> <y0> <x1> <y1>]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../../../src/compilador/huella.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { valorEnPunto } from "../../../src/visor/datos.ts";
import { Sesion } from "../../../src/visor/sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(WASM);
const dir = process.argv[2]!;
const [x0, y0, x1, y1] = process.argv.length > 3 ? process.argv.slice(3, 7).map(Number) : [0.35, 0.5, 5.65, 5.65];
const a = Sesion.abrir(readFileSync(join(dir, "proyecto.json"), "utf8"), sha256(new Uint8Array(WASM)));
if (!a.valido) throw new Error(JSON.stringify(a.diagnosticos));
const s = a.sesion;
const k = await s.calcular();
if (!k.ok) throw new Error(JSON.stringify(k.diagnosticos));
const v = (campo: "uz" | "m11" | "m22" | "v13", x: number, y: number) => {
  const q = valorEnPunto(s, "F1", campo, { tipo: "caso", caso: "PP" }, x, y);
  return q.valido && q.valor ? q.valor.valor : NaN;
};
const f = (n: number) => n.toFixed(2);
const d = 0.02;
const [xc, yc] = [(x0 + x1) / 2, (y0 + y1) / 2];
console.log(`uz centro ${f(v("uz", xc, yc))} mm`);
console.log(`m11 junto a las vigas en X: ${f(v("m11", xc, y0 + d))} / ${f(v("m11", xc, y1 - d))}; centro ${f(v("m11", xc, yc))}`);
console.log(`m22 junto a las vigas en Y: ${f(v("m22", x0 + d, yc))} / ${f(v("m22", x1 - d, yc))}; centro ${f(v("m22", xc, yc))}`);
const ext: Record<string, [number, number]> = { uz: [Infinity, -Infinity], m11: [Infinity, -Infinity], m22: [Infinity, -Infinity], v13: [Infinity, -Infinity] };
for (let x = x0 + d; x <= x1 - d + 1e-9; x += 0.05)
  for (let y = y0 + d; y <= y1 - d + 1e-9; y += 0.05)
    for (const c of ["uz", "m11", "m22", "v13"] as const) {
      const w = v(c, x, y);
      if (!Number.isFinite(w)) continue;
      ext[c]![0] = Math.min(ext[c]![0], w);
      ext[c]![1] = Math.max(ext[c]![1], w);
    }
for (const [c, [mn, mx]] of Object.entries(ext)) console.log(`${c} de ${f(mn)} a ${f(mx)}`);
