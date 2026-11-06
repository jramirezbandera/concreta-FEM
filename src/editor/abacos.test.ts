/**
 * «Ábacos en los pilares»: en el muestrario, sus 12 ábacos (escritos a mano como cuadrados de 2,40 m
 * centrados en los pilares) salen iguales generados, con la misma huella; y los que ya hay, los que
 * se solaparían y los que se salen del forjado se dicen.
 */
import { describe, expect, it } from "vitest";
import { huellaCompilacion } from "../compilador/compilar.ts";
import { resolverOpciones, type Losa } from "../compilador/fisico.ts";
import { resolverAbacos } from "../compilador/abacos.ts";
import type { Proyecto } from "../agente/proyecto.ts";
import { operacionAbacos, proponerAbacos, type PropuestaAbacos } from "./abacos.ts";
import { aplicar } from "./operaciones.ts";
import { leerEjemplo } from "./serializar.test.ts";

const { proyecto } = leerEjemplo("muestrario");
const huella = (p: Proyecto) => huellaCompilacion(p.modelo, resolverOpciones(p.opciones));
const sinAbacos = (): Proyecto => ({
  ...proyecto,
  modelo: { ...proyecto.modelo, losas: proyecto.modelo.losas!.map((l) => (l.reticular ? { ...l, reticular: { ...l.reticular, abacos: [] } } : l)) },
});
const propuesta = (p: Proyecto, a: number, b = a): PropuestaAbacos => {
  const r = proponerAbacos(p.modelo, "L2", a, b);
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("Ábacos en los pilares", () => {
  it("en el reticular sin ábacos, los de 2,40 m son los del muestrario y dan su huella", () => {
    const p = sinAbacos();
    const r = propuesta(p, 2.4);
    expect(r.nuevos.map((x) => x.pilar)).toEqual(proyecto.modelo.pilares!.map((x) => x.id));
    expect(r.nuevos.map((x) => x.poligono)).toStrictEqual((proyecto.modelo.losas![1] as Losa).reticular!.abacos);
    // Los de fachada se salen del forjado; los de P6 y P7, no
    expect(r.fuera).toEqual(r.nuevos.map((x) => x.pilar).filter((id) => id !== "P6" && id !== "P7"));
    const op = operacionAbacos(p.modelo, r)!;
    const a = aplicar(p, op);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(huella(a.proyecto)).toBe(huella(proyecto));
  });

  it("los pilares que ya tienen ábaco se dejan, y no hay operación si no hay nada nuevo", () => {
    const r = propuesta(proyecto, 2.4);
    expect(r.nuevos).toEqual([]);
    expect(r.conAbaco).toHaveLength(12);
    expect(operacionAbacos(proyecto.modelo, r)).toBeNull();
  });

  it("los que se solapan se crean y se unen en su rectángulo envolvente (AC-b)", () => {
    // 7 m de lado con pilares a 6 m: cada fila de cuatro pilares queda en un solo ábaco
    const p = sinAbacos();
    const r = propuesta(p, 7, 2);
    expect(r.nuevos).toHaveLength(12);
    expect(r.solapados.length).toBeGreaterThan(0);
    const a = aplicar(p, operacionAbacos(p.modelo, r)!);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const l = a.proyecto.modelo.losas!.find((x) => x.id === "L2")!;
    expect(l.reticular!.abacos).toStrictEqual([
      [[-3.5, 10], [21.5, 10], [21.5, 12], [-3.5, 12]],
      [[-3.5, 4.5], [21.5, 4.5], [21.5, 6.5], [-3.5, 6.5]],
      [[-3.5, -1], [21.5, -1], [21.5, 1], [-3.5, 1]],
    ]);
    // Lo escrito es lo que calcula el compilador
    expect(resolverAbacos(a.proyecto.modelo).modelo).toBe(a.proyecto.modelo);
  });

  it("los ábacos siguen la dirección de los nervios (eje 1)", () => {
    const p = sinAbacos();
    p.modelo = { ...p.modelo, losas: p.modelo.losas!.map((l) => (l.id === "L2" ? { ...l, eje1: 90 } : l)) };
    const r = propuesta(p, 3, 1);
    // Con los nervios según Y, los 3 m van según Y
    const q = r.nuevos.find((x) => x.pilar === "P6")!.poligono;
    const xs = q.map((v) => v[0]);
    const ys = q.map((v) => v[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(3, 9);
  });

  it("sólo en un reticular y con medidas positivas", () => {
    expect(proponerAbacos(proyecto.modelo, "L1", 2, 2)).toHaveProperty("error");
    expect(proponerAbacos(proyecto.modelo, "L2", 0, 2)).toHaveProperty("error");
    expect(proponerAbacos(proyecto.modelo, "X", 2, 2)).toHaveProperty("error");
  });
});
