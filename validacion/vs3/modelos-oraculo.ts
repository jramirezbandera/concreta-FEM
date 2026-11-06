/**
 * VS3, criterio 3 (`docs/fem3d/viento-sismo.md` §5): los modelos del oráculo externo del análisis por
 * espectros de respuesta, OpenSeesPy `responseSpectrumAnalysis`.
 *
 * Son los pórticos compilados de VS2 (`validacion/vs2/modelos-oraculo.ts`: el edificio objetivo de C1,
 * sólo barras de Euler–Bernoulli, con sus zonas rígidas, sus modificadores y sus diafragmas), que
 * OpenSees monta igual, con las restricciones por transformación y `eigen`. El oráculo recibe el
 * modelo analítico, las masas de los diafragmas, los datos del espectro de la NCSE-02 (que programa
 * aparte, del texto de la norma) y las variables que se comparan: los desplazamientos de unos nudos,
 * los esfuerzos de extremo de unas barras y la suma de las reacciones. De cada modo y cada dirección
 * da su respuesta (`responseSpectrumAnalysis … -mode i`), y con ellas, las combinaciones.
 *
 * `bun validacion/vs3/modelos-oraculo.ts` escribe validacion/vs3/opensees-modelos.json (no se
 * versiona), que lee `oraculo_opensees.py`. La prueba `src/motor/oraculo-vs3.test.ts` monta los mismos
 * modelos con estas funciones y compara con lo que guardó el oráculo.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { respuestaEspectral, type OpcionesRegla, type RespuestaEspectral } from "../../src/motor/espectral.ts";
import type { ModeloAnalitico, ResultadoModal } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { COEFICIENTE_RIESGO, COEFICIENTE_TERRENO, coeficienteModal, emplazamiento, factorAmortiguamiento } from "../../src/normas/ncse02.ts";
import { modalDe, MODELOS } from "../vs2/modelos-oraculo.ts";

/** El espectro de la prueba: Granada-like en terreno III, con otra ductilidad en cada dirección. */
export const ESPECTRO = { ab: 0.16, K: 1.0, importancia: "normal", terreno: "III", mu: [2, 3], omega: 5 } as const;

/** Los modelos del oráculo: los dos pórticos de VS2. */
export const MODELOS_VS3 = ["portico-3x3x2", "portico-7x9x7"] as const;

/** Los nudos y las barras cuyas variables se comparan: repartidos por el modelo. */
export function variables(m: ModeloAnalitico): { nudos: number[]; barras: number[]; apoyos: number[] } {
  const repartidos = (n: number, cuantos: number) => [...new Set(Array.from({ length: cuantos }, (_, i) => Math.floor(((i + 0.5) * n) / cuantos)))];
  return { nudos: repartidos(m.nudos.length, 10), barras: repartidos(m.barras!.length, 16), apoyos: (m.apoyos ?? []).filter((a) => a.coartados[0] || a.coartados[1]).map((a) => a.nudo) };
}

/** La respuesta espectral del motor en X (0) o en Y (1) con el espectro de la prueba y una regla. */
export function respuestaMotor(md: ResultadoModal, eje: 0 | 1, regla: OpcionesRegla): RespuestaEspectral {
  const e = emplazamiento(ESPECTRO.ab, ESPECTRO.K, COEFICIENTE_RIESGO[ESPECTRO.importancia], COEFICIENTE_TERRENO[ESPECTRO.terreno]);
  const beta = factorAmortiguamiento(ESPECTRO.omega) / ESPECTRO.mu[eje];
  return respuestaEspectral(md, { direccion: eje === 0 ? [1, 0] : [0, 1], aceleracion: (T) => coeficienteModal(T, e.TA, e.TB, beta) * e.ac * md.g, regla });
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, unknown> = {};
  for (const nombre of MODELOS_VS3) {
    const completo = MODELOS[nombre]!.modelo();
    const { casos: _c, modal: _m, ...modelo } = completo;
    const md = modalDe(completo);
    salida[nombre] = {
      handler: MODELOS[nombre]!.handler,
      modelo,
      diafragmas: md.diafragmas.map((d) => ({ restriccion: d.restriccion, m: d.masa, cm: d.cm, J: d.J, z: d.z })),
      g: md.g,
      espectro: { ...ESPECTRO, C: COEFICIENTE_TERRENO[ESPECTRO.terreno], rho: COEFICIENTE_RIESGO[ESPECTRO.importancia] },
      variables: variables(completo),
      // Para el informe del oráculo: los periodos y el cortante en la base del motor, por dirección
      periodos: md.modos.map((m) => m.periodo),
      basal: ([0, 1] as const).map((eje) => respuestaMotor(md, eje, {}).basal),
    };
    console.log(`${nombre}: ${modelo.nudos.length} nudos, ${modelo.barras?.length ?? 0} barras, ${md.modos.length} modos, T1 = ${md.modos[0]!.periodo.toFixed(4)} s`);
  }
  const ruta = join(import.meta.dirname, "opensees-modelos.json");
  writeFileSync(ruta, JSON.stringify(salida));
  console.log("escrito", ruta);
}
