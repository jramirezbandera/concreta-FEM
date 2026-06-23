// Test de la logica pura de ColocacionViga (feature-12, Tarea 2.3): el flujo de DOS
// clics (extremo I -> extremo J) decidido por procesarClicViga, mas las costuras
// posicionExtremo y extremosCoinciden. Se testea la LOGICA (no el render R3F: en
// jsdom no hay WebGL). Reproducimos el ciclo de dos clics aplicando las acciones
// como lo hace el componente y verificamos que se crea UNA viga con i/j correctos.
import { describe, it, expect } from "vitest";
import { crearModeloVacio } from "../../dominio";
import type { Modelo, Nudo } from "../../dominio";
import type { ExtremoViga } from "../../estado";
import {
  procesarClicViga,
  extremosCoinciden,
  posicionExtremo,
  type AccionClicViga,
} from "./colocacionVigaLogica";

const nudo = (id: string, x: number, y: number): Nudo => ({ id, x, y });

const modeloCon = (patch: Partial<Modelo>): Modelo => ({
  ...crearModeloVacio(),
  ...patch,
});

const DEFAULTS = {
  seccionId: "s1",
  materialId: "m1",
  extremoI: "empotrado" as const,
  extremoJ: "empotrado" as const,
  tirante: false,
};

// Simula el ciclo del componente: una secuencia de extremos resueltos (un clic cada
// uno). Mantiene `pendienteI` en una variable (como la ref del componente) y aplica
// las acciones. Devuelve las vigas creadas (DatosViga) y el estado final de I.
function reproducirClics(
  extremos: ExtremoViga[],
  plantaId = "p0",
): { creadas: AccionClicViga[]; pendienteFinal: ExtremoViga | null } {
  let pendienteI: ExtremoViga | null = null;
  const creadas: AccionClicViga[] = [];
  for (const extremo of extremos) {
    const accion = procesarClicViga(pendienteI, extremo, plantaId, DEFAULTS);
    if (accion.tipo === "guardarI") {
      pendienteI = accion.i;
    } else if (accion.tipo === "crearViga") {
      creadas.push(accion);
      pendienteI = null; // reset del ciclo, como el componente
    }
    // "ignorar": no toca pendienteI ni crea (degenerado)
  }
  return { creadas, pendienteFinal: pendienteI };
}

describe("procesarClicViga: flujo de dos clics", () => {
  it("primer clic guarda el extremo I (no crea viga)", () => {
    const accion = procesarClicViga(null, { x: 1, y: 2 }, "p0", DEFAULTS);
    expect(accion).toEqual({ tipo: "guardarI", i: { x: 1, y: 2 } });
  });

  it("segundo clic crea la viga UNA vez con i/j correctos y resetea I", () => {
    const { creadas, pendienteFinal } = reproducirClics([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(creadas).toHaveLength(1);
    const accion = creadas[0]!;
    expect(accion.tipo).toBe("crearViga");
    if (accion.tipo !== "crearViga") throw new Error("esperaba crearViga");
    expect(accion.datos.i).toEqual({ x: 0, y: 0 });
    expect(accion.datos.j).toEqual({ x: 4, y: 0 });
    expect(accion.datos.plantaId).toBe("p0");
    expect(accion.datos.seccionId).toBe("s1");
    expect(accion.datos.materialId).toBe("m1");
    expect(accion.datos.extremoI).toBe("empotrado");
    expect(accion.datos.extremoJ).toBe("empotrado");
    expect(accion.datos.tirante).toBe(false);
    // tras crear, el ciclo se reinicia (listo para la siguiente viga).
    expect(pendienteFinal).toBeNull();
  });

  it("segundo clic degenerado (J === I por coords) se ignora: NO crea viga", () => {
    const { creadas, pendienteFinal } = reproducirClics([
      { x: 2, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(creadas).toHaveLength(0);
    // I sigue pendiente: el usuario reintenta el extremo J.
    expect(pendienteFinal).toEqual({ x: 2, y: 2 });
  });

  it("segundo clic degenerado (J === I por nudoId) se ignora", () => {
    const { creadas } = reproducirClics([{ nudoId: "n1" }, { nudoId: "n1" }]);
    expect(creadas).toHaveLength(0);
  });

  it("dos vigas encadenadas: cuatro clics crean dos vigas", () => {
    const { creadas } = reproducirClics([
      { x: 0, y: 0 },
      { x: 4, y: 0 }, // viga 1
      { x: 4, y: 0 },
      { x: 4, y: 4 }, // viga 2
    ]);
    expect(creadas).toHaveLength(2);
    const v1 = creadas[0]!;
    const v2 = creadas[1]!;
    if (v1.tipo !== "crearViga" || v2.tipo !== "crearViga") {
      throw new Error("esperaba dos crearViga");
    }
    expect(v1.datos.j).toEqual({ x: 4, y: 0 });
    expect(v2.datos.i).toEqual({ x: 4, y: 0 });
    expect(v2.datos.j).toEqual({ x: 4, y: 4 });
  });

  it("extremos mixtos (nudoId + coords) crean una viga con ambos extremos", () => {
    const { creadas } = reproducirClics([{ nudoId: "nA" }, { x: 5, y: 0 }]);
    expect(creadas).toHaveLength(1);
    const accion = creadas[0]!;
    if (accion.tipo !== "crearViga") throw new Error("esperaba crearViga");
    expect(accion.datos.i).toEqual({ nudoId: "nA" });
    expect(accion.datos.j).toEqual({ x: 5, y: 0 });
  });
});

describe("extremosCoinciden", () => {
  it("dos nudos con el mismo id coinciden", () => {
    expect(extremosCoinciden({ nudoId: "n1" }, { nudoId: "n1" })).toBe(true);
  });
  it("dos nudos con distinto id no coinciden", () => {
    expect(extremosCoinciden({ nudoId: "n1" }, { nudoId: "n2" })).toBe(false);
  });
  it("dos coords iguales coinciden", () => {
    expect(extremosCoinciden({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
  });
  it("dos coords distintas no coinciden", () => {
    expect(extremosCoinciden({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
  });
  it("nudoId vs coords sin modelo se tratan como distintos", () => {
    expect(extremosCoinciden({ nudoId: "n1" }, { x: 1, y: 2 })).toBe(false);
  });
  it("con modelo, nudoId y coords del mismo punto (a <TOL_NODO) coinciden", () => {
    const m = modeloCon({ nudos: [nudo("n1", 3, 7)] });
    expect(extremosCoinciden({ nudoId: "n1" }, { x: 3, y: 7 }, m)).toBe(true);
    // 0.5 mm < TOL_NODO (1 mm): mismo punto fisico.
    expect(extremosCoinciden({ nudoId: "n1" }, { x: 3.0005, y: 7 }, m)).toBe(true);
  });
  it("con modelo, nudoId y coords de puntos distintos no coinciden", () => {
    const m = modeloCon({ nudos: [nudo("n1", 3, 7)] });
    expect(extremosCoinciden({ nudoId: "n1" }, { x: 5, y: 7 }, m)).toBe(false);
  });
});

describe("posicionExtremo", () => {
  it("resuelve un extremo por nudoId a las coords del nudo", () => {
    const m = modeloCon({ nudos: [nudo("n1", 3, 7)] });
    expect(posicionExtremo(m, { nudoId: "n1" })).toEqual({ x: 3, y: 7 });
  });
  it("un extremo por coords devuelve esas coords tal cual", () => {
    const m = modeloCon({});
    expect(posicionExtremo(m, { x: 2.5, y: -1 })).toEqual({ x: 2.5, y: -1 });
  });
  it("un nudoId inexistente devuelve null (referencia rota)", () => {
    const m = modeloCon({});
    expect(posicionExtremo(m, { nudoId: "fantasma" })).toBeNull();
  });
});
