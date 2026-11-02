/** P-19 (UI-41): lo que dice cada versión de un proyecto del navegador. */
import { describe, expect, it } from "vitest";
import { contarVersion, textoCuenta } from "../armazon/Versiones.tsx";

const texto = (m: Record<string, unknown[]>) => JSON.stringify({ esquema: "concreta-fem/proyecto@1", modelo: m });

describe("versiones", () => {
  it("cuenta plantas, pilares, vigas, forjados (losas y paños), muros y cargas, y lo que cambió", () => {
    const a = contarVersion(texto({ plantas: [1, 2], pilares: [1, 2, 3], vigas: [1], losas: [1], panos: [1], cargas: [1] }))!;
    const b = contarVersion(texto({ plantas: [1, 2], pilares: [1, 2, 3], vigas: [1, 2, 3], losas: [1], panos: [1] }))!;
    expect(textoCuenta(b, a)).toEqual({ resumen: "2 plantas · 3 pilares · 3 vigas · 2 forjados", cambios: "+2 vigas, −1 carga" });
    expect(textoCuenta(a, null).cambios).toBe("");
    expect(contarVersion("no es json")).toBeNull();
    expect(textoCuenta(contarVersion(texto({}))!, null).resumen).toBe("vacío");
  });
});
