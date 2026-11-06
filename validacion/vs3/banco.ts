/**
 * VS3 (`docs/fem3d/viento-sismo.md` §6): lo que cuesta el sismo del programa en los edificios
 * objetivo de 7 plantas. Las ecuaciones no cambian (los casos del sismo no son casos del cálculo: son
 * los modos, que VS2 ya resolvía); lo que cambia es que cada modo es ahora un caso base:
 *
 * - lo que ocupan los resultados (en memoria y en `.fem/`), con los cuatro vectores de cada modo;
 * - cuántos modos hacen falta de verdad: con el 90 % de la masa en cada dirección y todos los de
 *   periodo mayor que TA (art. 3.6.2.3.1), frente a todos, que es lo que se toma;
 * - lo que tardan las consultas con las combinaciones de la situación sísmica, que piden cada
 *   variable en todos los modos. El tiempo, sólo como información (CLAUDE.md, «Coste de una fase»):
 *   en caliente y con el mínimo de tres pasadas.
 *
 * `bun validacion/vs3/banco.ts --solo losas` (y `reticular`, y `unidireccional`) → out_banco_<edificio>.txt:
 * un edificio por proceso, porque los tres seguidos tardan más de diez minutos y cada uno ocupa varios
 * GB mientras se mide. `out_banco.txt`, el versionado, es la unión de los tres. Con --rapido, sólo el
 * edificio de losas de 3 plantas, para probar el propio banco.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conjuntoCombinaciones, type ConjuntoCombinaciones } from "../../src/agente/combinaciones.ts";
import { deriva, envolventes, franjas, reacciones } from "../../src/agente/consultas.ts";
import { envolventeCampo, ResultadosRender } from "../../src/agente/render/resultados.ts";
import { empaquetarResultados } from "../../src/agente/resultados.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import type { AccionCaso, ModeloFisico, SismoEdificio } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { edificioReticular, edificioUnidireccional } from "../c4/modelos.ts";

const MB = (b: number) => (b / 2 ** 20).toFixed(0);
const s3 = (ms: number) => (ms / 1000).toFixed(2);

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};
/** Un emplazamiento de prueba (no es el de ningún municipio): terreno III y ductilidad baja. */
const SISMO: SismoEdificio = { ab: 0.16, K: 1.0, terreno: "III", mu: 2, sistema: "porticos-ha" };
const con = (f: ModeloFisico, sismo: SismoEdificio | null): ModeloFisico => ({ ...f, casos: f.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })), ...(sismo ? { acciones: { sismo } } : {}) });

declare const Bun: { gc(completa: boolean): void };

/**
 * El menor de tres pasadas de `f`, ms, recogiendo la basura antes de cada una (cada pasada hace sus
 * `Consultas`, con todo lo que guardan: sin recogerla, el proceso llegó a 16 GB). Si la primera pasa
 * de 15 s, se queda en ésa.
 */
function minimo(f: () => unknown): number {
  let ms = Infinity;
  for (let i = 0; i < 3; i++) {
    Bun.gc(true);
    const t = performance.now();
    f();
    ms = Math.min(ms, performance.now() - t);
    if (ms > 15_000) break;
  }
  return ms;
}

const rapido = process.argv.includes("--rapido");
const lineas = [
  "# VS3: el coste del sismo del programa en los edificios objetivo de 7 plantas",
  "",
  "Los casos del sismo (EX+e, EX−e, EY+e, EY−e) no son casos del cálculo: las ecuaciones y los lados son los de VS2 (los casos y un lado por grado de libertad dinámico). Cada modo es un caso base, con sus cuatro vectores. El tiempo, sólo como información (mínimo de 3 pasadas, o una si pasa de 15 s; cada consulta, con unas `Consultas` nuevas, sin nada preparado).",
  "",
];
const tabla: string[] = [];
const modosTabla: string[] = [];
const tiempos: string[] = [];
// --solo losas,reticular: sólo esos edificios (los tres seguidos tardan más de diez minutos)
const solo = process.argv.includes("--solo") ? process.argv[process.argv.indexOf("--solo") + 1]!.split(",") : null;
const EDIFICIOS: [string, () => ModeloFisico][] = rapido
  ? [["losas, 3 plantas de 3 × 2 vanos", () => edificioObjetivoLosas(3, 3, 2)]]
  : [
      ["losas", () => edificioObjetivoLosas(7)],
      ["reticular", () => edificioReticular(7)],
      ["unidireccional", () => edificioUnidireccional(7)],
    ];
for (const [nombre, modelo] of EDIFICIOS) {
  if (solo && !solo.includes(nombre)) continue;
  const base = modelo();
  const f = con(base, SISMO);
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  const t0 = performance.now();
  const r = calcular(c.modelo);
  const tCalculo = performance.now() - t0;
  if (!r.valido || !r.modal) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  const md = r.modal;
  // Lo que ocupan los resultados
  const sinModos = empaquetarResultados(c.huella, { ...c.modelo, modal: undefined } as never, r.casos, r.estadisticas, []).bytes.byteLength;
  const conModos = empaquetarResultados(c.huella, c.modelo, r.casos, r.estadisticas, [], md).bytes.byteLength;
  const porCaso = sinModos / r.casos.length;
  const soloU = md.modos.length * 8 * (md.modos[0]!.u.length + 2 * 3 * md.diafragmas.length);
  tabla.push(
    `${nombre} | ${r.estadisticas.nudos} | ${r.estadisticas.ecuaciones} | ${r.casos.length} | ${md.modos.length} | ${MB(sinModos)} | ${MB(sinModos + soloU)} | ${MB(conModos)} | ${(porCaso / 2 ** 20).toFixed(1)} | ${s3(tCalculo)}`,
  );

  const q0 = new Consultas(f, c, r.casos, {}, md);
  const s = q0.sismo();
  if (!s.valido) throw new Error(s.diagnosticos.map((d) => d.mensaje).join("\n"));
  // Lo mismo con la combinación cuadrática completa (el modelo analítico y los resultados son los mismos)
  const cqc = new Consultas(con(base, { ...SISMO, regla: "cqc" }), c, r.casos, {}, md).sismo();
  if (!cqc.valido) throw new Error("sin la cqc");
  for (const d of s.valor.direcciones) {
    const dc = cqc.valor.direcciones[d.eje === "X" ? 0 : 1]!;
    const proximos = d.modos.reduce((t, m, i) => t + d.modos.slice(i + 1).filter((o) => Math.min(m.periodo, o.periodo) > 0.9 * Math.max(m.periodo, o.periodo)).length, 0);
    // Los modos que hacen falta: en orden de periodo, hasta el 90 % de la masa y todos los de T > TA
    const TA = s.valor.espectro.emplazamiento.TA;
    let [acumulada, n90] = [0, 0];
    d.modos.forEach((m, i) => {
      if (acumulada < 0.9) n90 = i + 1;
      acumulada += m.masaEfectiva;
    });
    const nTA = d.modos.filter((m) => m.periodo > TA).length;
    const necesarios = Math.max(n90, nTA, 4);
    const masa = d.modos.slice(0, necesarios).reduce((t, m) => t + m.masaEfectiva, 0);
    // El cortante en la base con sólo ésos (la regla, sobre los cortantes de los modos; sin los pares próximos, que aquí apenas pesan)
    const parcial = Math.hypot(...d.modos.slice(0, necesarios).map((m) => m.basal));
    const total = Math.hypot(...d.modos.map((m) => m.basal));
    const simp = d.simplificado.map((x) => `${x.origen === "modal" ? "T modal" : "T del art. 3.7.2.2"} = ${x.TF.toFixed(3)} s, ${x.modos} ${x.modos === 1 ? "modo" : "modos"}: ${x.basal.toFixed(0)} kN (el modal, ×${(d.basal / x.basal).toFixed(3)})`).join("; ");
    modosTabla.push(
      `${nombre} | ${d.eje} | ${d.dominante.periodo.toFixed(3)} | ${(100 * d.dominante.masaEfectiva).toFixed(1)} | ${d.basal.toFixed(0)} | ${d.coeficiente.toFixed(4)} | ${d.modos.length} | ${n90} | ${nTA} | ${necesarios} (${(100 * masa).toFixed(1)} % de la masa; cortante ×${(parcial / total).toFixed(4)}) | ${(1000 * d.desplazamientoMaximo).toFixed(1)} | ${d.thetaMaxima.toFixed(3)} | ${proximos} | ${dc.basal.toFixed(0)} (×${(dc.basal / d.basal).toFixed(3)}) | ${simp}`,
    );
  }

  // Las consultas: sin el sismo (ELU-PT) y con él (ELU-PT y ELU-SIS)
  const conjunto = (q: Consultas, situaciones: ("ELU-PT" | "ELU-SIS" | "ELS-C")[]): ConjuntoCombinaciones => {
    const x = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones });
    if (!x.valido) throw new Error(x.diagnosticos.map((d) => d.mensaje).join("\n"));
    return x.valor;
  };
  const planta = f.plantas[0]!.id;
  // El mismo edificio sin el sismo en las acciones: las consultas de antes
  const fSin = con(base, null);
  const cSin = compilar(fSin);
  if (!cSin.valido) throw new Error("el edificio sin sismo no compila");
  const rSin = calcular(cSin.modelo);
  if (!rSin.valido) throw new Error("el edificio sin sismo no se calcula");
  const medir = (que: string, consulta: (q: Consultas, cj: ConjuntoCombinaciones) => unknown, sinSismo: ("ELU-PT" | "ELS-C")[], conSismo: ("ELU-PT" | "ELU-SIS" | "ELS-C")[]) => {
    const nuevas = () => new Consultas(f, c, r.casos, {}, md);
    const z = minimo(() => {
      const q = new Consultas(fSin, cSin, rSin.casos, {});
      consulta(q, conjunto(q, sinSismo));
    });
    const a = minimo(() => {
      const q = nuevas();
      consulta(q, conjunto(q, sinSismo));
    });
    const b = minimo(() => {
      const q = nuevas();
      consulta(q, conjunto(q, conSismo));
    });
    tiempos.push(`${nombre} | ${que} | ${conjunto(q0, sinSismo).factores.length} | ${s3(z)} | ${s3(a)} | ${conjunto(q0, conSismo).factores.length} | ${s3(b)} | ×${(b / z).toFixed(1)}`);
    console.log(tiempos[tiempos.length - 1]);
  };
  medir("envolventes de todas las piezas", (q, cj) => envolventes(q, cj), ["ELU-PT"], ["ELU-PT", "ELU-SIS"]);
  medir(`envolventes de los pilares de ${planta}`, (q, cj) => envolventes(q, cj, { planta, tipo: "pilar" }), ["ELU-PT"], ["ELU-PT", "ELU-SIS"]);
  medir("reacciones (todas)", (q, cj) => reacciones(q, cj, { todos: true }), ["ELU-PT"], ["ELU-PT", "ELU-SIS"]);
  medir("deriva (todas las plantas)", (q, cj) => deriva(q, cj), ["ELS-C"], ["ELS-C", "ELU-SIS"]);
  if (f.losas?.length) {
    medir(`franjas de armado de ${planta}`, (q, cj) => franjas(q, cj, { planta }), ["ELU-PT"], ["ELU-PT", "ELU-SIS"]);
    medir(`mapa de M11 de ${planta} (envolvente máxima)`, (q, cj) => envolventeCampo(new ResultadosRender(q, q.compilado === c.modelo ? c : cSin), planta, "m11", cj, "max"), ["ELU-PT"], ["ELU-PT", "ELU-SIS"]);
  }
  console.log(nombre, "hecho");
}

lineas.push(
  "## Lo que ocupan los resultados",
  "",
  "edificio | nudos | ecuaciones | casos | modos | resultados sin modos, MiB | con los modos de VS2 (sólo la forma), MiB | con los modos como casos (VS3), MiB | por caso o por modo, MiB | cálculo, s",
  ...tabla,
  "",
  "## Los modos que hacen falta",
  "",
  "«Hasta el 90 %»: los primeros modos, por periodo, hasta el 90 % de la masa de la dirección (C.3.6.2.3.1). «T > TA»: los de periodo mayor que TA (art. 3.6.2.3.1). Se toman todos.",
  "",
  "edificio | dirección | T dominante, s | su masa, % | cortante en la base, kN | entre el peso | modos | hasta el 90 % | con T > TA | los que pide la norma | desplazamiento máximo, mm (por μ) | θ máxima | pares de modos a menos del 10 % | cortante con la cuadrática completa, kN (frente a la del articulado) | método simplificado",
  ...modosTabla,
  "",
  "## Las consultas, sin y con la situación sísmica",
  "",
  "«Sin el sismo»: el mismo edificio sin `acciones.sismo` (las consultas de antes). «Con el sismo, sin sus combinaciones»: con los modos como casos base, pero con las mismas combinaciones (lo que cuestan los modos donde se trabaja caso a caso: las franjas). «Con la situación sísmica»: además, con sus combinaciones.",
  "",
  "edificio | consulta | combinaciones | sin el sismo, s | con el sismo, sin sus combinaciones, s | combinaciones con la sísmica | s | veces (frente a sin el sismo)",
  ...tiempos,
  "",
);
const ruta = join(import.meta.dirname, rapido ? "out_banco_rapido.txt" : solo ? `out_banco_${solo.join("_")}.txt` : "out_banco.txt");
writeFileSync(ruta, lineas.join("\n"));
console.log("escrito", ruta);
