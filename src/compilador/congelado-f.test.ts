/**
 * Criterio 9 de la fase F, referencia congelada (regla de oro 1): los modelos de
 * validacion/f/congelar.ts tienen que dar el mismo modelo analítico (malla con las caras de las
 * franjas: estructura idéntica y números a 1e-12), el mismo mapeo, los mismos resultados a 1e-9, y
 * las mismas franjas, estaciones, momentos medios y envolventes de Wood–Armer a 1e-9. Si falla tras
 * un cambio, o el cambio es un error o es una mejora que hay que validar aparte antes de regenerar
 * el fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { redondeo } from "../../validacion/c5/congelar.ts";
import { MODELOS_CONGELADOS_F, referenciaF, type ReferenciaF } from "../../validacion/f/congelar.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { errorResultados } from "../pruebas/metamorficas.ts";

const congelado = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "congelado-f.json"), "utf8")) as Record<string, ReferenciaF>;
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

describe("criterio 9 de F: referencia congelada", () => {
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_F)) {
    it(nombre, () => {
      const ref = congelado[nombre]!;
      const r = JSON.parse(JSON.stringify(referenciaF(f), redondeo)) as ReferenciaF;
      expect(diferencias(r.c2.modelo, ref.c2.modelo, 1e-12)).toEqual([]);
      expect(diferencias(r.c2.mapeo, ref.c2.mapeo, 1e-12)).toEqual([]);
      expect(r.c2.casos.length).toBe(ref.c2.casos.length);
      r.c2.casos.forEach((c, k) => {
        const a = { u: F(c.u), reacciones: F(c.reacciones), esfuerzosBarras: F(c.esfuerzosBarras), esfuerzosLaminas: F(c.esfuerzosLaminas) };
        const b = { u: F(ref.c2.casos[k]!.u), reacciones: F(ref.c2.casos[k]!.reacciones), esfuerzosBarras: F(ref.c2.casos[k]!.esfuerzosBarras), esfuerzosLaminas: F(ref.c2.casos[k]!.esfuerzosLaminas) };
        expect(errorResultados(a, b), `caso ${k}`).toBeLessThan(1e-9);
      });
      expect(diferencias(r.franjas, ref.franjas, 1e-9)).toEqual([]);
    });
  }
});
