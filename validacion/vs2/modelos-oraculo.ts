/**
 * VS2, criterio 4 (`docs/fem3d/viento-sismo.md` §5): los modelos del oráculo externo de los modos,
 * OpenSeesPy `eigen` con `rigidDiaphragm` y la masa de cada diafragma en su centro de masas.
 *
 * Son modelos compilados (del modelo físico al analítico, con sus zonas rígidas, sus modificadores
 * y sus diafragmas), con el sismo en las acciones para que el motor dé las masas y los modos. El
 * oráculo recibe el modelo analítico y las masas de los diafragmas (m, centro de masas y J: lo que
 * valida son los modos, no el reparto de la masa, que tiene sus pruebas), monta el modelo con sus
 * elementos y calcula los periodos.
 *
 * - **Pórticos** (`portico-*`, sólo barras: el edificio objetivo de C1): las barras, sin áreas de
 *   cortante (Euler–Bernoulli), porque la `ElasticTimoshenkoBeam` de OpenSees 3.8 aplica mal
 *   `-jntOffset` (E2-1) y con `rigidLink` las zonas rígidas harían cadena con el diafragma, que su
 *   `Transformation` resuelve mal (E1-1). Así OpenSees monta el mismo modelo, con las restricciones
 *   por transformación, y los periodos tienen que coincidir a la precisión del solver.
 * - **Con losas y muros** (`losas-*`, `nucleo`): las huellas de los pilares y las caras de las vigas
 *   son enlaces rígidos encadenados con el diafragma. `eigen` de OpenSees no sirve con ellas (con
 *   multiplicadores de Lagrange K no es definida; con penalización, ARPACK no arma más vectores que
 *   GDL con masa, y el solver denso no cabe), así que OpenSees da la flexibilidad en los centros de
 *   masas con soluciones estáticas (con `Lagrange`, que resuelve bien las cadenas) y los valores
 *   propios salen de LAPACK. Sus láminas son ASDShellQ4, no la DKMQ24 del motor (a ≤ 0,5 % en E6):
 *   los periodos coinciden a lo que difieren los elementos.
 *
 * En todos, `empotramientoCabeza: 1`: el empotramiento parcial de CYPECAD (CY2) no tiene elemento
 * en OpenSees.
 *
 * `bun validacion/vs2/modelos-oraculo.ts [--grande]` escribe validacion/vs2/opensees-modelos.json
 * (no se versiona), que lee `oraculo_opensees.py`. La prueba `src/motor/oraculo-vs2.test.ts` monta
 * los mismos modelos con estas funciones y compara con lo que guardó el oráculo.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico, ResultadoModal } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivo } from "../c1/banco.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { reticulaConNucleo } from "../c3/modelos.ts";

/** Con el sismo en las acciones: G entero (el del peso propio), la mitad de Q y nada de los demás (no llevan acción). */
export const conSismo = (f: ModeloFisico): ModeloFisico => ({ ...f, acciones: { ...f.acciones, sismo: { masas: f.casos.filter((c) => !c.pesoPropio).map((c) => ({ caso: c.id, fraccion: c.id === "Q" ? 0.5 : 0 })) } } });

function compilado(f: ModeloFisico): ModeloAnalitico {
  const c = compilar(conSismo(f), { empotramientoCabeza: 1 });
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  return c.modelo;
}

/** El modelo con sus barras de Euler–Bernoulli (sin áreas de cortante). */
function sinCortante(m: ModeloAnalitico): ModeloAnalitico {
  return {
    ...m,
    barras: m.barras?.map((b) => {
      const { Avy: _y, Avz: _z, ...seccion } = b.seccion;
      return { ...b, seccion };
    }),
  };
}

export interface ModeloOraculo {
  modelo: () => ModeloAnalitico;
  /** Cómo van las restricciones en OpenSees. */
  handler: "Transformation" | "Lagrange";
  /** Diferencia relativa admitida en los periodos frente a OpenSees. */
  tolerancia: number;
  /** Se comprueba en la batería de pruebas (los grandes, sólo en el informe). */
  enPruebas: boolean;
}

export const MODELOS: Record<string, ModeloOraculo> = {
  "portico-3x3x2": { modelo: () => sinCortante(compilado(edificioObjetivo(3, 3, 2))), handler: "Transformation", tolerancia: 1e-8, enPruebas: true },
  "portico-7x9x7": { modelo: () => sinCortante(compilado(edificioObjetivo(7))), handler: "Transformation", tolerancia: 1e-8, enPruebas: true },
  "losas-3x3x2": { modelo: () => compilado(edificioObjetivoLosas(3, 3, 2)), handler: "Lagrange", tolerancia: 0.01, enPruebas: true },
  nucleo: { modelo: () => compilado(reticulaConNucleo()), handler: "Lagrange", tolerancia: 0.01, enPruebas: true },
};

/**
 * El edificio de losas con sus 7 plantas y 3 × 2 vanos: sólo con --grande (minutos en OpenSees). El
 * edificio objetivo entero con losas (86 796 nudos) tardaría horas con multiplicadores de Lagrange:
 * entero va el pórtico, que es exacto.
 */
export const GRANDES: Record<string, ModeloOraculo> = {
  "losas-7x3x2": { modelo: () => compilado(edificioObjetivoLosas(7, 3, 2)), handler: "Lagrange", tolerancia: 0.01, enPruebas: false },
};

export function modalDe(m: ModeloAnalitico): ResultadoModal {
  const r = calcular(m);
  if (!r.valido || !r.modal) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  return r.modal;
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, unknown> = {};
  const lista = { ...MODELOS, ...(process.argv.includes("--grande") ? GRANDES : {}) };
  for (const [nombre, x] of Object.entries(lista)) {
    const { casos: _c, modal: _m, ...modelo } = x.modelo();
    const md = modalDe(x.modelo());
    salida[nombre] = {
      handler: x.handler,
      tolerancia: x.tolerancia,
      modelo,
      diafragmas: md.diafragmas.map((d) => ({ restriccion: d.restriccion, m: d.masa, cm: d.cm, J: d.J, z: d.z })),
      periodos: md.modos.map((m) => m.periodo),
    };
    console.log(`${nombre}: ${modelo.nudos.length} nudos, ${modelo.barras?.length ?? 0} barras, ${modelo.laminas?.length ?? 0} láminas, ${md.modos.length} modos, T1 = ${md.modos[0]!.periodo.toFixed(4)} s`);
  }
  const ruta = join(import.meta.dirname, "opensees-modelos.json");
  writeFileSync(ruta, JSON.stringify(salida));
  console.log("escrito", ruta);
}
