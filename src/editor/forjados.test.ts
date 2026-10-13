/**
 * La tabla Forjados (como los paños de CYPECAD): losas macizas, reticulares y paños unidireccionales
 * en una sola tabla con su tipo, sobre las dos listas del modelo (`losas` y `panos`), que no cambian.
 * Cambiar el tipo de una fila pasa el objeto de una lista a la otra con su id y sus cargas, y la
 * armadura base de una losa que deja de serlo se va con ella.
 */
import { describe, expect, it } from "vitest";
import { compilar } from "../compilador/compilar.ts";
import type { Proyecto } from "../agente/proyecto.ts";
import { escribirFila } from "./edicion.ts";
import { aplicar } from "./operaciones.ts";
import { leerEjemplo } from "./serializar.test.ts";
import { DEF_TABLAS, contexto, filaConValor, objetosTabla, tablaDeColeccion } from "./tablas.ts";

const forjados = DEF_TABLAS.forjados;
const fila = (p: Proyecto, id: string) => forjados.fila(objetosTabla(p.modelo, "forjados").find((o) => o.id === id)!, contexto(p.modelo));
const errores = (p: Proyecto, f: Record<string, string>) => {
  const l = forjados.objeto(f, contexto(p.modelo));
  return l.ok ? [] : l.errores.map((e) => e.columna);
};
const escrito = (p: Proyecto, id: string | null, f: Record<string, string>): Proyecto => {
  const r = escribirFila(p, "forjados", id, f);
  if (!r.ok) throw new Error(r.errores.map((e) => e.mensaje).join(" | "));
  return r.proyecto;
};

describe("Forjados: una tabla para losas, reticulares y unidireccionales", () => {
  const { proyecto } = leerEjemplo("muestrario");

  it("enseña las losas y los paños con su tipo, y las dos colecciones se editan en ella", () => {
    const tipos = Object.fromEntries(objetosTabla(proyecto.modelo, "forjados").map((o) => [o.id, fila(proyecto, o.id).tipo]));
    expect(tipos).toStrictEqual({ L1: "maciza", L2: "reticular", F1: "unidireccional" });
    expect(tablaDeColeccion("losas")).toBe("forjados");
    expect(tablaDeColeccion("panos")).toBe("forjados");
  });

  it("lo que no aplica al tipo de la fila tiene que estar vacío, y el tipo es uno de los tres", () => {
    expect(errores(proyecto, { ...fila(proyecto, "L1"), seccion: "VT-70" })).toEqual(["seccion"]);
    expect(errores(proyecto, { ...fila(proyecto, "L1"), nervio: "0,12" })).toEqual(["nervio"]);
    expect(errores(proyecto, { ...fila(proyecto, "F1"), espesor: "0,3", material: "HA-30" })).toEqual(["espesor", "material"]);
    expect(errores(proyecto, { ...fila(proyecto, "F1"), seccion: "" })).toEqual(["seccion"]);
    expect(errores(proyecto, { ...fila(proyecto, "L2"), intereje: "" })).toEqual(["intereje"]);
    expect(errores(proyecto, { ...fila(proyecto, "L1"), tipo: "alveolar" })).toEqual(["tipo"]);
    // Vacío es maciza
    const l = forjados.objeto({ ...fila(proyecto, "L1"), tipo: "" }, contexto(proyecto.modelo));
    expect(l.ok && l.coleccion).toBe("losas");
  });

  it("al cambiar el tipo se vacía lo que deja de aplicar y el pp; lo que sigue aplicando se queda", () => {
    const r = filaConValor(forjados, fila(proyecto, "L2"), "tipo", "unidireccional");
    expect([r.espesor, r.material, r.nervio, r.capa, r.abacos, r.pp]).toEqual(["", "", "", "", "", ""]);
    expect(r.intereje).toBe("0,8");
    expect(r.contorno).toBe(fila(proyecto, "L2").contorno);
    expect(forjados.aplica!("nervio", r)).toBe(false);
    expect(forjados.aplica!("seccion", r)).toBe(true);
    // Escribir otra columna no vacía nada: un dato que no aplica se queda y da error
    const s = filaConValor(forjados, fila(proyecto, "L1"), "seccion", "VT-70");
    expect(s.seccion).toBe("VT-70");
    expect(errores(proyecto, s)).toEqual(["seccion"]);
    // De maciza a reticular no se pierde nada (falta el nervio)
    const q = filaConValor(forjados, fila(proyecto, "L1"), "tipo", "reticular");
    expect([q.espesor, q.material]).toEqual(["0,25", "HA-30"]);
  });

  it("una fila nueva sin id toma «F» si es unidireccional y «L» si es una losa, como Renumerar", () => {
    const f = fila(proyecto, "F1");
    const p = escrito(proyecto, null, { ...f, id: "", huecos: "" });
    expect(p.modelo.panos!.map((x) => x.id)).toEqual(["F1", "F2"]);
    const q = escrito(proyecto, null, { ...fila(proyecto, "L1"), id: "", huecos: "" });
    expect(q.modelo.losas!.map((x) => x.id)).toEqual(["L1", "L2", "L3"]);
  });

  it("cambiar el tipo de reticular a unidireccional y volver: mismo id, sus cargas lo siguen y el modelo compila", () => {
    const conArmado: Proyecto = { ...proyecto, armado: { ...proyecto.armado, losas: { L2: { "x-inf": 20 } } } };
    const cargasL2 = proyecto.modelo.cargas!.filter((c) => c.tipo === "superficie" && c.losa === "L2").map((c) => c.id);
    expect(cargasL2.length).toBeGreaterThan(0);

    // Viguetas en Y, de la viga de y = 0 a la de y = 11
    const unidir = escrito(conArmado, "L2", { ...fila(proyecto, "L2"), tipo: "unidireccional", espesor: "", material: "", pp: "3,5", direccion: "90", intereje: "0,7", nervio: "", capa: "", caseton: "", abacos: "", seccion: "VT-70" });
    expect(unidir.modelo.losas!.map((x) => x.id)).toEqual(["L1"]);
    expect(unidir.modelo.panos!.map((x) => x.id)).toEqual(["F1", "L2"]);
    for (const id of cargasL2) {
      const c = unidir.modelo.cargas!.find((x) => x.id === id)!;
      expect(c.tipo === "superficie" && [c.losa, c.pano]).toEqual([undefined, "L2"]);
      expect(Object.keys(c)).not.toContain("losa");
    }
    // La armadura base era de la losa L2, que ya no es una losa
    expect(unidir.armado?.losas?.L2).toBeUndefined();
    expect(unidir.armado?.base).toStrictEqual(proyecto.armado!.base);
    const c = compilar(unidir.modelo, unidir.opciones);
    expect(c.diagnosticos.filter((d) => d.severidad === "error")).toEqual([]);

    // Con la fila de antes vuelve a ser el mismo reticular, al final de las losas
    const vuelta = escrito(unidir, "L2", fila(proyecto, "L2"));
    expect(vuelta.modelo.panos!.map((x) => x.id)).toEqual(["F1"]);
    expect(vuelta.modelo.losas!.map((x) => x.id)).toEqual(["L1", "L2"]);
    expect(vuelta.modelo.losas!.find((x) => x.id === "L2")).toStrictEqual(proyecto.modelo.losas!.find((x) => x.id === "L2"));
    for (const id of cargasL2) expect(vuelta.modelo.cargas!.find((x) => x.id === id)).toStrictEqual(proyecto.modelo.cargas!.find((x) => x.id === id));
  });

  it("cambiar el tipo y el id a la vez renombra sus referencias", () => {
    const p = escrito(proyecto, "F1", { ...fila(proyecto, "F1"), id: "LC", tipo: "maciza", espesor: "0,22", material: "HA-30", pp: "", direccion: "", intereje: "", seccion: "" });
    expect(p.modelo.panos ?? []).toEqual([]);
    expect(p.modelo.losas!.map((x) => x.id)).toEqual(["L1", "L2", "LC"]);
    const cargas = p.modelo.cargas!.filter((c) => c.tipo === "superficie" && c.planta === "CUB");
    expect(cargas.length).toBeGreaterThan(0);
    for (const c of cargas) expect(c.tipo === "superficie" && [c.losa, c.pano]).toEqual(["LC", undefined]);
    expect(compilar(p.modelo, p.opciones).valido).toBe(true);
  });

  it("convertir algo que no existe, o a un id ocupado, no se aplica", () => {
    const o = proyecto.modelo.losas![0]!;
    expect(aplicar(proyecto, { op: "convertir", de: "losas", coleccion: "panos", id: "X9", objeto: o as never }).ok).toBe(false);
    expect(aplicar(proyecto, { op: "convertir", de: "losas", coleccion: "panos", id: "L1", objeto: { ...(proyecto.modelo.panos![0]! as unknown as Record<string, unknown>), id: "L2" } }).ok).toBe(false);
  });
});
