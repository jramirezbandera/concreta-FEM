// =============================================================================
// INTEGRACION del flujo de VIGAS (feature-12, T4.1): obra -> crearViga (comando
// real sobre modeloStore) -> discretizar(). Complementa los golden del
// discretizador (discretizador.casos.test.ts), que parten de fixtures con la viga
// ya armada por ids de nudo literales. Aqui ejercitamos el CAMINO REAL del
// usuario en "Entrada de vigas": introducir una viga por COORDENADAS de sus
// extremos y dejar que el comando resuelva los nudos (reusar uno cercano dentro de
// TOL_NODO o crear uno nuevo), todo en un paso de undo.
//
// La INVARIANTE que blinda este test (el "porque" del producto, CLAUDE.md §7):
//   - Dar los extremos de la viga en las MISMAS (x,y) que las cabezas de los
//     pilares (a <1mm) hace que el PORTICO CIERRE: la barra de la viga y los
//     pilares COMPARTEN los nudos FEM de las cabezas. Si esa union se rompiera
//     (nudos duplicados por proximidad), la estructura quedaria desconectada y el
//     solver veria un mecanismo. Este es el cierre geometrico que el discretizador
//     garantiza por snapping y que el comando crearViga respeta usando la misma
//     TOL_NODO.
//
// Corre en Node puro (project `node`): usa el modeloStore y discretizar() SIN
// arrancar Pyodide. La asercion es ESTRUCTURAL sobre el ModeloFEM (nudos i/j de la
// viga == nudos de las cabezas de pilar); no hace falta motor real para probar que
// el portico cierra.
// =============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { modeloStore, crearViga } from "../../src/estado";
import type { Modelo } from "../../src/dominio";
import { discretizarOExplotar } from "./_arnes";
import { fixtureBiapoyadaUDL, SECCION_GOLDEN, MATERIAL_GOLDEN } from "./_arnes";

// Geometria: dos pilares empotrados con vinculacion exterior en (0,0) y (5,0),
// subiendo de la cimentacion (p0, cota 0) a la planta de calculo (p1, cota 3). La
// viga se introducira entre esas dos cabezas dando los extremos por coordenadas.
const L = 5;
const COTA = 3;

// Modelo base: tomamos el fixture biapoyado (2 pilares empotrados + plantas +
// seccion/material/hipotesis validos) pero RETIRAMOS la viga, su carga y los nudos
// pre-armados: queremos que la viga (y sus nudos) nazcan del comando crearViga a
// partir de coordenadas, no de ids literales. Asi el test ejercita el flujo real.
function modeloSoloPilares(): Modelo {
  const base = fixtureBiapoyadaUDL({ L, q: 10, cota: COTA });
  return { ...base, vigas: [], cargas: [], nudos: [] };
}

describe("integracion vigas · crearViga por coordenadas cierra el portico", () => {
  beforeEach(() => {
    // Cargamos la obra base (resetea historial y resultados) antes de cada caso.
    modeloStore.getState().cargarModelo(modeloSoloPilares());
  });

  it("despacha crearViga sobre el store y deja la viga + sus 2 nudos resueltos en el modelo", () => {
    const base = modeloStore.getState().getModelo();
    expect(base.vigas).toHaveLength(0);
    expect(base.nudos).toHaveLength(0); // partimos sin nudos: los crea el comando

    // Extremos por COORDENADAS, coincidentes con las cabezas de pilar (0,0) y (5,0).
    // No hay nudos previos en esas coords, asi que el comando creara DOS nudos
    // nuevos en una sola receta (un paso de undo: borra ambos nudos y la viga).
    const comando = crearViga(base, {
      plantaId: "p1",
      i: { x: 0, y: 0 },
      j: { x: L, y: 0 },
      seccionId: SECCION_GOLDEN,
      materialId: MATERIAL_GOLDEN,
      extremoI: "articulado",
      extremoJ: "articulado",
      tirante: false,
    });
    modeloStore.getState().ejecutar(comando);

    const m = modeloStore.getState().getModelo();
    expect(m.vigas).toHaveLength(1);
    const viga = m.vigas[0];
    expect(viga.nombre).toBe("V1"); // primer nombre visible derivado
    // El comando resolvio cada extremo a un nudo (creado, pues no habia ninguno).
    expect(m.nudos).toHaveLength(2);
    const nudoI = m.nudos.find((n) => n.id === viga.nudoI);
    const nudoJ = m.nudos.find((n) => n.id === viga.nudoJ);
    expect(nudoI).toBeDefined();
    expect(nudoJ).toBeDefined();
    expect([nudoI!.x, nudoI!.y]).toEqual([0, 0]);
    expect([nudoJ!.x, nudoJ!.y]).toEqual([L, 0]);
    expect(viga.nudoI).not.toBe(viga.nudoJ); // dos extremos distintos
  });

  it("discretiza ok:true y la barra de la viga COMPARTE los nudos FEM de las cabezas de pilar (el portico CIERRA)", () => {
    const base = modeloStore.getState().getModelo();
    modeloStore.getState().ejecutar(
      crearViga(base, {
        plantaId: "p1",
        i: { x: 0, y: 0 },
        j: { x: L, y: 0 },
        seccionId: SECCION_GOLDEN,
        materialId: MATERIAL_GOLDEN,
        extremoI: "articulado",
        extremoJ: "articulado",
        tirante: false,
      }),
    );

    const modelo = modeloStore.getState().getModelo();
    // discretizarOExplotar lanza con detalle si ok:false (seria un fallo de cierre
    // o referencia rota). Que NO lance ya prueba ok:true; ademas aseveramos abajo.
    const fem = discretizarOExplotar(modelo);

    // Pese a 2 pilares (4 puntos: 2 pies + 2 cabezas) + 2 extremos de viga, el
    // snapping geometrico fusiona cada extremo de viga con la cabeza del pilar en
    // su misma (x, cota): 4 nodos FEM, no 6. Si fueran 6, el portico NO cerraria.
    expect(fem.nodes).toHaveLength(4);

    // Localizamos la barra de la viga: la unica barra HORIZONTAL (ambos extremos a
    // la cota de la planta, Y=COTA), frente a los pilares (verticales, de Y=0 a Y=COTA).
    const coordY = (name: string) => fem.nodes.find((n) => n.name === name)!.y;
    const viga = fem.members.find(
      (mb) => coordY(mb.i) === COTA && coordY(mb.j) === COTA,
    );
    expect(viga).toBeDefined(); // existe UNA barra (member) para la viga

    // Los nodos i/j de la viga son EXACTAMENTE los nodos de las cabezas de pilar:
    // cada pilar es una barra vertical cuyo nodo superior (Y=COTA) debe coincidir
    // con un extremo de la viga. Eso es el portico cerrado por nudos compartidos.
    const cabezasPilar = new Set(
      fem.members
        .filter((mb) => mb !== viga) // los dos pilares
        .map((mb) => (coordY(mb.i) === COTA ? mb.i : mb.j)), // su nodo superior
    );
    expect(cabezasPilar.size).toBe(2); // dos cabezas distintas
    // Los extremos de la viga estan, ambos, entre las cabezas de pilar.
    expect(cabezasPilar.has(viga!.i)).toBe(true);
    expect(cabezasPilar.has(viga!.j)).toBe(true);
    // Y juntos cubren ambas cabezas (la viga une LAS DOS, no la misma dos veces).
    expect(new Set([viga!.i, viga!.j])).toEqual(cabezasPilar);
  });
});
