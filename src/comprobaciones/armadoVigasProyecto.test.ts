/**
 * Fase CO2 (`docs/fem3d/comprobaciones.md` §4.4): el armado de las vigas en el `proyecto.json`
 * (`armado.vigas`) y los datos comunes que añade (`obra.armado.exposicion` y `flechaActiva`). No
 * cambian la huella, pasan el esquema, se validan, siguen a sus vigas al renombrarlas o borrarlas y
 * conviven con el armado de los pilares y la armadura base de las losas, que van en el mismo bloque.
 */
import { describe, expect, it } from "vitest";
import { leerProyecto, type Proyecto } from "../agente/proyecto.ts";
import { huellaCompilacion } from "../compilador/compilar.ts";
import { resolverOpciones } from "../compilador/fisico.ts";
import { aplicar, type Operacion } from "../editor/operaciones.ts";
import { serializar } from "../editor/serializar.ts";
import { leerEjemplo } from "../editor/serializar.test.ts";
import { areaVano, textoArmadoViga, type ArmadoVanoViga } from "./armado.ts";

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

describe("CO2: el armado de las vigas en el proyecto", () => {
  const { proyecto: p } = leerEjemplo("edificio");
  const [va, vb] = p.modelo.vigas!.map((x) => x.id) as [string, string];
  const vano: ArmadoVanoViga = { inferior: { n: 3, diametro: 16 }, superior: { n: 2, diametro: 12 }, superiorInicio: { n: 4, diametro: 16 }, cercos: { diametro: 8, separacion: 200 }, cercosFin: { diametro: 8, separacion: 100, ramas: 4 } };
  const armado = { base: { "x-inf": 20 }, vigas: { [vb]: [vano], [va]: [null, vano, { ...vano, piel: { n: 1, diametro: 12 } }] } };

  it("guardarlo pasa el esquema, no cambia la huella y se vuelve a leer igual", () => {
    const p1 = aplicado(p, { op: "armado", armado });
    expect(huella(p1)).toBe(huella(p));
    expect(Object.keys(p1.armado!.vigas!)).toEqual([va, vb].sort());
    expect(p1.armado!.base).toEqual({ "x-inf": 20 });
    const l = leerProyecto(serializar(p1));
    if (!l.valido) throw new Error(l.diagnosticos.map((d) => d.mensaje).join(" "));
    expect(l.proyecto.armado).toEqual(p1.armado);
    expect(l.proyecto.armado!.vigas![va]![0]).toBeNull();
    // Una viga con todos sus vanos sin armado no se guarda
    expect(aplicado(p, { op: "armado", armado: { vigas: { [va]: [null, null] } } }).armado).toBeUndefined();
  });

  it("lo que no vale: una viga que no es del modelo y barras o cercos que no existen", () => {
    expect(errores(p, { op: "armado", armado: { vigas: { "no-es": [vano] } } })).toEqual(["armado/viga"]);
    expect(errores(p, { op: "armado", armado: { vigas: { [va]: [{ ...vano, inferior: { n: 3, diametro: 14 } }] } } })).toEqual(["armado/barras"]);
    expect(errores(p, { op: "armado", armado: { vigas: { [va]: [{ ...vano, superior: { n: 1, diametro: 12 } }] } } })).toEqual(["armado/barras"]);
    expect(errores(p, { op: "armado", armado: { vigas: { [va]: [{ ...vano, cercos: { diametro: 8, separacion: 0 } }] } } })).toEqual(["armado/barras"]);
    expect(errores(p, { op: "armado", armado: { vigas: { [va]: [{ ...vano, cercosFin: { diametro: 8, separacion: 100, ramas: 1 } }] } } })).toEqual(["armado/barras"]);
    // Un campo que no es del armado, o un vano sin su armadura inferior, lo rechaza el esquema
    expect(errores(p, { op: "armado", armado: { vigas: { [va]: [{ ...vano, estribos: 3 } as unknown as ArmadoVanoViga] } } }).length).toBeGreaterThan(0);
    const { inferior: _i, ...sinInferior } = vano;
    expect(errores(p, { op: "armado", armado: { vigas: { [va]: [sinInferior as unknown as ArmadoVanoViga] } } }).length).toBeGreaterThan(0);
  });

  it("sigue a sus vigas: renombrar, borrar y renumerar, sin tocar lo de los pilares", () => {
    const pilar = p.modelo.pilares![0]!.id;
    const planta = p.modelo.plantas[0]!.id;
    const conPilares = { ...armado, pilares: { [pilar]: { [planta]: { esquinas: 16, cercos: { diametro: 6, separacion: 140 } } } } };
    const p1 = aplicado(p, { op: "armado", armado: conPilares });
    const viga = p1.modelo.vigas!.find((x) => x.id === va)!;
    const p2 = aplicado(p1, { op: "cambiar", coleccion: "vigas", id: va, objeto: { ...viga, id: "VIGA-NUEVA" } });
    expect(Object.keys(p2.armado!.vigas!).sort()).toEqual(["VIGA-NUEVA", vb].sort());
    expect(p2.armado!.vigas!["VIGA-NUEVA"]).toEqual(armado.vigas[va]);
    expect(p2.armado!.pilares).toEqual(conPilares.pilares);
    const p3 = aplicado(p1, { op: "borrar", ids: [va], dependientes: "borrar" });
    expect(Object.keys(p3.armado!.vigas!)).toEqual([vb]);
    expect(p3.armado!.base).toEqual({ "x-inf": 20 });
    expect(p3.armado!.pilares).toEqual(conPilares.pilares);
    const p4 = aplicado(p1, { op: "renumerar" });
    const ids = new Set(p4.modelo.vigas!.map((x) => x.id));
    expect(Object.keys(p4.armado!.vigas!).length).toBe(2);
    for (const id of Object.keys(p4.armado!.vigas!)) expect(ids.has(id)).toBe(true);
  });

  it("la clase de exposición y el límite de la flecha activa, en la obra: fuera de la huella y con sus valores", () => {
    const p1 = aplicado(p, { op: "obra", obra: { ...p.obra, armado: { exposicion: "XC1", flechaActiva: 500 } } });
    expect(p1.obra!.armado).toEqual({ exposicion: "XC1", flechaActiva: 500 });
    expect(huella(p1)).toBe(huella(p));
    const l = leerProyecto(serializar(p1));
    expect(l.valido && l.proyecto.obra?.armado).toEqual({ exposicion: "XC1", flechaActiva: 500 });
    expect(errores(p, { op: "obra", obra: { armado: { flechaActiva: 250 } } })).toEqual(["obra/armado"]);
    expect(errores(p, { op: "obra", obra: { armado: { exposicion: "XS1" as "XC1" } } }).length).toBeGreaterThan(0);
  });

  it("el texto y el acero de un vano", () => {
    expect(textoArmadoViga(vano)).toBe("inf 3Ø16 · sup 2Ø12 (inicio 4Ø16) · cØ8/200 (fin cØ8/100 (4R))");
    expect(textoArmadoViga({ inferior: { n: 2, diametro: 12 }, superior: { n: 2, diametro: 12 }, cercos: { diametro: 6, separacion: 150, ramas: 3 }, piel: { n: 1, diametro: 12 } })).toBe("inf 2Ø12 · sup 2Ø12 · cØ6/150 (3R) · piel 1Ø12 por cara");
    // El corrido, más lo de los apoyos a un cuarto de la luz cada uno
    const A = (n: number, d: number) => (n * Math.PI * d * d) / 4;
    expect(areaVano(vano)).toBeCloseTo(A(3, 16) + 0.5 * A(2, 12) + 0.25 * A(4, 16) + 0.25 * A(2, 12), 9);
  });
});
