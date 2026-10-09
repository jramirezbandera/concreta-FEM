/**
 * A-1 (`docs/fem3d/fase-a0-a2.md`): un campo desconocido del modelo físico o de las opciones es un
 * error de `compilar`, también sin pasar por el esquema de `proyecto.json`. Son las erratas de A-1,
 * que antes compilaban sin ningún aviso con el valor por defecto.
 */
import { describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico } from "./fisico.ts";

const base = () => structuredClone(edificioObjetivoLosas(2, 2, 2)) as unknown as Record<string, unknown> & ModeloFisico;
const objeto = (x: unknown) => x as Record<string, unknown>;

describe("A-1: campos desconocidos", () => {
  it("el modelo sin erratas compila como antes", () => {
    expect(compilar(base()).valido).toBe(true);
  });

  it("cada errata de A-1 es un error que nombra el objeto y propone el campo bueno", () => {
    const casos: [string, (f: Record<string, unknown> & ModeloFisico) => void, string, string][] = [
      ["viga", (f) => (objeto(f.vigas![0]).insercon = "superior"), "insercion", "X0-N1"],
      ["pilar: giro", (f) => (objeto(f.pilares![0]).gro = 90), "giro", "P0-0"],
      ["pilar: base", (f) => (objeto(f.pilares![0]).bse = "articulado"), "base", "P0-0"],
      ["planta", (f) => (objeto(f.plantas[0]).diafragm = "ninguno"), "diafragma", "N2"],
      ["caso", (f) => (objeto(f.casos[1]).pesopropio = true), "pesoPropio", "Q"],
      ["material", (f) => (objeto(f.materiales[0]).Nu = 0.3), "nu", "HA"],
      ["losa", (f) => (objeto(f.losas![0]).ejel = 30), "eje1", "L-N1"],
      ["carga", (f) => (objeto(f.cargas!.find((c) => c.tipo === "superficie")).zonna = [[0, 0], [1, 0], [1, 1]]), "zona", "R-N1"],
      ["modelo", (f) => (f.apoyoslineales = []), "apoyosLineales", ""],
    ];
    for (const [nombre, mutar, bueno, id] of casos) {
      const f = base();
      mutar(f);
      const r = compilar(f);
      expect(r.valido, nombre).toBe(false);
      const d = r.diagnosticos.filter((x) => x.codigo === "fisico/campo-desconocido");
      expect(d, nombre).toHaveLength(1);
      expect(d[0]!.mensaje, nombre).toContain(`¿quería decir "${bueno}"?`);
      if (id) expect(d[0]!.ids, nombre).toEqual([id]);
    }
  });

  it("y en las opciones", () => {
    const r = compilar(base(), { tamanoMala: 0.5 } as never);
    expect(r.valido).toBe(false);
    expect(r.diagnosticos.map((d) => d.codigo)).toEqual(["opciones/campo-desconocido"]);
    expect(r.diagnosticos[0]!.mensaje).toBe('En las opciones (OpcionesCompilacion): "tamanoMala" no es un campo de OpcionesCompilacion; ¿quería decir "tamanoMalla"?.');
  });
});
