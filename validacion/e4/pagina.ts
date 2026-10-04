/**
 * Banco de E4 en el navegador: el cliente del motor con un Worker de verdad y el núcleo compilado
 * una vez. Lo sirve y lo empaqueta `validacion/e4/chrome.ts`.
 *
 * - **Automático** (Chrome headless): arranque en frío y en caliente, el edificio objetivo por el
 *   worker (huella de los resultados, tareas largas del hilo principal, memoria del núcleo y del
 *   proceso), cancelar en plena factorización, reciclaje por memoria y un límite de ecuaciones.
 * - **Manual** (`?manual`, para medir en un móvil o un portátil): tamaños crecientes con un worker
 *   nuevo cada vez, hasta donde aguante el dispositivo. Cada resultado se envía al servidor en
 *   cuanto sale, así que, si la pestaña se cae, queda el último que cupo.
 */
import type { ModeloAnalitico, ResultadoCalculo } from "../../src/motor/modelo.ts";
import { ClienteMotor, crearWorkerWeb, ErrorCancelado, type OpcionesCliente, type Progreso } from "../../src/worker/cliente.ts";
import { infoNavegador, LIMITES, perfilDispositivo } from "../../src/worker/limites.ts";
import { calidad, edificioObjetivo, huellaResultado, muestraResultado, nombreVariante, type Variante } from "./modelos.ts";

const parametros = new URLSearchParams(location.search);
const manual = parametros.has("manual");
const salida = document.getElementById("salida")!;
const MB = (b: number) => Math.round(b / 2 ** 20);
const ms = (t: number) => Math.round(t);
const espera = (t: number) => new Promise((ok) => setTimeout(ok, t));

/** Pinta `r` en la página y lo envía al servidor junto con `oculto` (datos que no se pintan). */
async function enviar(r: Record<string, unknown>, oculto: Record<string, unknown> = {}): Promise<void> {
  salida.textContent += JSON.stringify(r) + "\n";
  await fetch("/resultado", { method: "POST", body: JSON.stringify({ ...r, ...oculto }) });
}

/** Memoria de los procesos de Chrome, medida por el servidor (sólo en el modo automático). */
async function memoriaProceso(etiqueta: string): Promise<unknown> {
  const r = await fetch(`/memoria?etiqueta=${encodeURIComponent(etiqueta)}`);
  return r.json();
}

/** Tareas del hilo principal de más de 50 ms (H27: la frontera no debe bloquearlo). */
const largas: number[] = [];
try {
  new PerformanceObserver((l) => l.getEntries().forEach((e) => largas.push(Math.round(e.duration)))).observe({ type: "longtask" });
} catch {
  // Safari no tiene longtask
}

/** Lo que cuesta en el hilo principal enviar (serializar) cada mensaje al worker. */
const enviarMs: number[] = [];

function nuevoCliente(nucleo: WebAssembly.Module, opciones: Partial<OpcionesCliente> = {}): ClienteMotor {
  const web = crearWorkerWeb(() => {
    const w = new Worker("worker.js", { type: "module" });
    const enviar = w.postMessage.bind(w) as (m: unknown, t: Transferable[]) => void;
    w.postMessage = ((m: unknown, t: Transferable[]) => {
      const t0 = performance.now();
      enviar(m, t);
      enviarMs.push(+(performance.now() - t0).toFixed(1));
    }) as never;
    return w;
  });
  return new ClienteMotor({ crearWorker: web, nucleo, ...opciones });
}

/** ¿Puede un worker medir su heap JS? (`performance.memory` no es estándar) */
function memoriaEnWorker(): Promise<unknown> {
  const w = new Worker(URL.createObjectURL(new Blob(["postMessage(typeof performance.memory === \"object\" ? performance.memory.usedJSHeapSize : null)"], { type: "text/javascript" })));
  return new Promise((ok) => (w.onmessage = (e) => (w.terminate(), ok(e.data))));
}

interface Medida {
  r: ResultadoCalculo;
  totalMs: number;
  fases: Record<string, number>;
  memoria: Progreso["memoria"] | undefined;
  largas: number[];
  enviarMs: number[];
}

async function medir(cliente: ClienteMotor, modelo: ModeloAnalitico): Promise<Medida> {
  const fases: Record<string, number> = {};
  let memoria: Progreso["memoria"] | undefined;
  largas.length = 0;
  enviarMs.length = 0;
  const t0 = performance.now();
  const r = await cliente.calcular(modelo, {
    alProgreso: (p) => {
      fases[p.fase] = ms(p.ms);
      memoria = p.memoria;
    },
  });
  const totalMs = performance.now() - t0;
  await espera(60); // que el observador entregue las tareas largas del final
  return { r, totalMs, fases, memoria, largas: [...largas], enviarMs: [...enviarMs] };
}

function resumen(nombre: string, m: Medida, generarMs: number, clonarMs: number): Record<string, unknown> {
  const est = m.r.estadisticas;
  return {
    variante: nombre,
    valido: m.r.valido,
    errores: m.r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo),
    nudos: est?.nudos,
    ecuaciones: est?.ecuaciones,
    nnzL: est?.nnzL,
    generarMs: ms(generarMs),
    clonarModeloMs: ms(clonarMs),
    totalMs: ms(m.totalMs),
    calculoWorkerMs: ms(Object.entries(m.fases).filter(([f]) => !f.startsWith("solucion.")).reduce((s, [, v]) => s + v, 0)),
    fasesMs: m.fases,
    tareasLargasMs: m.largas,
    enviarModeloMs: m.enviarMs.at(-1),
    memoriaLinealMB: m.memoria && MB(m.memoria.lineal),
    memoriaEnUsoMB: m.memoria && MB(m.memoria.enUso),
    picoEstimadoMB: est?.memoriaNucleo && MB(est.memoriaNucleo.picoEstimado),
    ...calidad(m.r),
    huella: m.r.valido ? huellaResultado(m.r) : undefined,
  };
}

async function automatico(): Promise<void> {
  await enviar({ evento: "memoria", ...(await memoriaProceso("base")) as object });
  await enviar({ evento: "performance.memory en un worker", usedJSHeapSize: await memoriaEnWorker() });
  let t = performance.now();
  const nucleo = await WebAssembly.compileStreaming(fetch("nucleo_bg.wasm"));
  const compilarMs = performance.now() - t;
  const cliente = nuevoCliente(nucleo, { umbralReciclaje: 2 ** 32 });
  t = performance.now();
  await cliente.calentar();
  await enviar({ evento: "arranque", compilarNucleoMs: +compilarMs.toFixed(1), arranqueFrioMs: +(performance.now() - t).toFixed(1), memoria: cliente.estado.memoria });
  await enviar({ evento: "memoria", ...(await memoriaProceso("worker caliente")) as object });

  // Edificio objetivo por el worker, con diafragma y semirrígido; el de diafragma, dos veces
  const variantes: Variante[] = [
    { malla: 0.75, diafragma: true },
    { malla: 0.75, diafragma: true },
    { malla: 0.75, diafragma: false },
  ];
  for (const [k, v] of variantes.entries()) {
    t = performance.now();
    const modelo = edificioObjetivo(v);
    const generarMs = performance.now() - t;
    t = performance.now();
    structuredClone(modelo);
    const clonarMs = performance.now() - t;
    await espera(100); // generar y clonar en su propia tarea: las tareas largas de medir() son del cálculo
    const m = await medir(cliente, modelo);
    await enviar({ evento: "calculo", vuelta: k, ...resumen(nombreVariante(v), m, generarMs, clonarMs) });
    await enviar({ evento: "memoria", ...(await memoriaProceso(`tras ${nombreVariante(v)}`)) as object });
    if (k === 0) {
      await espera(10_000);
      await enviar({ evento: "memoria", ...(await memoriaProceso("10 s después, con el worker vivo")) as object });
    }
  }
  cliente.cerrar();
  await espera(2000);
  await enviar({ evento: "memoria", ...(await memoriaProceso("2 s tras terminar el worker")) as object });

  // Cancelar en plena factorización del semirrígido y volver a calentar
  const semirrigido = edificioObjetivo({ malla: 0.75, diafragma: false });
  const c2 = nuevoCliente(nucleo);
  await c2.calentar();
  let tCancelar = 0;
  let tRechazo = 0;
  const p = c2.calcular(semirrigido, {
    alProgreso: (pr) => {
      if (pr.fase === "solucion.analisis") {
        tCancelar = performance.now();
        c2.cancelar();
      }
    },
  });
  await p.catch((e: unknown) => {
    tRechazo = performance.now();
    if (!(e instanceof ErrorCancelado)) throw e;
  });
  await c2.calentar();
  const tListo = performance.now();
  const tras = await medir(c2, edificioObjetivo({ malla: 0.75, diafragma: true }));
  await enviar({
    evento: "cancelar",
    rechazoMs: +(tRechazo - tCancelar).toFixed(1),
    rearranqueMs: +(tListo - tCancelar).toFixed(1),
    siguienteValido: tras.r.valido,
    siguienteHuella: tras.r.valido ? huellaResultado(tras.r) : undefined,
    arranques: c2.estado.arranques,
  });
  c2.cerrar();

  // Reciclaje automático con el umbral del perfil móvil (tras cada cálculo)
  const c3 = nuevoCliente(nucleo, { umbralReciclaje: LIMITES.movil.umbralReciclaje });
  const m3 = await medir(c3, semirrigido);
  await espera(2000);
  await enviar({ evento: "reciclaje", valido: m3.r.valido, memoriaLinealMB: m3.memoria && MB(m3.memoria.lineal), reciclajes: c3.estado.reciclajes, arranques: c3.estado.arranques });
  await enviar({ evento: "memoria", ...(await memoriaProceso("2 s tras reciclar")) as object });

  // Reciclar tras cada cálculo (umbral 0): lo que cuesta perder el JIT caliente
  const c4 = nuevoCliente(nucleo, { umbralReciclaje: 0 });
  const diafragma = edificioObjetivo({ malla: 0.75, diafragma: true });
  const tiempos: number[] = [];
  const fases: Record<string, number>[] = [];
  for (let k = 0; k < 3; k++) {
    await espera(100);
    const m = await medir(c4, diafragma);
    tiempos.push(ms(m.totalMs));
    fases.push(m.fases);
  }
  await enviar({ evento: "reciclar siempre", variante: "diafragma-0.75-24c", totalMs: tiempos, fasesMs: fases, arranques: c4.estado.arranques });
  c4.cerrar();

  // Un límite de 100 000 ecuaciones: el semirrígido se rechaza antes de ensamblar
  t = performance.now();
  const r4 = await c3.calcular(semirrigido, { limites: { ecuaciones: 100_000 } });
  await enviar({ evento: "limite", ecuaciones: 100_000, valido: r4.valido, errores: r4.diagnosticos.map((d) => d.codigo), ms: ms(performance.now() - t) });
  c3.cerrar();
}

async function enDispositivo(): Promise<void> {
  const info = infoNavegador(navigator as never);
  await enviar({ evento: "dispositivo", ua: navigator.userAgent, ...info, perfil: perfilDispositivo(info), nucleos: navigator.hardwareConcurrency });
  let t = performance.now();
  const nucleo = await WebAssembly.compileStreaming(fetch("nucleo_bg.wasm"));
  const compilarMs = performance.now() - t;
  const cliente = nuevoCliente(nucleo, { umbralReciclaje: 0 }); // un worker nuevo para cada tamaño
  t = performance.now();
  await cliente.calentar();
  await enviar({ evento: "arranque", compilarNucleoMs: ms(compilarMs), arranqueFrioMs: ms(performance.now() - t) });
  const tamanos: Variante[] = [
    { malla: 1.5, diafragma: true, casos: 5 },
    { malla: 1.0, diafragma: true, casos: 5 },
    { malla: 0.75, diafragma: true, casos: 5 },
    { malla: 0.75, diafragma: true },
    { malla: 1.0, diafragma: false },
    { malla: 0.75, diafragma: false },
    { malla: 0.5, diafragma: true },
  ];
  for (const v of tamanos) {
    await enviar({ evento: "empieza", variante: nombreVariante(v) });
    t = performance.now();
    const modelo = edificioObjetivo(v);
    const generarMs = performance.now() - t;
    try {
      const m = await medir(cliente, modelo);
      // La muestra de valores deja comparar con Node otro motor de JS (JavaScriptCore en iOS)
      await enviar({ evento: "calculo", ...resumen(nombreVariante(v), m, generarMs, 0) }, { parametros: v, muestra: muestraResultado(modelo, m.r) });
    } catch (e) {
      await enviar({ evento: "fallo", variante: nombreVariante(v), error: String(e) });
      break;
    }
  }
  await enviar({ evento: "fin" });
}

if (manual) {
  const boton = document.getElementById("medir") as HTMLButtonElement;
  const empezar = () => {
    boton.disabled = true;
    enDispositivo().catch((e) => enviar({ evento: "fallo", error: String(e) }));
  };
  boton.hidden = false;
  boton.onclick = empezar;
  if (parametros.has("iniciar")) empezar();
} else {
  automatico()
    .catch((e) => enviar({ evento: "fallo", error: String(e), pila: (e as Error).stack }))
    .finally(() => enviar({ fin: true, ua: navigator.userAgent }));
}
