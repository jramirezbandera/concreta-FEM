/**
 * Fase CO4, criterio 14 (docs/fem3d/comprobaciones.md §7): la referencia congelada del punzonamiento de
 * cinco modelos, con el armado de losas y la armadura de punzonamiento que se proponen de las tablas.
 *
 *   bun validacion/co/congelarPunzonamiento.ts   escribe src/comprobaciones/__fixtures__/congelado-co4.json
 *
 * De cada unión de pilar y losa se guarda la posición, la cara, la armadura propuesta, si cumple, lo
 * pendiente, β, VEd, el perímetro eficaz y cada fila con su aprovechamiento y su estado. No la
 * combinación que manda: entre dos casi iguales cambia con el último bit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import type { ArmaduraPunzonamiento } from "../../src/comprobaciones/armado.ts";
import { armadoPropuestoLosas, comprobarLosas } from "../../src/comprobaciones/losas.ts";
import { comprobarPunzonamientos } from "../../src/comprobaciones/punzonamiento.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { losaPlana } from "./modelosLosas.ts";
import { losaBordes } from "./modelosPunzonamiento.ts";

const RAIZ = join(import.meta.dirname, "..", "..");

function vivienda(): { modelo: ModeloFisico; opciones?: OpcionesCompilacion } {
  const l = leerProyecto(readFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8"));
  if (!l.valido) throw new Error("la vivienda no se lee");
  return { modelo: l.proyecto.modelo, ...(l.proyecto.opciones ? { opciones: l.proyecto.opciones } : {}) };
}

/** Los modelos: una losa hasta la cara de los pilares (esquinas, bordes e interior), la misma con más luz (cercos), con un hueco, una losa plana con sismo, un reticular y la vivienda. */
export const MODELOS_CONGELADOS_CO4: Record<string, () => { modelo: ModeloFisico; opciones?: OpcionesCompilacion }> = {
  "losa-bordes": () => ({ modelo: losaBordes() }),
  "losa-bordes-7m": () => ({ modelo: losaBordes({ luz: 7, h: 0.3 }) }),
  "losa-bordes-hueco": () => ({ modelo: losaBordes({ hueco: 0 }) }),
  "losa-plana-sismo": () => ({ modelo: losaPlana({ sismo: true }) }),
  "reticular-bordes": () => ({ modelo: losaBordes({ luz: 6, reticular: true }) }),
  vivienda,
};

export interface ReferenciaCO4 {
  resumen: { uniones: number; cumplen: number; noCumplen: number; conArmadura: number; sinArmadoLosa: number; pendientes: number };
  pilares: {
    pilar: string;
    planta: string;
    losa: string;
    posicion: string | null;
    cara: string | null;
    armadura: ArmaduraPunzonamiento | null;
    perimetros: number | null;
    cumple: boolean;
    pendientes: string[];
    beta: number | null;
    VEd: number | null;
    u1: number | null;
    filas: { id: string; aprovechamiento: number | null; estado: string }[];
  }[];
}

export function referenciaCO4(m: { modelo: ModeloFisico; opciones?: OpcionesCompilacion }): ReferenciaCO4 {
  const c = compilar(m.modelo, m.opciones);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const q = new Consultas(m.modelo, c, r.casos, m.opciones ?? {}, r.modal);
  const l = comprobarLosas(q, undefined, undefined, { proponer: true });
  if (!l.valido) throw new Error(l.diagnosticos.map((d) => d.mensaje).join("\n"));
  const p = comprobarPunzonamientos(q, armadoPropuestoLosas(l.valor, undefined), undefined, undefined, { proponer: true, filas: true });
  if (!p.valido) throw new Error(p.diagnosticos.map((d) => d.mensaje).join("\n"));
  const { llamadas: _l, ...resumen } = p.valor.resumen;
  return {
    resumen,
    pilares: p.valor.pilares.map((x) => ({
      pilar: x.pilar,
      planta: x.planta,
      losa: x.losa,
      posicion: x.posicion ?? null,
      cara: x.cara ?? null,
      armadura: x.armadura ?? null,
      perimetros: x.perimetros ?? null,
      cumple: x.cumple,
      pendientes: x.pendientes.map((y) => y.motivo),
      beta: x.beta ?? null,
      VEd: x.VEd ?? null,
      u1: x.u1 ?? null,
      filas: (x.filas ?? []).map((f) => ({ id: f.id, aprovechamiento: f.aprovechamiento, estado: f.estado })),
    })),
  };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, ReferenciaCO4> = {};
  for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_CO4)) {
    salida[nombre] = referenciaCO4(f());
    console.log(nombre, JSON.stringify(salida[nombre]!.resumen));
  }
  writeFileSync(join(RAIZ, "src", "comprobaciones", "__fixtures__", "congelado-co4.json"), JSON.stringify(salida) + "\n");
}
