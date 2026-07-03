// Tests del ACOPLE paño<->portico (F3 corte 2, Fase 1). Proyecto `node` (sin DOM):
// acople.ts es puro. Cubre la deteccion geometrica (vigas de contorno, nudos
// acoplados, bordes completos), las subdivisiones por viga (union multi-paño,
// dedup, exclusion de extremos), la degradacion a aislado (<2 nudos), el
// determinismo bajo reordenado y la robustez ante referencias rotas (no lanza).
import { describe, it, expect } from "vitest";
import {
  calcularAcoples,
  pilaresInterioresBajoPano,
  vigasInterioresBajoPano,
} from "./acople";
import type { Modelo, Pano } from "../dominio";
import { SCHEMA_VERSION } from "../dominio";

const MATERIAL_BARRA = "S275";
const MATERIAL_LOSA = "HA-25";
const SECCION_OK = "sec-ipe";
const PERFIL_OK = "IPE300";

// Modelo base: dos plantas (cota 0 y 3), 4 nudos en rectangulo 4x3 en planta y un
// pilar sujeto (la sujecion no afecta al acople, pero mantiene el modelo "sano").
// Cada test añade vigas/paños sobre esta base.
function modeloBase(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [
      { id: "g1", nombre: "Grupo 1", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
    ],
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, grupoId: "g1" },
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, grupoId: "g1" },
    ],
    secciones: [
      { id: SECCION_OK, nombre: "IPE 300", tipo: "perfilMetalico", perfilId: PERFIL_OK },
    ],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 4, y: 0 },
      { id: "n3", x: 4, y: 3 },
      { id: "n4", x: 0, y: 3 },
    ],
    pilares: [
      {
        id: "pil1", nombre: "P1", x: 0, y: 0,
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION_OK, materialId: MATERIAL_BARRA, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
    ],
    vigas: [],
    panos: [],
    muros: [],
    cargas: [],
    hipotesis: [{ id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false }],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

// Viga entre dos nudos existentes, en p1 por defecto (la cota del paño).
function viga(
  id: string,
  nudoI: string,
  nudoJ: string,
  extra?: Partial<Modelo["vigas"][number]>,
): Modelo["vigas"][number] {
  return {
    id, nombre: id.toUpperCase(), plantaId: "p1", nudoI, nudoJ,
    seccionId: SECCION_OK, materialId: MATERIAL_BARRA,
    extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
    ...extra,
  };
}

// Paño losa 4x3 sobre los nudos n1..n4 de la base, tamMalla 1 (rejilla 4x3:
// 14 nudos de borde; arista inferior/superior 5 nudos, izquierda/derecha 4).
function pano(id: string, extra?: Partial<Pano>): Pano {
  return {
    id, nombre: id.toUpperCase(), tipo: "losa", plantaId: "p1",
    perimetro: ["n1", "n2", "n3", "n4"],
    espesor: 0.2, materialId: MATERIAL_LOSA, tamMalla: 1, bordeApoyo: "simple",
    ...extra,
  };
}

// Puntos (x,y) de obra de los nudos ACOPLADOS de un paño, para asserts geometricos
// independientes de los nombres PQ* (que dependen del indice del paño).
function puntosAcoplados(modelo: Modelo, panoId: string): { x: number; y: number }[] {
  const acople = calcularAcoples(modelo).porPano.get(panoId)!;
  const porNombre = new Map(acople.malla.nodos.map((n) => [n.name, n]));
  return [...acople.nodosAcoplados]
    .map((name) => porNombre.get(name)!)
    .map((n) => ({ x: n.x, y: n.z })) // obra: x = FEM X, y = FEM Z
    .sort((a, b) => a.x - b.x || a.y - b.y);
}

describe("calcularAcoples · deteccion de vigas de contorno", () => {
  it("viga exacta bajo una arista: acopla TODOS sus nudos (esquinas incluidas) y subdivide en los interiores", () => {
    const m = modeloBase();
    m.vigas = [viga("v-inf", "n1", "n2")]; // (0,0)-(4,0), arista inferior
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    const a = res.porPano.get("f1")!;
    // 5 nudos de la arista inferior (x=0..4, y=0), esquinas INCLUIDAS.
    expect(puntosAcoplados(m, "f1")).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
    ]);
    expect(a.acopleActivo).toBe(true);
    expect(a.bordeParcial).toBe(true); // el resto del borde no tiene viga
    expect(a.bordesCompletos).toBe(1); // solo la inferior
    // Subdivisiones: SOLO los nudos estrictamente interiores a la viga (x=1,2,3);
    // los extremos (0,0) y (4,0) ya son nudos de obra.
    expect(res.subdivisionesViga.get("v-inf")).toEqual([
      { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    ]);
  });

  it("contorno completo (4 vigas): todo el borde acoplado, 4 bordes completos, sin borde parcial", () => {
    const m = modeloBase();
    m.vigas = [
      viga("v-inf", "n1", "n2"),
      viga("v-der", "n2", "n3"),
      viga("v-sup", "n3", "n4"),
      viga("v-izq", "n4", "n1"),
    ];
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    const a = res.porPano.get("f1")!;
    expect(a.nodosAcoplados.size).toBe(14); // 2*(4+3) nudos de borde
    expect(a.acopleActivo).toBe(true);
    expect(a.bordeParcial).toBe(false);
    expect(a.bordesCompletos).toBe(4);
    // Aristas verticales (longitud 3): interiores en y=1,2.
    expect(res.subdivisionesViga.get("v-der")).toEqual([
      { x: 4, y: 1 }, { x: 4, y: 2 },
    ]);
    // v-sup va de n3(4,3) a n4(0,3): el orden de los puntos es por distancia a
    // nudoI (n3), es decir x descendente.
    expect(res.subdivisionesViga.get("v-sup")).toEqual([
      { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 },
    ]);
  });

  it("viga MAS LARGA que la arista: las esquinas del paño caen a mitad de vano y TAMBIEN subdividen", () => {
    const m = modeloBase();
    m.nudos.push({ id: "nA", x: -2, y: 0 }, { id: "nB", x: 6, y: 0 });
    m.vigas = [viga("v-larga", "nA", "nB")]; // (-2,0)-(6,0), cubre de sobra la inferior
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    const a = res.porPano.get("f1")!;
    expect(a.bordesCompletos).toBe(1);
    // Los 5 nudos de la arista (0..4) son ESTRICTAMENTE interiores a (-2,6):
    // todos acoplados Y todos subdividen (las esquinas del paño estan a mitad de
    // vano de la viga: sin nudo alli no habria acople).
    expect(res.subdivisionesViga.get("v-larga")).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
    ]);
  });

  it("dos vigas colineales en una arista: cada una subdivide en SUS interiores; el nudo compartido no subdivide", () => {
    const m = modeloBase();
    m.nudos.push({ id: "nM", x: 2, y: 0 });
    m.vigas = [viga("v-a", "n1", "nM"), viga("v-b", "nM", "n2")]; // (0..2) y (2..4)
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    const a = res.porPano.get("f1")!;
    expect(a.bordesCompletos).toBe(1); // entre ambas cubren la arista entera
    // x=2 es extremo de AMBAS vigas: nudo de obra existente, no subdivide ninguna.
    expect(res.subdivisionesViga.get("v-a")).toEqual([{ x: 1, y: 0 }]);
    expect(res.subdivisionesViga.get("v-b")).toEqual([{ x: 3, y: 0 }]);
  });

  it("excluidas: tirante, viga diagonal y viga de otra cota no acoplan", () => {
    const m = modeloBase();
    m.nudos.push({ id: "n5", x: 0, y: 1.5 });
    m.vigas = [
      viga("v-tir", "n1", "n2", { tirante: true }), // sobre la arista pero tirante
      viga("v-diag", "n1", "n3"), // diagonal
      viga("v-baja", "n1", "n2", { plantaId: "p0" }), // otra cota
    ];
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    const a = res.porPano.get("f1")!;
    expect(a.nodosAcoplados.size).toBe(0);
    expect(a.acopleActivo).toBe(false);
    expect(a.bordesCompletos).toBe(0);
    expect(res.subdivisionesViga.size).toBe(0);
  });

  it("viga colineal con la arista pero FUERA del paño (sin solape) no acopla", () => {
    const m = modeloBase();
    m.nudos.push({ id: "nA", x: 5, y: 0 }, { id: "nB", x: 9, y: 0 });
    m.vigas = [viga("v-fuera", "nA", "nB")]; // misma recta y=0, rango 5..9
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    expect(res.porPano.get("f1")!.nodosAcoplados.size).toBe(0);
    expect(res.subdivisionesViga.size).toBe(0);
  });
});

describe("calcularAcoples · degradacion y bordes", () => {
  it("1 solo nudo acoplado: el paño se DEGRADA a aislado (sin remap ni subdivisiones)", () => {
    const m = modeloBase();
    // Viga corta que solo cubre el nudo x=0 de la arista inferior (solape 0..0.5).
    m.nudos.push({ id: "nA", x: -1, y: 0 }, { id: "nB", x: 0.5, y: 0 });
    m.vigas = [viga("v-corta", "nA", "nB")];
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    const a = res.porPano.get("f1")!;
    expect(a.nodosAcoplados.size).toBe(1); // solo la esquina (0,0)
    expect(a.acopleActivo).toBe(false);
    expect(a.bordesCompletos).toBe(0);
    // Degradado: sus subdivisiones NO se emiten (la viga no se parte por un paño aislado).
    expect(res.subdivisionesViga.size).toBe(0);
  });

  it("esquina acoplada por la arista ADYACENTE cuenta para la completitud del borde", () => {
    const m = modeloBase();
    // v-inf cubre la inferior SIN la esquina (4,0) (rango 0..3.5); v-der cubre la
    // derecha entera, incluida esa esquina.
    m.nudos.push({ id: "nB", x: 3.5, y: 0 });
    m.vigas = [viga("v-inf", "n1", "nB"), viga("v-der", "n2", "n3")];
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    const a = res.porPano.get("f1")!;
    // La esquina (4,0) queda acoplada por v-der: la arista inferior tiene sus 5
    // nudos acoplados (0..3 por v-inf, 4 por v-der) => completa. La derecha tambien.
    expect(a.bordesCompletos).toBe(2);
    const puntos = puntosAcoplados(m, "f1");
    expect(puntos).toContainEqual({ x: 4, y: 0 });
  });
});

describe("calcularAcoples · union multi-paño", () => {
  it("dos paños que comparten viga: subdivisiones = UNION con dedup", () => {
    const m = modeloBase();
    // Paño B debajo del A: comparte la arista y=0 (viga v-comp).
    m.nudos.push({ id: "n5", x: 0, y: -3 }, { id: "n6", x: 4, y: -3 });
    m.vigas = [
      viga("v-comp", "n1", "n2"), // (0,0)-(4,0): arista compartida
      viga("v-supA", "n3", "n4"), // contorno del A para que acople
      viga("v-infB", "n5", "n6"), // contorno del B
    ];
    m.panos = [
      pano("fA"), // 4x3 arriba, tamMalla 1 -> interiores x=1,2,3
      pano("fB", { perimetro: ["n5", "n6", "n2", "n1"], tamMalla: 2 }), // 4x3 abajo, malla 2 -> interior x=2
    ];
    const res = calcularAcoples(m);
    expect(res.porPano.get("fA")!.acopleActivo).toBe(true);
    expect(res.porPano.get("fB")!.acopleActivo).toBe(true);
    // Union {1,2,3} (de fA) ∪ {2} (de fB) = {1,2,3}, dedup por celda, orden por
    // distancia a nudoI de v-comp (n1).
    expect(res.subdivisionesViga.get("v-comp")).toEqual([
      { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    ]);
  });
});

describe("calcularAcoples · determinismo y robustez", () => {
  it("reordenar paños, vigas y nudos de entrada no cambia el resultado", () => {
    const construir = (invertir: boolean): Modelo => {
      const m = modeloBase();
      m.nudos.push({ id: "n5", x: 0, y: -3 }, { id: "n6", x: 4, y: -3 });
      m.vigas = [
        viga("v-comp", "n1", "n2"),
        viga("v-supA", "n3", "n4"),
        viga("v-infB", "n5", "n6"),
      ];
      m.panos = [pano("fA"), pano("fB", { perimetro: ["n5", "n6", "n2", "n1"] })];
      if (invertir) {
        m.vigas.reverse();
        m.panos.reverse();
        m.nudos.reverse();
      }
      return m;
    };
    const a = calcularAcoples(construir(false));
    const b = calcularAcoples(construir(true));
    // Mismas subdivisiones byte a byte (mismas claves en el mismo orden).
    expect([...a.subdivisionesViga.entries()]).toEqual([...b.subdivisionesViga.entries()]);
    // Mismo acople por paño (sets comparados como listas ordenadas).
    for (const id of ["fA", "fB"]) {
      const pa = a.porPano.get(id)!;
      const pb = b.porPano.get(id)!;
      expect([...pa.nodosAcoplados].sort()).toEqual([...pb.nodosAcoplados].sort());
      expect(pa.acopleActivo).toBe(pb.acopleActivo);
      expect(pa.bordesCompletos).toBe(pb.bordesCompletos);
      expect(pa.indicePano).toBe(pb.indicePano);
    }
  });

  it("el indice del paño cuenta TODOS los paños ordenados por id (espejo del Paso 6c)", () => {
    const m = modeloBase();
    m.vigas = [viga("v-inf", "n1", "n2")];
    // "a-ret" (reticular, se salta) ordena ANTES que "b-losa": el indice de la losa
    // debe ser 1 (no 0) para que sus nombres PQ1-* coincidan con los del Paso 6c.
    m.panos = [pano("b-losa"), pano("a-ret", { tipo: "reticular" })];
    const res = calcularAcoples(m);
    expect(res.porPano.has("a-ret")).toBe(false);
    const losa = res.porPano.get("b-losa")!;
    expect(losa.indicePano).toBe(1);
    expect(losa.malla.nodos[0].name.startsWith("PQ1-")).toBe(true);
  });

  it("referencias rotas NO lanzan: el paño queda fuera de porPano", () => {
    const m = modeloBase();
    m.vigas = [viga("v-inf", "n1", "n2")];
    m.panos = [
      pano("f-rotoNudo", { perimetro: ["n1", "n2", "n3", "NO_EXISTE"] }),
      pano("f-rotoPlanta", { plantaId: "NO_EXISTE" }),
      pano("f-tresNudos", { perimetro: ["n1", "n2", "n3"] }),
    ];
    expect(() => calcularAcoples(m)).not.toThrow();
    const res = calcularAcoples(m);
    expect(res.porPano.size).toBe(0);
    expect(res.subdivisionesViga.size).toBe(0);
  });

  it("viga con extremos rotos no participa (no lanza)", () => {
    const m = modeloBase();
    m.vigas = [viga("v-rota", "n1", "NO_EXISTE"), viga("v-inf", "n1", "n2")];
    m.panos = [pano("f1")];
    expect(() => calcularAcoples(m)).not.toThrow();
    expect(calcularAcoples(m).subdivisionesViga.has("v-inf")).toBe(true);
  });

  it("modelo sin paños: resultado vacio", () => {
    const m = modeloBase();
    m.vigas = [viga("v-inf", "n1", "n2")];
    const res = calcularAcoples(m);
    expect(res.porPano.size).toBe(0);
    expect(res.subdivisionesViga.size).toBe(0);
  });
});

describe("pilaresInterioresBajoPano (OV-5)", () => {
  it("pilar estrictamente dentro que REMATA en la cota del paño -> detectado", () => {
    const m = modeloBase();
    m.pilares.push({
      id: "pil-int", nombre: "P2", x: 2, y: 1.5,
      plantaInicial: "p0", plantaFinal: "p1",
      seccionId: SECCION_OK, materialId: MATERIAL_BARRA, angulo: 0,
      vinculacionExterior: true, arranque: "empotrado",
    });
    m.panos = [pano("f1")];
    const ids = pilaresInterioresBajoPano(m, m.panos[0]).map((p) => p.id);
    expect(ids).toEqual(["pil-int"]);
  });

  it("pilar dentro en planta pero que NO alcanza la cota del paño -> no detectado", () => {
    const m = modeloBase();
    // Pilar de una unica planta inferior (0 -> 0): no llega a la cota 3 del paño.
    m.pilares.push({
      id: "pil-bajo", nombre: "P3", x: 2, y: 1.5,
      plantaInicial: "p0", plantaFinal: "p0",
      seccionId: SECCION_OK, materialId: MATERIAL_BARRA, angulo: 0,
      vinculacionExterior: true, arranque: "empotrado",
    });
    m.panos = [pano("f1")];
    expect(pilaresInterioresBajoPano(m, m.panos[0])).toEqual([]);
  });

  it("pilar SOBRE el borde o la esquina -> no es interior (lo gobiernan las reglas de borde)", () => {
    const m = modeloBase();
    m.pilares.push(
      {
        id: "pil-borde", nombre: "P4", x: 0, y: 1.5, // sobre la arista izquierda
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION_OK, materialId: MATERIAL_BARRA, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
      {
        id: "pil-esq", nombre: "P5", x: 4, y: 3, // esquina
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION_OK, materialId: MATERIAL_BARRA, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
    );
    m.panos = [pano("f1")];
    expect(pilaresInterioresBajoPano(m, m.panos[0])).toEqual([]);
  });

  it("pilar PASANTE que atraviesa la cota del paño -> detectado", () => {
    const m = modeloBase();
    m.plantas.push({ id: "p2", nombre: "Planta 2", cota: 6, altura: 3, grupoId: "g1" });
    m.pilares.push({
      id: "pil-pasante", nombre: "P6", x: 1, y: 1,
      plantaInicial: "p0", plantaFinal: "p2", // 0 -> 6, atraviesa la cota 3
      seccionId: SECCION_OK, materialId: MATERIAL_BARRA, angulo: 0,
      vinculacionExterior: true, arranque: "empotrado",
    });
    m.panos = [pano("f1")];
    expect(pilaresInterioresBajoPano(m, m.panos[0]).map((p) => p.id)).toEqual(["pil-pasante"]);
  });
});

describe("vigasInterioresBajoPano (TODO-2)", () => {
  it("viga embrochalada (de borde a borde por dentro) -> detectada", () => {
    const m = modeloBase();
    m.nudos.push({ id: "nA", x: 0, y: 1.5 }, { id: "nB", x: 4, y: 1.5 });
    m.vigas = [viga("v-mid", "nA", "nB")]; // cruza el paño por y=1.5
    m.panos = [pano("f1")];
    expect(vigasInterioresBajoPano(m, m.panos[0]).map((v) => v.id)).toEqual(["v-mid"]);
  });

  it("viga de CONTORNO (colineal con una arista) -> NO es interior", () => {
    const m = modeloBase();
    m.vigas = [viga("v-inf", "n1", "n2"), viga("v-der", "n2", "n3")];
    m.panos = [pano("f1")];
    expect(vigasInterioresBajoPano(m, m.panos[0])).toEqual([]);
  });

  it("tirante interior -> detectado (igual de ignorado por el acople)", () => {
    const m = modeloBase();
    m.nudos.push({ id: "nA", x: 1, y: 1 }, { id: "nB", x: 3, y: 2 });
    m.vigas = [viga("v-tir", "nA", "nB", { tirante: true })];
    m.panos = [pano("f1")];
    expect(vigasInterioresBajoPano(m, m.panos[0]).map((v) => v.id)).toEqual(["v-tir"]);
  });

  it("viga PARCIALMENTE dentro (un extremo fuera) -> detectada", () => {
    const m = modeloBase();
    m.nudos.push({ id: "nA", x: 2, y: 1.5 }, { id: "nB", x: 6, y: 1.5 });
    m.vigas = [viga("v-parcial", "nA", "nB")]; // el tramo 2..4 queda bajo el paño
    m.panos = [pano("f1")];
    expect(vigasInterioresBajoPano(m, m.panos[0]).map((v) => v.id)).toEqual(["v-parcial"]);
  });

  it("viga de otra cota o totalmente fuera -> no detectada", () => {
    const m = modeloBase();
    m.nudos.push({ id: "nA", x: 0, y: 1.5 }, { id: "nB", x: 4, y: 1.5 });
    m.nudos.push({ id: "nC", x: 5, y: 5 }, { id: "nD", x: 9, y: 5 });
    m.vigas = [
      viga("v-baja", "nA", "nB", { plantaId: "p0" }), // cruza pero en cota 0
      viga("v-lejos", "nC", "nD"), // fuera del rectangulo
    ];
    m.panos = [pano("f1")];
    expect(vigasInterioresBajoPano(m, m.panos[0])).toEqual([]);
  });

  it("diagonal que atraviesa el paño -> detectada (no acopla, seria ignorada)", () => {
    const m = modeloBase();
    m.vigas = [viga("v-diag", "n1", "n3")]; // (0,0)-(4,3), diagonal completa
    m.panos = [pano("f1")];
    expect(vigasInterioresBajoPano(m, m.panos[0]).map((v) => v.id)).toEqual(["v-diag"]);
  });
});
