/**
 * A-2 (`docs/fem3d/fase-a0-a2.md`): ψ por su nombre ("uso-A", "viento"…), para que quien modela no
 * escriba los números de la tabla 4.2 del DB SE de memoria. Un nombre da las mismas combinaciones que
 * sus valores, y uno que no existe es un error con el id del caso.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { conAcciones } from "../../validacion/c5/modelos.ts";
import { PSI_NOMBRES, PSI_TEMPERATURA, PSI_VIENTO, psiDe, psiNieve, psiUso } from "../combinaciones/psi.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const conPsi = (f: ModeloFisico, psi: Record<string, unknown>): ModeloFisico => ({ ...f, casos: f.casos.map((c) => (psi[c.id] !== undefined ? { ...c, accion: { ...c.accion!, psi: psi[c.id] as never } } : c)) });

function combinaciones(f: ModeloFisico) {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("; "));
  const r = new Consultas(f, c, casosValidos(calcular(c.modelo))).combinaciones();
  if (!r.valido) throw new Error(r.diagnosticos[0]!.mensaje);
  return r.valor.map((x) => ({ id: x.id, factores: [...x.factores] }));
}

describe("A-2: ψ por su nombre", () => {
  it("cada nombre es su fila de la tabla", () => {
    expect(psiDe("uso-A")).toEqual(psiUso("A"));
    expect(psiDe("uso-C")).toEqual(psiUso("C"));
    expect(psiDe("uso-G")).toEqual(psiUso("G"));
    expect(psiDe("nieve-hasta-1000")).toEqual(psiNieve(false));
    expect(psiDe("nieve-mas-de-1000")).toEqual(psiNieve(true));
    expect(psiDe("viento")).toEqual(PSI_VIENTO);
    expect(psiDe("temperatura")).toEqual(PSI_TEMPERATURA);
    expect(PSI_NOMBRES).toHaveLength(10);
  });

  it("da las mismas combinaciones que sus valores", () => {
    const f = conAcciones(edificioObjetivoLosas(2, 2, 2)); // Q con ψ de uso A y viento con los suyos, en números
    expect(combinaciones(conPsi(f, { Q: "uso-A", Vx: "viento", Vy: "viento" }))).toEqual(combinaciones(f));
  });

  it("un nombre que no existe es un error con el id del caso", () => {
    const r = compilar(conPsi(conAcciones(edificioObjetivoLosas(2, 2, 2)), { Q: "uso-Z" }));
    expect(r.valido).toBe(false);
    const d = r.diagnosticos.find((x) => x.ids?.includes("Q"))!;
    expect(d.mensaje).toContain("«uso-Z» no es ninguno de los nombres admitidos");
  });
});
