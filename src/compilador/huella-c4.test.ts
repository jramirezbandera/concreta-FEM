/**
 * Criterio 7 de C4: determinismo y huella con forjados. La huella de compilación no depende del
 * orden de las listas (tampoco del de los ábacos) y cambia con 1e-9 m en un paño, con su intereje o
 * su dirección y con un ábaco; y el modelo analítico (viguetas, su reparto y la malla de los
 * reticulares) es el mismo en Node (V8) y en Bun (JavaScriptCore): topología exacta y coordenadas a
 * 1e-12.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { huellasC4 } from "../../validacion/c4/huellas.ts";
import { azar, fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../pruebas/forjadosAleatorios.ts";
import { barajar } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

const bun = (() => {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("criterio 7 de C4: determinismo y huella", () => {
  it("la huella no depende del orden de los paños ni de los ábacos, y cambia con 1e-9 m en un paño, con su intereje, su dirección o un ábaco", () => {
    for (const s of [1, 5]) {
      const f = conForjadosAleatorios(fisicoAleatorio(s), s);
      const r = azar(s);
      const a = compilar(f);
      const losas = (f.losas ?? []).map((l) => (l.reticular?.abacos ? { ...l, reticular: { ...l.reticular, abacos: barajar(l.reticular.abacos, r) } } : l));
      const g: ModeloFisico = { ...f, ...(f.panos ? { panos: barajar(f.panos, r) } : {}), ...(f.losas ? { losas } : {}), cargas: barajar(f.cargas!, r) };
      expect(compilar(g).huella).toBe(a.huella);
      if (f.panos?.length) {
        const p0 = f.panos[0]!;
        const cambia = (p: typeof p0) => compilar({ ...f, panos: [p, ...f.panos!.slice(1)] }).huella;
        expect(cambia({ ...p0, contorno: p0.contorno.map(([x, y], k) => [k === 1 ? x + 1e-9 : x, y] as const) })).not.toBe(a.huella);
        expect(cambia({ ...p0, intereje: p0.intereje + 0.01 })).not.toBe(a.huella);
        expect(cambia({ ...p0, direccion: p0.direccion + 90 })).not.toBe(a.huella);
      }
      if (f.losas?.length) {
        const l0 = f.losas[0]!;
        expect(compilar({ ...f, losas: [{ ...l0, reticular: { ...l0.reticular!, abacos: l0.reticular!.abacos!.slice(1) } }, ...f.losas.slice(1)] }).huella).not.toBe(a.huella);
      }
    }
  });

  it.skipIf(!bun)("el mismo modelo en Node (V8) y en Bun (JavaScriptCore): topología exacta y coordenadas a 1e-12", () => {
    const enBun = JSON.parse(execFileSync("bun", [join(import.meta.dirname, "..", "..", "validacion", "c4", "huellas.ts")], { encoding: "utf8", maxBuffer: 1 << 28 })) as ReturnType<typeof huellasC4>;
    const enNode = huellasC4();
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
