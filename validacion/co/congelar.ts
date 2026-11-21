/**
 * Fase CO1, criterio 14 (docs/fem3d/comprobaciones.md §7): la referencia congelada de las
 * comprobaciones de los pilares de tres modelos, con el armado que se propone de la tabla.
 *
 *   bun validacion/co/congelar.ts     escribe src/comprobaciones/__fixtures__/congelado-co1.json
 *
 * De cada tramo se guarda el armado propuesto, si cumple, lo pendiente y cada fila con su
 * aprovechamiento y su estado. No la combinación que manda: entre dos casi iguales (pilares
 * simétricos) cambia con el último bit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { comprobarPilares } from "../../src/comprobaciones/pilares.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioSO } from "../so/modelos.ts";

const RAIZ = join(import.meta.dirname, "..", "..");

function vivienda(): { modelo: ModeloFisico; opciones?: OpcionesCompilacion } {
  const l = leerProyecto(readFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8"));
  if (!l.valido) throw new Error("la vivienda no se lee");
  return { modelo: l.proyecto.modelo, ...(l.proyecto.opciones ? { opciones: l.proyecto.opciones } : {}) };
}

/** Los tres modelos: barras con viento, barras con mucha carga y sismo, y la vivienda (reticular). */
export const MODELOS_CONGELADOS_CO1: Record<string, () => { modelo: ModeloFisico; opciones?: OpcionesCompilacion }> = {
  "edificio-viento": () => ({ modelo: edificioSO() }),
  "edificio-cargado-sismo": () => ({ modelo: edificioSO({ G: 600, Q: 300, sismo: true }) }),
  vivienda,
};

export interface ReferenciaCO1 {
  resumen: { pilares: number; tramos: number; cumplen: number; noCumplen: number; sinArmado: number };
  tramos: { pilar: string; planta: string; texto: string | null; ajuste?: "continuidad" | "agrupado"; cumple: boolean; pendientes: string[]; filas: { id: string; aprovechamiento: number | null; estado: string }[] }[];
}

export function referenciaCO1(m: { modelo: ModeloFisico; opciones?: OpcionesCompilacion }): ReferenciaCO1 {
  const c = compilar(m.modelo, m.opciones);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const q = new Consultas(m.modelo, c, r.casos, m.opciones ?? {}, r.modal);
  const p = comprobarPilares(q, undefined, undefined, { proponer: true, filas: true });
  if (!p.valido) throw new Error(p.diagnosticos.map((d) => d.mensaje).join("\n"));
  const { llamadas: _l, ...resumen } = p.valor.resumen;
  return {
    resumen,
    tramos: p.valor.pilares.flatMap((x) =>
      x.tramos.map((t) => ({
        pilar: x.pilar,
        planta: t.planta,
        texto: t.texto ?? null,
        ...(t.ajuste ? { ajuste: t.ajuste } : {}),
        cumple: t.cumple,
        pendientes: t.pendientes.map((y) => y.motivo),
        filas: (t.filas ?? []).map((f) => ({ id: f.id, aprovechamiento: f.aprovechamiento, estado: f.estado })),
      })),
    ),
  };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, ReferenciaCO1> = {};
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_CO1)) {
    salida[nombre] = referenciaCO1(f());
    const s = salida[nombre]!;
    const textos = new Map<string, number>();
    for (const t of s.tramos) textos.set(t.texto ?? "sin propuesta", (textos.get(t.texto ?? "sin propuesta") ?? 0) + 1);
    console.log(nombre, JSON.stringify(s.resumen), Object.fromEntries(textos));
  }
  writeFileSync(join(RAIZ, "src", "comprobaciones", "__fixtures__", "congelado-co1.json"), JSON.stringify(salida) + "\n");
}
