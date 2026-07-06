// Test del modulo puro del arbol de obra (UX-3.2). Node-agnostico.
import { describe, expect, it } from "vitest";

import { crearModeloVacio } from "../../dominio";
import type { Modelo } from "../../dominio";
import { derivarArbol } from "./nodosArbol";

// Obra minima: dos plantas, un pilar PASANTE (ambas), una viga en p1 y una losa en
// p2. Los ids de seccion/material son opacos para el arbol (no se validan aqui).
function modeloDePrueba(): Modelo {
  const m = crearModeloVacio();
  m.plantas.push(
    { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
    { id: "p2", nombre: "Planta 2", cota: 6, altura: 3, categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
  );
  m.nudos.push(
    { id: "n1", x: 0, y: 0 },
    { id: "n2", x: 5, y: 0 },
    { id: "n3", x: 0, y: 5 },
    { id: "n4", x: 5, y: 5 },
  );
  m.pilares.push({
    id: "pil1",
    nombre: "P1",
    x: 0,
    y: 0,
    plantaInicial: "p1",
    plantaFinal: "p2",
    seccionId: "s1",
    materialId: "mat1",
    angulo: 0,
    vinculacionExterior: true,
    arranque: "empotrado",
  });
  m.vigas.push({
    id: "v1",
    nombre: "V1",
    plantaId: "p1",
    nudoI: "n1",
    nudoJ: "n2",
    seccionId: "s1",
    materialId: "mat1",
    extremoI: "empotrado",
    extremoJ: "empotrado",
    tirante: false,
  });
  m.panos.push({
    id: "f1",
    nombre: "F1",
    tipo: "losa",
    plantaId: "p2",
    perimetro: ["n1", "n2", "n4", "n3"],
    espesor: 0.25,
    materialId: "mat1",
    tamMalla: 0.5,
    bordeApoyo: "simple",
  });
  return m;
}

describe("derivarArbol (UX-3.2)", () => {
  it("plantas de mayor a menor cota, con sus elementos por tipo", () => {
    const arbol = derivarArbol(modeloDePrueba());
    expect(arbol.map((p) => p.id)).toEqual(["p2", "p1"]); // desc por cota

    // p2 (cota 6): el pilar pasante + la losa.
    expect(arbol[0]!.elementos).toEqual([
      { id: "pil1", tipo: "pilar", nombre: "P1" },
      { id: "f1", tipo: "pano", nombre: "F1" },
    ]);
    // p1 (cota 3): el pilar pasante (aparece en CADA planta de su tramo) + la viga.
    expect(arbol[1]!.elementos).toEqual([
      { id: "pil1", tipo: "pilar", nombre: "P1" },
      { id: "v1", tipo: "viga", nombre: "V1" },
    ]);
  });

  it("modelo vacio: sin plantas, arbol vacio", () => {
    expect(derivarArbol(crearModeloVacio())).toEqual([]);
  });
});
