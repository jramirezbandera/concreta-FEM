/**
 * Criterio 7 de C2: determinismo y huella con losas. La huella de compilación no depende del orden
 * de las listas de C2 y cambia con 1e-9 m en una losa o con el tamaño de malla; y el modelo
 * analítico (malla incluida) es el mismo, a 12 cifras, en Node (V8) y en Bun (JavaScriptCore).
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { huellasC2 } from "../../validacion/c2/huellas.ts";
import { azar, fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../pruebas/losasAleatorias.ts";
import { barajar } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";

const bun = (() => {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("criterio 7 de C2: determinismo y huella", () => {
  it("la huella no depende del orden de las listas y cambia con 1e-9 m o con el tamaño de malla", () => {
    for (const s of [1, 4]) {
      const f = conLosasAleatorias(fisicoAleatorio(s), s);
      const r = azar(s);
      const g = { ...f, losas: barajar(f.losas!, r), bandas: barajar(f.bandas!, r), cargas: barajar(f.cargas!, r) };
      const a = compilar(f);
      expect(compilar(g).huella).toBe(a.huella);
      const h = { ...f, losas: f.losas!.map((l, i) => (i === 0 ? { ...l, contorno: l.contorno.map(([x, y], k) => [k === 1 ? x + 1e-9 : x, y] as const) } : l)) };
      expect(compilar(h).huella).not.toBe(a.huella);
      expect(compilar(f, { tamanoMalla: 0.6 }).huella).not.toBe(a.huella);
    }
  });

  it.skipIf(!bun)("la misma malla en Node (V8) y en Bun (JavaScriptCore): topología exacta y coordenadas a 1e-12", () => {
    const enBun = JSON.parse(execFileSync("bun", [join(import.meta.dirname, "..", "..", "validacion", "c2", "huellas.ts")], { encoding: "utf8", maxBuffer: 1 << 28 })) as ReturnType<typeof huellasC2>;
    const enNode = huellasC2();
    expect(enBun.length).toBe(enNode.length);
    enNode.forEach((a, i) => {
      const b = enBun[i]!;
      expect(b.nombre).toBe(a.nombre);
      expect(b.compilacion, a.nombre).toBe(a.compilacion);
      expect(b.topologia, a.nombre).toBe(a.topologia);
      expect(b.coordenadas.length, a.nombre).toBe(a.coordenadas.length);
      let peor = 0;
      a.coordenadas.forEach((x, k) => (peor = Math.max(peor, Math.abs(x - b.coordenadas[k]!) / Math.max(1, Math.abs(x)))));
      expect(peor, a.nombre).toBeLessThan(1e-12);
    });
  });
});
