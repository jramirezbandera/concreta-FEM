/**
 * Criterio 7 de C3: determinismo y huella con muros. La huella de compilación no depende del orden
 * de las listas y cambia con 1e-9 m en un muro, con un hueco o con el tamaño de malla; y el modelo
 * analítico (malla de los muros incluida) es el mismo en Node (V8) y en Bun (JavaScriptCore):
 * topología exacta y coordenadas a 1e-12.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { huellasC3 } from "../../validacion/c3/huellas.ts";
import { azar, fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../pruebas/losasAleatorias.ts";
import { barajar } from "../pruebas/metamorficasFisicas.ts";
import { conMurosAleatorios } from "../pruebas/murosAleatorios.ts";
import { compilar } from "./compilar.ts";

const bun = (() => {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("criterio 7 de C3: determinismo y huella", () => {
  it("la huella no depende del orden de las listas y cambia con 1e-9 m en un muro, con un hueco o con el tamaño de malla", () => {
    for (const s of [1, 4]) {
      const f = conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(s), s), s);
      const r = azar(s);
      const a = compilar(f);
      expect(compilar({ ...f, muros: barajar(f.muros!, r), cargas: barajar(f.cargas!, r) }).huella).toBe(a.huella);
      const mover = { ...f, muros: f.muros!.map((w, i) => (i === 0 ? { ...w, puntos: w.puntos.map(([x, y], k) => [k === 1 ? x + 1e-9 : x, y] as const) } : w)) };
      expect(compilar(mover).huella).not.toBe(a.huella);
      const hueco = { ...f, muros: f.muros!.map((w) => (w.id === "NUC" ? { ...w, huecos: w.huecos!.slice(1) } : w)) };
      expect(compilar(hueco).huella).not.toBe(a.huella);
      expect(compilar(f, { tamanoMalla: 0.6 }).huella).not.toBe(a.huella);
    }
  });

  it.skipIf(!bun)("la misma malla en Node (V8) y en Bun (JavaScriptCore): topología exacta y coordenadas a 1e-12", () => {
    const enBun = JSON.parse(execFileSync("bun", [join(import.meta.dirname, "..", "..", "validacion", "c3", "huellas.ts")], { encoding: "utf8", maxBuffer: 1 << 28 })) as ReturnType<typeof huellasC3>;
    const enNode = huellasC3();
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
