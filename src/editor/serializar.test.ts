/**
 * Criterio 1 de V2a (`docs/fem3d/visor.md` §6.3): abrir y guardar sin cambios los proyectos de
 * ejemplo da el mismo modelo y la misma huella, y guardar otra vez da los mismos bytes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { leerProyecto, type Proyecto } from "../agente/proyecto.ts";
import { huellaCompilacion } from "../compilador/compilar.ts";
import { resolverOpciones } from "../compilador/fisico.ts";
import { serializar } from "./serializar.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
export const EJEMPLOS = {
  ejemplo: ".claude/skills/fem/ejemplo.json",
  muestrario: "ejemplos/muestrario/proyecto.json",
  vivienda: "ejemplos/vivienda/proyecto.json",
  "1022": "validacion/a2/agente/1022/proyecto.json",
  nucleo: "validacion/a2/agente/nucleo/proyecto.json",
  edificio: "validacion/a2/agente/edificio/proyecto.json",
} as const;

export function leerEjemplo(nombre: keyof typeof EJEMPLOS): { texto: string; proyecto: Proyecto } {
  const texto = readFileSync(join(RAIZ, EJEMPLOS[nombre]), "utf8");
  const l = leerProyecto(texto);
  if (!l.valido) throw new Error(`${nombre}: ${l.diagnosticos.map((d) => d.mensaje).join(" ")}`);
  return { texto, proyecto: l.proyecto };
}

const huella = (p: Proyecto) => huellaCompilacion(p.modelo, resolverOpciones(p.opciones));

describe("formato canónico (criterio 1 de V2a)", () => {
  for (const nombre of Object.keys(EJEMPLOS) as (keyof typeof EJEMPLOS)[])
    it(`${nombre}: el mismo modelo, la misma huella y los mismos bytes al guardar otra vez`, () => {
      const { texto, proyecto } = leerEjemplo(nombre);
      const t1 = serializar(proyecto);
      const l1 = leerProyecto(t1);
      expect(l1.valido).toBe(true);
      if (!l1.valido) return;
      expect(l1.proyecto).toStrictEqual(JSON.parse(texto));
      expect(huella(l1.proyecto)).toBe(huella(proyecto));
      expect(serializar(l1.proyecto)).toBe(t1);
    });

  it("las claves van en el orden de los tipos y las listas de números, en una línea", () => {
    const { proyecto } = leerEjemplo("ejemplo");
    const t = serializar(proyecto);
    expect(t.indexOf('"esquema"')).toBeLessThan(t.indexOf('"modelo"'));
    expect(t).toMatch(/"puntos": \[\[-?[\d.]+, -?[\d.]+\], \[/);
    expect(t.endsWith("}\n")).toBe(true);
  });
});
