/**
 * DO1 (`docs/fem3d/datos-obra.md` §5): los datos de la obra en el proyecto y en el editor.
 * - criterio 1: un proyecto sin `obra` no cambia, y `obra` no entra en la huella;
 * - criterio 2: el material por defecto de un tipo manda sobre el más usado;
 * - criterio 3: «cambiar también las existentes» toca sólo las piezas del tipo, copia sólo las
 *   secciones compartidas, y deshacer da los bytes de partida.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { comprobarObra, TIPOS_OBRA, type ObraProyecto } from "../agente/obra.ts";
import { leerProyecto, VERSION_ESQUEMA, type Proyecto } from "../agente/proyecto.ts";
import { huellaCompilacion } from "../compilador/compilar.ts";
import { resolverOpciones, type ModeloFisico } from "../compilador/fisico.ts";
import { reticulaEnrasada } from "../../validacion/c2/modelos.ts";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { edificioReticular, edificioUnidireccional } from "../../validacion/c4/modelos.ts";
import { materialPropuesto } from "./gestores.ts";
import { deshacer, hacer, historial } from "./historial.ts";
import { aplicarObra, piezasACambiar } from "./obra.ts";
import { aplicar, type Operacion } from "./operaciones.ts";
import { proyectoNuevo } from "./plantilla.ts";
import { serializar } from "./serializar.ts";
import { leerEjemplo } from "./serializar.test.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const proyecto = (modelo: ModeloFisico): Proyecto => ({ esquema: VERSION_ESQUEMA, modelo });
const huella = (p: Proyecto) => huellaCompilacion(p.modelo, resolverOpciones(p.opciones));

function aplicado(p: Proyecto, o: Operacion): Proyecto {
  const r = aplicar(p, o);
  if (!r.ok) throw new Error(r.errores.map((e) => e.mensaje).join(" "));
  return r.proyecto;
}

function referencias(): [string, Proyecto][] {
  const vivienda = leerProyecto(readFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8"));
  if (!vivienda.valido) throw new Error("vivienda");
  return [
    ["1-022", leerEjemplo("1022").proyecto],
    ["reticula enrasada (C2)", proyecto(reticulaEnrasada())],
    ["reticula con nucleo (C3)", proyecto(reticulaConNucleo())],
    ["reticular (C4)", proyecto(edificioReticular(2, 3, 2))],
    ["unidireccional (C4)", proyecto(edificioUnidireccional(2, 3, 2))],
    ["vivienda", vivienda.proyecto],
  ];
}

/** Un modelo pequeño con una sección compartida por un pilar y una viga, una losa y un muro. */
function mezclado(): Proyecto {
  const p = proyectoNuevo("mezclado");
  return {
    ...p,
    modelo: {
      ...p.modelo,
      materiales: [...p.modelo.materiales, { id: "S275", tipo: "acero" }],
      secciones: [
        { id: "C30", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.3 },
        { id: "P40", material: "HA-30", forma: "rectangular", b: 0.4, h: 0.4 },
        { id: "IPE300", material: "S275", forma: "I", perfil: { A: 53.8, Iy: 8356, Iz: 603.8, It: 20.1, h: 300, b: 150, tf: 10.7, tw: 7.1 } },
      ],
      pilares: [
        { id: "P1", x: 0, y: 0, seccion: "C30", desde: "Cim", hasta: "N1" },
        { id: "P2", x: 5, y: 0, seccion: "P40", desde: "Cim", hasta: "N1" },
        { id: "P3", x: 10, y: 0, seccion: "IPE300", desde: "Cim", hasta: "N1" },
      ],
      vigas: [{ id: "V1", planta: "N1", puntos: [[0, 0], [5, 0]], seccion: "C30" }],
      losas: [{ id: "L1", planta: "N1", contorno: [[0, 0], [5, 0], [5, 5], [0, 5]], espesor: 0.25, material: "HA-30" }],
      muros: [{ id: "M1", puntos: [[0, 5], [5, 5]], desde: "Cim", hasta: "N1", espesor: 0.25, material: "HA-30" }],
    },
  } as Proyecto;
}

describe("DO1, criterio 1: obra fuera de la huella y sin cambios para lo de antes", () => {
  it.each(referencias())("%s: con y sin obra, la misma huella; obra null la quita", (_n, p) => {
    expect(p.obra).toBeUndefined();
    const obra: ObraProyecto = { uso: "B", materiales: { pilares: p.modelo.materiales[0]!.id } };
    const q = aplicado(p, { op: "obra", obra });
    expect(q.obra).toEqual(obra);
    expect(huella(q)).toBe(huella(p));
    expect(serializar(aplicado(q, { op: "obra", obra: null }))).toBe(serializar(p));
    // Una operación que no toca la obra deja el proyecto sin `obra`
    expect(aplicado(p, { op: "datos", nombre: "x" }).obra).toBeUndefined();
  });

  it("el proyecto nuevo trae el uso A y el HA-30 en forjados, pilares y muros, y pasa el esquema", () => {
    const p = proyectoNuevo("x");
    expect(p.obra).toEqual({ uso: "A", materiales: { forjados: "HA-30", pilares: "HA-30", muros: "HA-30" } });
    expect(leerProyecto(serializar(p)).valido).toBe(true);
  });

  it("un material que no existe es error; vacío, se quita", () => {
    const p = proyectoNuevo();
    const r = aplicar(p, { op: "obra", obra: { materiales: { pilares: "HA-99" } } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores[0]!.codigo).toBe("obra/material-inexistente");
    expect(comprobarObra({ materiales: { perfiles: "S355" } }, p.modelo).map((d) => d.codigo)).toEqual(["obra/material-inexistente"]);
    expect(aplicado(p, { op: "obra", obra: { materiales: { pilares: "" } } }).obra).toBeUndefined();
    expect(leerProyecto(JSON.stringify({ ...p, obra: { colores: 1 } })).valido).toBe(false);
  });

  it("los materiales por defecto siguen al material renombrado, reasignado o borrado", () => {
    let p = aplicado(proyectoNuevo(), { op: "crear", coleccion: "materiales", objeto: { id: "HA-25", tipo: "hormigon", fck: 25 } });
    p = aplicado(p, { op: "obra", obra: { materiales: { forjados: "HA-30", pilares: "HA-25" } } });
    const r = aplicado(p, { op: "cambiar", coleccion: "materiales", id: "HA-25", objeto: { id: "H25", tipo: "hormigon", fck: 25 } });
    expect(r.obra?.materiales).toEqual({ forjados: "HA-30", pilares: "H25" });
    const b = aplicado(r, { op: "borrar", ids: ["H25"] });
    expect(b.obra?.materiales).toEqual({ forjados: "HA-30" });
    const s = aplicado(aplicado(p, { op: "crear", coleccion: "secciones", objeto: { id: "X", material: "HA-25", forma: "circular", D: 0.3 } }), { op: "borrar", ids: ["HA-25"], dependientes: { reasignar: { "HA-25": "HA-30" } } });
    expect(s.obra?.materiales).toEqual({ forjados: "HA-30", pilares: "HA-30" });
  });
});

describe("DO1, criterio 2: el material de la obra manda", () => {
  it("con pilares HA-25, se propone HA-25 aunque el más usado sea HA-30; de otra familia, no", () => {
    const p = mezclado();
    const m = { ...p.modelo, materiales: [...p.modelo.materiales, { id: "HA-25", tipo: "hormigon" as const, fck: 25 }] };
    expect(materialPropuesto(m, "hormigon")).toBe("HA-30");
    expect(materialPropuesto(m, "hormigon", "HA-25")).toBe("HA-25");
    expect(materialPropuesto(m, "hormigon", "S275")).toBe("HA-30");
    expect(materialPropuesto(m, "acero", "S275")).toBe("S275");
    expect(materialPropuesto(m, "hormigon", "no-existe")).toBe("HA-30");
  });
});

describe("DO1, criterio 3: cambiar las existentes", () => {
  it("elegir un típico que no está lo crea; sin «existentes», no se toca ninguna pieza", () => {
    const p = mezclado();
    const r = aplicarObra(p, { materiales: { pilares: "HA-25" } });
    if (!r.ok) throw new Error(r.mensaje);
    const q = aplicado(p, r.operaciones[0]!);
    expect(q.modelo.materiales.map((x) => x.id)).toEqual(["HA-30", "S275", "HA-25"]);
    expect(q.modelo.secciones).toEqual(p.modelo.secciones);
    expect(q.obra).toEqual({ materiales: { pilares: "HA-25" } });
    expect(r.piezas).toBe(0);
  });

  it("pilares: la sección del pilar y la viga se copia; la del pilar solo cambia; el acero y lo demás, igual", () => {
    const p = mezclado();
    expect(piezasACambiar(p.modelo, "pilares", "HA-25")).toEqual(["P1", "P2"]);
    const r = aplicarObra(p, { materiales: { pilares: "HA-25" } }, ["pilares"]);
    if (!r.ok) throw new Error(r.mensaje);
    expect([r.piezas, r.secciones, r.copias]).toEqual([2, 1, 1]);
    const q = aplicado(p, r.operaciones[0]!);
    const sec = new Map(q.modelo.secciones.map((s) => [s.id, s]));
    expect(sec.get("C30")!.material).toBe("HA-30"); // sigue siendo de la viga
    expect(sec.get("P40")!.material).toBe("HA-25");
    const p1 = q.modelo.pilares!.find((x) => x.id === "P1")!;
    expect(sec.get(p1.seccion)!).toMatchObject({ material: "HA-25", forma: "rectangular", b: 0.3, h: 0.3 });
    expect(q.modelo.vigas).toEqual(p.modelo.vigas);
    expect(q.modelo.losas).toEqual(p.modelo.losas);
    expect(q.modelo.muros).toEqual(p.modelo.muros);
    expect(q.modelo.pilares!.find((x) => x.id === "P3")).toEqual(p.modelo.pilares!.find((x) => x.id === "P3"));
  });

  it("forjados y muros: losas, vigas y muros cambian; perfiles: el acero", () => {
    const p = mezclado();
    const f = aplicarObra(p, { materiales: { forjados: "HA-35", muros: "HA-35", perfiles: "S355" } }, ["forjados", "muros", "perfiles"]);
    if (!f.ok) throw new Error(f.mensaje);
    const q = aplicado(p, f.operaciones[0]!);
    const sec = new Map(q.modelo.secciones.map((s) => [s.id, s]));
    expect(q.modelo.losas![0]!.material).toBe("HA-35");
    expect(q.modelo.muros![0]!.material).toBe("HA-35");
    expect(sec.get(q.modelo.vigas![0]!.seccion)!.material).toBe("HA-35");
    expect(sec.get("C30")!.material).toBe("HA-30"); // la del pilar P1
    expect(sec.get("IPE300")!.material).toBe("S355");
    expect(q.modelo.pilares!.find((x) => x.id === "P1")!.seccion).toBe("C30");
  });

  it("un material de otra familia no se admite", () => {
    const r = aplicarObra(mezclado(), { materiales: { pilares: "S275" } });
    expect(r.ok).toBe(false);
  });

  it.each(referencias())("%s: cada tipo, deshacer da los bytes, y las piezas de los otros tipos no cambian", (_n, p) => {
    for (const t of TIPOS_OBRA) {
      const nuevo = t === "perfiles" ? "S355" : "HA-45";
      const r = aplicarObra(p, { materiales: { [t]: nuevo } }, [t]);
      if (!r.ok) throw new Error(r.mensaje);
      const q = aplicado(p, r.operaciones[0]!);
      expect(serializar(deshacer(hacer(historial(p), q, "obra")).actual)).toBe(serializar(p));
      expect(piezasACambiar(q.modelo, t, nuevo)).toEqual([]);
      // Los otros tipos, con los mismos materiales efectivos
      const efectivo = (x: Proyecto) => {
        const s = new Map(x.modelo.secciones.map((y) => [y.id, y.material]));
        return {
          pilares: t === "pilares" || t === "perfiles" ? null : (x.modelo.pilares ?? []).map((y) => [y.id, s.get(y.seccion), (y.tramos ?? []).map((z) => s.get(z.seccion))]),
          vigas: t === "forjados" || t === "perfiles" ? null : (x.modelo.vigas ?? []).map((y) => [y.id, s.get(y.seccion)]),
          losas: t === "forjados" ? null : (x.modelo.losas ?? []).map((y) => [y.id, y.material]),
          muros: t === "muros" ? null : (x.modelo.muros ?? []).map((y) => [y.id, y.material]),
        };
      };
      expect(efectivo(q)).toEqual(efectivo(p));
    }
  });
});
