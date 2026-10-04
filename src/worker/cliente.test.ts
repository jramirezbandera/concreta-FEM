/**
 * E4: el worker del motor y su cliente, con workers de verdad (`worker_threads`) y el núcleo
 * compilado una vez. Mismo resultado que `calcular()` bit a bit, resultados transferidos, avance,
 * cola, cancelación, reciclaje por memoria y por fallo, agotamiento de memoria del núcleo,
 * límites del dispositivo y reposo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EDIFICIOS_CONGELADOS } from "../../validacion/e1/congelar.ts";
import { EDIFICIOS_CONGELADOS_E2 } from "../../validacion/e2/congelar.ts";
import { MODELOS_CONGELADOS_E3 } from "../../validacion/e3/congelar.ts";
import { calcular } from "../motor/calcular.ts";
import type { ModeloAnalitico, ResultadoCalculo } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Constructor, seccionRectangular } from "../pruebas/constructor.ts";
import { edificio } from "../pruebas/edificio.ts";
import { crearWorkerNodo, type PuertoNodo } from "../pruebas/workerNodo.ts";
import { crearAtendedor } from "./atender.ts";
import { ClienteMotor, ErrorCancelado, ErrorWorker, type OpcionesCliente, type Progreso } from "./cliente.ts";
import { LIMITES } from "./limites.ts";
import { transferibles, type MensajeDelWorker } from "./protocolo.ts";

const bytes = readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm"));
let nucleo: WebAssembly.Module;

beforeAll(async () => {
  nucleo = await WebAssembly.compile(bytes);
  await iniciarNucleo(nucleo);
});

const clientes: ClienteMotor[] = [];
afterEach(() => {
  for (const c of clientes.splice(0)) c.cerrar();
});

function nuevoCliente(opciones: Partial<OpcionesCliente> = {}, creados: PuertoNodo[] = []): ClienteMotor {
  const c = new ClienteMotor({ crearWorker: crearWorkerNodo(creados), nucleo, ...opciones });
  clientes.push(c);
  return c;
}

const pequeno = () => edificio(EDIFICIOS_CONGELADOS_E2["e2-diafragma"]!).modelo;

/** Un modelo que tarda lo bastante (≈ 0,5–1 s) para cancelarlo a medias. */
const mediano = () =>
  edificio({ vanosX: 5, vanosY: 4, luzX: 6, luzY: 6, plantas: 4, altura: 3, malla: 0.75, huella: 0.75, vigas: true, muro: true, diafragma: false, barrasE2: true, laminasE3: true }).modelo;

/** Espera (hasta 5 s) a que se cumpla la condición. */
async function hasta(condicion: () => boolean): Promise<void> {
  const t0 = performance.now();
  while (!condicion()) {
    if (performance.now() - t0 > 5000) throw new Error("tiempo agotado");
    await new Promise((ok) => setTimeout(ok, 5));
  }
}

/** Igualdad bit a bit de dos resultados, salvo los tiempos y el pico de memoria (dependen de cada hilo). */
function mismoResultado(a: ResultadoCalculo, b: ResultadoCalculo): void {
  expect(a.valido).toBe(b.valido);
  expect(a.diagnosticos).toEqual(b.diagnosticos);
  const sinTiempos = (r: ResultadoCalculo) =>
    r.estadisticas && { ...r.estadisticas, tiempos: undefined, memoriaNucleo: r.estadisticas.memoriaNucleo?.requerida };
  expect(sinTiempos(a)).toEqual(sinTiempos(b));
  const casos = (r: ResultadoCalculo) => (r.valido ? r.casos : (r.casosNoValidos ?? []));
  const [ca, cb] = [casos(a), casos(b)];
  expect(ca.length).toBe(cb.length);
  ca.forEach((c, k) => {
    const d = cb[k]!;
    expect(c.id).toBe(d.id);
    expect(c.equilibrio).toEqual(d.equilibrio);
    expect(c.residuo).toBe(d.residuo);
    for (const campo of ["u", "reacciones", "esfuerzosBarras", "esfuerzosLaminas"] as const) {
      expect(Buffer.from(c[campo].buffer).equals(Buffer.from(d[campo].buffer)), `${c.id} ${campo}`).toBe(true);
    }
  });
}

describe("mismo resultado que calcular()", () => {
  const modelos: Record<string, () => ModeloAnalitico> = {
    ...Object.fromEntries(Object.entries(EDIFICIOS_CONGELADOS).map(([k, o]) => [`e1 ${k}`, () => edificio(o).modelo])),
    ...Object.fromEntries(Object.entries(EDIFICIOS_CONGELADOS_E2).map(([k, o]) => [`e2 ${k}`, () => edificio(o).modelo])),
    ...Object.fromEntries(Object.entries(MODELOS_CONGELADOS_E3).map(([k, f]) => [`e3 ${k}`, () => f().modelo])),
    "sin apoyo (diagnóstico)": () => {
      const m = new Constructor();
      m.barra(m.nudo(0, 0, 0, "A"), m.nudo(3, 0, 0, "B"), seccionRectangular(0.3, 0.4), [0, 0, 1], "BAR");
      m.caso("G");
      return m.modelo();
    },
  };

  it("los modelos congelados de E1–E3, en cola en un mismo worker, bit a bit", async () => {
    const cliente = nuevoCliente({ umbralReciclaje: 2 ** 32 });
    const nombres = Object.keys(modelos);
    const enWorker = await Promise.all(nombres.map((k) => cliente.calcular(modelos[k]!())));
    nombres.forEach((k, i) => {
      const directo = calcular(modelos[k]!());
      mismoResultado(enWorker[i]!, directo);
    });
    expect(enWorker.find((r) => !r.valido)?.diagnosticos.map((d) => d.codigo)).toContain("modelo/parte-sin-apoyo");
    expect(cliente.estado.arranques).toBe(1);
  });
});

describe("frontera worker → hilo principal (H27)", () => {
  it("se transfieren todos los buffers de los resultados, sin repetir, y en el emisor quedan vacíos", () => {
    const r = calcular(pequeno());
    const t = transferibles(r);
    const casos = r.valido ? r.casos : [];
    expect(t.length).toBe(4 * casos.length);
    expect(new Set(t).size).toBe(t.length);
    const copia = structuredClone(r, { transfer: t });
    for (const b of t) expect(b.byteLength).toBe(0);
    expect(copia.valido && copia.casos[0]!.u.length).toBeGreaterThan(0);
  });

  it("el atendedor envía avance, resultado y memoria, y transfiere el resultado", async () => {
    const enviados: { m: MensajeDelWorker; t?: ArrayBuffer[] }[] = [];
    const atender = crearAtendedor((m, t) => enviados.push({ m, t }));
    await atender({ tipo: "iniciar", nucleo });
    await atender({ tipo: "calcular", id: 7, modelo: pequeno() });
    const tipos = enviados.map((e) => e.m.tipo);
    expect(tipos[0]).toBe("listo");
    expect(tipos.at(-1)).toBe("resultado");
    expect(tipos.slice(1, -1).every((t) => t === "progreso")).toBe(true);
    const fin = enviados.at(-1)!;
    if (fin.m.tipo !== "resultado") throw new Error();
    expect(fin.m.id).toBe(7);
    expect(fin.t).toEqual(transferibles(fin.m.resultado));
    expect(fin.m.memoria.lineal).toBeGreaterThanOrEqual(fin.m.memoria.enUso);
  });

  it("un cálculo antes de iniciar es un fallo, no un cuelgue", async () => {
    const enviados: MensajeDelWorker[] = [];
    await crearAtendedor((m) => enviados.push(m))({ tipo: "calcular", id: 1, modelo: pequeno() });
    expect(enviados).toEqual([{ tipo: "fallo", id: 1, mensaje: "Error: cálculo recibido antes de iniciar el núcleo" }]);
  });
});

describe("cliente", () => {
  it("informa del avance por fases con la memoria del núcleo", async () => {
    const cliente = nuevoCliente();
    const avance: Progreso[] = [];
    const r = await cliente.calcular(pequeno(), { alProgreso: (p) => avance.push(p) });
    expect(r.valido).toBe(true);
    expect(avance.map((p) => p.fase).sort()).toEqual(Object.keys(r.estadisticas!.tiempos).sort());
    expect(avance.every((p) => p.memoria.lineal > 0)).toBe(true);
    expect(cliente.estado.memoria!.lineal).toBeGreaterThanOrEqual(avance.at(-1)!.memoria.lineal);
  });

  it("cancelar rechaza en el acto lo pendiente, calienta otro worker y el siguiente cálculo sale igual", async () => {
    const cliente = nuevoCliente({ umbralReciclaje: 2 ** 32 });
    await cliente.calentar();
    const modelo = mediano();
    let t0 = 0;
    const enCurso = cliente.calcular(modelo, {
      alProgreso: (p) => {
        if (p.fase === "ensamblado") {
          t0 = performance.now();
          cliente.cancelar();
        }
      },
    });
    const enCola = cliente.calcular(pequeno());
    await expect(enCurso).rejects.toBeInstanceOf(ErrorCancelado);
    await expect(enCola).rejects.toBeInstanceOf(ErrorCancelado);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(cliente.estado.arranques).toBe(2);
    await cliente.calentar();
    mismoResultado(await cliente.calcular(modelo), calcular(modelo));
    expect(cliente.estado.arranques).toBe(2);
  });

  it("por defecto recicla tras cada cálculo; con umbral, sólo cuando la memoria lineal pasa de él", async () => {
    const cliente = nuevoCliente();
    const modelo = pequeno();
    const a = await cliente.calcular(modelo);
    const b = await cliente.calcular(modelo);
    mismoResultado(a, b);
    expect(cliente.estado).toMatchObject({ reciclajes: 2, arranques: 3, vivo: true }); // el siguiente ya se está calentando
    await cliente.calentar();
    expect(cliente.estado.listo).toBe(true);
    const conUmbral = nuevoCliente({ umbralReciclaje: 2 * 2 ** 20 });
    await conUmbral.calcular(modelo);
    await conUmbral.calcular(modelo);
    expect(conUmbral.estado.memoria!.lineal).toBeLessThan(2 * 2 ** 20);
    expect(conUmbral.estado).toMatchObject({ reciclajes: 0, arranques: 1 });
    await conUmbral.calcular(mediano());
    expect(conUmbral.estado).toMatchObject({ reciclajes: 1, arranques: 2 });
  });

  it("una excepción del motor es ErrorWorker; el worker se recicla y la cola sigue", async () => {
    const cliente = nuevoCliente({ umbralReciclaje: 2 ** 32 });
    const roto = { nudos: null } as unknown as ModeloAnalitico;
    const [malo, bueno] = [cliente.calcular(roto), cliente.calcular(pequeno())];
    await expect(malo).rejects.toBeInstanceOf(ErrorWorker);
    await expect(malo).rejects.toThrow(/TypeError/);
    expect((await bueno).valido).toBe(true);
    expect(cliente.estado).toMatchObject({ reciclajes: 1, arranques: 2 });
  });

  it("si el worker se cae, el siguiente cálculo va a uno nuevo", async () => {
    const creados: PuertoNodo[] = [];
    const cliente = nuevoCliente({}, creados);
    await cliente.calentar();
    creados[0]!.prueba({ tipo: "prueba-lanzar" });
    await hasta(() => cliente.estado.arranques === 2);
    expect(cliente.estado.reciclajes).toBe(1);
    expect((await cliente.calcular(pequeno())).valido).toBe(true);
  });

  it("si el núcleo no compila, calentar y calcular rechazan con ErrorWorker sin reintentar en bucle", async () => {
    const cliente = nuevoCliente({ nucleo: Promise.reject(new Error("descarga fallida")) });
    await expect(cliente.calentar()).rejects.toThrow(/descarga fallida/);
    await expect(cliente.calcular(pequeno())).rejects.toBeInstanceOf(ErrorWorker);
    expect(cliente.estado).toMatchObject({ vivo: false, pendientes: 0, arranques: 2 });
  });

  it("cerrar rechaza lo pendiente y no deja worker", async () => {
    const cliente = nuevoCliente();
    const p = cliente.calcular(pequeno());
    cliente.cerrar();
    await expect(p).rejects.toBeInstanceOf(ErrorCancelado);
    expect(cliente.estado).toMatchObject({ vivo: false, pendientes: 0 });
  });

  it("en reposo termina el worker y lo vuelve a arrancar al calcular", async () => {
    const cliente = nuevoCliente({ reposoMs: 30, umbralReciclaje: 2 ** 32 });
    await cliente.calcular(pequeno());
    expect(cliente.estado.vivo).toBe(true);
    await hasta(() => !cliente.estado.vivo);
    expect((await cliente.calcular(pequeno())).valido).toBe(true);
    expect(cliente.estado.arranques).toBe(2);
  });
});

describe("memoria del núcleo (H16)", () => {
  it("los límites del perfil rechazan el modelo antes de factorizar; cada cálculo puede cambiarlos", async () => {
    const cliente = nuevoCliente({ limites: { ecuaciones: 10 } });
    const r = await cliente.calcular(pequeno());
    expect(r.valido).toBe(false);
    expect(r.diagnosticos.map((d) => d.codigo)).toEqual(["modelo/demasiado-grande"]);
    expect((await cliente.calcular(pequeno(), { limites: LIMITES.movil })).valido).toBe(true);
  });

  it("sin memoria en el núcleo da solver/sin-memoria, y el worker se recicla", async () => {
    const creados: PuertoNodo[] = [];
    const cliente = nuevoCliente({}, creados);
    await cliente.calentar();
    creados[0]!.prueba({ tipo: "prueba-ocupar", libres: 8 * 2 ** 20 });
    const r = await cliente.calcular(mediano());
    expect(r.valido).toBe(false);
    expect(r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo)).toEqual(["solver/sin-memoria"]);
    expect(cliente.estado.reciclajes).toBe(1);
    expect((await cliente.calcular(pequeno())).valido).toBe(true);
  });

  it("una trampa del WASM por memoria agotada es ErrorWorker, y el worker se recicla", async () => {
    const creados: PuertoNodo[] = [];
    const cliente = nuevoCliente({}, creados);
    await cliente.calentar();
    creados[0]!.prueba({ tipo: "prueba-ocupar", libres: 0 });
    const p = cliente.calcular(mediano());
    await expect(p).rejects.toBeInstanceOf(ErrorWorker);
    await expect(p).rejects.toThrow(/RuntimeError/);
    expect(cliente.estado.reciclajes).toBe(1);
    mismoResultado(await cliente.calcular(pequeno()), calcular(pequeno()));
  });
});
