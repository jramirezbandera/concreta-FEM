/**
 * Fase GE (`docs/fem3d/gestores.md`): crear secciones y materiales sin la tabla.
 * - Los ids propuestos (GE-c) y la reutilización de una sección con los mismos datos.
 * - Un material típico que no está se crea con la sección, y todo va en un lote (un paso).
 * - Lo creado es lo que se escribiría a mano en el JSON (criterio 1 y 3), y compila y calcula.
 * - Las propiedades de la ficha son las de `compilarSeccion` bit a bit (criterio 4).
 * - Cambiar una sección que se usa cambia todos los objetos que la usan, y renombrarla, sus referencias.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Proyecto } from "../agente/proyecto.ts";
import { compilar } from "../compilador/compilar.ts";
import type { Material, Seccion } from "../compilador/fisico.ts";
import { compilarSeccion } from "../compilador/secciones.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { hormigon } from "../secciones/seccion3D.ts";
import { cambiarSeccion, comoUna, crearMaterial, crearSeccion, describirMaterial, describirSeccion, idSeccion, materialPropuesto, MATERIALES_TIPICOS, propiedadesMaterial, propiedadesSeccion, seccionPropuesta, textoUsos, usosDe, type DatosSeccion } from "./gestores.ts";
import { aplicar, type Operacion } from "./operaciones.ts";
import { proyectoNuevo } from "./plantilla.ts";
import { DEF_TABLAS, contexto } from "./tablas.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const aplicado = (p: Proyecto, ops: readonly Operacion[]): Proyecto => {
  const r = aplicar(p, comoUna(ops));
  if (!r.ok) throw new Error(r.errores.map((e) => e.mensaje).join("\n"));
  return r.proyecto;
};

/** Un pórtico de dos pilares y una viga en N1, con la sección `sp` en los pilares y `sv` en la viga. */
function portico(p: Proyecto, sp: string, sv: string): Proyecto {
  return aplicado(p, [
    { op: "crear", coleccion: "pilares", objeto: { id: "P1", x: 0, y: 0, desde: "Cim", hasta: "N1", seccion: sp } },
    { op: "crear", coleccion: "pilares", objeto: { id: "P2", x: 5, y: 0, desde: "Cim", hasta: "N1", seccion: sp } },
    { op: "crear", coleccion: "vigas", objeto: { id: "V1", planta: "N1", puntos: [[0, 0], [5, 0]], seccion: sv } },
    { op: "crear", coleccion: "cargas", objeto: { id: "Q1", tipo: "viga", caso: "Q", viga: "V1", ejes: "global", q: [0, 0, -10] } },
  ]);
}

describe("GE: ids propuestos (GE-c)", () => {
  const m = proyectoNuevo().modelo;
  it("por forma y uso", () => {
    expect(idSeccion(m, seccionPropuesta("rectangular", "pilar", "HA-30"), "pilar")).toBe("P30x30");
    expect(idSeccion(m, seccionPropuesta("rectangular", "viga", "HA-30"), "viga")).toBe("V30x50");
    expect(idSeccion(m, { material: "HA-30", forma: "rectangular", b: 0.275, h: 0.6 }, "viga")).toBe("V27.5x60");
    expect(idSeccion(m, seccionPropuesta("circular", "pilar", "HA-30"), "pilar")).toBe("C40");
    expect(idSeccion(m, seccionPropuesta("T", "vigueta", "HA-30"), "vigueta")).toBe("T70x30");
    expect(idSeccion(m, seccionPropuesta("I", "viga", "S275"), "viga")).toBe("IPE300");
    expect(idSeccion(m, seccionPropuesta("general", null, "HA-30"), null)).toBe("S1");
  });
  it("si está ocupado, con «-2»", () => {
    const p = aplicado(proyectoNuevo(), [{ op: "crear", coleccion: "secciones", objeto: { id: "P30x30", material: "HA-30", forma: "circular", D: 0.3 } }]);
    expect(idSeccion(p.modelo, seccionPropuesta("rectangular", "pilar", "HA-30"), "pilar")).toBe("P30x30-2");
  });
});

describe("GE: textos de los desplegables", () => {
  it("secciones y materiales", () => {
    expect(describirSeccion({ material: "HA-30", forma: "rectangular", b: 0.3, h: 0.5 })).toBe("rect. 30 × 50 · HA-30");
    expect(describirSeccion({ material: "HA-30", forma: "circular", D: 0.45 })).toBe("circ. Ø 45 · HA-30");
    expect(describirSeccion(seccionPropuesta("I", null, "S275"))).toBe("IPE 300 · S275");
    expect(describirMaterial({ id: "HA-30", tipo: "hormigon", fck: 30 })).toBe("hormigón, fck 30");
    expect(describirMaterial({ id: "S275", tipo: "acero" })).toBe("acero");
  });
  it("la tabla de pilares da la descripción y marca la referencia", () => {
    const c = crearSeccion(proyectoNuevo().modelo, seccionPropuesta("rectangular", "pilar", "HA-30"), { uso: "pilar" });
    const p = aplicado(proyectoNuevo(), c.ok ? c.operaciones : []);
    const col = DEF_TABLAS.pilares.columnas.find((c) => c.clave === "seccion")!;
    expect(col.referencia).toBe("secciones");
    expect(col.opciones!(contexto(p.modelo))).toEqual([{ valor: "P30x30", texto: "P30x30 · rect. 30 × 30 · HA-30" }]);
    const conReferencia = (r: string) => Object.values(DEF_TABLAS).flatMap((d) => d.columnas.filter((c) => c.referencia === r).map((c) => `${d.nombre}.${c.clave}`));
    expect([...conReferencia("secciones"), ...conReferencia("materiales")]).toEqual(["pilares.seccion", "vigas.seccion", "forjados.seccion", "secciones.material", "forjados.material", "muros.material"]);
    // GE2 y GE3
    expect(conReferencia("casos")).toEqual(["casos.derivadoDe", "cargas.caso"]);
    expect(conReferencia("plantas")).toEqual(["pilares.desde", "pilares.hasta", "vigas.planta", "forjados.planta", "muros.desde", "muros.hasta", "apoyos.planta", "apoyosLineales.planta", "cargas.planta"]);
    // Toda columna que elige de esas listas lleva su referencia («desde» y «hasta» de una carga son estaciones)
    const sinReferencia = Object.values(DEF_TABLAS).flatMap((d) => d.columnas.filter((c) => c.opciones && !c.referencia && /^(desde|hasta|planta|caso|seccion|material|derivadoDe)$/.test(c.clave)).map((c) => `${d.nombre}.${c.clave}`));
    expect(sinReferencia).toEqual([]);
  });
});

describe("GE: crear", () => {
  it("una sección con un material típico que no está: material y sección en un lote", () => {
    const p = proyectoNuevo();
    const c = crearSeccion(p.modelo, seccionPropuesta("I", "viga", "S275"), { uso: "viga" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.id).toBe("IPE300");
    expect(c.operaciones.map((o) => (o.op === "crear" ? o.coleccion : o.op))).toEqual(["materiales", "secciones"]);
    const q = aplicado(p, c.operaciones);
    // Lo que se escribiría a mano en el JSON, con los valores de Concreta (steelProfiles.ts)
    expect(q.modelo.materiales.at(-1)).toEqual({ id: "S275", tipo: "acero" });
    expect(q.modelo.secciones).toEqual([{ id: "IPE300", material: "S275", forma: "I", perfil: { A: 53.8, Iy: 8356, Iz: 603.8, It: 20.1, h: 300, b: 150, tf: 10.7, tw: 7.1 } }]);
  });
  it("si ya hay una con los mismos datos, se reutiliza (sin operaciones)", () => {
    const p = proyectoNuevo();
    const c1 = crearSeccion(p.modelo, seccionPropuesta("rectangular", "pilar", "HA-30"), { uso: "pilar" });
    const q = aplicado(p, c1.ok ? c1.operaciones : []);
    const c2 = crearSeccion(q.modelo, { forma: "rectangular", h: 0.3, b: 0.3, material: "HA-30" }, { uso: "viga" });
    expect(c2).toEqual({ ok: true, id: "P30x30", operaciones: [], reutilizada: true });
    // Con otro material, no
    const c3 = crearSeccion(q.modelo, { forma: "rectangular", b: 0.3, h: 0.3, material: "HA-25" }, { uso: "pilar" });
    expect(c3.ok && c3.id).toBe("P30x30-2");
  });
  it("con un id dado que ya está, error; un material que no existe ni es típico, error", () => {
    const p = proyectoNuevo();
    expect(crearSeccion(p.modelo, seccionPropuesta("rectangular", "pilar", "HA-30"), { id: "HA-30" })).toEqual({ ok: false, mensaje: "Ya hay un objeto «HA-30» en el proyecto." });
    expect(crearSeccion(p.modelo, seccionPropuesta("rectangular", "pilar", "H-99"))).toEqual({ ok: false, mensaje: "No hay ningún material «H-99»." });
  });
  it("los materiales típicos se crean tal cual", () => {
    const p = proyectoNuevo();
    for (const t of MATERIALES_TIPICOS) {
      const c = crearMaterial(p.modelo, t);
      if (t.id === "HA-30") expect(c.ok).toBe(false);
      else expect(c.ok && aplicado(p, c.operaciones).modelo.materiales.at(-1)).toEqual(t);
    }
  });
  it("el material propuesto: el más usado de la familia; si no hay, el típico", () => {
    const p = proyectoNuevo();
    expect(materialPropuesto(p.modelo, "hormigon")).toBe("HA-30");
    expect(materialPropuesto(p.modelo, "acero")).toBe("S275");
    const q = aplicado(p, [
      { op: "crear", coleccion: "materiales", objeto: { id: "HA-25", tipo: "hormigon", fck: 25 } },
      { op: "crear", coleccion: "secciones", objeto: { id: "X", material: "HA-25", forma: "circular", D: 0.3 } },
    ]);
    expect(materialPropuesto(q.modelo, "hormigon")).toBe("HA-25");
  });
});

describe("GE: lo creado compila y calcula (criterio 3)", () => {
  it("pórtico de hormigón con viga IPE 300 del catálogo: lo mismo que con el perfil escrito a mano", () => {
    const p = proyectoNuevo();
    const cp = crearSeccion(p.modelo, seccionPropuesta("rectangular", "pilar", "HA-30"), { uso: "pilar" });
    const q = aplicado(p, cp.ok ? cp.operaciones : []);
    const cv = crearSeccion(q.modelo, seccionPropuesta("I", "viga", materialPropuesto(q.modelo, "acero")), { uso: "viga" });
    const r = aplicado(q, cv.ok ? cv.operaciones : []);
    const conGestor = portico(r, "P30x30", "IPE300");
    const aMano = portico(
      aplicado(p, [
        { op: "crear", coleccion: "materiales", objeto: { id: "S275", tipo: "acero" } },
        { op: "crear", coleccion: "secciones", objeto: { id: "P30x30", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.3 } },
        { op: "crear", coleccion: "secciones", objeto: { id: "IPE300", material: "S275", forma: "I", perfil: { A: 53.8, Iy: 8356, Iz: 603.8, It: 20.1, h: 300, b: 150, tf: 10.7, tw: 7.1 } } },
      ]),
      "P30x30",
      "IPE300",
    );
    expect(conGestor.modelo).toEqual(aMano.modelo);
    const c = compilar(conGestor.modelo);
    expect(c.valido).toBe(true);
    if (!c.valido) return;
    const res = calcular(c.modelo);
    expect(res.valido, res.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join(" | ")).toBe(true);
  });
});

describe("GE: las propiedades de la ficha son las del compilador (criterio 4)", () => {
  const p = proyectoNuevo();
  const formas: DatosSeccion[] = [
    seccionPropuesta("rectangular", "pilar", "HA-30"),
    seccionPropuesta("circular", "pilar", "HA-30"),
    seccionPropuesta("T", "vigueta", "HA-30"),
    seccionPropuesta("I", "viga", "S275"),
    seccionPropuesta("general", null, "HA-30"),
  ];
  it.each(formas.map((d) => [d.forma, d] as const))("%s", (_f, d) => {
    const mat: Material = d.material === "S275" ? { id: "S275", tipo: "acero" } : p.modelo.materiales[0]!;
    expect(propiedadesSeccion(p.modelo, d)).toEqual(compilarSeccion({ id: "", ...d } as Seccion, mat, true));
  });
  it("el Ecm del hormigón es el de hormigon(fck)", () => {
    expect(propiedadesMaterial({ id: "HA-30", tipo: "hormigon", fck: 30 }).E).toBe(hormigon(30).E);
    expect(propiedadesMaterial({ id: "S", tipo: "acero" })).toEqual({ E: 210e6, G: 210e6 / 2.6, peso: 78.5 });
  });
  it("con datos que no valen, null", () => {
    expect(propiedadesSeccion(p.modelo, { material: "HA-30", forma: "rectangular", b: Number.NaN, h: 0.3 })).toBeNull();
    expect(propiedadesSeccion(p.modelo, { material: "nada", forma: "rectangular", b: 0.3, h: 0.3 })).toBeNull();
  });
});

describe("GE: cambiar una sección que se usa (GE-f)", () => {
  it("cambia todos los objetos que la usan, y renombrarla arrastra sus referencias", () => {
    const p = proyectoNuevo();
    const cp = crearSeccion(p.modelo, seccionPropuesta("rectangular", "pilar", "HA-30"), { uso: "pilar" });
    const cv = crearSeccion(aplicado(p, cp.ok ? cp.operaciones : []).modelo, seccionPropuesta("rectangular", "viga", "HA-30"), { uso: "viga" });
    const q = portico(aplicado(aplicado(p, cp.ok ? cp.operaciones : []), cv.ok ? cv.operaciones : []), "P30x30", "V30x50");
    expect(textoUsos(usosDe(q.modelo, "P30x30"))).toBe("2 pilares");
    expect(textoUsos(usosDe(q.modelo, "HA-30"))).toBe("2 secciones");
    expect(textoUsos(usosDe(q.modelo, "nada"))).toBe("ningún objeto");
    const c = cambiarSeccion(q.modelo, "P30x30", { material: "HA-30", forma: "rectangular", b: 0.4, h: 0.4 }, "P40x40");
    const r = aplicado(q, c.ok ? c.operaciones : []);
    expect(r.modelo.pilares!.map((x) => x.seccion)).toEqual(["P40x40", "P40x40"]);
    expect(r.modelo.secciones.find((s) => s.id === "P40x40")).toEqual({ id: "P40x40", material: "HA-30", forma: "rectangular", b: 0.4, h: 0.4 });
    expect(cambiarSeccion(q.modelo, "P30x30", { material: "HA-30", forma: "rectangular", b: 0.4, h: 0.4 }, "V30x50")).toEqual({ ok: false, mensaje: "Ya hay un objeto «V30x50» en el proyecto." });
  });
});
