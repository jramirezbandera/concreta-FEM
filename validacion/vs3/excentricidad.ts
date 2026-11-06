/**
 * VS3, decisión VS-i (`docs/fem3d/viento-sismo.md` §8): la excentricidad accidental va como un
 * torsor estático (un par en cada planta, el de su fuerza equivalente por e = L/20), sumado al caso
 * de los modos. «VS3 mide cuánto se separa de mover el centro de masas»: aquí se mide.
 *
 * La alternativa: mover la masa de cada planta ±e (perpendicular al sismo) y rehacer los modos. Se
 * hace con dos masas de más en cada diafragma, +Δm en su nudo más alejado a un lado y −Δm en el del
 * otro, con Δm·(distancia entre ellos) = m·e: la masa de la planta no cambia y su centro se mueve e.
 *
 * Se compara, pilar a pilar y con el sismo según X y según Y, la envolvente de los dos cortantes de
 * la base de cada tramo (el de la dirección del sismo y el perpendicular, que sale de la torsión):
 * - con el torsor: |E| + |T| (los dos casos EX+e y EX−e, con su ±);
 * - moviendo la masa: el mayor de |E(+e)| y |E(−e)|.
 *
 * `bun validacion/vs3/excentricidad.ts` → validacion/vs3/out_excentricidad.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { casosModales, respuestaEspectral, Superposicion, type RespuestaEspectral } from "../../src/motor/espectral.ts";
import type { ModeloAnalitico, ResultadoModal } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { COEFICIENTE_RIESGO, COEFICIENTE_TERRENO, coeficienteModal, emplazamiento, factorAmortiguamiento } from "../../src/normas/ncse02.ts";
import { edificioObjetivo } from "../c1/banco.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { conSismo } from "../vs2/modelos-oraculo.ts";
import { ESPECTRO } from "./modelos-oraculo.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

function modalDe(m: ModeloAnalitico): ResultadoModal {
  const r = calcular(m);
  if (!r.valido || !r.modal) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  return r.modal;
}

const E = emplazamiento(ESPECTRO.ab, ESPECTRO.K, COEFICIENTE_RIESGO[ESPECTRO.importancia], COEFICIENTE_TERRENO[ESPECTRO.terreno]);

type Regla = "srss" | "cqc";

function respuesta(md: ResultadoModal, eje: 0 | 1, regla: Regla, excentricidades?: number[]): RespuestaEspectral {
  const beta = factorAmortiguamiento(ESPECTRO.omega) / ESPECTRO.mu[eje];
  return respuestaEspectral(md, { direccion: eje === 0 ? [1, 0] : [0, 1], aceleracion: (T) => coeficienteModal(T, E.TA, E.TB, beta) * E.ac * md.g, regla: { tipo: regla, zeta: ESPECTRO.omega / 100 }, ...(excentricidades ? { excentricidades } : {}) });
}

/** Los valores del caso espectral (con su signo) de una respuesta, y los de su torsor, en los esfuerzos de todas las barras. */
function esfuerzos(md: ResultadoModal, r: RespuestaEspectral): { modos: Float64Array; torsor: Float64Array | null } {
  const casos = casosModales(md).resultados;
  const n = casos[0]!.esfuerzosBarras.length;
  const sup = new Superposicion(casos.length, [{ id: "E", espectral: { modos: Int32Array.from(casos.keys()), coeficientes: r.coeficientes, regla: r.regla, dominante: r.dominante, lineal: null, ductilidad: 1 } }]);
  const modos = sup.vector([1], (k) => casos[k]!.esfuerzosBarras, n);
  let torsor: Float64Array | null = null;
  if (r.torsor) {
    torsor = new Float64Array(n);
    casos.forEach((c, i) => {
      const t = r.torsor![i]!;
      if (t) for (let q = 0; q < n; q++) torsor![q]! += t * c.esfuerzosBarras[q]!;
    });
  }
  return { modos, torsor };
}

const lineas = [
  "# VS3, VS-i: la excentricidad accidental como torsor estático, frente a mover el centro de masas",
  "",
  `Espectro de prueba: ab = ${ESPECTRO.ab} g, terreno ${ESPECTRO.terreno}, μ = ${ESPECTRO.mu.join(" y ")}. e = L/20. En la base de cada tramo de pilar, la envolvente de sus dos cortantes: con el torsor, |E| + |T|; moviendo la masa, el mayor de |E(+e)| y |E(−e)|. El cociente es torsor / masa movida, en los tramos con al menos el 5 % del mayor cortante del edificio. «En la dirección del sismo», el cortante mayor de cada tramo; «perpendicular», el otro, que sale de la torsión.`,
  "",
  "edificio | dirección | regla | e, m | T del modo dominante / del de giro, s | cortante en la base, kN (sin mover / +e / −e) | lo que añade la excentricidad al tramo más cargado, % (torsor / masa movida) | en la dirección del sismo, torsor / masa movida: mínimo / mediana / máximo (tramos) | perpendicular: mínimo / mediana / máximo (tramos); el mayor con la masa movida frente al mayor cortante",
];

for (const [nombre, f, dim] of [
  ["losas, 3 plantas de 3 × 2 vanos", edificioObjetivoLosas(3, 3, 2), [18, 10]],
  ["pórtico, 3 plantas de 3 × 2 vanos", edificioObjetivo(3, 3, 2), [18, 10]],
  ["pórtico objetivo, 7 plantas de 9 × 7 vanos", edificioObjetivo(7), [54, 35]],
] as [string, ModeloFisico, [number, number]][]) {
  const c = compilar(conSismo(f));
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  const md = modalDe(c.modelo);
  const pilares = c.mapeo.barras.map((m, b) => (m.tipo === "pilar" ? b : -1)).filter((b) => b >= 0);
  for (const eje of [0, 1] as const) for (const regla of ["srss", "cqc"] as const) {
    // La dimensión perpendicular al sismo
    const e = 0.05 * dim[1 - eje]!;
    const exc = md.diafragmas.map((df) => (df.masa > 0 ? e : 0));
    const base = respuesta(md, eje, regla, exc);
    if (!base.torsor) throw new Error("sin torsor");
    const conTorsor = esfuerzos(md, base);
    // La masa movida ±e: dos masas de más en cada diafragma, en sus nudos extremos en la perpendicular
    const movido = ([1, -1] as const).map((signo) => {
      const nodales: { nudo: number; m: number }[] = [];
      for (const df of md.diafragmas) {
        if (!(df.masa > 0)) continue;
        const r = c.modelo.restricciones![df.restriccion]!;
        const coord = (v: number) => (eje === 0 ? c.modelo.nudos[v]!.y : c.modelo.nudos[v]!.x);
        const otra = (v: number) => (eje === 0 ? c.modelo.nudos[v]!.x : c.modelo.nudos[v]!.y);
        // Los dos nudos del diafragma más alejados en la perpendicular, lo más cerca posible del centro de masas en la otra
        const cmOtra = df.cm[eje];
        const ordenados = [...r.esclavos].sort((a, b) => coord(a) - coord(b));
        const [min, max] = [coord(ordenados[0]!), coord(ordenados[ordenados.length - 1]!)];
        const cerca = (lado: number) => ordenados.filter((v) => Math.abs(coord(v) - lado) < 1e-6).sort((a, b) => Math.abs(otra(a) - cmOtra) - Math.abs(otra(b) - cmOtra))[0]!;
        const [a, b] = [cerca(max), cerca(min)];
        const dm = (signo * df.masa * e) / (max - min);
        nodales.push({ nudo: a, m: dm }, { nudo: b, m: -dm });
      }
      const mdM = modalDe({ ...c.modelo, modal: { ...c.modelo.modal, nodales } });
      // comprobación: el centro de masas se ha movido e (en la perpendicular) y la masa es la misma
      mdM.diafragmas.forEach((df, k) => {
        const d0 = md.diafragmas[k]!;
        if (!(d0.masa > 0)) return;
        const mov = df.cm[1 - eje]! - d0.cm[1 - eje]!;
        if (Math.abs(mov - signo * e) > 1e-9 || Math.abs(df.masa - d0.masa) > 1e-9 * d0.masa) throw new Error(`el centro de masas no se ha movido ${e}: ${mov}`);
      });
      const r = respuesta(mdM, eje, regla);
      return { md: mdM, r, e: esfuerzos(mdM, r).modos };
    });
    // En la base de cada tramo de pilar, sus dos cortantes (Vy y Vz, en sus ejes): el mayor sin excentricidad
    // es el de la dirección del sismo; el otro, el perpendicular, que sin excentricidad es casi nulo en un
    // edificio simétrico y sale sólo de la torsión
    const filas = pilares.map((b) => {
      const de = (cmp: number) => {
        const q = 12 * b + cmp;
        return { sin: Math.abs(conTorsor.modos[q]!), torsor: Math.abs(conTorsor.modos[q]!) + Math.abs(conTorsor.torsor![q]!), masa: Math.max(Math.abs(movido[0]!.e[q]!), Math.abs(movido[1]!.e[q]!)) };
      };
      const [vy, vz] = [de(1), de(2)];
      return vy.sin > vz.sin ? { principal: vy, otro: vz } : { principal: vz, otro: vy };
    });
    const mayor = Math.max(...filas.map((x) => x.principal.masa));
    const est = (xs: number[]) => {
      if (!xs.length) return "—";
      const s = [...xs].sort((p, q) => p - q);
      return `${s[0]!.toFixed(2)} / ${s[Math.floor(s.length / 2)]!.toFixed(2)} / ${s[s.length - 1]!.toFixed(2)} (${s.length})`;
    };
    const principal = filas.filter((x) => x.principal.masa >= 0.05 * mayor).map((x) => x.principal.torsor / x.principal.masa);
    // El perpendicular, donde pesa: al menos el 5 % del mayor cortante del edificio
    const perpendicular = filas.filter((x) => x.otro.masa >= 0.05 * mayor);
    const peor = filas.reduce((p, q) => (q.principal.masa > p.principal.masa ? q : p));
    const peorT = filas.reduce((p, q) => (q.principal.torsor > p.principal.torsor ? q : p));
    const T = (x: ResultadoModal, rr: RespuestaEspectral) => x.modos[rr.dominante]!.periodo.toFixed(3);
    // El modo de giro: el de más masa efectiva en el giro, sin mover la masa
    const giro = md.modos.reduce((p, q) => (q.masaEfectiva[2] > p.masaEfectiva[2] ? q : p)).periodo;
    lineas.push(
      `${nombre} | ${eje === 0 ? "X" : "Y"} | ${regla === "srss" ? "la del articulado" : "cuadrática completa"} | ${e.toFixed(2)} | ${T(md, base)} / ${giro.toFixed(3)} | ${base.basal.toFixed(0)} / ${movido[0]!.r.basal.toFixed(0)} / ${movido[1]!.r.basal.toFixed(0)} | ${(100 * (peorT.principal.torsor / peorT.principal.sin - 1)).toFixed(1)} / ${(100 * (peor.principal.masa / peor.principal.sin - 1)).toFixed(1)} | ${est(principal)} | ${perpendicular.length ? `${est(perpendicular.map((x) => x.otro.torsor / x.otro.masa))}; hasta ${Math.max(...perpendicular.map((x) => x.otro.masa)).toFixed(0)} kN frente a ${mayor.toFixed(0)}` : "no llega al 5 % del mayor en ningún tramo"}`,
    );
    console.log(lineas[lineas.length - 1]);
  }
}
writeFileSync(join(import.meta.dirname, "out_excentricidad.txt"), lineas.join("\n") + "\n");
