/**
 * Fase AC (`docs/fem3d/abacos.md`): los ábacos uno a uno. Criterio 1: tras cada operación, el
 * fichero tiene lo que dibuja y calcula el compilador (`resolverAbacos` lo deja igual). Criterio 2:
 * lo que sale es lo que se escribiría a mano. Con el muestrario: L2, reticular de 18 × 11 con 12
 * ábacos de 2,40 en pilares a 6 × 5,5 m.
 */
import { describe, expect, it } from "vitest";
import type { Proyecto } from "../agente/proyecto.ts";
import { vistaModelo } from "../agente/render/modelo.ts";
import { resolverAbacos } from "../compilador/abacos.ts";
import type { Losa, ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { objetoEn } from "../visor/escena.ts";
import { asasAbaco, borrarAbacos, cambiarAbaco, crearAbaco, fijarAbacosPilares, idAbaco, leerIdAbaco, moverAsaAbaco, rectanguloDe, unirAbacos, type ResultadoAbacos } from "./abacos.ts";
import { pasoAbaco } from "./dibujo/abaco.ts";
import { indiceEnganches } from "./dibujo/enganches.ts";
import { ESTADO_INICIAL, type ContextoHerramienta } from "./dibujo/herramientas.ts";
import { aplicar } from "./operaciones.ts";
import { leerEjemplo } from "./serializar.test.ts";
import { asas, moverAsa, transformar } from "./transformar.ts";

const { proyecto } = leerEjemplo("muestrario");
const m = proyecto.modelo;
const L2 = () => m.losas!.find((x) => x.id === "L2")!;

/** El proyecto tras la operación (falla si no entra). */
function tras(r: ResultadoAbacos | { ok: true; operacion: unknown } | { ok: false; mensaje: string }, p: Proyecto = proyecto, tolerancia?: number): Proyecto {
  if (!r.ok) throw new Error(r.mensaje);
  const a = aplicar(p, r.operacion as never);
  if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
  // Criterio 1: lo escrito es lo que calcula el compilador
  expect(resolverAbacos(a.proyecto.modelo, tolerancia).modelo).toBe(a.proyecto.modelo);
  return a.proyecto;
}
const abacosDe = (p: Proyecto, losa = "L2") => p.modelo.losas!.find((x) => x.id === losa)!.reticular!.abacos!;

describe("AC: los ábacos uno a uno", () => {
  it("cada ábaco tiene su id de selección, que no es un id del modelo", () => {
    expect(leerIdAbaco(m, "L2/A1")).toEqual({ losa: L2(), i: 0 });
    expect(leerIdAbaco(m, "L2/A12")?.i).toBe(11);
    expect(leerIdAbaco(m, "L2/A13")).toBeNull();
    expect(leerIdAbaco(m, "L1/A1")).toBeNull(); // maciza
    expect(leerIdAbaco(m, "L2/A0")).toBeNull();
    expect(leerIdAbaco(m, "P1")).toBeNull();
  });

  it("un rectángulo según los nervios se reconoce, y uno girado o de cinco vértices no", () => {
    expect(rectanguloDe(L2(), L2().reticular!.abacos![5] as Vec2[])).toEqual({ centro: [6, 5.5], a: 2.4, b: 2.4 });
    const rombo: Vec2[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    expect(rectanguloDe(L2(), rombo)).toBeNull();
    // Con los nervios a 45°, el rombo sí lo es
    expect(rectanguloDe({ ...L2(), eje1: 45 }, rombo)?.a).toBeCloseTo(Math.SQRT2, 6);
  });

  it("uno nuevo que solapa se une con el que pisa en su rectángulo envolvente, y queda elegido el unido", () => {
    // Uno de 2 × 2 centrado en (7, 5.5): pisa el de P6 ([4.8, 7.2] × [4.3, 6.7])
    const r = crearAbaco(m, "L2", [[6, 4.5], [8, 4.5], [8, 6.5], [6, 6.5]]);
    const p = tras(r);
    expect(abacosDe(p)).toHaveLength(12);
    expect(abacosDe(p)[5]).toStrictEqual([[4.8, 4.3], [8, 4.3], [8, 6.7], [4.8, 6.7]]);
    expect(r.ok && r.elegidos).toEqual(["L2/A6"]);
    expect(r.ok && r.avisos[0]).toMatch(/Unido/);
  });

  it("uno a menos de h/2 de otro también se une; a más, no", () => {
    // El de P6 acaba en x = 7.2: uno desde 7.5 (0,3 < 0,375) se une; desde 7.6 (0,4), no
    expect(abacosDe(tras(crearAbaco(m, "L2", [[7.5, 5], [8.5, 5], [8.5, 6], [7.5, 6]])))).toHaveLength(12);
    expect(abacosDe(tras(crearAbaco(m, "L2", [[7.6, 5], [8.6, 5], [8.6, 6], [7.6, 6]])))).toHaveLength(13);
    // Con h = 0,5 la tolerancia es 0,25: el de 0,3 ya no
    expect(abacosDe(tras(crearAbaco(m, "L2", [[7.5, 5], [8.5, 5], [8.5, 6], [7.5, 6]], 0.25), proyecto, 0.25))).toHaveLength(13);
  });

  it("«Unir» dos lejanos da su rectángulo envolvente, en la posición del primero", () => {
    const r = unirAbacos(m, ["L2/A6", "L2/A7"]);
    const p = tras(r);
    expect(abacosDe(p)).toHaveLength(11);
    expect(abacosDe(p)[5]).toStrictEqual([[4.8, 4.3], [13.2, 4.3], [13.2, 6.7], [4.8, 6.7]]);
    expect(r.ok && r.elegidos).toEqual(["L2/A6"]);
    expect(unirAbacos(m, ["L2/A6"]).ok).toBe(false);
  });

  it("«Unir» un rectángulo que pisa a otro se lleva también ése", () => {
    // A6 + A8 (P6 y P8) cubre el de P7 por el medio
    const p = tras(unirAbacos(m, ["L2/A6", "L2/A8"]));
    expect(abacosDe(p)).toHaveLength(10);
    expect(abacosDe(p)[5]).toStrictEqual([[4.8, 4.3], [19.2, 4.3], [19.2, 6.7], [4.8, 6.7]]);
  });

  it("borrar quita sólo los elegidos, en una operación por losa", () => {
    const p = tras(borrarAbacos(m, ["L2/A1", "L2/A12", "P1"]));
    expect(abacosDe(p)).toStrictEqual(abacosDe(proyecto).slice(1, 11));
  });

  it("cambiar uno por otro polígono, también no convexo", () => {
    const L: Vec2[] = [[5, 4.5], [7, 4.5], [7, 5.5], [6, 5.5], [6, 6.5], [5, 6.5]];
    expect(abacosDe(tras(cambiarAbaco(m, "L2/A6", L)))[5]).toStrictEqual(L);
  });

  it("pinzamientos: el vértice se mueve con el opuesto fijo y el lado en paralelo; sigue siendo un rectángulo", () => {
    const as = asasAbaco(m, "L2/A6");
    expect(as.filter((a) => a.tipo === "vertice")).toHaveLength(4);
    expect(as.filter((a) => a.tipo === "lado")).toHaveLength(4);
    // El vértice (7.2, 6.7) a (8, 7): el opuesto (4.8, 4.3) se queda
    const v = as.find((a) => a.tipo === "vertice" && a.p[0] === 7.2 && a.p[1] === 6.7)!;
    expect(abacosDe(tras(moverAsaAbaco(m, v, [8, 7])))[5]).toStrictEqual([[4.8, 4.3], [8, 4.3], [8, 7], [4.8, 7]]);
    // El lado derecho (x = 7.2) a x = 7.7: sólo cuenta lo perpendicular (la y del ratón no)
    const d = as.find((a) => a.tipo === "lado" && a.p[0] === 7.2)!;
    expect(abacosDe(tras(moverAsaAbaco(m, d, [7.7, 9])))[5]).toStrictEqual([[4.8, 4.3], [7.7, 4.3], [7.7, 6.7], [4.8, 6.7]]);
    // Llevar el lado hasta el otro: sin área
    expect(moverAsaAbaco(m, d, [4.8, 5.5]).ok).toBe(false);
  });

  it("los pinzamientos van por transformar: con el ábaco elegido, sus asas; con la losa, ya no", () => {
    expect(asas(m, ["L2/A6"], "PL1")).toHaveLength(8);
    expect(asas(m, ["L2"], "PL1").some((a) => a.ruta[0] === "reticular")).toBe(false);
    const d = asas(m, ["L2/A6"], "PL1").find((a) => a.ruta[1] === "lado" && a.p[0] === 7.2)!;
    // Hasta pisar el de P7 (que empieza en 10.8): se unen
    const r = moverAsa(m, d, [11, 5.5]);
    const p = tras(r);
    expect(abacosDe(p)).toHaveLength(11);
    expect(r.ok && r.elegidos).toEqual(["L2/A6"]);
  });

  it("Mover y Copiar los ábacos elegidos, y unirlos si caen encima de otro", () => {
    // A6 dos metros a la derecha: no pisa a nadie (queda de 6.8 a 9.2; el de P7 empieza en 10.8)
    let r = transformar(m, ["L2/A6"], { tipo: "mover", de: [0, 0], a: [2, 0] });
    let p = tras(r);
    expect(abacosDe(p)[5]).toStrictEqual([[6.8, 4.3], [9.2, 4.3], [9.2, 6.7], [6.8, 6.7]]);
    expect(r.ok && r.elegidos).toEqual(["L2/A6"]);
    // Cinco metros: pisa el de P7 y se une con él (sale de la lista y queda en la posición de P6)
    r = transformar(m, ["L2/A6"], { tipo: "mover", de: [0, 0], a: [5, 0] });
    p = tras(r);
    expect(abacosDe(p)).toHaveLength(11);
    expect(abacosDe(p)[5]).toStrictEqual([[9.8, 4.3], [13.2, 4.3], [13.2, 6.7], [9.8, 6.7]]);
    // Copiar: el original se queda y la copia va al final
    r = transformar(m, ["L2/A6"], { tipo: "mover", de: [0, 0], a: [3, 0] }, { copiar: true });
    p = tras(r);
    expect(abacosDe(p)).toHaveLength(13);
    expect(abacosDe(p)[12]).toStrictEqual([[7.8, 4.3], [10.2, 4.3], [10.2, 6.7], [7.8, 6.7]]);
    expect(r.ok && r.nuevos).toEqual(["L2/A13"]);
  });

  it("un ábaco de una losa que también se elige va con ella, no dos veces", () => {
    const r = transformar(m, ["L2", "L2/A6"], { tipo: "mover", de: [0, 0], a: [1, 0] });
    const p = tras(r);
    expect(abacosDe(p)[5]).toStrictEqual(abacosDe(proyecto)[5]!.map((q) => [q[0] + 1, q[1]]));
  });

  it("«Fijar como polígonos» deja en el fichero los ábacos de los pilares que calcula el compilador", () => {
    const sin: ModeloFisico = { ...m, losas: m.losas!.map((l) => (l.id === "L2" ? ({ ...l, reticular: { ...l.reticular!, abacos: [], abacosPilares: { lado: 2.4 } } } as Losa) : l)) };
    const p = tras(fijarAbacosPilares(sin, "L2"), { ...proyecto, modelo: sin });
    expect(abacosDe(p)).toStrictEqual(abacosDe(proyecto));
    expect(p.modelo.losas!.find((x) => x.id === "L2")!.reticular!.abacosPilares).toBeUndefined();
  });

  it("la planta dibuja cada ábaco con su id, y un clic en él lo elige antes que a la losa", () => {
    const e = vistaModelo(m, "PL1", { huella: "0".repeat(64), nombre: "muestrario" } as never);
    const ids = new Set(e.primitivas.flatMap((p) => ("objeto" in p && p.objeto?.startsWith("L2/") ? [p.objeto] : [])));
    expect(ids.size).toBe(12);
    expect(objetoEn(e, [6, 5.5 + 1], 0.05)).toBe("L2/A6");
    expect(objetoEn(e, [3, 3], 0.05)).toBe("L2");
  });

  it("la herramienta Ábaco: un clic en un pilar, y el rectángulo de dos esquinas", () => {
    const sin: ModeloFisico = { ...m, losas: m.losas!.map((l) => (l.id === "L2" ? ({ ...l, reticular: { ...l.reticular!, abacos: [] } } as Losa) : l)) };
    const ctx = (abaco: ContextoHerramienta["plantillas"]["abaco"], modelo = sin): ContextoHerramienta => ({ modelo, planta: "PL1", indice: indiceEnganches(modelo, "PL1"), plantillas: { pilar: {}, viga: {}, abaco } });
    // En P6, el de 2,40 por defecto: el del muestrario, byte a byte
    const r = pasoAbaco(ESTADO_INICIAL, { tipo: "punto", p: [6.1, 5.4], cursor: [6.1, 5.4], radio: 0.1 }, ctx({}));
    expect(r.hecho).toBeDefined();
    const p = tras({ ok: true, operacion: r.hecho!.operacion }, { ...proyecto, modelo: sin });
    expect(abacosDe(p)).toStrictEqual([abacosDe(proyecto)[5]]);
    // Otra vez en P6: ya tiene
    expect(pasoAbaco(ESTADO_INICIAL, { tipo: "punto", p: [6, 5.5], radio: 0.1 }, ctx({}, p.modelo)).error).toMatch(/ya tiene ábaco/);
    // Fuera de un pilar
    expect(pasoAbaco(ESTADO_INICIAL, { tipo: "punto", p: [3, 3], radio: 0.1 }, ctx({})).error).toMatch(/pilar/);
    // Rectángulo: la primera esquina en el reticular, la segunda donde sea
    const c = ctx({ modo: "rectangulo" });
    const r1 = pasoAbaco(ESTADO_INICIAL, { tipo: "punto", p: [2, 2] }, c);
    expect(r1.estado.objeto).toBe("L2");
    const r2 = pasoAbaco(r1.estado, { tipo: "punto", p: [4, 3] }, c);
    expect(abacosDe(tras({ ok: true, operacion: r2.hecho!.operacion }, { ...proyecto, modelo: sin }))).toStrictEqual([[[2, 2], [4, 2], [4, 3], [2, 3]]]);
  });

  it("el id de selección sigue a la lista: idAbaco y leerIdAbaco son inversos", () => {
    for (let i = 0; i < 12; i++) expect(leerIdAbaco(m, idAbaco("L2", i))?.i).toBe(i);
  });
});
