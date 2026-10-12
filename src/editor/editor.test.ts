/**
 * Operaciones del editor (V2a, `docs/fem3d/visor.md` §6.3):
 * - criterio 2: con sucesiones al azar de operaciones, el proyecto pasa siempre el esquema, no queda
 *   ninguna referencia rota y deshacerlo todo devuelve los bytes del principio;
 * - criterio 3: 1-022 y el edificio objetivo se reconstruyen desde un proyecto vacío pegando sus
 *   tablas, y dan la huella de su `proyecto.json`.
 */
import { describe, expect, it } from "vitest";
import { leerProyecto, VERSION_ESQUEMA, type Proyecto } from "../agente/proyecto.ts";
import { huellaCompilacion } from "../compilador/compilar.ts";
import { proponerEjes } from "../compilador/ejes.ts";
import { resolverOpciones } from "../compilador/fisico.ts";
import { azar, fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { leerTsv } from "./celdas.ts";
import { copiarAPlantas, escribirFila, exportar, filas, objetosDePlanta, operacionFila, pegar } from "./edicion.ts";
import { deshacer, hacer, historial, rehacer } from "./historial.ts";
import { aplicar, type Operacion } from "./operaciones.ts";
import { proyectoNuevo } from "./plantilla.ts";
import { COLECCIONES, lista, referenciasRotas, usos, type Objeto } from "./referencias.ts";
import { serializar } from "./serializar.ts";
import { leerEjemplo } from "./serializar.test.ts";
import { DEF_TABLAS, TABLAS, contexto } from "./tablas.ts";

const huella = (p: Proyecto) => huellaCompilacion(p.modelo, resolverOpciones(p.opciones));
const vacio = (): Proyecto => ({ esquema: VERSION_ESQUEMA, modelo: { plantas: [], materiales: [], secciones: [], casos: [] } });

function aplicado(p: Proyecto, o: Operacion): Proyecto {
  const r = aplicar(p, o);
  if (!r.ok) throw new Error(r.errores.map((e) => e.mensaje).join(" | "));
  return r.proyecto;
}

/** Orden en el que se pegan las tablas: lo referido antes que lo que refiere. */
const ORDEN = ["plantas", "materiales", "secciones", "casos", "pilares", "vigas", "losas", "apoyos", "cargas"] as const;

describe("tablas: ida y vuelta (criterio 3)", () => {
  for (const nombre of ["ejemplo", "1022", "edificio"] as const)
    it(`${nombre}: cada objeto sale igual de su fila`, () => {
      const { proyecto } = leerEjemplo(nombre);
      const ctx = contexto(proyecto.modelo);
      for (const t of TABLAS) {
        const def = DEF_TABLAS[t];
        for (const o of lista(proyecto.modelo, def.coleccion)) {
          const l = def.objeto(def.fila(o, ctx), ctx);
          expect(l.ok ? l.objeto : l.errores, `${t} ${o.id}`).toStrictEqual(o);
        }
      }
    });

  for (const nombre of ["1022", "edificio"] as const)
    it(`${nombre}: se reconstruye desde un proyecto vacío pegando sus tablas, con la misma huella`, () => {
      const { proyecto } = leerEjemplo(nombre);
      expect(leerProyecto(serializar(vacio())).valido).toBe(true);
      let p = vacio();
      for (const t of ORDEN) {
        const tsv = exportar(proyecto.modelo, t);
        if (leerTsv(tsv).length <= 1) continue;
        const r = pegar(p.modelo, t, tsv);
        if (!r.ok) throw new Error(`${t}: ${JSON.stringify(r.errores.slice(0, 3))}`);
        p = aplicado(p, r.operacion);
      }
      p = { ...p, ...(proyecto.nombre ? { nombre: proyecto.nombre } : {}), ...(proyecto.opciones ? { opciones: proyecto.opciones } : {}) };
      expect(p.modelo).toStrictEqual(proyecto.modelo);
      expect(huella(p)).toBe(huella(proyecto));
    });
});

describe("ejes de replanteo (I2)", () => {
  const { proyecto } = leerEjemplo("edificio");
  const propuestos = proponerEjes(proyecto.modelo, proyecto.opciones).ejes;

  it("guardar los propuestos es un lote de altas: cada uno sale igual de su fila, y la huella no cambia", () => {
    const p = aplicado(proyecto, { op: "lote", operaciones: propuestos.map((objeto) => ({ op: "crear", coleccion: "ejes", objeto: objeto as unknown as Objeto })) });
    expect(p.modelo.ejes).toEqual(propuestos);
    expect(huella(p)).toBe(huella(proyecto));
    const ctx = contexto(p.modelo);
    const def = DEF_TABLAS.ejes;
    for (const o of lista(p.modelo, "ejes")) {
      const l = def.objeto(def.fila(o, ctx), ctx);
      expect(l.ok ? l.objeto : l.errores, o.id).toStrictEqual(o);
    }
    // Pegar su tabla en el proyecto sin ejes da los mismos
    const r = pegar(proyecto.modelo, "ejes", exportar(p.modelo, "ejes"));
    if (!r.ok) throw new Error(JSON.stringify(r.errores));
    expect(aplicado(proyecto, r.operacion).modelo.ejes).toEqual(propuestos);
  });

  it("un eje con los dos extremos iguales no entra", () => {
    const l = DEF_TABLAS.ejes.objeto({ id: "Z", nombre: "", x0: "1", y0: "2", x1: "1", y1: "2" }, contexto(proyecto.modelo));
    expect(l.ok).toBe(false);
  });
});

describe("operaciones", () => {
  const { proyecto: ej } = leerEjemplo("ejemplo");

  it("renombrar un id cambia todas sus referencias", () => {
    const s = lista(ej.modelo, "secciones").find((x) => x.id === "P30x30")!;
    const p = aplicado(ej, { op: "cambiar", coleccion: "secciones", id: "P30x30", objeto: { ...s, id: "P35" } });
    expect(lista(p.modelo, "pilares").every((x) => x.seccion === "P35")).toBe(true);
    expect(referenciasRotas(p.modelo)).toEqual([]);
    const q = aplicado(p, { op: "cambiar", coleccion: "plantas", id: "P1", objeto: { ...p.modelo.plantas[1]!, id: "Baja" } });
    expect(lista(q.modelo, "vigas").filter((v) => v.planta === "Baja")).toHaveLength(2);
    expect(referenciasRotas(q.modelo)).toEqual([]);
  });

  it("un id repetido, una referencia que no existe o un dato que no pasa el esquema no entran", () => {
    const v = lista(ej.modelo, "vigas")[0]!;
    const r1 = aplicar(ej, { op: "crear", coleccion: "vigas", objeto: { ...v } });
    expect(r1.ok ? null : r1.errores[0]!.codigo).toBe("editor/id-repetido");
    const r2 = aplicar(ej, { op: "cambiar", coleccion: "vigas", id: v.id, objeto: { ...v, seccion: "NO" } });
    expect(r2.ok ? null : r2.errores[0]!.codigo).toBe("editor/referencia");
    const r3 = aplicar(ej, { op: "cambiar", coleccion: "vigas", id: v.id, objeto: { ...v, seccion: "P1" } });
    expect(r3.ok ? null : r3.errores[0]!.codigo).toBe("editor/referencia");
    const r4 = aplicar(ej, { op: "cambiar", coleccion: "vigas", id: v.id, objeto: { ...v, puntos: "no" } });
    expect(r4.ok).toBe(false);
  });

  it("borrar lo que otro usa pregunta; con «borrar» se lleva lo que lo usa; con «reasignar», lo pasa", () => {
    const r = aplicar(ej, { op: "borrar", ids: ["Q"] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores[0]!.codigo).toBe("editor/en-uso");
      expect(r.usos!.every((u) => u.coleccion === "cargas")).toBe(true);
    }
    const b = aplicado(ej, { op: "borrar", ids: ["Q"], dependientes: "borrar" });
    expect(lista(b.modelo, "cargas").some((c) => c.caso === "Q")).toBe(false);
    expect(referenciasRotas(b.modelo)).toEqual([]);
    const a = aplicado(ej, { op: "borrar", ids: ["Q"], dependientes: { reasignar: { Q: "G" } } });
    expect(lista(a.modelo, "cargas").length).toBe(lista(ej.modelo, "cargas").length);
    expect(referenciasRotas(a.modelo)).toEqual([]);
    // Borrar una planta se lleva sus vigas, sus losas, sus cargas y los pilares que arrancan o acaban en ella
    const c = aplicado(ej, { op: "borrar", ids: ["P2"], dependientes: "borrar" });
    expect(referenciasRotas(c.modelo)).toEqual([]);
    expect(usos(c.modelo, new Set(["P2"]))).toEqual([]);
  });

  it("borrar la sección de un tramo de pilar quita el tramo, no el pilar", () => {
    const { proyecto: ed } = leerEjemplo("edificio");
    const conTramo = lista(ed.modelo, "pilares").find((x) => Array.isArray(x.tramos) && x.tramos.length > 0);
    if (!conTramo) return;
    const t = (conTramo.tramos as { seccion: string }[])[0]!.seccion;
    const p = aplicado(ed, { op: "borrar", ids: [t], dependientes: "borrar" });
    // Los pilares cuya sección principal es la borrada se van; los que sólo la usan en un tramo, se quedan
    const quedan = lista(p.modelo, "pilares").filter((x) => x.seccion !== t);
    expect(quedan.length).toBeGreaterThan(0);
    expect(referenciasRotas(p.modelo)).toEqual([]);
  });

  it("escribir una celda con un dato que no vale lo dice y no cambia nada", () => {
    const fila = filas(ej.modelo, "pilares")[0]!;
    const r = escribirFila(ej, "pilares", fila.id, { ...fila.fila, x: "tres" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores[0]!.mensaje).toContain("no es un número");
    const s = escribirFila(ej, "pilares", fila.id, { ...fila.fila, x: "0,25" });
    expect(s.ok && lista(s.proyecto.modelo, "pilares")[0]!.x).toBe(0.25);
  });

  it("una fila nueva sin id recibe uno libre con el prefijo de la tabla", () => {
    const t = operacionFila(ej.modelo, "pilares", null, { x: "3", y: "2,5", desde: "CIM", hasta: "P2", seccion: "P30x30" });
    // P1 y P2 son plantas: los ids son únicos en todo el modelo
    expect(t.ok && t.operacion.op === "crear" && t.operacion.objeto.id).toBe("P3");
  });

  it("pegar es todo o nada y dice qué fila falla", () => {
    const tsv = "x\ty\tdesde\thasta\tseccion\n1\t1\tCIM\tP2\tP30x30\n2\tdos\tCIM\tP2\tP30x30\n";
    const r = pegar(ej.modelo, "pilares", tsv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores).toEqual([{ fila: 2, id: expect.any(String), columna: "y", mensaje: "«dos» no es un número" }]);
    const bien = pegar(ej.modelo, "pilares", tsv.replace("dos", "2"));
    expect(bien.ok).toBe(true);
    if (bien.ok) {
      const p = aplicado(ej, bien.operacion);
      expect(lista(p.modelo, "pilares")).toHaveLength(lista(ej.modelo, "pilares").length + 2);
    }
  });

  it("pegar sobre filas que existen cambia sólo lo pegado", () => {
    const r = pegar(ej.modelo, "pilares", "id\tgiro\nA1\t90\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = aplicado(ej, r.operacion);
    const a1 = lista(p.modelo, "pilares").find((x) => x.id === "A1")!;
    expect(a1).toStrictEqual({ ...lista(ej.modelo, "pilares").find((x) => x.id === "A1")!, giro: 90 });
  });

  it("copiar una planta a otra da sus vigas, losas y cargas con ids de la planta nueva", () => {
    const ids = objetosDePlanta(ej.modelo, "P1");
    const r = copiarAPlantas(ej.modelo, ids, ["P2"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = aplicado(ej, r.operacion);
    expect(lista(p.modelo, "vigas").filter((v) => v.planta === "P2")).toHaveLength(4);
    expect(referenciasRotas(p.modelo)).toEqual([]);
    expect(copiarAPlantas(ej.modelo, ["A1"], ["P2"]).ok).toBe(false);
  });

  it("el proyecto nuevo pasa el esquema", () => {
    expect(leerProyecto(serializar(proyectoNuevo("Nuevo"))).valido).toBe(true);
  });
});

describe("sucesiones al azar (criterio 2)", () => {
  const TABLAS_EDITABLES = ["pilares", "vigas", "losas", "cargas", "secciones", "casos", "plantas"] as const;

  function paso(p: Proyecto, r: () => number): { op: Operacion; etiqueta: string } | null {
    const elegir = <T>(xs: readonly T[]): T | undefined => (xs.length ? xs[Math.floor(r() * xs.length)] : undefined);
    const m = p.modelo;
    const t = elegir(TABLAS_EDITABLES)!;
    const def = DEF_TABLAS[t];
    const o = elegir(lista(m, def.coleccion));
    const k = r();
    if (!o) return null;
    if (k < 0.35) {
      // Cambiar una celda numérica
      const f = def.fila(o, contexto(m));
      const col = elegir(def.columnas.filter((c) => !c.calculada && /^-?\d/.test(f[c.clave] ?? "")));
      if (!col) return null;
      const tr = operacionFila(m, t, o.id, { ...f, [col.clave]: String(Math.round(r() * 80) / 10).replace(".", ",") });
      return tr.ok ? { op: tr.operacion, etiqueta: `${o.id}.${col.clave}` } : null;
    }
    if (k < 0.55) return { op: { op: "cambiar", coleccion: def.coleccion, id: o.id, objeto: { ...o, id: `${o.id}~${Math.floor(r() * 1000)}` } }, etiqueta: `renombrar ${o.id}` };
    if (k < 0.75) {
      const otros = lista(m, def.coleccion).filter((x) => x.id !== o.id);
      const otro = elegir(otros);
      if (r() < 0.5 || !otro) return { op: { op: "borrar", ids: [o.id], dependientes: "borrar" }, etiqueta: `borrar ${o.id}` };
      return { op: { op: "borrar", ids: [o.id], dependientes: { reasignar: { [o.id]: otro.id } } }, etiqueta: `borrar ${o.id} → ${otro.id}` };
    }
    if (k < 0.85 && m.plantas.length > 1) {
      const a = elegir(m.plantas)!;
      const b = elegir(m.plantas.filter((x) => x.id !== a.id))!;
      const ids = objetosDePlanta(m, a.id);
      const c = copiarAPlantas(m, ids, [b.id]);
      return c.ok ? { op: c.operacion, etiqueta: `copiar ${a.id} a ${b.id}` } : null;
    }
    const pl = elegir(m.plantas);
    const antes = elegir(m.plantas.filter((x) => x.id !== pl?.id));
    return pl ? { op: { op: "mover", coleccion: "plantas", id: pl.id, antesDe: antes?.id ?? null }, etiqueta: `mover ${pl.id}` } : null;
  }

  /** Sucesión al azar sobre un proyecto: el esquema siempre pasa, sin referencias rotas, y deshacer devuelve los bytes. */
  function sucesiones(proyecto: Proyecto, semillas: readonly number[]) {
    for (const semilla of semillas) {
      const r = azar(semilla);
      let h = historial(proyecto);
      const inicio = serializar(proyecto);
      let hechas = 0;
      for (let i = 0; i < 40; i++) {
        const x = paso(h.actual, r);
        if (!x) continue;
        const a = aplicar(h.actual, x.op);
        if (!a.ok) continue;
        hechas++;
        h = hacer(h, a.proyecto, x.etiqueta);
        expect(leerProyecto(serializar(h.actual)).valido, `semilla ${semilla}, paso ${i}: ${x.etiqueta}`).toBe(true);
        expect(referenciasRotas(h.actual.modelo), `semilla ${semilla}, paso ${i}: ${x.etiqueta}`).toEqual([]);
        if (r() < 0.1) {
          const d = deshacer(h);
          expect(rehacer(d).actual).toBe(h.actual);
        }
      }
      expect(hechas).toBeGreaterThan(5);
      while (h.pasado.length) h = deshacer(h);
      expect(serializar(h.actual)).toBe(inicio);
    }
  }

  for (const [nombre, semillas] of [
    ["ejemplo", [1, 2, 3, 4, 5, 6, 7, 8]],
    ["1022", [11, 12, 13, 14]],
    ["edificio", [21, 22]],
  ] as const)
    it(`${nombre}: el esquema siempre pasa, sin referencias rotas, y deshacer devuelve los bytes`, () => sucesiones(leerEjemplo(nombre).proyecto, semillas));

  for (const semilla of [101, 102, 103, 104, 105, 106])
    it(`modelo físico al azar ${semilla}: lo mismo`, () => {
      const p: Proyecto = { esquema: VERSION_ESQUEMA, modelo: fisicoAleatorio(semilla) };
      expect(leerProyecto(serializar(p)).valido).toBe(true);
      sucesiones(p, [semilla, semilla + 1000]);
    });

  it("las colecciones con id del catálogo son las de validar.ts, y los ejes de replanteo (I2), que el compilador no ve", () => {
    expect([...COLECCIONES].sort()).toEqual(["apoyos", "apoyosLineales", "bandas", "cargas", "casos", "ejes", "losas", "materiales", "muros", "panos", "pilares", "plantas", "secciones", "vigas"]);
  });
});

describe("materiales: el E de cada tipo, en su unidad", () => {
  const ctx = contexto(vacio().modelo);
  const def = DEF_TABLAS.materiales;
  it("el acero en MPa y el general en kN/m², en columnas distintas; una en la columna del otro no entra", () => {
    const acero = def.objeto({ id: "S275", tipo: "acero", Eacero: "210000" }, ctx);
    expect(acero.ok && acero.objeto).toStrictEqual({ id: "S275", tipo: "acero", E: 210000 });
    expect(def.fila(acero.ok ? acero.objeto : ({} as never), ctx)).toMatchObject({ Eacero: "210000", E: "" });
    const mal = def.objeto({ id: "S275", tipo: "acero", E: "210000" }, ctx);
    expect(mal.ok ? null : mal.errores[0]!.columna).toBe("E");
    const gen = def.objeto({ id: "X", tipo: "general", E: "2,1e8", G: "8,1e7", peso: "78,5" }, ctx);
    expect(gen.ok && gen.objeto).toStrictEqual({ id: "X", tipo: "general", E: 2.1e8, G: 8.1e7, peso: 78.5 });
    expect(def.objeto({ id: "X", tipo: "general", Eacero: "210000", G: "1", peso: "1" }, ctx).ok).toBe(false);
  });
});

describe("pegar en una celda, como en Excel", () => {
  const { proyecto: ej } = leerEjemplo("ejemplo");
  const ids = filas(ej.modelo, "pilares").map((f) => f.id);
  const col = DEF_TABLAS.pilares.columnas.findIndex((c) => c.clave === "x");

  it("sobrescribe desde la fila y la columna elegidas y crea filas pasada la última", () => {
    const r = pegar(ej.modelo, "pilares", "10\t11\n12\t13\n", col, { ids, fila: 3 });
    expect(r.ok).toBe(false); // la fila nueva no tiene desde, hasta ni sección
    const s = pegar(ej.modelo, "pilares", "10\t11\n12\t13\n", col, { ids, fila: 2 });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const p = aplicado(ej, s.operacion);
    const ps = lista(p.modelo, "pilares");
    expect([ps[2]!.x, ps[2]!.y, ps[3]!.x, ps[3]!.y]).toEqual([10, 11, 12, 13]);
    expect(ps[2]!.id).toBe(ids[2]);
  });

  it("pegar en la columna del id renombra, con sus referencias", () => {
    const r = pegar(ej.modelo, "vigas", "VA\n", 0, { ids: filas(ej.modelo, "vigas").map((f) => f.id), fila: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = aplicado(ej, r.operacion);
    expect(lista(p.modelo, "vigas")[0]!.id).toBe("VA");
    expect(referenciasRotas(p.modelo)).toEqual([]);
  });
});
