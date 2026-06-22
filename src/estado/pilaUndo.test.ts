// Tests del nucleo del patron Command aislado del store (CLAUDE.md §10, feature-7):
// PilaUndo + crearComandoParches. Se prueba con un "modelo" mutable de juguete y un
// aplicador que reproduce lo que hace modeloStore (applyPatches sobre el estado),
// para verificar el contrato de delta/coalescing sin acoplar al Zustand.
import { describe, it, expect, beforeEach } from "vitest";
import { applyPatches } from "immer";
import type { Patch } from "immer";
import { PilaUndo } from "./comandos/pilaUndo";
import { crearComandoParches } from "./comandos/comando";
import type { AplicadorParches } from "./comandos/comando";
import { crearModeloVacio } from "../dominio";
import type { Modelo } from "../dominio";

// Estado de juguete sobre el que actua el aplicador. Cumple el contrato real: el
// Comando no conoce este estado; recibe el aplicador inyectado.
let modelo: Modelo;
const aplicador: AplicadorParches = (patches: Patch[]) => {
  modelo = applyPatches(modelo, patches);
};

beforeEach(() => {
  modelo = crearModeloVacio();
});

describe("crearComandoParches (delta Immer)", () => {
  it("guarda el delta y devuelve el modelo siguiente ya producido", () => {
    const { comando, siguiente } = crearComandoParches(
      modelo,
      "Anadir nudo",
      (b) => {
        b.nudos.push({ id: "n1", x: 1, y: 2 });
      },
    );
    // No muta el base (Immer produce uno nuevo).
    expect(modelo.nudos).toHaveLength(0);
    expect(siguiente.nudos).toHaveLength(1);
    expect(comando.etiqueta).toBe("Anadir nudo");
    expect(comando.coalesceKey).toBeUndefined();
  });

  it("propaga coalesceKey al comando", () => {
    const { comando } = crearComandoParches(modelo, "x", () => {}, "k");
    expect(comando.coalesceKey).toBe("k");
  });

  it("aplicar reproduce el cambio y revertir lo deshace (deltas puros)", () => {
    const previo = structuredClone(modelo);
    const { comando } = crearComandoParches(modelo, "Anadir nudo", (b) => {
      b.nudos.push({ id: "n1", x: 1, y: 2 });
    });
    comando.aplicar(aplicador);
    expect(modelo.nudos).toEqual([{ id: "n1", x: 1, y: 2 }]);
    comando.revertir(aplicador);
    expect(modelo).toEqual(previo);
  });
});

describe("PilaUndo (ejecutar/deshacer/rehacer)", () => {
  it("arranca vacia: no puede deshacer ni rehacer", () => {
    const pila = new PilaUndo();
    expect(pila.puedeDeshacer()).toBe(false);
    expect(pila.puedeRehacer()).toBe(false);
  });

  function comandoAnadirNudo(id: string) {
    return crearComandoParches(modelo, `Anadir ${id}`, (b) => {
      b.nudos.push({ id, x: 0, y: 0 });
    }).comando;
  }

  it("ejecutar aplica y permite deshacer; deshacer permite rehacer", () => {
    const pila = new PilaUndo();
    pila.ejecutar(comandoAnadirNudo("n1"), aplicador);
    expect(modelo.nudos.map((n) => n.id)).toEqual(["n1"]);
    expect(pila.puedeDeshacer()).toBe(true);
    expect(pila.puedeRehacer()).toBe(false);

    pila.deshacer(aplicador);
    expect(modelo.nudos).toHaveLength(0);
    expect(pila.puedeDeshacer()).toBe(false);
    expect(pila.puedeRehacer()).toBe(true);

    pila.rehacer(aplicador);
    expect(modelo.nudos.map((n) => n.id)).toEqual(["n1"]);
    expect(pila.puedeDeshacer()).toBe(true);
    expect(pila.puedeRehacer()).toBe(false);
  });

  it("ejecutar un comando nuevo limpia la rama de rehacer", () => {
    const pila = new PilaUndo();
    pila.ejecutar(comandoAnadirNudo("n1"), aplicador);
    pila.deshacer(aplicador);
    expect(pila.puedeRehacer()).toBe(true);

    // base ahora es el modelo deshecho (vacio): nuevo comando sobre ese estado.
    pila.ejecutar(comandoAnadirNudo("n2"), aplicador);
    expect(pila.puedeRehacer()).toBe(false);
    expect(modelo.nudos.map((n) => n.id)).toEqual(["n2"]);
  });

  it("deshacer/rehacer sobre pila vacia son no-ops (no lanzan)", () => {
    const pila = new PilaUndo();
    expect(() => pila.deshacer(aplicador)).not.toThrow();
    expect(() => pila.rehacer(aplicador)).not.toThrow();
    expect(modelo).toEqual(crearModeloVacio());
  });

  it("limpiar() vacia ambas pilas", () => {
    const pila = new PilaUndo();
    pila.ejecutar(comandoAnadirNudo("n1"), aplicador);
    pila.deshacer(aplicador);
    pila.limpiar();
    expect(pila.puedeDeshacer()).toBe(false);
    expect(pila.puedeRehacer()).toBe(false);
  });
});

describe("PilaUndo · coalescing por coalesceKey", () => {
  // Construye un comando que fija la posicion de un nudo existente a (x,y), con la
  // misma coalesceKey por nudo (igual que moverNudo). El base es el modelo actual.
  function comandoMover(nudoId: string, x: number, y: number) {
    return crearComandoParches(
      modelo,
      "Mover nudo",
      (b) => {
        const n = b.nudos.find((nn) => nn.id === nudoId);
        if (n) {
          n.x = x;
          n.y = y;
        }
      },
      `moverNudo:${nudoId}`,
    ).comando;
  }

  beforeEach(() => {
    modelo = { ...crearModeloVacio(), nudos: [{ id: "n1", x: 0, y: 0 }] };
  });

  it("una rafaga del MISMO nudo = un solo paso de undo", () => {
    const pila = new PilaUndo();
    // Tres movimientos consecutivos del mismo nudo (misma coalesceKey).
    pila.ejecutar(comandoMover("n1", 1, 1), aplicador);
    pila.ejecutar(comandoMover("n1", 2, 2), aplicador);
    pila.ejecutar(comandoMover("n1", 3, 3), aplicador);
    expect(modelo.nudos[0]).toMatchObject({ x: 3, y: 3 });

    // Un unico deshacer devuelve a la posicion inicial de TODA la rafaga.
    pila.deshacer(aplicador);
    expect(modelo.nudos[0]).toMatchObject({ x: 0, y: 0 });
    expect(pila.puedeDeshacer()).toBe(false);
  });

  it("distintos nudos NO coalescen (distinta key = pasos separados)", () => {
    modelo = {
      ...crearModeloVacio(),
      nudos: [
        { id: "n1", x: 0, y: 0 },
        { id: "n2", x: 0, y: 0 },
      ],
    };
    const pila = new PilaUndo();
    pila.ejecutar(comandoMover("n1", 1, 1), aplicador);
    pila.ejecutar(comandoMover("n2", 5, 5), aplicador);

    // Deshacer solo revierte el ultimo (n2); n1 sigue movido.
    pila.deshacer(aplicador);
    expect(modelo.nudos.find((n) => n.id === "n2")).toMatchObject({ x: 0, y: 0 });
    expect(modelo.nudos.find((n) => n.id === "n1")).toMatchObject({ x: 1, y: 1 });
    expect(pila.puedeDeshacer()).toBe(true);
  });

  it("rehacer tras coalescing salta al estado FINAL de la rafaga", () => {
    const pila = new PilaUndo();
    pila.ejecutar(comandoMover("n1", 1, 1), aplicador);
    pila.ejecutar(comandoMover("n1", 9, 9), aplicador);
    pila.deshacer(aplicador);
    expect(modelo.nudos[0]).toMatchObject({ x: 0, y: 0 });
    pila.rehacer(aplicador);
    expect(modelo.nudos[0]).toMatchObject({ x: 9, y: 9 });
  });
});

describe("PilaUndo · cap de profundidad (maxDepth)", () => {
  // Comando sin coalesceKey: cada uno apila (no se fusiona), asi la pila crece.
  function comandoAnadirNudo(id: string) {
    return crearComandoParches(modelo, `Anadir ${id}`, (b) => {
      b.nudos.push({ id, x: 0, y: 0 });
    }).comando;
  }

  it("con maxDepth=3, ejecutar N>3 comandos solo deja deshacer 3 pasos", () => {
    const pila = new PilaUndo(3);
    // 5 comandos sin coalesceKey: la pila se cap a 3 (descarta los 2 mas antiguos).
    for (let i = 0; i < 5; i++) {
      pila.ejecutar(comandoAnadirNudo(`n${i}`), aplicador);
    }
    // Solo se pueden deshacer maxDepth=3 pasos; el 4º deshacer ya no tiene nada.
    let pasos = 0;
    while (pila.puedeDeshacer()) {
      pila.deshacer(aplicador);
      pasos++;
    }
    expect(pasos).toBe(3);
  });
});
