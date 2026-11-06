/**
 * El peso propio calculado de la Revisión en otro hilo (`PesoAparte`, el worker anidado de la app):
 * se lanza con la provisional, la final lo espera y sale con los mismos bytes que compilándolo aquí
 * (el informe de `fem revisar`). Aquí «otro hilo» es una promesa en el mismo, con la misma función.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { pesoPropioCalculado } from "../agente/sensatez.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../compilador/fisico.ts";
import { sha256 } from "../compilador/huella.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Atendedor, type PesoAparte } from "./atender.ts";
import type { DatosRevision } from "./datos.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const WASM = new Uint8Array(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const MOTOR = sha256(WASM);
const TEXTO = readFileSync(join(RAIZ, "validacion/a2/agente/nucleo/proyecto.json"), "utf8");

beforeAll(async () => {
  await iniciarNucleo(WASM);
});

async function revision(o: { pesoAparte?: PesoAparte } = {}): Promise<{ provisional: DatosRevision; final: DatosRevision }> {
  const at = new Atendedor(MOTOR, o);
  expect((await at.atender({ tipo: "abrir", texto: TEXTO })).ok).toBe(true);
  expect((await at.atender({ tipo: "calcular" })).ok).toBe(true);
  const p = await at.atender({ tipo: "revision", provisional: true });
  const f = await at.atender({ tipo: "revision" });
  if (!p.ok || !f.ok) throw new Error("la revisión falla");
  return { provisional: p.valor as DatosRevision, final: f.valor as DatosRevision };
}

describe("el peso propio calculado de la Revisión, en otro hilo", () => {
  it("se lanza una vez con la provisional y la final es la de compilarlo aquí, byte a byte", async () => {
    const aqui = await revision();
    const llamadas: { modelo: ModeloFisico; opciones: OpcionesCompilacion | undefined }[] = [];
    const aparte = await revision({
      pesoAparte: (modelo, opciones) => {
        llamadas.push({ modelo, opciones });
        return Promise.resolve().then(() => pesoPropioCalculado(modelo, opciones));
      },
    });
    expect(llamadas).toHaveLength(1);
    expect(aparte.provisional.pendiente).toBe(true);
    expect(aparte.provisional.sha256).toBe(aqui.provisional.sha256);
    expect(aparte.final.pendiente).toBeUndefined();
    expect(aparte.final.sha256).toBe(aqui.final.sha256);
  }, 120_000);

  it("la final usa lo de fuera, y si falla lo compila aquí", async () => {
    const aqui = await revision();
    // Otro peso (el doble): el informe cambia, así que la final no lo compila aquí
    const otro = await revision({ pesoAparte: (m, o) => Promise.resolve(new Map([...pesoPropioCalculado(m, o)!].map(([k, v]) => [k, 2 * v]))) });
    expect(otro.final.sha256).not.toBe(aqui.final.sha256);
    expect(otro.final.comprobaciones.find((c) => c.codigo === "sensatez/peso-propio")!.estado).toBe("avisos");
    const falla = await revision({ pesoAparte: () => Promise.reject(new Error("sin worker")) });
    expect(falla.final.sha256).toBe(aqui.final.sha256);
  }, 120_000);
});
