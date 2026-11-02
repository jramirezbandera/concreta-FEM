/**
 * R-25: el atendedor del worker pasa las fases del cálculo según terminan (las de `alProgreso` del
 * motor), y el resultado es el mismo que sin ellas (los mismos bytes).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "../compilador/huella.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Atendedor } from "./atender.ts";
import type { EstadoSesion } from "./sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const WASM = new Uint8Array(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const MOTOR = sha256(WASM);
const TEXTO = readFileSync(join(RAIZ, ".claude/skills/fem/ejemplo.json"), "utf8");

beforeAll(async () => {
  await iniciarNucleo(WASM);
});

describe("R-25 · progreso del cálculo", () => {
  it("las fases llegan en el orden del motor y el cálculo da los mismos resultados que sin ellas", async () => {
    const calcular = async (alProgreso?: (fase: string, ms: number) => void) => {
      const at = new Atendedor(MOTOR);
      expect((await at.atender({ tipo: "abrir", texto: TEXTO })).ok).toBe(true);
      const r = await at.atender({ tipo: "calcular" }, alProgreso);
      if (!r.ok) throw new Error(JSON.stringify(r.diagnosticos));
      return (r.valor as EstadoSesion).sha256Resultados;
    };
    const fases: string[] = [];
    const con = await calcular((f, ms) => {
      expect(ms).toBeGreaterThanOrEqual(0);
      fases.push(f);
    });
    expect(fases.slice(0, 4)).toEqual(["numeracion", "cargas", "patron", "ensamblado"]);
    expect(fases).toContain("solucion.factorizacion");
    expect(fases.indexOf("solucion")).toBeGreaterThan(fases.indexOf("solucion.factorizacion"));
    expect(fases.at(-1)).toBe("recuperacion");
    expect(con).toBe(await calcular());
  }, 60_000);
});
