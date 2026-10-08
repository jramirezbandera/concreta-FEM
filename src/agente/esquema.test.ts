/**
 * Criterios 1 y 2 de A0: el esquema de `proyecto.json` es el que sale de los tipos, acepta todos los
 * modelos válidos de C1–C5 y, con el compilador detrás, rechaza el catálogo de entradas no válidas
 * de C1–C4 nombrando el id físico. Además, los mensajes del validador.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RUTA_ESQUEMA, textoEsquema } from "../../scripts/generar-esquema.ts";
import { modelosValidos } from "../../validacion/a0/modelos.ts";
import { compilar } from "../compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../compilador/fisico.ts";
import * as c1 from "../pruebas/invalidos-c1.ts";
import * as c2 from "../pruebas/invalidos-c2.ts";
import * as c3 from "../pruebas/invalidos-c3.ts";
import * as c4 from "../pruebas/invalidos-c4.ts";
import { comprobarProyecto, leerProyecto, VERSION_ESQUEMA, type Proyecto } from "./proyecto.ts";

const proyecto = (modelo: unknown, opciones?: OpcionesCompilacion): Proyecto => ({ esquema: VERSION_ESQUEMA, modelo: modelo as ModeloFisico, ...(opciones ? { opciones } : {}) });

describe("criterio 1 de A0: el esquema", () => {
  it("el versionado es el que sale de los tipos (bun scripts/generar-esquema.ts)", () => {
    expect(readFileSync(RUTA_ESQUEMA, "utf8").replace(/\r\n/g, "\n")).toBe(textoEsquema());
  }, 120_000);

  const validos = modelosValidos();
  it(`acepta los ${validos.length} modelos válidos de C1–C5 (tras pasar por JSON)`, () => {
    expect(validos.length).toBeGreaterThan(80);
    for (const m of validos) {
      const r = leerProyecto(JSON.stringify(proyecto(m.fisico, m.opciones)));
      expect(r.diagnosticos, m.nombre).toEqual([]);
      expect(r.valido, m.nombre).toBe(true);
    }
  });
});

type Entrada = [nombre: string, mutar: (f: never) => unknown, codigo: string, id?: string, opciones?: OpcionesCompilacion];
const catalogos: [string, () => ModeloFisico, readonly Entrada[]][] = [
  ["C1", c1.base, c1.CATALOGO as unknown as Entrada[]],
  ["C2", c2.base, c2.CATALOGO as unknown as Entrada[]],
  ["C3", c3.base, c3.CATALOGO as unknown as Entrada[]],
  ["C4", c4.base, c4.CATALOGO as unknown as Entrada[]],
];

describe("criterio 2 de A0: las entradas no válidas de C1–C4 se rechazan nombrando el id", () => {
  for (const [fase, base, catalogo] of catalogos) {
    it(`${fase}: el modelo base pasa el esquema`, () => {
      expect(comprobarProyecto(proyecto(base())).diagnosticos).toEqual([]);
    });
    it(`${fase}: las ${catalogo.length} entradas, por el esquema o por el compilador`, () => {
      let porEsquema = 0;
      for (const [nombre, mutar, codigo, id, opciones] of catalogo) {
        const f = base();
        const otro = mutar(f as never);
        const modelo = otro === null ? null : f;
        const e = comprobarProyecto(proyecto(modelo, opciones));
        if (!e.valido) {
          porEsquema++;
          expect(e.diagnosticos.every((d) => d.codigo.startsWith("esquema/")), nombre).toBe(true);
          if (id) expect(e.diagnosticos.some((d) => d.ids?.includes(id)), `${nombre}: ${e.diagnosticos.map((d) => d.mensaje).join("; ")}`).toBe(true);
          continue;
        }
        // Lo que el esquema deja pasar lo para el compilador, con su código y su id (como en C1–C4)
        const r = compilar(modelo as ModeloFisico, opciones);
        expect(r.valido, nombre).toBe(false);
        const d = r.diagnosticos.filter((x) => x.codigo === codigo);
        expect(d.length, `${nombre}: ${codigo} no está en ${r.diagnosticos.map((x) => x.codigo).join(", ")}`).toBeGreaterThan(0);
        if (id) expect(d.some((x) => x.ids?.includes(id)), nombre).toBe(true);
      }
      expect(porEsquema).toBeGreaterThan(0);
    });
  }
});

describe("mensajes del validador", () => {
  const base = (): ModeloFisico => c1.base();
  const errores = (mutar: (f: Record<string, unknown> & ModeloFisico) => void, opciones?: unknown) => {
    const f = structuredClone(base()) as Record<string, unknown> & ModeloFisico;
    mutar(f);
    const r = comprobarProyecto({ ...proyecto(f), ...(opciones !== undefined ? { opciones } : {}) });
    return r.diagnosticos;
  };

  it("un campo mal escrito propone el bueno y nombra el objeto", () => {
    const d = errores((f) => ((f.pilares![0] as unknown as Record<string, unknown>).secion = "p30"));
    expect(d.map((x) => x.codigo)).toEqual(["esquema/campo-desconocido"]);
    expect(d[0]!.mensaje).toBe('En modelo.pilares[0] (Pilar A): "secion" no es un campo de Pilar; ¿quería decir "seccion"?.');
    expect(d[0]!.ids).toEqual(["A"]);
    expect(d[0]!.detalles).toEqual({ ruta: "modelo.pilares[0]" });
  });

  it("un campo opcional mal escrito no se ignora en silencio", () => {
    const d = errores((f) => ((f.vigas![0] as unknown as Record<string, unknown>).insercon = "superior"));
    expect(d[0]!.mensaje).toContain('¿quería decir "insercion"?');
  });

  it("falta un campo obligatorio", () => {
    const d = errores((f) => delete (f.pilares![1] as unknown as Record<string, unknown>).seccion);
    expect(d[0]!.mensaje).toBe('En modelo.pilares[1] (Pilar B): falta el campo obligatorio "seccion".');
  });

  it("la variante de una unión la elige su discriminante", () => {
    const d = errores((f) => (f.cargas as unknown[]).push({ tipo: "superficie", id: "s1", caso: "Q", planta: "P1", q: [0, 0, -1], zona: [[0, 0], [1, 0]], loza: "L" }));
    expect(d.map((x) => x.codigo)).toEqual(["esquema/campo-desconocido"]);
    expect(d[0]!.mensaje).toContain('"loza" no es un campo de CargaFisica; ¿quería decir "losa"?');
    const e = errores((f) => (f.cargas as unknown[]).push({ tipo: "puntal", id: "p1", caso: "Q", planta: "P1", x: 0, y: 0 }));
    expect(e[0]!.mensaje).toContain('vale "puntal", que no es ninguno de los admitidos: "puntual", "viga", "pilar", "superficie", "lineal", "empuje"');
    expect(e[0]!.ids).toEqual(["p1"]);
  });

  it("tuplas, tipos y valores", () => {
    expect(errores((f) => ((f.vigas![0] as unknown as Record<string, unknown>).puntos = [[0, 0], [6, 0, 1]]))[0]!.mensaje).toBe("En modelo.vigas[0].puntos[1] (Viga X0P1): tiene 3 elementos y admite 2.");
    expect(errores((f) => ((f.pilares![0] as unknown as Record<string, unknown>).x = "0"))[0]!.mensaje).toBe('En modelo.pilares[0].x (Pilar A): tiene que ser un número y es un texto ("0").');
    expect(errores((f) => ((f.plantas[1] as unknown as Record<string, unknown>).altura = "3"))[0]!.mensaje).toBe('En modelo.plantas[1].altura (Planta P1): tiene que ser un número o null y es un texto ("3").');
    expect(errores((f) => ((f.plantas[1] as unknown as Record<string, unknown>).tipo = "garaje"))[0]!.mensaje).toBe('En modelo.plantas[1].tipo (Planta P1): vale "garaje", que no es ninguno de los admitidos: "cubierta", "planta", "sotano".');
  });

  it("opciones mal escritas", () => {
    const d = errores(() => undefined, { tamanoMala: 0.5 });
    expect(d[0]!.mensaje).toBe('En opciones (OpcionesCompilacion): "tamanoMala" no es un campo de OpcionesCompilacion; ¿quería decir "tamanoMalla"?.');
  });

  it("JSON roto, versión y raíz", () => {
    expect(leerProyecto("{ esto no").diagnosticos[0]!.codigo).toBe("proyecto/json");
    expect(leerProyecto(JSON.stringify({ ...proyecto(base()), esquema: "concreta-fem/proyecto@2" })).diagnosticos[0]!.codigo).toBe("proyecto/version");
    const sin = leerProyecto(JSON.stringify({ modelo: base() }));
    expect(sin.diagnosticos.map((d) => d.mensaje)).toEqual(['En el proyecto: falta el campo obligatorio "esquema".']);
    expect(leerProyecto("[]").diagnosticos[0]!.mensaje).toBe("En el proyecto: tiene que ser un objeto y es una lista ([]).");
  });

  it("muchos errores se cortan con un aviso de cuántos más hay", () => {
    const d = errores((f) => f.pilares!.forEach((p) => ((p as unknown as Record<string, unknown>).X = 1)), undefined);
    expect(d.length).toBe(4);
    const g = errores((f) => {
      for (let i = 0; i < 60; i++) (f.cargas as unknown[]).push({ tipo: "puntual", id: `x${i}`, caso: "Q", planta: "P1", x: 0, y: 0, f: [0, 0, 1] });
    });
    expect(g.length).toBe(51);
    expect(g[50]!.codigo).toBe("esquema/demasiados");
  });
});
