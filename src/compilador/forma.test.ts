/**
 * A2-61 y A2-62 (`docs/fem3d/auditoria-2.md` §10.3): `compilar` llamado sin el esquema de la CLI (la
 * integración en Concreta) con entradas mal formadas da un error de modelo claro, nunca
 * `compilador/error-interno`, y un booleano o un objeto que no lo es no se ignora en silencio.
 */
import { describe, expect, it } from "vitest";
import { base } from "../pruebas/invalidos-c2.ts";
import { transformar } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

type M = Record<string, unknown>;
const mutar = (f: (m: M) => void): ModeloFisico => {
  const m = structuredClone(base()) as unknown as M;
  f(m);
  return m as unknown as ModeloFisico;
};
const lista = (m: M, k: string) => m[k] as M[];

const CASOS: [string, (m: M) => void, string][] = [
  ["una lista que no es una lista", (m) => (m.pilares = "P1"), "fisico/no-valido"],
  ["un elemento null", (m) => (lista(m, "pilares")[0] = null as unknown as M), "fisico/sin-id"],
  ["un caso null", (m) => (lista(m, "casos")[0] = null as unknown as M), "fisico/sin-id"],
  ["una carga null", (m) => (lista(m, "cargas")[0] = null as unknown as M), "fisico/sin-id"],
  ["el contorno de una losa que no es una lista de pares", (m) => (lista(m, "losas")[0]!.contorno = [[0, 0, 0], [1, 0], [1, 1]]), "fisico/valor-no-valido"],
  ["los huecos de una losa que no son listas de pares", (m) => (lista(m, "losas")[0]!.huecos = [5]), "fisico/valor-no-valido"],
  ["un tipo de material desconocido", (m) => (lista(m, "materiales")[0]!.tipo = "hormigón"), "fisico/valor-no-valido"],
  ["acciones que no es un objeto", (m) => (m.acciones = "x"), "fisico/valor-no-valido"],
  ["acciones.viento null", (m) => (m.acciones = { viento: null }), "fisico/valor-no-valido"],
  ["pesoPropio que no es un booleano", (m) => (lista(m, "casos")[0]!.pesoPropio = 1), "fisico/valor-no-valido"],
  ["amplificar del segundo orden que no es un booleano", (m) => (m.acciones = { segundoOrden: { amplificar: "no" } }), "segundo-orden/no-valido"],
  ["el modelo, vacío", (m) => Object.keys(m).forEach((k) => delete m[k]), "fisico/no-valido"],
];

describe("la forma del modelo, antes de compilarlo (A2-61, A2-62)", () => {
  it("el modelo de partida compila", () => {
    expect(compilar(base()).valido).toBe(true);
  });
  for (const [nombre, f, codigo] of CASOS)
    it(nombre, () => {
      const r = compilar(mutar(f));
      expect(r.valido).toBe(false);
      const codigos = r.diagnosticos.map((d) => d.codigo);
      expect(codigos).not.toContain("compilador/error-interno");
      expect(codigos).toContain(codigo);
    });
  it("a más de 5 km del origen, un error de modelo claro; dentro, compila con el mismo control sin pérdidas (A2-15)", () => {
    // Antes, desde 1,5 km del origen, `cargas/perdidas` («Es un fallo del compilador»): el control sumaba
    // los momentos de las regiones con sus coordenadas absolutas (2,5e-9 a 1,5 km, con 1e-9 de tolerancia)
    const trasladado = (D: number) => transformar(base(), { p: (q) => [q[0] + D, q[1] - D], v: (q) => [q[0]!, q[1]!, q[2]!], giro: 0 });
    const lejos = compilar(trasladado(20000));
    expect(lejos.valido).toBe(false);
    expect(lejos.diagnosticos.map((d) => d.codigo)).toEqual(["fisico/lejos-del-origen"]);
    for (const D of [0, 1500, 4900]) {
      const c = compilar(trasladado(D));
      expect(c.valido, `${D} m: ${c.diagnosticos.map((d) => d.mensaje).join("\n")}`).toBe(true);
      if (c.valido) expect(Math.max(c.estadisticas.sinPerdidas.fuerzas, c.estadisticas.sinPerdidas.momentos), `${D} m`).toBeLessThan(1e-13);
    }
  });
  it("un modelo que no es un objeto", () => {
    for (const x of [null, 5, "x", []]) {
      const r = compilar(x as unknown as ModeloFisico);
      expect(r.valido).toBe(false);
      expect(r.diagnosticos.map((d) => d.codigo)).toEqual(["fisico/no-valido"]);
    }
  });
});
