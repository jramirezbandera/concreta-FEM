/**
 * Ejes de replanteo propuestos (I2, criterio 4 de `docs/fem3d/interfaz.md` §14.1): los del edificio
 * objetivo son los de su retícula, la propuesta no depende del orden de las listas ni de una
 * traslación o un giro de la planta, y los ejes no cambian la huella.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Proyecto } from "../agente/proyecto.ts";
import { compilar } from "./compilar.ts";
import { ejesDe, letraEje, MARGEN_EJES, proponerEjes } from "./ejes.ts";
import type { ModeloFisico, Vec2 } from "./fisico.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const leer = (ruta: string) => JSON.parse(readFileSync(join(RAIZ, ruta), "utf8")) as Proyecto;
const edificio = leer("validacion/a2/agente/edificio/proyecto.json");
const portico = leer("validacion/a2/agente/1022/proyecto.json");

/** El mismo modelo con los pilares y las losas movidos por `f` y el eje 1 de las losas girado `giro` grados. */
function mover(m: ModeloFisico, f: (p: Vec2) => Vec2, giro = 0): ModeloFisico {
  return {
    ...m,
    pilares: m.pilares?.map((p) => {
      const [x, y] = f([p.x, p.y]);
      return { ...p, x, y };
    }),
    losas: m.losas?.map((l) => ({ ...l, contorno: l.contorno.map(f), ...(l.huecos ? { huecos: l.huecos.map((h) => h.map(f)) } : {}), eje1: (l.eje1 ?? 0) + giro })),
  };
}

describe("ejes propuestos", () => {
  it("el edificio objetivo: 1–10 según X y A–H según Y, de lado a lado con el margen", () => {
    const { ejes, direccion } = proponerEjes(edificio.modelo, edificio.opciones);
    expect(direccion).toBe(0);
    const numeros = ejes.filter((e) => /^\d+$/.test(e.nombre ?? e.id));
    const letras = ejes.filter((e) => /^[A-Z]+$/.test(e.nombre ?? e.id));
    expect(numeros.map((e) => e.nombre ?? e.id)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)));
    expect(letras.map((e) => e.nombre ?? e.id)).toEqual("ABCDEFGH".split(""));
    numeros.forEach((e, i) => {
      expect(e.desde).toEqual([6 * i, -MARGEN_EJES]);
      expect(e.hasta).toEqual([6 * i, 35 + MARGEN_EJES]);
    });
    letras.forEach((e, i) => {
      expect(e.desde).toEqual([-MARGEN_EJES, 5 * i]);
      expect(e.hasta).toEqual([54 + MARGEN_EJES, 5 * i]);
    });
    // C y G son ids de otros objetos del modelo: el eje lleva otro id y el nombre de siempre
    const ids = new Set([...edificio.modelo.casos, ...edificio.modelo.materiales, ...edificio.modelo.secciones, ...edificio.modelo.plantas].map((x) => x.id));
    for (const e of ejes) {
      expect(ids.has(e.id)).toBe(false);
      if (e.nombre) expect(e.id).toBe(`eje-${e.nombre}`);
    }
  });

  it("un pórtico (una sola fila de pilares): un eje por pilar en la otra dirección", () => {
    const { ejes } = proponerEjes(portico.modelo, portico.opciones);
    expect(ejes.map((e) => e.nombre ?? e.id)).toEqual(["1", "2", "3", "A"]);
  });

  it("no depende del orden de las listas", () => {
    const m = edificio.modelo;
    const r = { ...m, pilares: [...(m.pilares ?? [])].reverse(), losas: [...(m.losas ?? [])].reverse() };
    expect(proponerEjes(r, edificio.opciones)).toEqual(proponerEjes(m, edificio.opciones));
  });

  it("se trasladan y giran con la planta", () => {
    const base = proponerEjes(edificio.modelo, edificio.opciones);
    const [dx, dy] = [123.25, -47.5];
    const t = proponerEjes(mover(edificio.modelo, (p) => [p[0] + dx, p[1] + dy]), edificio.opciones);
    expect(t.ejes.map((e) => e.id)).toEqual(base.ejes.map((e) => e.id));
    t.ejes.forEach((e, i) => {
      const b = base.ejes[i]!;
      for (const [q, r] of [
        [e.desde, b.desde],
        [e.hasta, b.hasta],
      ] as const) {
        expect(q[0]).toBeCloseTo(r[0] + dx, 6);
        expect(q[1]).toBeCloseTo(r[1] + dy, 6);
      }
    });
    const g = 30;
    const [c, s] = [Math.cos((g * Math.PI) / 180), Math.sin((g * Math.PI) / 180)];
    const giro = (p: Vec2): Vec2 => [c * p[0] - s * p[1], s * p[0] + c * p[1]];
    const r = proponerEjes(mover(edificio.modelo, giro, g), edificio.opciones);
    expect(r.direccion).toBeCloseTo(g, 9);
    expect(r.ejes.map((e) => e.id)).toEqual(base.ejes.map((e) => e.id));
    r.ejes.forEach((e, i) => {
      const b = base.ejes[i]!;
      for (const [q, p] of [
        [e.desde, giro(b.desde)],
        [e.hasta, giro(b.hasta)],
      ] as const) {
        expect(q[0]).toBeCloseTo(p[0], 5);
        expect(q[1]).toBeCloseTo(p[1], 5);
      }
    });
  });

  it("los ejes no cambian la huella ni el modelo analítico; sin ejes, se dibujan los propuestos", () => {
    const m = portico.modelo;
    const con: ModeloFisico = { ...m, ejes: [{ id: "X1", desde: [0, -3], hasta: [0, 3] }] };
    const a = compilar(m, portico.opciones);
    const b = compilar(con, portico.opciones);
    expect(a.valido && b.valido).toBe(true);
    expect(b.huella).toBe(a.huella);
    if (a.valido && b.valido) expect(b.modelo).toEqual(a.modelo);
    expect(ejesDe(con).propuestos).toBe(false);
    expect(ejesDe(con).ejes).toEqual(con.ejes);
    expect(ejesDe(m).propuestos).toBe(true);
    // Una lista vacía es «sin ejes», no «los propuestos»
    expect(ejesDe({ ...m, ejes: [] }).ejes).toEqual([]);
  });

  it("letras: A…Z y después AA, AB…", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(letraEje)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
  });
});
