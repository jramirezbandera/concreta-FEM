/**
 * Criterio 7 de C5: determinismo y huella con las bandas propuestas.
 * - La huella de compilación incluye las bandas (su ancho, sus apoyos) y no depende de su orden.
 * - La propuesta y la malla con sus caras (trazos exactos, C5-g) son las mismas en Node (V8) y en
 *   Bun (JavaScriptCore), también con la planta girada 37°.
 * - Trasladar, girar 90° o 37° la planta, o reordenar sus listas, da la misma malla transformada.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conPropuesta, huellasC5, losaPilaresMezclados } from "../../validacion/c5/huellas.ts";
import { azar } from "../pruebas/fisicoAleatorio.ts";
import { barajar, planos, transformar } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, Vec2 } from "./fisico.ts";

const bun = (() => {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("criterio 7 de C5: determinismo y huella con las bandas", () => {
  const f = conPropuesta(losaPilaresMezclados());

  it("la huella incluye las bandas y no depende de su orden", () => {
    const a = compilar(f).huella;
    expect(compilar({ ...f, bandas: barajar(f.bandas!, azar(5)) }).huella).toBe(a);
    const cambiar = (i: number, g: (b: NonNullable<ModeloFisico["bandas"]>[number]) => object) => ({ ...f, bandas: f.bandas!.map((b, k) => (k === i ? { ...b, ...g(b) } : b)) });
    expect(compilar(cambiar(0, (b) => ({ ancho: b.ancho + 1e-9 }))).huella).not.toBe(a);
    expect(compilar(cambiar(0, (b) => ({ apoyos: b.apoyos!.slice(1) }))).huella).not.toBe(a);
    expect(compilar(cambiar(0, () => ({ origen: "usuario" }))).huella).not.toBe(a);
  });

  it("trasladar, girar 90° o 37° la planta, o reordenar sus listas, da la misma malla transformada", () => {
    const r = compilar(f);
    if (!r.valido) throw new Error("no válido");
    const clave = (x: number, y: number, z: number) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
    const nudos = new Set(r.modelo.nudos.map((n) => clave(n.x, n.y, n.z)));
    const variantes: [string, ModeloFisico, (q: Vec2) => Vec2][] = [
      ...planos().map(({ nombre, t }): [string, ModeloFisico, (q: Vec2) => Vec2] => {
        // La inversa de la transformación de la planta
        const [p0, p1, p2] = [t.p([0, 0]), t.p([1, 0]), t.p([0, 1])];
        const [a, b, c, d] = [p1[0] - p0[0], p2[0] - p0[0], p1[1] - p0[1], p2[1] - p0[1]];
        const det = a * d - b * c;
        const inv = (q: Vec2): Vec2 => [(d * (q[0] - p0[0]) - b * (q[1] - p0[1])) / det, (-c * (q[0] - p0[0]) + a * (q[1] - p0[1])) / det];
        return [nombre, conPropuesta(transformar(losaPilaresMezclados(), t)), inv];
      }),
      ["listas al revés", { ...f, pilares: [...f.pilares!].reverse(), bandas: [...f.bandas!].reverse(), cargas: [...f.cargas!].reverse() }, (q) => q],
    ];
    for (const [nombre, g, inv] of variantes) {
      const s = compilar(g);
      if (!s.valido) throw new Error(`${nombre}: no válido`);
      expect(s.estadisticas.nudos, nombre).toBe(r.estadisticas.nudos);
      expect(s.estadisticas.laminas, nombre).toBe(r.estadisticas.laminas);
      expect(s.estadisticas.malla.plantillas, nombre).toBe(r.estadisticas.malla.plantillas);
      const fuera = s.modelo.nudos.filter((n) => {
        const [x, y] = inv([n.x, n.y]);
        return !nudos.has(clave(x, y, n.z));
      });
      expect(fuera.length, nombre).toBe(0);
    }
  });

  it.skipIf(!bun)("la misma propuesta y la misma malla en Node (V8) y en Bun (JavaScriptCore)", () => {
    const enBun = JSON.parse(execFileSync("bun", [join(import.meta.dirname, "..", "..", "validacion", "c5", "huellas.ts")], { encoding: "utf8", maxBuffer: 1 << 28 })) as ReturnType<typeof huellasC5>;
    const enNode = huellasC5();
    expect(enBun.length).toBe(enNode.length);
    enNode.forEach((a, i) => {
      const b = enBun[i]!;
      expect(b.nombre).toBe(a.nombre);
      expect(b.bandas, a.nombre).toBe(a.bandas);
      expect(b.compilacion, a.nombre).toBe(a.compilacion);
      expect(b.topologia, a.nombre).toBe(a.topologia);
      expect(b.coordenadas.length, a.nombre).toBe(a.coordenadas.length);
      let peor = 0;
      a.coordenadas.forEach((x, k) => (peor = Math.max(peor, Math.abs(x - b.coordenadas[k]!) / Math.max(1, Math.abs(x)))));
      expect(peor, a.nombre).toBeLessThan(1e-12);
    });
  });
});
