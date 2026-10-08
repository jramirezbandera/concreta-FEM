/**
 * Criterio 9 de C5, referencia congelada (regla de oro 1): los modelos de validacion/c5/congelar.ts
 * tienen que dar las mismas bandas propuestas, el mismo modelo analítico (malla con sus caras de banda:
 * estructura idéntica y números a 1e-12), el mismo mapeo y los mismos resultados a 1e-9, y las mismas
 * estaciones de bandas, envolventes de Wood–Armer, machones, dinteles y consultas a 1e-9. Si falla
 * tras un cambio, o el cambio es un error o es una mejora que hay que validar aparte antes de
 * regenerar el fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_CONGELADOS_C5, redondeo, referenciaC5, type ReferenciaC5 } from "../../validacion/c5/congelar.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { errorResultados } from "../pruebas/metamorficas.ts";

const congelado = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "congelado-c5.json"), "utf8")) as Record<string, ReferenciaC5>;
const F = (v: number[]) => Float64Array.from(v);

/** Diferencias entre dos valores JSON: estructura, textos y nulos exactos, números a `tol` relativo. */
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

describe("criterio 9 de C5: referencia congelada", () => {
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_C5)) {
    it(nombre, () => {
      const ref = congelado[nombre]!;
      const r = JSON.parse(JSON.stringify(referenciaC5(f), redondeo)) as ReferenciaC5;
      expect(diferencias(r.bandas, ref.bandas, 1e-12)).toEqual([]);
      expect(diferencias(r.c2.modelo, ref.c2.modelo, 1e-12)).toEqual([]);
      expect(diferencias(r.c2.mapeo, ref.c2.mapeo, 1e-12)).toEqual([]);
      expect(r.c2.casos.length).toBe(ref.c2.casos.length);
      r.c2.casos.forEach((c, k) => {
        const a = { u: F(c.u), reacciones: F(c.reacciones), esfuerzosBarras: F(c.esfuerzosBarras), esfuerzosLaminas: F(c.esfuerzosLaminas) };
        const b = { u: F(ref.c2.casos[k]!.u), reacciones: F(ref.c2.casos[k]!.reacciones), esfuerzosBarras: F(ref.c2.casos[k]!.esfuerzosBarras), esfuerzosLaminas: F(ref.c2.casos[k]!.esfuerzosLaminas) };
        expect(errorResultados(a, b), `caso ${k}`).toBeLessThan(1e-9);
      });
      for (const k of ["estaciones", "muros", "consultas"] as const) expect(diferencias(r[k], ref[k], 1e-9), k).toEqual([]);
    });
  }
});
