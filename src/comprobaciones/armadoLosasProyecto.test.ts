/**
 * Fase CO3 (`docs/fem3d/comprobaciones.md` §4.4): el armado de las losas en el `proyecto.json`
 * (`armado.forjados`). No cambia la huella, pasa el esquema, se valida, sigue a sus losas al
 * renombrarlas o borrarlas y convive con la armadura base de AB (`armado.losas`, kN·m/m), que va en el
 * mismo bloque.
 */
import { describe, expect, it } from "vitest";
import { losaPlana } from "../../validacion/co/modelosLosas.ts";
import { leerProyecto, VERSION_ESQUEMA, type Proyecto } from "../agente/proyecto.ts";
import { huellaCompilacion } from "../compilador/compilar.ts";
import { resolverOpciones } from "../compilador/fisico.ts";
import { aplicar, type Operacion } from "../editor/operaciones.ts";
import { serializar } from "../editor/serializar.ts";
import { areaBarrasForjado, textoArmadoForjado, textoBarrasForjado, type ArmadoForjado, type BarrasForjado } from "./armado.ts";

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

const cuatro = (b: BarrasForjado): ArmadoForjado["base"] => ({ "x-inf": b, "x-sup": b, "y-inf": b, "y-sup": b });

describe("CO3: el armado de las losas en el proyecto", () => {
  const p: Proyecto = { esquema: VERSION_ESQUEMA, modelo: losaPlana({ reticular: true }) };
  const forjado: ArmadoForjado = {
    base: cuatro({ diametro: 12, n: 2 }),
    abacos: cuatro({ diametro: 12, separacion: 200 }),
    refuerzos: [
      { armadura: "x-sup", s: [5, 7], t: [5, 7], barras: { diametro: 16, separacion: 150 }, en: "abacos" },
      { armadura: "y-inf", s: [1, 4.5], t: [0.4, 2], barras: { diametro: 12, n: 1 }, en: "nervios" },
    ],
    cercos: [{ direccion: "x", s: [4, 4.6], t: [5.2, 6.8], cercos: { diametro: 6, separacion: 150 } }],
  };
  const armado = { losas: { L: { "x-inf": 25 } }, forjados: { L: forjado } };

  it("guardarlo pasa el esquema, no cambia la huella y se vuelve a leer igual", () => {
    const p1 = aplicado(p, { op: "armado", armado });
    expect(huella(p1)).toBe(huella(p));
    expect(p1.armado).toEqual(armado);
    const l = leerProyecto(serializar(p1));
    if (!l.valido) throw new Error(l.diagnosticos.map((d) => d.mensaje).join(" "));
    expect(l.proyecto.armado).toEqual(armado);
  });

  it("lo que no vale: una losa que no es del modelo, barras que no existen y campos que no son del armado", () => {
    expect(errores(p, { op: "armado", armado: { forjados: { "no-es": forjado } } })).toEqual(["armado/losa"]);
    expect(errores(p, { op: "armado", armado: { forjados: { L: { ...forjado, base: cuatro({ diametro: 14, n: 2 }) } } } })).toEqual(["armado/barras", "armado/barras", "armado/barras", "armado/barras"]);
    expect(errores(p, { op: "armado", armado: { forjados: { L: { ...forjado, refuerzos: [{ ...forjado.refuerzos![0]!, en: "nervios" }] } } } })).toEqual(["armado/barras", "armado/barras"]);
    // Un campo que no es del armado, o una base a la que le falta una armadura, lo rechaza el esquema
    expect(errores(p, { op: "armado", armado: { forjados: { L: { ...forjado, mallazo: 3 } as unknown as ArmadoForjado } } }).length).toBeGreaterThan(0);
    const { "y-sup": _y, ...tres } = forjado.base;
    expect(errores(p, { op: "armado", armado: { forjados: { L: { ...forjado, base: tres as unknown as ArmadoForjado["base"] } } } }).length).toBeGreaterThan(0);
  });

  it("sigue a su losa: renombrarla y borrarla, con la armadura base de AB", () => {
    const p1 = aplicado(p, { op: "armado", armado });
    const losa = p1.modelo.losas![0]!;
    const p2 = aplicado(p1, { op: "cambiar", coleccion: "losas", id: "L", objeto: { ...losa, id: "FORJADO" } });
    expect(p2.armado).toEqual({ losas: { FORJADO: { "x-inf": 25 } }, forjados: { FORJADO: forjado } });
    const p3 = aplicado(p1, { op: "borrar", ids: ["L"], dependientes: "borrar" });
    expect(p3.armado).toBeUndefined();
  });

  it("los textos y el acero de unas barras", () => {
    expect(textoBarrasForjado({ diametro: 12, separacion: 200 })).toBe("Ø12/200");
    expect(textoBarrasForjado({ diametro: 16, n: 2 })).toBe("2Ø16");
    expect(areaBarrasForjado({ diametro: 12, separacion: 200 })).toBeCloseTo((Math.PI * 36 * 1000) / 200, 9);
    expect(areaBarrasForjado({ diametro: 16, n: 2 })).toBeCloseTo(2 * Math.PI * 64, 9);
    expect(textoArmadoForjado(forjado)).toBe("x-inf 2Ø12 · x-sup 2Ø12 · y-inf 2Ø12 · y-sup 2Ø12 · ábacos: x-inf Ø12/200 · x-sup Ø12/200 · y-inf Ø12/200 · y-sup Ø12/200 · 2 refuerzos · 1 zona de cercos");
  });
});
