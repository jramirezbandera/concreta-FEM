// Orquestacion del calculo (feature-14, Tarea 1.1/3.2). Probamos calcularObra() —
// la fuente UNICA del pipeline obra -> FEM -> resultados, sin hooks — con el
// solverClient MOCKEADO: ningun test arranca Pyodide (CLAUDE.md §13; nada de
// instancia por test). Vive bajo src/ui/, asi que corre en el project `jsdom`,
// pero calcularObra no usa React: ejercitamos su logica imperativa directamente.
//
// Casos cubiertos (los 4 del plan):
//   (a) discretizar ok:false -> expone errores de obra y NO llama al solver.
//   (b) calcular OK -> setResultados (trio) + fija combinacionActiva + auto-switch
//       a la pestana "resultados".
//   (c) ErrorMotor (carga/calculo) -> ultimoError legible, sin romper la app.
//   (d) reentrada / doble disparo solapado -> el segundo se ignora (un solo calculo).
import { describe, it, expect, beforeEach, vi } from "vitest";

// El mock del solver se declara ANTES de importar el SUT (hoisting de vi.mock). Solo
// reexpone lo que useCalcular consume del barrel del solver: solverClient (con
// calcular/estado/precargar) y esErrorMotor. La forma de ErrorMotor es {fase,mensaje}.
const calcularMock = vi.fn();
const estadoMock = vi.fn(async () => "listo" as const);
const precargarMock = vi.fn(async () => {});
vi.mock("../../solver", () => ({
  solverClient: {
    calcular: (...args: unknown[]) => calcularMock(...args),
    estado: () => estadoMock(),
    precargar: () => precargarMock(),
  },
  // Reproduccion fiel del type-guard real: distingue el ErrorMotor plano del worker.
  esErrorMotor: (e: unknown): boolean =>
    typeof e === "object" &&
    e !== null &&
    "fase" in e &&
    "mensaje" in e &&
    ((e as { fase: unknown }).fase === "carga" ||
      (e as { fase: unknown }).fase === "calculo"),
}));

import { calcularObra } from "./useCalcular";
import type { CalculoSink } from "./useCalcular";
import { modeloStore } from "../../estado/modeloStore";
import { resultadosStore } from "../../estado/resultadosStore";
import { vistaStore } from "../../estado/vistaStore";
import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";
import type { ResultadosCalculo } from "../../solver";
import { fixtureBiapoyadaUDL } from "../../../tests/golden/_arnes/fixtures";

// Obra VALIDA (discretiza ok:true): el fixture de libro biapoyado.
function obraValida(): Modelo {
  return fixtureBiapoyadaUDL({ L: 6, q: 10, cota: 3 });
}

// Obra INVALIDA (discretiza ok:false): el mismo fixture sin pilares -> sin apoyos
// -> "la estructura no esta sujeta" (SIN_SUJECION, en lenguaje de obra).
function obraSinSujecion(): Modelo {
  return { ...obraValida(), pilares: [] };
}

// Resultados sinteticos minimos validos: dos combos para verificar la inicializacion
// de combinacionActiva a la primera (ELU).
function resultadosFalsos(combos: [string, ...string[]] = ["ELU", "ELS"]): ResultadosCalculo {
  return {
    units: "kN-m",
    analysis: { type: "linear", n_points: 2 },
    combos,
    nodos: {},
    barras: {},
    check_statics: null,
  };
}

// Sink que registra los callbacks invocados, para asertar el flujo sin React.
function sinkEspia(): {
  sink: CalculoSink;
  errores: ReturnType<typeof vi.fn>;
  avisos: ReturnType<typeof vi.fn>;
  errorMotor: ReturnType<typeof vi.fn>;
  calculando: ReturnType<typeof vi.fn>;
} {
  const errores = vi.fn();
  const avisos = vi.fn();
  const errorMotor = vi.fn();
  const calculando = vi.fn();
  return {
    sink: {
      onErrores: errores,
      onAvisos: avisos,
      onErrorMotor: errorMotor,
      onCalculando: calculando,
    },
    errores,
    avisos,
    errorMotor,
    calculando,
  };
}

beforeEach(() => {
  calcularMock.mockReset();
  estadoMock.mockReset();
  estadoMock.mockResolvedValue("listo");
  precargarMock.mockReset();
  // Reset de los stores (singletons de modulo).
  modeloStore.getState().cargarModelo(crearModeloVacio());
  vistaStore.getState().setPestanaActiva("entradaPilares");
  vistaStore.getState().setCombinacionActiva(null);
  resultadosStore.getState().descartar();
});

describe("calcularObra · (a) discretizar ok:false", () => {
  it("expone los errores de obra y NO llama al solver", async () => {
    modeloStore.getState().cargarModelo(obraSinSujecion());
    const { sink, errores, avisos } = sinkEspia();

    await calcularObra(sink);

    // Se expusieron errores de obra (lenguaje de obra, no jerga FEM).
    expect(errores).toHaveBeenCalledTimes(1);
    const lista = errores.mock.calls[0][0] as Array<{ mensaje: string }>;
    expect(lista.length).toBeGreaterThan(0);
    expect(lista[0].mensaje).toMatch(/no está sujeta/i);
    // No se tocaron avisos con contenido bloqueante; el solver no se invoco.
    expect(calcularMock).not.toHaveBeenCalled();
    // No se fijaron resultados ni se cambio de pestana.
    expect(resultadosStore.getState().resultados).toBeNull();
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares");
    expect(avisos).toHaveBeenCalledWith([]);
  });
});

describe("calcularObra · (b) calcular OK", () => {
  it("fija el trio de resultados, la combinacion activa y cambia a Resultados", async () => {
    modeloStore.getState().cargarModelo(obraValida());
    const resultados = resultadosFalsos(["ELU", "ELS"]);
    calcularMock.mockResolvedValue(resultados);
    const { sink, errores, errorMotor } = sinkEspia();

    await calcularObra(sink);

    // El solver se llamo exactamente una vez con un ModeloFEM (Capa 2).
    expect(calcularMock).toHaveBeenCalledTimes(1);
    const arg = calcularMock.mock.calls[0][0] as { nodes: unknown[]; members: unknown[] };
    expect(Array.isArray(arg.nodes)).toBe(true);
    expect(arg.members.length).toBeGreaterThan(0);

    // Se fijaron resultados + modeloFEM + trazabilidad (el trio coherente).
    const rs = resultadosStore.getState();
    expect(rs.resultados).toBe(resultados);
    expect(rs.modeloFEM).not.toBeNull();
    expect(rs.trazabilidad).not.toBeNull();
    expect(rs.vigente).toBe(true);

    // combinacionActiva inicializada a la primera combo (estaba en null).
    expect(vistaStore.getState().combinacionActiva).toBe("ELU");
    // Auto-switch a la pestana Resultados.
    expect(vistaStore.getState().pestanaActiva).toBe("resultados");
    // Sin errores de obra ni de motor.
    expect(errores).toHaveBeenCalledWith([]);
    expect(errorMotor).not.toHaveBeenCalledWith(
      expect.objectContaining({ fase: expect.anything() }),
    );
  });

  it("respeta la combinacion activa del usuario si sigue siendo valida (recalculo)", async () => {
    modeloStore.getState().cargarModelo(obraValida());
    vistaStore.getState().setCombinacionActiva("ELS"); // el usuario eligio ELS
    calcularMock.mockResolvedValue(resultadosFalsos(["ELU", "ELS"]));

    await calcularObra();

    // ELS sigue entre las combos calculadas: no se sobreescribe con la primera.
    expect(vistaStore.getState().combinacionActiva).toBe("ELS");
  });

  it("si la combinacion activa ya no existe entre las combos, cae a la primera", async () => {
    modeloStore.getState().cargarModelo(obraValida());
    vistaStore.getState().setCombinacionActiva("NO_EXISTE");
    calcularMock.mockResolvedValue(resultadosFalsos(["ELU", "ELS"]));

    await calcularObra();

    expect(vistaStore.getState().combinacionActiva).toBe("ELU");
  });
});

describe("calcularObra · (c) ErrorMotor sin romper la app", () => {
  it("ErrorMotor de carga -> ultimoError legible, sin fijar resultados", async () => {
    modeloStore.getState().cargarModelo(obraValida());
    const errorCarga = {
      fase: "carga" as const,
      mensaje: "No se pudo arrancar el motor de cálculo.",
      detalle: "micropip falló",
    };
    calcularMock.mockRejectedValue(errorCarga);
    const { sink, errorMotor } = sinkEspia();

    // No debe propagar: calcularObra captura el fallo del motor.
    await expect(calcularObra(sink)).resolves.toBeUndefined();

    expect(errorMotor).toHaveBeenCalledWith(errorCarga);
    expect(resultadosStore.getState().resultados).toBeNull();
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares");
  });

  it("ErrorMotor de calculo -> ultimoError con fase 'calculo'", async () => {
    modeloStore.getState().cargarModelo(obraValida());
    const errorCalc = { fase: "calculo" as const, mensaje: "El modelo no converge." };
    calcularMock.mockRejectedValue(errorCalc);
    const { sink, errorMotor } = sinkEspia();

    await calcularObra(sink);
    expect(errorMotor).toHaveBeenCalledWith(errorCalc);
  });

  it("excepcion inesperada (no ErrorMotor) se envuelve en mensaje legible de obra", async () => {
    modeloStore.getState().cargarModelo(obraValida());
    calcularMock.mockRejectedValue(new Error("boom interno"));
    const { sink, errorMotor } = sinkEspia();

    await calcularObra(sink);

    // Se normaliza a un ErrorMotor de fase "calculo" con copy en lenguaje de obra;
    // el detalle tecnico crudo queda fuera del mensaje al arquitecto.
    expect(errorMotor).toHaveBeenCalledTimes(2); // null inicial + el error final
    const ultimo = errorMotor.mock.calls.at(-1)![0] as {
      fase: string;
      mensaje: string;
      detalle?: string;
    };
    expect(ultimo.fase).toBe("calculo");
    expect(ultimo.mensaje).toMatch(/fallo inesperado/i);
    expect(ultimo.mensaje).not.toContain("boom interno"); // sin jerga tecnica
    expect(ultimo.detalle).toContain("boom interno"); // pero queda en detalle
  });
});

describe("calcularObra · (d) reentrada / doble disparo", () => {
  it("un segundo disparo solapado se ignora (un solo calculo en vuelo)", async () => {
    modeloStore.getState().cargarModelo(obraValida());
    // calcular() queda pendiente hasta que resolvemos manualmente: simula un calculo
    // en curso para que el segundo disparo coincida con el primero en vuelo.
    let resolver!: (r: ResultadosCalculo) => void;
    calcularMock.mockReturnValue(
      new Promise<ResultadosCalculo>((res) => {
        resolver = res;
      }),
    );

    const p1 = calcularObra(); // primer disparo: entra y queda esperando al solver
    const p2 = calcularObra(); // segundo disparo SOLAPADO: debe ignorarse
    await p2; // el segundo retorna de inmediato (guard de reentrada)

    expect(calcularMock).toHaveBeenCalledTimes(1); // el solver se invoco UNA vez

    resolver(resultadosFalsos()); // liberamos el primero
    await p1;
    expect(calcularMock).toHaveBeenCalledTimes(1);
    expect(resultadosStore.getState().resultados).not.toBeNull();
  });
});

describe("calcularObra · (e) carrera de resultados obsoletos (eng-review D3)", () => {
  it("si la obra cambia durante el calculo, NO compromete los resultados ni cambia de pestana", async () => {
    modeloStore.getState().cargarModelo(obraValida());
    // El motor queda pendiente: simula el calculo en vuelo para poder editar la obra
    // ANTES de que devuelva (la ventana exacta de la carrera).
    let resolver!: (r: ResultadosCalculo) => void;
    calcularMock.mockReturnValue(
      new Promise<ResultadosCalculo>((res) => {
        resolver = res;
      }),
    );

    const p = calcularObra(); // arranca con el modelo A (referencia capturada)
    // El usuario edita la obra mientras se calcula: cargarModelo reemplaza la
    // referencia del modelo (Immer) -> el guard de identidad debe detectarlo.
    modeloStore.getState().cargarModelo(obraValida());

    resolver(resultadosFalsos(["ELU", "ELS"])); // el motor devuelve resultados del modelo A
    await p;

    // Guard D3: los resultados eran del modelo viejo -> NO se fijan como vigentes,
    // no se cambia de pestana. El usuario nunca ve datos que no corresponden a su obra.
    expect(resultadosStore.getState().resultados).toBeNull();
    expect(resultadosStore.getState().vigente).toBe(false);
    expect(vistaStore.getState().pestanaActiva).toBe("entradaPilares");
  });

  it("si la obra NO cambia, fija los resultados con normalidad (control)", async () => {
    modeloStore.getState().cargarModelo(obraValida());
    calcularMock.mockResolvedValue(resultadosFalsos(["ELU", "ELS"]));

    await calcularObra();

    // Sin edicion concurrente, el camino feliz sigue intacto.
    expect(resultadosStore.getState().resultados).not.toBeNull();
    expect(vistaStore.getState().pestanaActiva).toBe("resultados");
  });
});
