/**
 * V2b (`docs/fem3d/visor.md` §7.3): muros y empujes, reticular, paños y apoyos lineales en las
 * tablas del editor.
 * - criterio 1: cada objeto sale igual de su fila, sin conservar nada a escondidas, y guardar sin
 *   cambios da los mismos bytes y la huella;
 * - criterio 3: los modelos se reconstruyen desde un proyecto vacío pegando sus tablas.
 * El criterio 2 (sucesiones al azar) está en `editor.test.ts`, con estos proyectos.
 *
 * Desde la fase F (`docs/fem3d/franjas.md` §2.6), las bandas no se proponen ni se editan en la app:
 * un proyecto con bandas (las del agente) las conserva tal cual al editar lo demás y al guardar.
 */
import { describe, expect, it } from "vitest";
import { MODELOS_V2B, proyectoV2b } from "../../validacion/v2b/modelos.ts";
import { leerProyecto, VERSION_ESQUEMA, type Proyecto } from "../agente/proyecto.ts";
import { huellaCompilacion } from "../compilador/compilar.ts";
import { resolverOpciones, type ModeloFisico } from "../compilador/fisico.ts";
import { leerTsv } from "./celdas.ts";
import { copiarAPlantas, escribirFila, exportar, pegar } from "./edicion.ts";
import { aplicar, type Operacion } from "./operaciones.ts";
import { lista } from "./referencias.ts";
import { serializar } from "./serializar.ts";
import { DEF_TABLAS, TABLAS, contexto } from "./tablas.ts";

const huella = (p: Proyecto) => huellaCompilacion(p.modelo, resolverOpciones(p.opciones));
const vacio = (): Proyecto => ({ esquema: VERSION_ESQUEMA, modelo: { plantas: [], materiales: [], secciones: [], casos: [] } });
const NOMBRES = Object.keys(MODELOS_V2B);

function aplicado(p: Proyecto, o: Operacion): Proyecto {
  const r = aplicar(p, o);
  if (!r.ok) throw new Error(r.errores.map((e) => e.mensaje).join(" | "));
  return r.proyecto;
}

describe("V2b: ida y vuelta (criterio 1)", () => {
  for (const nombre of NOMBRES)
    it(`${nombre}: cada objeto sale igual de su fila, sin base`, () => {
      const { modelo } = proyectoV2b(nombre);
      const ctx = contexto(modelo);
      let vistos = 0;
      for (const t of TABLAS) {
        const def = DEF_TABLAS[t];
        for (const o of lista(modelo, def.coleccion)) {
          const l = def.objeto(def.fila(o, ctx), ctx);
          expect(l.ok ? l.objeto : l.errores, `${t} ${o.id}`).toStrictEqual(o);
          // Con su base, sale igual
          const b = def.objeto(def.fila(o, ctx), ctx, o);
          expect(b.ok ? b.objeto : b.errores, `${t} ${o.id} con base`).toStrictEqual(o);
          vistos++;
        }
      }
      expect(vistos).toBeGreaterThan(5);
    });

  for (const nombre of NOMBRES)
    it(`${nombre}: guardar sin cambios da el mismo modelo y la misma huella; guardar otra vez, los mismos bytes`, () => {
      const p = proyectoV2b(nombre);
      const l = leerProyecto(serializar(p));
      expect(l.valido).toBe(true);
      if (!l.valido) return;
      expect(l.proyecto.modelo).toStrictEqual(p.modelo);
      expect(huella(l.proyecto)).toBe(huella(p));
      expect(serializar(l.proyecto)).toBe(serializar(p));
    });

  it("las tablas de V2b son de las colecciones nuevas, y ninguna columna de una tabla queda sin leer", () => {
    for (const t of ["muros", "panos", "apoyosLineales"] as const) expect(DEF_TABLAS[t].coleccion).toBe(t);
    expect((TABLAS as readonly string[]).includes("bandas")).toBe(false);
    // Cada clave que da la fila de un objeto es una columna de su tabla
    for (const nombre of NOMBRES) {
      const { modelo } = proyectoV2b(nombre);
      const ctx = contexto(modelo);
      for (const t of TABLAS) {
        const claves = new Set(DEF_TABLAS[t].columnas.map((c) => c.clave));
        for (const o of lista(modelo, DEF_TABLAS[t].coleccion)) for (const k of Object.keys(DEF_TABLAS[t].fila(o, ctx))) expect(claves.has(k), `${t}.${k}`).toBe(true);
      }
    }
  });
});

describe("V2b: desplegables", () => {
  for (const nombre of NOMBRES)
    it(`${nombre}: cada valor de una columna con desplegable está entre sus opciones, y cada opción se lee en esa columna`, () => {
      const { modelo } = proyectoV2b(nombre);
      const ctx = contexto(modelo);
      for (const t of TABLAS) {
        const def = DEF_TABLAS[t];
        for (const col of def.columnas) {
          if (!col.opciones) continue;
          const valores = col.opciones(ctx).map((o) => o.valor);
          for (const o of lista(modelo, def.coleccion)) {
            const fila = def.fila(o, ctx);
            if (!(col.clave === "psi" && /\d/.test(fila.psi ?? ""))) expect(valores, `${t} ${o.id} · ${col.clave}`).toContain(fila[col.clave] ?? "");
            if (!fila[col.clave]) continue;
            for (const v of valores) {
              if (v === "") continue;
              const l = def.objeto({ ...fila, [col.clave]: v }, ctx, o);
              expect(l.ok ? [] : l.errores.filter((e) => e.columna === col.clave), `${t} ${o.id} · ${col.clave} = «${v}»`).toEqual([]);
            }
          }
        }
      }
    });
});

describe("V2b: celdas que no valen", () => {
  const p = proyectoV2b("variado");
  const m = p.modelo;
  const ctx = contexto(m);
  const fila = (t: "losas" | "muros" | "cargas", id: string) => DEF_TABLAS[t].fila(lista(m, DEF_TABLAS[t].coleccion).find((o) => o.id === id)!, ctx);
  const errores = (t: "losas" | "muros" | "cargas", f: Record<string, string>) => {
    const l = DEF_TABLAS[t].objeto(f, ctx);
    return l.ok ? [] : l.errores.map((e) => e.columna);
  };
  const losa = m.losas![0]!.id;
  const maciza = m.losas![1]!.id;

  it("un dato de reticular en una losa sin intereje no entra; con intereje, nervio y capa son obligatorios", () => {
    expect(errores("losas", { ...fila("losas", maciza), nervio: "0,12" })).toEqual(["nervio"]);
    expect(errores("losas", { ...fila("losas", losa), nervio: "", capa: "" })).toEqual(["nervio", "capa"]);
  });

  it("los multiplicadores, por su nombre, en (0, 100] y sin repetir", () => {
    for (const x of ["m11=0", "m33=0,5", "m11=0,3 m11=0,4", "m11 0,3", "m11=101"]) expect(errores("losas", { ...fila("losas", losa), multiplicadores: x }), x).toEqual(["multiplicadores"]);
    const l = DEF_TABLAS.losas.objeto({ ...fila("losas", losa), multiplicadores: "v23 = 0,15  M11=0,5" }, ctx);
    expect(l.ok && (l.objeto.reticular as { multiplicadores: unknown }).multiplicadores).toStrictEqual({ m11: 0.5, v23: 0.15 });
  });

  it("los huecos de un muro, de cuatro números; un empuje necesita su lado y z1 > z0, y no admite columnas de otras cargas", () => {
    const muro = m.muros?.[0]?.id ?? proyectoV2b("muros").modelo.muros![0]!.id;
    const pm = proyectoV2b("muros").modelo;
    const cm = contexto(pm);
    const fm = DEF_TABLAS.muros.fila(pm.muros!.find((x) => x.id === muro)! as never, cm);
    const lm = DEF_TABLAS.muros.objeto({ ...fm, huecos: "1 2 3" }, cm);
    expect(lm.ok ? [] : lm.errores.map((e) => e.columna)).toEqual(["huecos"]);
    const emp = pm.cargas!.find((c) => c.tipo === "empuje")!;
    const fe = DEF_TABLAS.cargas.fila(emp as never, cm);
    const leer = (f: Record<string, string>) => {
      const l = DEF_TABLAS.cargas.objeto(f, cm);
      return l.ok ? [] : l.errores.map((e) => e.columna);
    };
    expect(leer({ ...fe, lado: "" })).toEqual(["lado"]);
    expect(leer({ ...fe, z1: fe.z0! })).toEqual(["z1"]);
    expect(leer({ ...fe, q: "0 0 -1" })).toEqual(["q"]);
    expect(leer({ ...fila("cargas", m.cargas![0]!.id), lado: "derecho" })).toContain("lado");
  });
});

describe("V2b: se reconstruye desde un proyecto vacío (criterio 3)", () => {
  const ORDEN = ["plantas", "materiales", "secciones", "casos", "pilares", "vigas", "losas", "panos", "muros", "apoyos", "apoyosLineales", "cargas"] as const;

  for (const nombre of NOMBRES)
    it(`${nombre}: pegando sus tablas, el mismo modelo (sin sus bandas, que ya no tienen tabla) y la misma huella`, () => {
      const proyecto = { ...proyectoV2b(nombre) };
      const { bandas: _b, ...sin } = proyecto.modelo;
      proyecto.modelo = sin as ModeloFisico;
      let p = vacio();
      for (const t of ORDEN) {
        const tsv = exportar(proyecto.modelo, t);
        if (leerTsv(tsv).length <= 1) continue;
        const r = pegar(p.modelo, t, tsv);
        if (!r.ok) throw new Error(`${t}: ${JSON.stringify(r.errores.slice(0, 3))}`);
        p = aplicado(p, r.operacion);
      }
      expect(p.modelo).toStrictEqual(proyecto.modelo);
      expect(huella(p)).toBe(huella(proyecto));
    });
});

describe("Fase F: las bandas, fuera de la app", () => {
  const base = proyectoV2b("bandas");

  it("editar lo demás y guardar deja las bandas como estaban", () => {
    const losa = base.modelo.losas![0]!;
    const f = DEF_TABLAS.losas.fila(losa as never, contexto(base.modelo));
    const r = escribirFila(base, "losas", losa.id, { ...f, espesor: "0,3" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proyecto.modelo.bandas).toStrictEqual(base.modelo.bandas);
    const l = leerProyecto(serializar(r.proyecto));
    expect(l.valido && l.proyecto.modelo.bandas).toStrictEqual(base.modelo.bandas);
  });

  it("no hay operación para proponer bandas, ni se copian a otras plantas", () => {
    expect(aplicar(base, { op: "proponerBandas" } as unknown as Operacion).ok).toBe(false);
    const c = copiarAPlantas(base.modelo, [base.modelo.bandas![0]!.id], [base.modelo.plantas[0]!.id]);
    expect(c.ok && c.operacion.op === "lote" ? c.operacion.operaciones.length : 0).toBe(0);
  });
});
