/**
 * Criterio 5 de la fase AB (`docs/fem3d/armado.md` §4): la armadura base en el proyecto no cambia la
 * huella, pasa el esquema, se valida, sigue a sus losas al renombrarlas, borrarlas o renumerarlas y
 * se deshace.
 */
import { describe, expect, it } from "vitest";
import { huellaCompilacion } from "../compilador/compilar.ts";
import { resolverOpciones } from "../compilador/fisico.ts";
import { deshacer, hacer, historial } from "../editor/historial.ts";
import { aplicar, type Operacion } from "../editor/operaciones.ts";
import { serializar } from "../editor/serializar.ts";
import { leerEjemplo } from "../editor/serializar.test.ts";
import { baseDe, comprobarArmado, hayBase, limpiarArmado } from "./armaduraBase.ts";
import { leerProyecto, type Proyecto } from "./proyecto.ts";

const huella = (p: Proyecto) => huellaCompilacion(p.modelo, resolverOpciones(p.opciones));

function aplicado(p: Proyecto, o: Operacion): Proyecto {
  const r = aplicar(p, o);
  if (!r.ok) throw new Error(r.errores.map((e) => e.mensaje).join(" | "));
  return r.proyecto;
}

const errores = (p: Proyecto, o: Operacion) => {
  const r = aplicar(p, o);
  return r.ok ? [] : r.errores.map((e) => e.codigo);
};

describe("armadura base (AB, criterio 5)", () => {
  const { proyecto: p } = leerEjemplo("edificio");
  const armado = { base: { "x-inf": 20, "x-sup": 25 }, losas: { "L-N7": { "x-inf": 15, "y-sup": 0 } } };

  it("la base de una losa: la suya, si no la común, si no ninguna", () => {
    expect(baseDe(armado, "L-N7", "x-inf")).toBe(15);
    expect(baseDe(armado, "L-N7", "x-sup")).toBe(25);
    expect(baseDe(armado, "L-N7", "y-sup")).toBe(0);
    expect(baseDe(armado, "L-N1", "x-inf")).toBe(20);
    expect(baseDe(armado, "L-N1", "y-inf")).toBeNull();
    expect(baseDe(undefined, "L-N1", "x-inf")).toBeNull();
    expect(hayBase(armado, "y-sup")).toBe(true);
    expect(hayBase(armado, "y-inf")).toBe(false);
  });

  it("guardarla pasa el esquema, no cambia la huella, se vuelve a leer igual y se deshace", () => {
    const h0 = huella(p);
    let h = historial(p);
    const p1 = aplicado(p, { op: "armado", armado });
    h = hacer(h, p1, "base");
    expect(huella(p1)).toBe(h0);
    expect(p1.armado).toEqual(armado);
    const texto = serializar(p1);
    const l = leerProyecto(texto);
    expect(l.valido && l.proyecto.armado).toEqual(armado);
    expect(texto.indexOf('"armado"')).toBeGreaterThan(texto.indexOf('"modelo"'));
    // Quitarla deja el fichero como estaba
    const p2 = aplicado(p1, { op: "armado", armado: null });
    expect(p2.armado).toBeUndefined();
    expect(serializar(p2)).toBe(serializar(p));
    // Lo vacío no se guarda
    expect(aplicado(p, { op: "armado", armado: { base: {}, losas: { "L-N1": {} } } }).armado).toBeUndefined();
    h = deshacer(h);
    expect(serializar(h.actual)).toBe(serializar(p));
  });

  it("rechaza valores negativos o no finitos y losas que no existen", () => {
    expect(errores(p, { op: "armado", armado: { base: { "x-inf": -1 } } })).toEqual(["armado/base"]);
    expect(errores(p, { op: "armado", armado: { base: { "x-inf": Number.NaN } } })).toEqual(["armado/base"]);
    expect(errores(p, { op: "armado", armado: { losas: { "L-N9": { "x-inf": 10 } } } })).toEqual(["armado/losa"]);
    // Un pilar no es una losa
    const pilar = p.modelo.pilares![0]!.id;
    expect(errores(p, { op: "armado", armado: { losas: { [pilar]: { "x-inf": 10 } } } })).toEqual(["armado/losa"]);
    // Un campo desconocido, el esquema
    expect(errores(p, { op: "armado", armado: { base: { "z-inf": 3 } } as never })).not.toEqual([]);
    expect(comprobarArmado(armado, p.modelo)).toEqual([]);
  });

  it("sigue a sus losas: renombrar, borrar y renumerar", () => {
    const p1 = aplicado(p, { op: "armado", armado });
    const l7 = p1.modelo.losas!.find((l) => l.id === "L-N7")!;
    const p2 = aplicado(p1, { op: "cambiar", coleccion: "losas", id: "L-N7", objeto: { ...l7, id: "Cubierta" } });
    expect(p2.armado).toEqual({ base: armado.base, losas: { Cubierta: armado.losas["L-N7"] } });
    expect(comprobarArmado(p2.armado, p2.modelo)).toEqual([]);
    // En un lote, cada paso sigue al anterior
    const p3 = aplicado(p1, {
      op: "lote",
      operaciones: [
        { op: "cambiar", coleccion: "losas", id: "L-N7", objeto: { ...l7, id: "A" } },
        { op: "cambiar", coleccion: "losas", id: "A", objeto: { ...l7, id: "B" } },
      ],
    });
    expect(Object.keys(p3.armado!.losas!)).toEqual(["B"]);
    // Borrarla quita su base, y la común se queda
    const p4 = aplicado(p1, { op: "borrar", ids: ["L-N7"], dependientes: "borrar" });
    expect(p4.armado).toEqual({ base: armado.base });
    const p5 = aplicado(p1, { op: "renumerar" });
    const nuevo = p5.modelo.losas!.find((l) => l.planta === l7.planta)!.id;
    expect(p5.armado!.losas).toEqual({ [nuevo]: armado.losas["L-N7"] });
    expect(comprobarArmado(p5.armado, p5.modelo)).toEqual([]);
  });

  it("lo que ya no era una losa se queda (lo dice comprobarArmado, no se pierde en silencio)", () => {
    const malo: Proyecto = { ...p, armado: { losas: { Fantasma: { "x-inf": 3 } } } };
    const p1 = aplicado(malo, { op: "datos", nombre: "otro" });
    expect(p1.armado).toEqual(malo.armado);
    expect(comprobarArmado(p1.armado, p1.modelo).map((d) => d.codigo)).toEqual(["armado/losa"]);
  });

  it("limpiar ordena las losas y quita lo vacío", () => {
    expect(JSON.stringify(limpiarArmado({ losas: { b: { "x-inf": 1 }, a: { "y-sup": 2 }, c: {} } }))).toBe('{"losas":{"a":{"y-sup":2},"b":{"x-inf":1}}}');
  });
});
