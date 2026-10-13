/**
 * El muestrario de la app (`ejemplos/muestrario/proyecto.json`): muro de sótano con empuje, núcleo
 * con huecos, pilares apeados sobre el muro, porche sobre un apoyo lineal, reticular con ábacos,
 * cubierta unidireccional y todos los casos con su acción. Es para mirarlo en la app, así que tiene
 * que seguir compilando sin avisos, calcular con equilibrio y dar las combinaciones CTE/NCSE.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { conjuntoCombinaciones, seleccionPorDefecto } from "./combinaciones.ts";
import { reacciones } from "./consultas.ts";
import { leerProyecto } from "./proyecto.ts";

const RAIZ = join(import.meta.dirname, "..", "..");

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("muestrario de la app", () => {
  it("compila sin avisos, calcula con equilibrio y da las combinaciones ELU-PT y ELU-SIS", () => {
    const l = leerProyecto(readFileSync(join(RAIZ, "ejemplos", "muestrario", "proyecto.json"), "utf8"));
    expect(l.diagnosticos).toEqual([]);
    if (!l.valido) return;
    const f = l.proyecto.modelo;
    for (const k of ["muros", "apoyosLineales", "panos"] as const) expect(f[k]?.length, k).toBeGreaterThan(0);
    expect(f.losas!.some((x) => x.reticular)).toBe(true);
    expect(f.cargas!.some((x) => x.tipo === "empuje")).toBe(true);

    const c = compilar(f, l.proyecto.opciones);
    expect(c.diagnosticos).toEqual([]);
    if (!c.valido) return;
    const casos = casosValidos(calcular(c.modelo));
    expect(casos.length).toBe(f.casos.length);
    const q = new Consultas(f, c, casos);

    const sel = seleccionPorDefecto(f.casos, "esfuerzos");
    expect(sel).toEqual({ tipo: "situaciones", situaciones: ["ELU-PT", "ELU-SIS"] });
    const r = conjuntoCombinaciones(q, sel);
    expect(r.valido).toBe(true);
    if (!r.valido) return;
    const n = (s: string) => r.valor.nombres.filter((x) => x.startsWith(`${s}-`)).length;
    expect(n("ELU-PT")).toBeGreaterThan(100);
    expect(n("ELU-SIS")).toBe(16);

    // El porche carga el apoyo lineal hacia abajo con el peso propio
    const porCaso = conjuntoCombinaciones(q, seleccionPorDefecto(f.casos, "lineal"));
    if (!porCaso.valido) throw new Error(porCaso.diagnosticos[0]!.mensaje);
    const ap = reacciones(q, porCaso.valor, { objeto: "AL1" });
    expect(ap.valido).toBe(true);
    if (!ap.valido) return;
    expect(ap.valor.objetos[0]!.R[0]![2]).toBeGreaterThan(100);
  }, 120_000);
});
