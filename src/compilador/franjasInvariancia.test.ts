/**
 * A2-56 y A2-63 (`docs/fem3d/auditoria-2.md` §11.2), de la segunda auditoría:
 * - A2-63: las franjas de un reticular con vigas de borde no cambian al trasladar la planta. Antes, una
 *   estación de apoyo con un nudo suelto (una lámina que toca la recta en un solo nudo) en el borde de dos
 *   franjas iba entera a la que daba el último bit de su t (0,497 ↔ 0,554 kN·m/m), y una estación de paso
 *   a mitad de dos rectas de la malla tomaba el cociente de A2-2 de la una o de la otra (−14,1 ↔ −15,1).
 * - A2-56: una franja que toca un pilar que se da por apoyado en una viga, sin estación de apoyo junto a
 *   él, lleva `franja/pilar-sin-cara`. Antes callaba.
 * - A2-57: lo que asoma de un pilar más ancho que su viga (unos cm de la franja) no acerca a la cara la
 *   recta de my y mxy de la estación de apoyo (LV2-h): va a un canto, no a 2,5 cm.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { reticulaAleatoria } from "../pruebas/reticulasAleatorias.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico, Vec2 } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function consultas(f: ModeloFisico): Consultas {
  const r = compilar(f, {});
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.codigo).join(", "));
  const c = calcular(r.modelo);
  if (!c.valido) throw new Error("no calcula");
  return new Consultas(f, r, c.casos, {}, c.modal);
}

/** Reticular de 2 × 2 vanos de 5 m con vigas de borde de 30 × 50, pilares de 40 y vuelo de 0,15. */
function reticularBorde(T: (p: Vec2) => Vec2): ModeloFisico {
  const xs = [0, 5, 10];
  const pilares = xs.flatMap((x) =>
    xs.map((y) => {
      const p = T([x, y]);
      return { id: `P${x}-${y}`, x: p[0], y: p[1], desde: "C", hasta: "P1", seccion: "p40" };
    }),
  );
  const vigas = [0, 10].flatMap((c) =>
    [0, 1].flatMap((i) => [
      { id: `VX${c}-${i}`, planta: "P1", puntos: [T([xs[i]!, c]), T([xs[i + 1]!, c])], seccion: "v" },
      { id: `VY${c}-${i}`, planta: "P1", puntos: [T([c, xs[i]!]), T([c, xs[i + 1]!])], seccion: "v" },
    ]),
  );
  const v = 0.15;
  const contorno = ([[-v, -v], [10 + v, -v], [10 + v, 10 + v], [-v, 10 + v]] as Vec2[]).map(T);
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "C", tipo: "sotano", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
      { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
    ],
    pilares,
    vigas,
    losas: [{ id: "L", planta: "P1", contorno, espesor: 0.3, material: "HA", reticular: { intereje: 0.8, nervio: 0.12, capa: 0.05, abacosPilares: { lado: 2 } } }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [{ tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -10] }],
  } as ModeloFisico;
}

describe("A2-63: las franjas no cambian al trasladar la planta", () => {
  it("reticular con vigas de borde, trasladado (37,3; −12,7): las mismas estaciones a 1e-9 del mayor", () => {
    const [dx, dy] = [37.3, -12.7];
    const a = consultas(reticularBorde((p) => p));
    const b = consultas(reticularBorde((p) => [p[0] + dx, p[1] + dy]));
    const fa = a.franjas("L");
    const fb = b.franjas("L");
    if (!fa.valido || !fb.valido) throw new Error("franjas");
    expect(fb.valor.map((f) => f.id)).toEqual(fa.valor.map((f) => f.id));
    let mayor = 0;
    let peor = 0;
    let donde = "";
    let n = 0;
    for (const f of fa.valor) {
      const ea = a.franja(f.id);
      const eb = b.franja(f.id);
      if (!ea.valido || !eb.valido) throw new Error(f.id);
      const sa = ea.valor.estaciones;
      const sb = eb.valor.estaciones;
      expect(sb.length, f.id).toBe(sa.length);
      const ds = f.direccion === 1 ? dx : dy;
      sa.forEach((x, i) => {
        const y = sb[i]!;
        expect([y.tipo, y.lado, Math.abs(y.s - ds - x.s) < 1e-9], `${f.id}[${i}]`).toEqual([x.tipo, x.lado, true]);
        if (!x.valido) return;
        n++;
        x.medios.forEach((v, j) => {
          mayor = Math.max(mayor, Math.abs(v));
          const d = Math.abs(v - y.medios[j]!);
          if (d > peor) [peor, donde] = [d, `${f.id} ${x.tipo} s = ${x.s.toFixed(3)}: ${v} ↔ ${y.medios[j]}`];
        });
      });
    }
    expect(n).toBeGreaterThan(500);
    expect(peor / mayor, donde).toBeLessThan(1e-9);
  }, 300_000);
});

describe("A2-56: el pilar apoyado en una viga, sin estación junto a él", () => {
  it("retícula 8: P3-3 en el extremo de Y3 con el vuelo detrás, la franja L-N1:X16 lo avisa", () => {
    const q = consultas(reticulaAleatoria(8));
    const r = q.franja("L-N1:X16");
    if (!r.valido) throw new Error("franja");
    const d = r.valor.diagnosticos.find((x) => x.codigo === "franja/pilar-sin-cara");
    expect(d?.ids).toContain("P3-3");
    // La de al lado, con la estación de apoyo en la cara de Y3, no
    const v = q.franja("L-N1:X15");
    if (!v.valido) throw new Error("franja");
    expect(v.valor.diagnosticos.some((x) => x.codigo === "franja/pilar-sin-cara" && x.ids?.includes("P3-3"))).toBe(false);
  }, 300_000);

  it("retícula 22: P0-4 de esquina con estaciones de apoyo en las dos caras de X4, sin aviso por él", () => {
    const q = consultas(reticulaAleatoria(22));
    const r = q.franja("L-N1:Y1");
    if (!r.valido) throw new Error("franja");
    expect(r.valor.diagnosticos.some((x) => x.codigo === "franja/pilar-sin-cara" && x.ids?.includes("P0-4"))).toBe(false);
    // Y su franja no pierde ninguna estación válida
    expect(r.valor.estaciones.every((e) => e.valido)).toBe(true);
  }, 300_000);
});

describe("A2-57: un obstáculo que tapa poco de la franja no acerca la recta de muestras", () => {
  it("retícula 8: la estación de apoyo de L-N1:X1 en la cara de Y0, junto a P0-0, toma my y mxy a un canto", () => {
    const f = reticulaAleatoria(8);
    const q = consultas(f);
    const r = q.franja("L-N1:X1");
    if (!r.valido) throw new Error("franja");
    const e = r.valor.estaciones.find((x) => x.tipo === "apoyo" && x.lado === 1 && Math.abs(x.s - 0.15) < 1e-9);
    expect(e?.valido).toBe(true);
    const canto = f.losas!.find((l) => l.id === "L-N1")!.espesor;
    expect(e!.distanciaMuestras).toBeCloseTo(canto, 12);
  }, 300_000);
});
