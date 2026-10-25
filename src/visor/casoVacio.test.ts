/**
 * Un caso sin cargas (`sensatez/caso-vacio`) sólo se avisa en la app con resultados: mientras se
 * modela, un caso recién creado aún no tiene sus cargas. `sensatezPrevia` (`fem validar`) lo sigue
 * dando siempre.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "../compilador/huella.ts";
import { sensatezPrevia } from "../agente/sensatez.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Sesion } from "./sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
const MOTOR = sha256(new Uint8Array(WASM));

beforeAll(async () => {
  await iniciarNucleo(WASM);
});

describe("caso vacío en la app", () => {
  const proyecto = JSON.parse(readFileSync(join(RAIZ, ".claude/skills/fem/ejemplo.json"), "utf8"));
  proyecto.modelo.casos.push({ id: "VACIO" });
  const texto = JSON.stringify(proyecto);
  const vacio = (ds: readonly { codigo: string }[]) => ds.filter((d) => d.codigo === "sensatez/caso-vacio").length;

  it("no sale sin calcular, sí con resultados; fem validar lo da siempre", async () => {
    expect(vacio(sensatezPrevia(proyecto.modelo, proyecto.opciones).flatMap((x) => x.avisos))).toBe(1);

    const a = Sesion.abrir(texto, MOTOR, { diferir: true });
    if (!a.valido) throw new Error(JSON.stringify(a.diagnosticos));
    const s = a.sesion;
    expect(vacio(s.estado({ sinCompilar: true }).diagnosticos)).toBe(0);
    expect(vacio(s.estado().diagnosticos)).toBe(0);

    const r = await s.calcular();
    expect(r.ok).toBe(true);
    expect(s.calculado).toBe(true);
    expect(vacio(s.estado().diagnosticos)).toBe(1);
  });
});
