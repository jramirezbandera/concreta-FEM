/**
 * Fase CO1 (`docs/fem3d/comprobaciones.md` §4.4): el armado de los pilares en el `proyecto.json`
 * (`armado.pilares`) y los datos comunes de las armaduras (`obra.armado`). No cambian la huella,
 * pasan el esquema, se validan, siguen a sus pilares y a sus plantas al renombrarlos o borrarlos y
 * no rompen la armadura base de las losas, que va en el mismo bloque.
 */
import { describe, expect, it } from "vitest";
import { leerProyecto, type Proyecto } from "../agente/proyecto.ts";
import { huellaCompilacion } from "../compilador/compilar.ts";
import { resolverOpciones } from "../compilador/fisico.ts";
import { aplicar, type Operacion } from "../editor/operaciones.ts";
import { serializar } from "../editor/serializar.ts";
import { leerEjemplo } from "../editor/serializar.test.ts";
import type { ArmadoTramoPilar } from "./armado.ts";

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

describe("CO1: el armado de los pilares en el proyecto", () => {
  const { proyecto: p } = leerEjemplo("edificio");
  const [pa, pb] = p.modelo.pilares!.map((x) => x.id) as [string, string];
  const [arriba, debajo] = p.modelo.plantas.map((x) => x.id) as [string, string];
  const tramo: ArmadoTramoPilar = { esquinas: 16, caraB: { n: 1, diametro: 12 }, cercos: { diametro: 6, separacion: 140 } };
  const armado = { base: { "x-inf": 20 }, pilares: { [pb]: { [arriba]: tramo }, [pa]: { [arriba]: tramo, [debajo]: { ...tramo, esquinas: 20 } } } };

  it("guardarlo pasa el esquema, no cambia la huella y se vuelve a leer igual", () => {
    const p1 = aplicado(p, { op: "armado", armado });
    expect(huella(p1)).toBe(huella(p));
    expect(Object.keys(p1.armado!.pilares!)).toEqual([pa, pb].sort());
    expect(p1.armado!.base).toEqual({ "x-inf": 20 });
    const l = leerProyecto(serializar(p1));
    if (!l.valido) throw new Error(l.diagnosticos.map((d) => d.mensaje).join(" "));
    expect(l.proyecto.armado).toEqual(p1.armado);
    // Un pilar sin tramos no se guarda
    expect(aplicado(p, { op: "armado", armado: { pilares: { [pa]: {} } } }).armado).toBeUndefined();
  });

  it("lo que no vale: un pilar o una planta que no son del modelo, y barras que no existen", () => {
    expect(errores(p, { op: "armado", armado: { pilares: { "no-es": { [arriba]: tramo } } } })).toEqual(["armado/pilar"]);
    expect(errores(p, { op: "armado", armado: { pilares: { [pa]: { "no-es": tramo } } } })).toEqual(["armado/planta"]);
    expect(errores(p, { op: "armado", armado: { pilares: { [pa]: { [arriba]: { ...tramo, esquinas: 14 } } } } })).toEqual(["armado/barras"]);
    expect(errores(p, { op: "armado", armado: { pilares: { [pa]: { [arriba]: { ...tramo, cercos: { diametro: 6, separacion: 0 } } } } } })).toEqual(["armado/barras"]);
    expect(errores(p, { op: "armado", armado: { pilares: { [pa]: { [arriba]: { anillo: { n: 8, diametro: 16 }, esquinas: 16, cercos: tramo.cercos } } } } })).toEqual(["armado/barras"]);
    // Un campo que no es del armado lo rechaza el esquema
    expect(errores(p, { op: "armado", armado: { pilares: { [pa]: { [arriba]: { ...tramo, estribos: 3 } as unknown as ArmadoTramoPilar } } } }).length).toBeGreaterThan(0);
  });

  it("sigue a sus pilares: renombrar, borrar y renumerar", () => {
    const p1 = aplicado(p, { op: "armado", armado });
    const pilar = p1.modelo.pilares!.find((x) => x.id === pa)!;
    const p2 = aplicado(p1, { op: "cambiar", coleccion: "pilares", id: pa, objeto: { ...pilar, id: "PILAR-NUEVO" } });
    expect(Object.keys(p2.armado!.pilares!).sort()).toEqual(["PILAR-NUEVO", pb].sort());
    expect(p2.armado!.pilares!["PILAR-NUEVO"]).toEqual(armado.pilares[pa]);
    const p3 = aplicado(p1, { op: "borrar", ids: [pa], dependientes: "borrar" });
    expect(Object.keys(p3.armado!.pilares!)).toEqual([pb]);
    expect(p3.armado!.base).toEqual({ "x-inf": 20 });
    const p4 = aplicado(p1, { op: "renumerar" });
    const ids = new Set(p4.modelo.pilares!.map((x) => x.id));
    expect(Object.keys(p4.armado!.pilares!).length).toBe(2);
    for (const id of Object.keys(p4.armado!.pilares!)) expect(ids.has(id)).toBe(true);
  });

  it("los datos comunes de las armaduras, en la obra: fuera de la huella y con sus límites", () => {
    const p1 = aplicado(p, { op: "obra", obra: { ...p.obra, armado: { fyk: 400, recubrimiento: 35 } } });
    expect(p1.obra!.armado).toEqual({ fyk: 400, recubrimiento: 35 });
    expect(huella(p1)).toBe(huella(p));
    const l = leerProyecto(serializar(p1));
    expect(l.valido && l.proyecto.obra?.armado).toEqual({ fyk: 400, recubrimiento: 35 });
    expect(errores(p, { op: "obra", obra: { armado: { fyk: 100 } } })).toEqual(["obra/armado"]);
    expect(errores(p, { op: "obra", obra: { armado: { recubrimiento: 300 } } })).toEqual(["obra/armado"]);
  });
});
