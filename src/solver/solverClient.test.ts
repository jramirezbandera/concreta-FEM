// =============================================================================
// solverClient.test.ts - tests de la CAPA CLIENTE del solver (feature-5, F5-T1).
//
// ENTORNO: proyecto "node" de Vitest (vitest.config.ts), SIN Pyodide, SIN Worker
// real, SIN DOM. Probamos SOLO la logica que aporta solverClient sobre el worker:
// validacion de nPoints en el borde (F5-1), safeParse del contrato (#8), timeout
// + reset (F5-3/F5-5), passthrough de estado()/error() y el type guard esErrorMotor.
//
// COSTURA (documentada en solverClient.ts): el cliente expone __setFabricaWorker()
// para inyectar un doble del par { worker, proxy } en vez de hacer `new Worker` +
// Comlink.wrap (no instanciables en Node). NO mockeamos Comlink ni globalThis.Worker:
// la costura es minima y explicita, y no altera el camino de produccion (la fabrica
// por defecto sigue siendo new Worker + Comlink.wrap).
//
// QUE QUEDA PARA F16 (E2E con worker real): el comportamiento de worker.onerror
// ante un crash REAL del Worker del navegador, y que terminate() corte de verdad
// el Python sincrono de Pyodide. Aqui asertamos la LOGICA (que onerror resetea y
// que el timeout llama a terminate + recrea), no el runtime del navegador.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  solverClient,
  esErrorMotor,
  __setFabricaWorker,
  __resetWorker,
  type ParWorker,
} from "./solverClient";
import type { ModeloFEM } from "../discretizador/contratoFEM";
import type { ResultadosCalculo } from "./resultados";

// -----------------------------------------------------------------------------
// Utilidades de test: doble del par worker+proxy.
// -----------------------------------------------------------------------------

// ModeloFEM minimo VALIDO en forma (no se calcula nada: el proxy esta mockeado).
// Basta con que tenga la forma; la validacion de ModeloFEM no ocurre en el cliente.
const MODELO_FEM = {} as unknown as ModeloFEM;

// Salida VALIDA contra ResultadosCalculoSchema (la minima que el esquema acepta).
const RESULTADOS_OK: ResultadosCalculo = {
  units: "kN-m",
  analysis: { type: "linear", n_points: 11 },
  combos: ["ELU"],
  nodos: {},
  barras: {},
  check_statics: null,
};

/** Doble de worker: registra cuantas veces se llamo terminate() y guarda onerror. */
interface DobleWorker {
  terminate: ReturnType<typeof vi.fn>;
  onerror: ((ev: unknown) => void) | null;
  onmessageerror: ((ev: unknown) => void) | null;
}

/** Crea un par { worker, proxy } doble con los metodos de proxy que se le pasen. */
function crearPar(metodosProxy: {
  calcular?: ReturnType<typeof vi.fn>;
  precargar?: ReturnType<typeof vi.fn>;
  estado?: ReturnType<typeof vi.fn>;
  error?: ReturnType<typeof vi.fn>;
}): { par: ParWorker; worker: DobleWorker } {
  const worker: DobleWorker = {
    terminate: vi.fn(),
    onerror: null,
    onmessageerror: null,
  };
  const proxy = {
    calcular: metodosProxy.calcular ?? vi.fn(),
    precargar: metodosProxy.precargar ?? vi.fn(async () => undefined),
    estado: metodosProxy.estado ?? vi.fn(async () => "listo"),
    error: metodosProxy.error ?? vi.fn(async () => null),
  };
  // El cliente solo usa worker.terminate y asigna worker.onerror/onmessageerror;
  // el proxy se usa como objeto de metodos asincronos. El cast es seguro para test.
  return { par: { worker, proxy } as unknown as ParWorker, worker };
}

beforeEach(() => {
  // Cada test parte de un singleton limpio y restaura la fabrica al final.
  __resetWorker();
});

afterEach(() => {
  __setFabricaWorker(null);
  __resetWorker();
  vi.restoreAllMocks();
});

// =============================================================================
// F5-1: validacion de nPoints en el borde (NO debe cruzar al worker).
// =============================================================================
describe("F5-1 validacion de nPoints en el borde", () => {
  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
    ["negativo", -10],
    ["cero", 0],
    ["uno (por debajo del minimo 2)", 1],
    ["fraccionario", 12.5],
    ["gigante (1e9)", 1e9],
    ["por encima del maximo (201)", 201],
  ])(
    "rechaza nPoints=%s con ErrorMotor{fase:calculo} SIN llamar al worker",
    async (_etiqueta, nPoints) => {
      const calcular = vi.fn();
      const { par } = crearPar({ calcular });
      __setFabricaWorker(() => par);

      await expect(solverClient.calcular(MODELO_FEM, nPoints)).rejects.toSatisfy(
        (e: unknown) => esErrorMotor(e) && e.fase === "calculo",
      );
      // La clave de F5-1: el calculo NO cruzo al worker.
      expect(calcular).not.toHaveBeenCalled();
    },
  );

  it("acepta nPoints en rango (2 y 200) y un valor intermedio", async () => {
    const calcular = vi.fn(async () => RESULTADOS_OK);
    const { par } = crearPar({ calcular });
    __setFabricaWorker(() => par);

    await expect(solverClient.calcular(MODELO_FEM, 2)).resolves.toBeDefined();
    await expect(solverClient.calcular(MODELO_FEM, 50)).resolves.toBeDefined();
    await expect(solverClient.calcular(MODELO_FEM, 200)).resolves.toBeDefined();
    expect(calcular).toHaveBeenCalledTimes(3);
  });

  it("nPoints OMITIDO es valido: cruza al worker sin n_points", async () => {
    const calcular = vi.fn(async () => RESULTADOS_OK);
    const { par } = crearPar({ calcular });
    __setFabricaWorker(() => par);

    await expect(solverClient.calcular(MODELO_FEM)).resolves.toBeDefined();
    // Se llamo con nPoints=undefined (el worker/glue aplica su N_POINTS_DEFAULT).
    expect(calcular).toHaveBeenCalledWith(MODELO_FEM, undefined);
  });
});

// =============================================================================
// #8 / F5: safeParse del contrato de resultados en el borde.
// =============================================================================
describe("safeParse de la salida del worker (#8)", () => {
  it("salida VALIDA -> devuelve los datos validados", async () => {
    const calcular = vi.fn(async () => RESULTADOS_OK);
    const { par } = crearPar({ calcular });
    __setFabricaWorker(() => par);

    const out = await solverClient.calcular(MODELO_FEM);
    expect(out).toEqual(RESULTADOS_OK);
    expect(out.units).toBe("kN-m");
  });

  it("salida MALFORMADA (falta 'units') -> rechaza ErrorMotor{fase:calculo}", async () => {
    // Quitamos un campo requerido por el esquema: safeParse falla con seguridad.
    const malformado = { ...RESULTADOS_OK } as Partial<ResultadosCalculo>;
    delete malformado.units;
    const calcular = vi.fn(async () => malformado);
    const { par } = crearPar({ calcular });
    __setFabricaWorker(() => par);

    await expect(solverClient.calcular(MODELO_FEM)).rejects.toSatisfy(
      (e: unknown) => esErrorMotor(e) && e.fase === "calculo",
    );
  });

  it("salida MALFORMADA (falta 'combos') -> rechaza ErrorMotor{fase:calculo}", async () => {
    const malformado = { ...RESULTADOS_OK } as Partial<ResultadosCalculo>;
    delete malformado.combos;
    const calcular = vi.fn(async () => malformado);
    const { par } = crearPar({ calcular });
    __setFabricaWorker(() => par);

    await expect(solverClient.calcular(MODELO_FEM)).rejects.toSatisfy(
      (e: unknown) => esErrorMotor(e) && e.fase === "calculo",
    );
  });
});

// =============================================================================
// Passthrough de estado() y error() al proxy.
// =============================================================================
describe("passthrough estado()/error()", () => {
  it("estado() reenvia el valor del proxy", async () => {
    const estado = vi.fn(async () => "calculando" as const);
    const { par } = crearPar({ estado });
    __setFabricaWorker(() => par);

    await expect(solverClient.estado()).resolves.toBe("calculando");
    expect(estado).toHaveBeenCalledTimes(1);
  });

  it("error() reenvia el ErrorMotor del proxy", async () => {
    const motor = { fase: "carga", mensaje: "No arranco el motor" } as const;
    const error = vi.fn(async () => motor);
    const { par } = crearPar({ error });
    __setFabricaWorker(() => par);

    await expect(solverClient.error()).resolves.toEqual(motor);
  });
});

// =============================================================================
// esErrorMotor: discrimina ErrorMotor plano de cualquier otra excepcion.
// =============================================================================
describe("esErrorMotor (type guard)", () => {
  it("true para ErrorMotor de fase 'carga' y 'calculo'", () => {
    expect(esErrorMotor({ fase: "carga", mensaje: "x" })).toBe(true);
    expect(esErrorMotor({ fase: "calculo", mensaje: "x" })).toBe(true);
  });

  it("false para un Error normal y para objetos sin fase valida", () => {
    expect(esErrorMotor(new Error("boom"))).toBe(false);
    expect(esErrorMotor({ mensaje: "sin fase" })).toBe(false);
    expect(esErrorMotor({ fase: "otra", mensaje: "x" })).toBe(false);
    expect(esErrorMotor({ fase: "calculo" })).toBe(false); // sin mensaje
    expect(esErrorMotor(null)).toBe(false);
    expect(esErrorMotor("texto")).toBe(false);
    expect(esErrorMotor(undefined)).toBe(false);
  });
});

// =============================================================================
// F5-3 / F5-5: timeout -> termina el worker, resetea el singleton y rechaza.
// =============================================================================
describe("F5-3/F5-5 timeout y reset del worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("si el calculo no resuelve antes del timeout: termina worker, resetea y rechaza ErrorMotor", async () => {
    // calcular que NUNCA resuelve -> fuerza la rama de timeout.
    const calcular = vi.fn(() => new Promise<ResultadosCalculo>(() => {}));
    const { par, worker } = crearPar({ calcular });
    __setFabricaWorker(() => par);

    // timeoutMs pequeno para no esperar 60 s; avanzamos el reloj falso.
    const p = solverClient.calcular(MODELO_FEM, undefined, 1000);
    // Capturamos el rechazo antes de avanzar el reloj (evita unhandled rejection).
    const esperaRechazo = expect(p).rejects.toSatisfy(
      (e: unknown) => esErrorMotor(e) && e.fase === "calculo",
    );
    await vi.advanceTimersByTimeAsync(1000);
    await esperaRechazo;

    // F5-3: el worker colgado se TERMINO (unica forma de cortar el Python sincrono).
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("tras el timeout, la proxima calcular() recrea un worker LIMPIO (F5-5)", async () => {
    // Primera fabrica: worker que cuelga. Segunda: worker que resuelve.
    const calcularCuelga = vi.fn(() => new Promise<ResultadosCalculo>(() => {}));
    const { par: par1, worker: worker1 } = crearPar({ calcular: calcularCuelga });

    const calcularOk = vi.fn(async () => RESULTADOS_OK);
    const { par: par2 } = crearPar({ calcular: calcularOk });

    // La fabrica devuelve par1 la primera vez, par2 la segunda (recreacion).
    let llamada = 0;
    __setFabricaWorker(() => {
      llamada += 1;
      return llamada === 1 ? par1 : par2;
    });

    // 1ª llamada: cuelga -> timeout -> reset (par=null).
    const p1 = solverClient.calcular(MODELO_FEM, undefined, 500);
    const espera1 = expect(p1).rejects.toSatisfy(
      (e: unknown) => esErrorMotor(e) && e.fase === "calculo",
    );
    await vi.advanceTimersByTimeAsync(500);
    await espera1;
    expect(worker1.terminate).toHaveBeenCalledTimes(1);

    // 2ª llamada: debe crear un worker NUEVO (par2) y resolver con exito.
    const out = await solverClient.calcular(MODELO_FEM);
    expect(out).toEqual(RESULTADOS_OK);
    expect(calcularOk).toHaveBeenCalledTimes(1);
    expect(llamada).toBe(2); // la fabrica se invoco DOS veces -> hubo recreacion.
  });

  it("onerror del worker resetea el singleton: la proxima operacion recrea (F5-5)", async () => {
    const estado1 = vi.fn(async () => "listo" as const);
    const { par: par1, worker: worker1 } = crearPar({ estado: estado1 });
    const estado2 = vi.fn(async () => "descargado" as const);
    const { par: par2 } = crearPar({ estado: estado2 });

    let llamada = 0;
    __setFabricaWorker(() => {
      llamada += 1;
      return llamada === 1 ? par1 : par2;
    });

    // Crear el worker (instala onerror) consultando estado.
    await solverClient.estado();
    expect(llamada).toBe(1);
    expect(typeof worker1.onerror).toBe("function");

    // Simular muerte del worker: dispara onerror -> resetea el singleton.
    worker1.onerror?.({});

    // La proxima operacion debe recrear (par2) -> la fabrica se invoca de nuevo.
    await expect(solverClient.estado()).resolves.toBe("descargado");
    expect(llamada).toBe(2);
  });
});
