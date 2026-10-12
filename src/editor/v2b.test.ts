/**
 * V2b (`docs/fem3d/visor.md` §7.3): muros y empujes, reticular, paños, apoyos lineales y bandas en
 * las tablas del editor.
 * - criterio 1: cada objeto sale igual de su fila, sin conservar nada a escondidas (las bandas, con
 *   su origen y sus apoyos recalculados), y guardar sin cambios da los mismos bytes y la huella;
 * - criterio 3: los modelos se reconstruyen desde un proyecto vacío pegando sus tablas y, las
 *   bandas, con «Proponer bandas»;
 * - criterio 4: proponer bandas no pierde las del usuario y proponer dos veces no cambia nada;
 * - decisión a: los apoyos de una banda editada se recalculan.
 * El criterio 2 (sucesiones al azar) está en `editor.test.ts`, con estos proyectos.
 */
import { describe, expect, it } from "vitest";
import { MODELOS_V2B, proyectoV2b } from "../../validacion/v2b/modelos.ts";
import { leerProyecto, VERSION_ESQUEMA, type Proyecto } from "../agente/proyecto.ts";
import { apoyosBanda, proponerBandas } from "../compilador/bandas.ts";
import { huellaCompilacion } from "../compilador/compilar.ts";
import { resolverOpciones, type Banda } from "../compilador/fisico.ts";
import { propuestaBandas, solapan } from "./bandas.ts";
import { leerTsv } from "./celdas.ts";
import { copiarAPlantas, escribirFila, exportar, operacionFila, pegar } from "./edicion.ts";
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
    it(`${nombre}: cada objeto sale igual de su fila, sin base (las bandas, con sus apoyos recalculados)`, () => {
      const { modelo } = proyectoV2b(nombre);
      const ctx = contexto(modelo);
      let vistos = 0;
      for (const t of TABLAS) {
        const def = DEF_TABLAS[t];
        for (const o of lista(modelo, def.coleccion)) {
          const l = def.objeto(def.fila(o, ctx), ctx);
          // Una banda leída de nuevo es del usuario, con los apoyos de sus pilares: los de la propuesta, bit a bit
          const esperado = t === "bandas" ? { ...o, origen: "usuario", apoyos: apoyosBanda(modelo, o as unknown as Banda) } : o;
          expect(l.ok ? l.objeto : l.errores, `${t} ${o.id}`).toStrictEqual(esperado);
          if (t === "bandas" && (o as unknown as Banda).apoyos) expect((l.ok ? l.objeto : o).apoyos, `${o.id}`).toStrictEqual(o.apoyos);
          // Con su base y la misma geometría, sale igual, también su origen
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
    for (const t of ["muros", "panos", "apoyosLineales", "bandas"] as const) expect(DEF_TABLAS[t].coleccion).toBe(t);
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
  const ORDEN = ["plantas", "materiales", "secciones", "casos", "pilares", "vigas", "losas", "panos", "muros", "apoyos", "apoyosLineales", "bandas", "cargas"] as const;

  for (const nombre of NOMBRES)
    it(`${nombre}: pegando sus tablas${nombre === "bandas" ? " y proponiendo las bandas" : ""}, el mismo modelo y la misma huella`, () => {
      const proyecto = proyectoV2b(nombre);
      let p = vacio();
      for (const t of ORDEN) {
        // Las bandas propuestas salen de «Proponer bandas»; las del usuario se pegan
        if (t === "bandas" && nombre === "bandas") {
          p = aplicado(p, { op: "proponerBandas" });
          continue;
        }
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

describe("V2b: bandas (decisiones a y b, criterio 4)", () => {
  const base = proyectoV2b("bandas");
  const propuestas = base.modelo.bandas!;
  const p2 = propuestas.find((b) => b.id.endsWith(":1:P2"))!;
  const p3 = propuestas.find((b) => b.id.endsWith(":1:P3"))!;
  const filaDe = (p: Proyecto, id: string) => DEF_TABLAS.bandas.fila(p.modelo.bandas!.find((b) => b.id === id)! as never, contexto(p.modelo));

  it("mover una banda a otra alineación la hace del usuario, con los apoyos de ésa", () => {
    const f = filaDe(base, p2.id);
    const r = escribirFila(base, "bandas", p2.id, { ...f, y0: String(p3.desde[1]).replace(".", ","), y1: String(p3.hasta[1]).replace(".", ",") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.proyecto.modelo.bandas!.find((x) => x.id === p2.id)!;
    expect(b.origen).toBe("usuario");
    expect(b.apoyos).toStrictEqual(p3.apoyos);
  });

  it("cambiar su ancho la hace del usuario y deja sus apoyos; cambiar sólo su id, no", () => {
    const f = filaDe(base, p2.id);
    const r = escribirFila(base, "bandas", p2.id, { ...f, ancho: "2" });
    expect(r.ok && r.proyecto.modelo.bandas!.find((x) => x.id === p2.id)).toMatchObject({ ancho: 2, origen: "usuario", apoyos: p2.apoyos });
    const s = escribirFila(base, "bandas", p2.id, { ...f, id: "BX" });
    expect(s.ok && s.proyecto.modelo.bandas!.find((x) => x.id === "BX")).toStrictEqual({ ...p2, id: "BX" });
  });

  it("una banda nueva escrita en la tabla es del usuario y tiene los apoyos de sus pilares", () => {
    const t = operacionFila(base.modelo, "bandas", null, { id: "", planta: p2.planta, x0: String(p2.desde[0]), y0: String(p2.desde[1]), x1: String(p2.hasta[0]), y1: String(p2.hasta[1]), ancho: "1", tipo: "" });
    expect(t.ok && t.operacion.op === "crear" && t.operacion.objeto).toMatchObject({ id: "B1", origen: "usuario", apoyos: p2.apoyos });
  });

  it("proponer dos veces seguidas no cambia nada", () => {
    const p = aplicado(base, { op: "proponerBandas" });
    expect(serializar(p)).toBe(serializar(base));
    const sin = { ...base, modelo: { ...base.modelo, bandas: undefined } };
    const a = aplicado(sin, { op: "proponerBandas" });
    expect(serializar(aplicado(a, { op: "proponerBandas" }))).toBe(serializar(a));
  });

  it("proponer otra vez rehace las propuestas y deja las del usuario; la que se solapa con una del usuario no entra", () => {
    // P2, retocada por el usuario (más estrecha); P3, quitada; y una del usuario lejos de todo
    const f = filaDe(base, p2.id);
    let p = (() => {
      const r = escribirFila(base, "bandas", p2.id, { ...f, ancho: "2" });
      if (!r.ok) throw new Error("no");
      return r.proyecto;
    })();
    p = aplicado(p, { op: "borrar", ids: [p3.id] });
    const pb = propuestaBandas(p.modelo);
    expect(pb.omitidas.map((x) => [x.banda.id, x.solapa])).toEqual([[p2.id, p2.id]]);
    expect(pb.quitar.sort()).toEqual(propuestas.filter((b) => b.id !== p2.id && b.id !== p3.id).map((b) => b.id).sort());
    const q = aplicado(p, { op: "proponerBandas" });
    const bs = q.modelo.bandas!;
    expect(bs.find((b) => b.id === p2.id)).toMatchObject({ ancho: 2, origen: "usuario" });
    expect(bs.find((b) => b.id === p3.id)).toStrictEqual(p3);
    expect(bs).toHaveLength(propuestas.length);
    // Ninguna propuesta se solapa con una del usuario
    for (const b of bs) if (b.origen === "propuesta") expect(bs.filter((u) => u.origen !== "propuesta").some((u) => solapan(u, b)), b.id).toBe(false);
  });

  it("proponer en una planta no toca las de las demás", () => {
    const m = proyectoV2b("muros");
    const todas = aplicado(m, { op: "proponerBandas" });
    const [n1, n2] = [m.modelo.plantas.find((x) => x.id === "N1")!.id, m.modelo.plantas.find((x) => x.id === "N2")!.id];
    const solo1 = aplicado(m, { op: "proponerBandas", plantas: [n1] });
    expect(solo1.modelo.bandas!.every((b) => b.planta === n1)).toBe(true);
    expect(solo1.modelo.bandas).toStrictEqual(todas.modelo.bandas!.filter((b) => b.planta === n1));
    const luego2 = aplicado(solo1, { op: "proponerBandas", plantas: [n2] });
    expect(new Set(luego2.modelo.bandas)).toStrictEqual(new Set(todas.modelo.bandas));
    expect(proponerBandas(m.modelo).bandas.length).toBe(todas.modelo.bandas!.length);
  });

  it("un modelo que no vale no propone nada y lo dice", () => {
    const malo = { ...base, modelo: { ...base.modelo, pilares: [{ ...base.modelo.pilares![0]!, desde: base.modelo.pilares![0]!.hasta }] } };
    const r = aplicar(malo, { op: "proponerBandas" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores[0]!.codigo).toBe("editor/bandas");
  });

  it("copiar una banda a otra planta la hace del usuario, con los apoyos de los pilares de allí", () => {
    const m = aplicado(proyectoV2b("muros"), { op: "proponerBandas", plantas: ["N1"] });
    const b = m.modelo.bandas![0]!;
    const c = copiarAPlantas(m.modelo, [b.id], ["N2"]);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const q = aplicado(m, c.operacion);
    const copia = q.modelo.bandas!.find((x) => x.planta === "N2")!;
    expect(copia).toMatchObject({ desde: b.desde, hasta: b.hasta, ancho: b.ancho, origen: "usuario" });
    expect(copia.apoyos).toStrictEqual(apoyosBanda(q.modelo, copia));
  });
});
