/**
 * Criterio 8 de C1, referencia congelada (regla de oro 1): los modelos físicos de
 * validacion/c1/congelar.ts tienen que dar el mismo modelo analítico (estructura idéntica y números
 * a 1e-12, que absorbe la diferencia de bits entre motores de JavaScript), el mismo mapeo y los
 * mismos resultados a 1e-9 con los dos solvers. Si falla tras un cambio, o el cambio es un error o
 * es una mejora que hay que validar aparte antes de regenerar el fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_CONGELADOS_C1, referenciaC1, type ReferenciaC1 } from "../../validacion/c1/congelar.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { errorResultados } from "../pruebas/metamorficas.ts";

const congelado = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "congelado-c1.json"), "utf8")) as Record<string, ReferenciaC1>;
const F = (v: number[]) => Float64Array.from(v);

/** Diferencias entre dos valores JSON: estructura y textos exactos, números a `tol` relativo. */
function diferencias(a: unknown, b: unknown, tol: number, ruta = "", out: string[] = []): string[] {
  if (out.length > 5) return out;
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > tol * Math.max(1, Math.abs(a), Math.abs(b))) out.push(`${ruta}: ${a} ≠ ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${ruta}: longitud ${a.length} ≠ ${b.length}`);
    else a.forEach((x, i) => diferencias(x, b[i], tol, `${ruta}[${i}]`, out));
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined).sort();
    const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined).sort();
    if (ka.join() !== kb.join()) out.push(`${ruta}: claves ${ka.join()} ≠ ${kb.join()}`);
    else for (const k of ka) diferencias((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tol, `${ruta}.${k}`, out);
  } else if (a !== b) out.push(`${ruta}: ${String(a)} ≠ ${String(b)}`);
  return out;
}

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 8 de C1: referencia congelada", () => {
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_C1)) {
    for (const solver of ["nucleo", "perfil"] as const) {
      it(`${nombre} (${solver})`, () => {
        const ref = congelado[nombre]!;
        const r = referenciaC1(f, solver);
        expect(diferencias(JSON.parse(JSON.stringify(r.modelo)), ref.modelo, 1e-12)).toEqual([]);
        expect(diferencias(JSON.parse(JSON.stringify(r.mapeo)), ref.mapeo, 1e-12)).toEqual([]);
        expect(r.casos.length).toBe(ref.casos.length);
        r.casos.forEach((c, k) => {
          const vacio = new Float64Array(0);
          const a = { u: F(c.u), reacciones: F(c.reacciones), esfuerzosBarras: F(c.esfuerzosBarras), esfuerzosLaminas: vacio };
          const b = { u: F(ref.casos[k]!.u), reacciones: F(ref.casos[k]!.reacciones), esfuerzosBarras: F(ref.casos[k]!.esfuerzosBarras), esfuerzosLaminas: vacio };
          expect(errorResultados(a, b), `caso ${k}`).toBeLessThan(1e-9);
        });
      });
    }
  }
});
