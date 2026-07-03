// Tests de los helpers PUROS de ejes del discretizador (project node): mapearEjes y su
// espejo para reacciones mapearReaccionAObra. El foco es la INVARIANTE de identidad-inversa
// (D5): el mapeo FEM->obra de reacciones debe ser el inverso exacto de la construccion de
// ejes FEM de mapearEjes, para que la UI (TablaReacciones) no diverja del discretizador.
import { describe, it, expect } from "vitest";
import {
  mapearEjes,
  mapearReaccionAObra,
  cuantizar,
  mismaCoordenada,
  clavePosicion,
  TOL_NODO,
} from "./geometria";

// --- cuantizar / mismaCoordenada (F3.2): el atomo escalar del criterio de celda ---
// El acople paño<->portico compara cotas y coordenadas de arista con ESTE criterio;
// debe coincidir exactamente con el de clavePosicion (misma celda <=> misma clave).
describe("cuantizar / mismaCoordenada (criterio de celda, F3.2)", () => {
  it("dos coordenadas en la misma celda son 'la misma'; en celdas vecinas no", () => {
    // 3.0001 y 3.0004 redondean a la celda 3000; 3.0006 cae en la 3001.
    expect(mismaCoordenada(3.0001, 3.0004)).toBe(true);
    expect(mismaCoordenada(3.0004, 3.0006)).toBe(false);
    // El criterio NO es |Δ|<TOL: 2.9994 y 3.0003 distan 0.9 mm (< TOL_NODO) pero
    // caen en celdas distintas, 2999 vs 3000 (frontera de celda, [AUDITORIA M-4]).
    expect(mismaCoordenada(2.9994, 3.0003)).toBe(false);
  });

  it("coincide con clavePosicion componente a componente (no pueden divergir)", () => {
    const a: [number, number, number] = [1.2345, -0.0004, 7.7776];
    expect(clavePosicion(a, TOL_NODO)).toBe(
      `${cuantizar(a[0])}|${cuantizar(a[1])}|${cuantizar(a[2])}`,
    );
  });

  it("normaliza el -0 (una coordenada negativa minuscula no crea celda '-0')", () => {
    expect(Object.is(cuantizar(-0.0001), 0)).toBe(true);
    expect(mismaCoordenada(-0.0001, 0.0001)).toBe(true);
  });
});

describe("mapearEjes (convencion Y-up)", () => {
  it("planta (x,y) + cota -> [x, cota, y] (X horiz, Y vertical, Z horiz)", () => {
    expect(mapearEjes(2, 5, 3)).toEqual([2, 3, 5]);
  });
});

describe("mapearReaccionAObra · componentes en ejes de obra (D5)", () => {
  it("remapea fuerzas y momentos FEM a nombres de obra", () => {
    // rxnFem = [FX, FY, FZ, MX, MY, MZ] con valores distinguibles por componente.
    const r = mapearReaccionAObra([1, 2, 3, 4, 5, 6]);
    expect(r).toEqual({
      V: 2, // vertical = FY fem
      Hx: 1, // horizontal obra-X = FX fem
      Hy: 3, // horizontal obra-Y = FZ fem
      Mx: 4, // vuelco sobre obra-x = MX fem
      My: 6, // vuelco sobre obra-y = MZ fem
      Mv: 5, // torsor vertical = MY fem
    });
  });

  it("tolera un vector corto (rellena con 0 las componentes ausentes)", () => {
    // Un solo apoyo vertical: solo V no nula.
    expect(mapearReaccionAObra([0, 60])).toEqual({
      V: 60,
      Hx: 0,
      Hy: 0,
      Mx: 0,
      My: 0,
      Mv: 0,
    });
  });
});

// --- INVARIANTE golden: identidad-inversa (mapearReaccionAObra ∘ mapearEjes = id) --------
// Un vector FEM se construye poniendo cada eje de obra en su hueco FEM segun mapearEjes:
//   componente horizontal-X de obra  -> hueco FEM X (mapearEjes deja x_obra en X)
//   componente vertical de obra       -> hueco FEM Y (mapearEjes deja la cota en Y)
//   componente horizontal-Y de obra   -> hueco FEM Z (mapearEjes deja y_obra en Z)
// Si construimos rxnFem con ese orden (para fuerzas y, por separado, momentos) y le
// aplicamos mapearReaccionAObra, debemos recuperar EXACTAMENTE las componentes de obra
// originales: el helper es el inverso del mapeo de ejes de mapearEjes.
describe("mapearReaccionAObra · identidad-inversa con mapearEjes (golden D5)", () => {
  it("recupera las 6 componentes de obra tras construir el vector FEM con el orden de mapearEjes", () => {
    // Componentes de obra elegidas arbitrariamente pero distinguibles.
    const obra = { V: 11, Hx: 22, Hy: 33, Mx: 44, My: 55, Mv: 66 };

    // Construccion del vector FEM colocando cada eje de obra en el hueco FEM que le asigna
    // mapearEjes. Fuerzas: mapearEjes(Hx, Hy, V) = [Hx, V, Hy] = [FX, FY, FZ]. Momentos:
    // el vuelco sobre obra-x va a FEM-X, el vuelco sobre obra-y a FEM-Z y el torsor
    // vertical a FEM-Y -> mapearEjes(Mx, My, Mv) = [Mx, Mv, My] = [MX, MY, MZ].
    const [FX, FY, FZ] = mapearEjes(obra.Hx, obra.Hy, obra.V);
    const [MX, MY, MZ] = mapearEjes(obra.Mx, obra.My, obra.Mv);
    const rxnFem = [FX, FY, FZ, MX, MY, MZ];

    // El helper debe deshacer exactamente esa construccion.
    expect(mapearReaccionAObra(rxnFem)).toEqual(obra);
  });
});
