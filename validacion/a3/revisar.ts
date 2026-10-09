/**
 * Revisión de un modelo físico sin la CLI (A3): compila, calcula y pasa `revisar` con lo mismo que
 * `fem revisar`. Para la validación de A3 (mutaciones y referencias) y sus tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { revisar, type Revision } from "../../src/agente/revision.ts";
import { VERSION_ESQUEMA, type Proyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { traducirDiagnosticos } from "../../src/compilador/mapeo.ts";
import { calcular } from "../../src/motor/calcular.ts";
import type { Diagnostico } from "../../src/motor/diagnosticos.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";

export const WASM = join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm");

let listo = false;
export async function prepararNucleo(): Promise<void> {
  if (!listo) await iniciarNucleo(readFileSync(WASM));
  listo = true;
}

export const proyectoDe = (modelo: ModeloFisico, opciones?: OpcionesCompilacion, nombre?: string): Proyecto => ({ esquema: VERSION_ESQUEMA, ...(nombre ? { nombre } : {}), modelo, ...(opciones ? { opciones } : {}) });

/** La revisión de un proyecto, o los errores que la impiden (de la compilación o del cálculo). */
export function revisarProyecto(p: Proyecto): { valido: true; revision: Revision; huella: string; segundos: number } | { valido: false; errores: Diagnostico[] } {
  const t0 = performance.now();
  const c = compilar(p.modelo, p.opciones);
  if (!c.valido) return { valido: false, errores: c.diagnosticos.filter((d) => d.severidad === "error") };
  const r = calcular(c.modelo);
  if (!r.valido) return { valido: false, errores: r.diagnosticos.filter((d) => d.severidad === "error") };
  const q = new Consultas(p.modelo, c, r.casos, p.opciones);
  const revision = revisar(p, c, q, {
    motor: "validacion",
    diagnosticos: [...c.diagnosticos, ...traducirDiagnosticos(r.diagnosticos, c.modelo, c.mapeo)],
    equilibrio: r.casos.map((k) => ({ id: k.id, fuerzas: k.equilibrio.fuerzas, momentos: k.equilibrio.momentos })),
    ficheroFirmas: "proyecto.revision.json",
  });
  return { valido: true, revision, huella: c.huella, segundos: (performance.now() - t0) / 1000 };
}
