/**
 * Lo que el inspector dice de cada campo (`ficha.ts`): lo obligatorio sale de leer la fila con el
 * campo vacío, el valor por defecto es el del compilador y el croquis de un forjado sigue lo escrito.
 */
import { describe, expect, it } from "vitest";
import { pesoLosa } from "../agente/sensatez.ts";
import type { Losa } from "../compilador/fisico.ts";
import { croquisForjado, estadoCampos } from "./ficha.ts";
import { leerEjemplo } from "./serializar.test.ts";
import { DEF_TABLAS, TABLAS, contexto, objetosTabla } from "./tablas.ts";

const { proyecto } = leerEjemplo("muestrario");
const m = proyecto.modelo;
const ctx = contexto(m);
const forjados = DEF_TABLAS.forjados;
const fila = (id: string) => forjados.fila(objetosTabla(m, "forjados").find((o) => o.id === id)!, ctx);
const obligatorios = (f: Record<string, string>) =>
  Object.entries(estadoCampos(forjados, f, ctx))
    .filter(([, e]) => e.obligatorio)
    .map(([k]) => k);

describe("estadoCampos", () => {
  it("en Forjados, lo obligatorio depende del tipo", () => {
    expect(obligatorios(fila("L1"))).toEqual(["planta", "contorno", "espesor", "material"]);
    // El pp sale solo, salvo con un casetón perdido de otro material o una vigueta que no es una T
    expect(fila("L2").caseton).toBe("perdido");
    expect(obligatorios(fila("L2"))).toEqual(["planta", "contorno", "espesor", "material", "pp", "intereje", "nervio", "capa"]);
    for (const caseton of ["", "hormigon", "ceramica", "poliestireno", "recuperable"])
      expect(obligatorios({ ...fila("L2"), caseton }), caseton).toEqual(["planta", "contorno", "espesor", "material", "intereje", "nervio", "capa"]);
    expect(obligatorios(fila("F1"))).toEqual(["planta", "contorno", "direccion", "intereje", "seccion"]);
  });

  it("el pp por defecto es el que pesa la losa sin él", () => {
    const sinPp = (id: string, f: Record<string, string>) => {
      const e = estadoCampos(forjados, { ...f, pp: "" }, ctx).pp!;
      const l = { ...(m.losas!.find((x) => x.id === id) as Losa) };
      delete (l as { pp?: number }).pp;
      if (f.caseton === "recuperable") l.reticular = { ...l.reticular!, caseton: "recuperable", abacos: [] };
      const mat = m.materiales.find((x) => x.id === l.material)!;
      const A = Math.abs(croquisForjado({ ...f, abacos: "" }, ctx).area!);
      return [e.defecto!.split(" = ")[0], (Math.round((pesoLosa(l, mat) / A) * 100) / 100).toString().replace(".", ",")];
    };
    const [a, b] = sinPp("L1", fila("L1"));
    expect(a).toBe(b);
    const [c, d] = sinPp("L2", { ...fila("L2"), caseton: "recuperable" });
    expect(c).toBe(d);
    expect(estadoCampos(forjados, fila("L1"), ctx).direccion!.defecto).toBe("0 (según +X)");
    expect(estadoCampos(forjados, fila("F1"), ctx).direccion!.defecto).toBeUndefined();
  });

  it("en todas las tablas: el id nunca es obligatorio y un obligatorio vacío no se lee", () => {
    for (const t of TABLAS) {
      const def = DEF_TABLAS[t];
      for (const o of objetosTabla(m, t)) {
        const f = def.fila(o, ctx);
        const e = estadoCampos(def, f, ctx, o);
        expect(e.id?.obligatorio ?? false).toBe(false);
        for (const [k, x] of Object.entries(e)) if (x.obligatorio && !def.obligatoria?.(k, f, ctx)) expect(def.objeto({ ...f, [k]: "" }, ctx, o).ok).toBe(false);
      }
    }
  });
});

describe("croquisForjado", () => {
  it("lee lo escrito y deja fuera lo que está a medio escribir", () => {
    const f = fila("L2");
    const c = croquisForjado(f, ctx);
    expect(c.tipo).toBe("reticular");
    expect(c.contorno!.length).toBeGreaterThanOrEqual(3);
    expect(c.intereje).toBeGreaterThan(0);
    expect(c.volumen).toBeGreaterThan(c.capa!);
    expect(c.volumen).toBeLessThan(c.canto!);
    const medio = croquisForjado({ ...f, contorno: "0 0; 5", nervio: "0,", huecos: "1 1; 2" }, ctx);
    expect(medio.contorno).toBeNull();
    expect(medio.area).toBeNull();
    expect(medio.nervio).toBeUndefined();
    expect(medio.huecos).toEqual([]);
    expect(croquisForjado({ id: "X", tipo: "maciza", contorno: "0 0; 4 0; 4 3; 0 3", huecos: "1 1; 2 1; 2 2; 1 2" }, ctx).area).toBe(11);
    expect(croquisForjado(fila("F1"), ctx).vigueta?.id).toBe(fila("F1").seccion);
  });
});

describe("Cargas en el inspector (2026-10-28)", () => {
  const cargas = DEF_TABLAS.cargas;
  const filaCarga = (id: string) => cargas.fila(objetosTabla(m, "cargas").find((o) => o.id === id)!, ctx);
  const aplican = (f: Record<string, string>) => cargas.columnas.map((c) => c.clave).filter((k) => cargas.aplica!(k, f));

  it("cada tipo enseña sólo sus campos", () => {
    expect(aplican(filaCarga("CM-PB"))).toEqual(["id", "tipo", "caso", "planta", "sobre", "q", "puntos"]);
    expect(aplican(filaCarga("PETO-1"))).toEqual(["id", "tipo", "caso", "sobre", "ejes", "q", "qb", "desde", "hasta"]);
    expect(aplican(filaCarga("WX+P1"))).toEqual(["id", "tipo", "caso", "planta", "x", "y", "F", "M"]);
    expect(aplican(filaCarga("EMP-M1"))).toEqual(["id", "tipo", "caso", "sobre", "lado", "z0", "z1", "p0", "p1"]);
  });

  it("los ejes de una carga de barra son globales si no se dicen, y cambiar de tipo vacía lo que deja de aplicar", () => {
    const f = { ...filaCarga("PETO-1"), ejes: "" };
    const l = cargas.objeto(f, ctx);
    expect(l.ok && l.objeto).toEqual(objetosTabla(m, "cargas").find((o) => o.id === "PETO-1"));
    expect(estadoCampos(cargas, f, ctx).ejes).toEqual({ obligatorio: false });
    const lineal = cargas.conValor!(filaCarga("CM-PB"), "tipo", "lineal");
    expect([lineal.sobre, lineal.q, lineal.planta]).toEqual(["", "0 0 -2", "PB"]);
  });
});
