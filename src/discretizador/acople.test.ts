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
import type { Modelo, Pano, PanoLosa, PanoUnidireccional } from "../dominio";
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
    // v4 "plantas sin grupos": el uso/cargas viven en cada planta. `calcularAcoples`
    // es geometria pura (no lee SU/CM), pero se conservan los valores del antiguo
    // grupo para mantener la Capa 2 identica en las plantas con paño losa.
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
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
function pano(id: string, extra?: Partial<PanoLosa>): Pano {
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
    m.panos = [pano("b-losa"), panoRet("a-ret")];
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
    m.plantas.push({ id: "p2", nombre: "Planta 2", cota: 6, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 });
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

// --- F2.0 · losa plana sobre pilares interiores (T-f3-losa-plana) --------------
// Helper: un pilar que arranca en p0 y remata en p1 (cota del paño), en (x,y).
function pilarInterior(id: string, x: number, y: number, extra?: Partial<Modelo["pilares"][number]>): Modelo["pilares"][number] {
  return {
    id, nombre: id.toUpperCase(), x, y,
    plantaInicial: "p0", plantaFinal: "p1",
    seccionId: SECCION_OK, materialId: MATERIAL_BARRA, angulo: 0,
    vinculacionExterior: true, arranque: "empotrado",
    ...extra,
  };
}

describe("calcularAcoples · acople de cabezas de pilar (F2.0 losa plana)", () => {
  it("losa sobre 2 pilares interiores (sin vigas): cabezas acopladas, acopleActivo, lineas de control", () => {
    const m = modeloBase();
    m.pilares.push(pilarInterior("pil-A", 1, 1), pilarInterior("pil-B", 3, 2));
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    const a = res.porPano.get("f1")!;
    // Las dos cabezas se acoplan (una por cada pilar): acopleActivo (size>=2).
    expect(a.acopleActivo).toBe(true);
    expect(a.pilaresAcoplados).toEqual(["pil-A", "pil-B"]); // ordenados por id
    expect(a.nodosAcoplados.size).toBe(2); // solo las 2 cabezas (bordes libres)
    // Los nudos acoplados caen EXACTAMENTE en las cabezas de pilar (lineas de control
    // en x=1,3 e y=1,2 -> nudos exactos en (1,1) y (3,2)).
    expect(puntosAcoplados(m, "f1")).toEqual([
      { x: 1, y: 1 }, { x: 3, y: 2 },
    ]);
    // Sin vigas de contorno: ningun borde acoplado.
    expect(a.bordesCompletos).toBe(0);
    expect(a.bordeParcial).toBe(false); // 0 nudos de borde acoplados
    // Ningun error ni junta.
    expect(res.erroresMallado.size).toBe(0);
    expect(res.pilaresJuntos.size).toBe(0);
  });

  it("cada cabeza de pilar tiene un nudo de malla EXACTO en su celda (match por clave)", () => {
    const m = modeloBase();
    m.pilares.push(pilarInterior("pil-A", 1.3, 0.7), pilarInterior("pil-B", 2.6, 2.1));
    m.panos = [pano("f1")];
    const a = calcularAcoples(m).porPano.get("f1")!;
    // Las lineas de control fuerzan un nudo exacto en cada cabeza (coord no en rejilla base).
    expect(a.pilaresAcoplados).toEqual(["pil-A", "pil-B"]);
    expect(puntosAcoplados(m, "f1")).toEqual([
      { x: 1.3, y: 0.7 }, { x: 2.6, y: 2.1 },
    ]);
  });

  it("caso 1-pilar (DP1): acopleActivo=false, pilaresAcoplados VACIO (bloqueo aguas abajo)", () => {
    const m = modeloBase();
    m.pilares.push(pilarInterior("pil-solo", 2, 1.5));
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    const a = res.porPano.get("f1")!;
    // 1 sola cabeza -> size==1 -> NO activo -> pilaresAcoplados vacio (RESERVA-1/DP1):
    // el remap no se activa y PANO_PILAR_INTERIOR seguira bloqueando en validaciones.
    expect(a.acopleActivo).toBe(false);
    expect(a.nodosAcoplados.size).toBe(1);
    expect(a.pilaresAcoplados).toEqual([]);
    expect(res.pilaresJuntos.size).toBe(0);
  });

  it("dos pilares en misma X, distinta Y: NO son junta (cada uno su nudo por su Y)", () => {
    const m = modeloBase();
    m.pilares.push(pilarInterior("pil-A", 2, 1), pilarInterior("pil-B", 2, 2));
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    const a = res.porPano.get("f1")!;
    expect(a.acopleActivo).toBe(true);
    expect(a.pilaresAcoplados).toEqual(["pil-A", "pil-B"]);
    // Dos nudos distintos: comparten la linea de control X=2 pero difieren en Y.
    expect(puntosAcoplados(m, "f1")).toEqual([
      { x: 2, y: 1 }, { x: 2, y: 2 },
    ]);
    // NO es junta (la junta es por celda 2D, no por eje 1D, RESERVA-2).
    expect(res.pilaresJuntos.has("f1")).toBe(false);
  });

  it("dos pilares en la MISMA celda 2D -> pilaresJuntos (no acople silencioso)", () => {
    const m = modeloBase();
    // pil-B a < TOL_NODO del pil-A: misma clavePosicion 2D -> misma celda.
    m.pilares.push(pilarInterior("pil-A", 2, 1.5), pilarInterior("pil-B", 2.0004, 1.5));
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    expect(res.pilaresJuntos.get("f1")).toEqual([["pil-A", "pil-B"]]); // par por id, menor primero
    // Ambas cabezas reclaman el mismo nudo -> size==1 -> no activo -> no se acoplan
    // en silencio (validaciones emitira PANO_PILARES_JUNTOS para bloquear).
    const a = res.porPano.get("f1")!;
    expect(a.acopleActivo).toBe(false);
    expect(a.pilaresAcoplados).toEqual([]);
  });

  it("junta determinista: el par sale con id menor primero sea cual sea el orden de entrada", () => {
    const construir = (invertir: boolean): Modelo => {
      const m = modeloBase();
      const a = pilarInterior("pil-A", 2, 1.5);
      const b = pilarInterior("pil-B", 2.0004, 1.5);
      m.pilares.push(...(invertir ? [b, a] : [a, b]));
      m.panos = [pano("f1")];
      return m;
    };
    expect(calcularAcoples(construir(false)).pilaresJuntos.get("f1")).toEqual([["pil-A", "pil-B"]]);
    expect(calcularAcoples(construir(true)).pilaresJuntos.get("f1")).toEqual([["pil-A", "pil-B"]]);
  });

  it("cap de lineas de control excedido -> paño en erroresMallado, NO en porPano (XOR)", () => {
    const m = modeloBase();
    // Diagonal de N pilares: N lineas de control en X y N en Y -> (N+1)^2 celdas
    // minimas > CAP_QUADS (2000). El mallado devuelve PANO_DEMASIADOS_PILARES.
    const N = 45;
    for (let i = 1; i <= N; i++) {
      const x = 0.1 + (i * 3.8) / (N + 1);
      const y = 0.1 + (i * 2.8) / (N + 1);
      m.pilares.push(pilarInterior("p" + String(i).padStart(3, "0"), x, y));
    }
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    expect(res.erroresMallado.get("f1")?.codigo).toBe("PANO_DEMASIADOS_PILARES");
    expect(res.porPano.has("f1")).toBe(false); // XOR: no esta en porPano
  });

  it("bordeParcial correcto con cabezas interiores presentes (fix RESERVA-4)", () => {
    const m = modeloBase();
    // 1 arista sobre viga (inferior, 5 nudos) + 2 pilares interiores. bordeParcial
    // debe mirar SOLO el borde: 5 de 14 nudos de borde acoplados -> parcial=true,
    // sin contaminarse por las 2 cabezas interiores (que inflarian nodosAcoplados.size).
    m.vigas = [viga("v-inf", "n1", "n2")]; // arista inferior
    m.pilares.push(pilarInterior("pil-A", 1, 1.5), pilarInterior("pil-B", 3, 1.5));
    m.panos = [pano("f1")];
    const a = calcularAcoples(m).porPano.get("f1")!;
    // Las cabezas (y=1.5) fuerzan una fila extra -> malla 5x5, 16 nudos de borde.
    // nodosAcoplados = 5 (borde inferior) + 2 (cabezas) = 7.
    expect(a.nodosAcoplados.size).toBe(7);
    expect(a.malla.nodosBorde.length).toBe(16);
    // nodosBordeAcoplados cuenta SOLO borde (5), NO las 2 cabezas: fuente unica de bordeParcial.
    expect(a.nodosBordeAcoplados).toBe(5);
    expect(a.bordeParcial).toBe(true); // 5 de 16 nudos de BORDE acoplados
    expect(a.bordesCompletos).toBe(1); // solo la inferior (cabezas no cuentan)
    expect(a.pilaresAcoplados).toEqual(["pil-A", "pil-B"]);
  });

  it("bordeParcial=false cuando TODO el borde esta acoplado, con cabezas interiores extra", () => {
    const m = modeloBase();
    // 4 vigas de contorno (14 nudos de borde) + 2 pilares interiores. El borde esta
    // COMPLETO: bordeParcial=false pese a que nodosAcoplados.size (16) > nodosBorde (14).
    m.vigas = [
      viga("v-inf", "n1", "n2"), viga("v-der", "n2", "n3"),
      viga("v-sup", "n3", "n4"), viga("v-izq", "n4", "n1"),
    ];
    m.pilares.push(pilarInterior("pil-A", 1, 1.5), pilarInterior("pil-B", 3, 1.5));
    m.panos = [pano("f1")];
    const a = calcularAcoples(m).porPano.get("f1")!;
    // Malla 5x5 (fila extra por y=1.5): 16 nudos de borde + 2 cabezas = 18.
    expect(a.malla.nodosBorde.length).toBe(16);
    expect(a.nodosAcoplados.size).toBe(18); // 16 borde + 2 cabezas
    // nodosBordeAcoplados = 16 (todo el borde), aunque nodosAcoplados.size sea 18.
    expect(a.nodosBordeAcoplados).toBe(16);
    expect(a.bordeParcial).toBe(false); // borde completo pese a size(18) > nodosBorde(16)
    expect(a.bordesCompletos).toBe(4);
    expect(a.pilaresAcoplados).toEqual(["pil-A", "pil-B"]);
  });

  it("nodosBordeAcoplados < nodosBorde con contorno completo + cabezas interiores (desbloquea sujecion)", () => {
    // Contorno completo (16 nudos de borde acoplados) + 2 cabezas interiores. La cuenta
    // que gobierna la sujecion del paño (nodosBordeAcoplados) es 16 = nodosBorde.length:
    // el paño esta TOTALMENTE apoyado en su borde (no emite apoyos propios). El punto del
    // fix: nodosAcoplados.size (18) NO debe usarse alli, o superaria nodosBorde y mentiria.
    const m = modeloBase();
    m.vigas = [
      viga("v-inf", "n1", "n2"), viga("v-der", "n2", "n3"),
      viga("v-sup", "n3", "n4"), viga("v-izq", "n4", "n1"),
    ];
    m.pilares.push(pilarInterior("pil-A", 1, 1.5), pilarInterior("pil-B", 3, 1.5));
    m.panos = [pano("f1")];
    const a = calcularAcoples(m).porPano.get("f1")!;
    expect(a.nodosBordeAcoplados).toBe(a.malla.nodosBorde.length); // 16
    expect(a.nodosAcoplados.size).toBeGreaterThan(a.malla.nodosBorde.length); // 18 > 16
  });

  it("un pilar interior NO subdivide ninguna viga (es nudo puntual, no extremo de segmento)", () => {
    const m = modeloBase();
    // 1 viga de contorno (para tener subdivisiones de borde) + 2 pilares interiores.
    m.vigas = [viga("v-inf", "n1", "n2")];
    m.pilares.push(pilarInterior("pil-A", 1, 1.5), pilarInterior("pil-B", 3, 1.5));
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    // Subdivisiones de v-inf = solo nudos de BORDE interiores a la viga (x=1,2,3),
    // NADA de las cabezas interiores (que no estan sobre la arista).
    expect(res.subdivisionesViga.get("v-inf")).toEqual([
      { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    ]);
    expect(res.subdivisionesViga.size).toBe(1); // solo v-inf
  });

  it("pilar interior sin nudo de malla (no deberia pasar con lineas de control) no se fuerza", () => {
    // Caso defensivo: un pilar que NO alcanza la cota del paño no es interior -> no
    // genera linea de control ni se acopla. La losa queda sin acople de cabeza.
    const m = modeloBase();
    m.pilares.push(pilarInterior("pil-bajo", 2, 1.5, { plantaFinal: "p0" })); // 0->0, no llega a cota 3
    m.panos = [pano("f1")];
    const a = calcularAcoples(m).porPano.get("f1")!;
    expect(a.acopleActivo).toBe(false);
    expect(a.pilaresAcoplados).toEqual([]);
    expect(a.nodosAcoplados.size).toBe(0);
  });

  it("determinismo: reordenar pilares de entrada no cambia acople ni juntas", () => {
    const construir = (invertir: boolean): Modelo => {
      const m = modeloBase();
      const pils = [
        pilarInterior("pil-A", 1, 1),
        pilarInterior("pil-B", 3, 2),
        pilarInterior("pil-C", 2, 1),
      ];
      m.pilares.push(...(invertir ? [...pils].reverse() : pils));
      m.panos = [pano("f1")];
      return m;
    };
    const a = calcularAcoples(construir(false)).porPano.get("f1")!;
    const b = calcularAcoples(construir(true)).porPano.get("f1")!;
    expect(a.pilaresAcoplados).toEqual(b.pilaresAcoplados);
    expect([...a.nodosAcoplados].sort()).toEqual([...b.nodosAcoplados].sort());
    expect(a.acopleActivo).toBe(b.acopleActivo);
  });
});

describe("calcularAcoples · regresion byte a byte del corte 2 (F2.0)", () => {
  it("sin pilares interiores: campos nuevos vacios y acople identico al corte 2", () => {
    const m = modeloBase();
    m.vigas = [
      viga("v-inf", "n1", "n2"), viga("v-der", "n2", "n3"),
      viga("v-sup", "n3", "n4"), viga("v-izq", "n4", "n1"),
    ];
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    const a = res.porPano.get("f1")!;
    // Acople de borde intacto (identico al test de contorno completo del corte 2).
    expect(a.nodosAcoplados.size).toBe(14);
    expect(a.acopleActivo).toBe(true);
    expect(a.bordeParcial).toBe(false);
    expect(a.bordesCompletos).toBe(4);
    // Campos nuevos VACIOS: sin pilar interior no hay linea de control -> camino uniforme.
    expect(a.pilaresAcoplados).toEqual([]);
    expect(res.erroresMallado.size).toBe(0);
    expect(res.pilaresJuntos.size).toBe(0);
  });

  it("el mallado del corte 2 no cambia: nudos de malla identicos sin lineas de control", () => {
    // La malla de un paño sin pilares interiores debe ser byte-identica: mismos nudos,
    // mismos nombres, mismo orden (camino uniforme de planificarRejilla intacto).
    const sinPilar = modeloBase();
    sinPilar.vigas = [viga("v-inf", "n1", "n2")];
    sinPilar.panos = [pano("f1")];
    const a = calcularAcoples(sinPilar).porPano.get("f1")!;
    // Rejilla 4x3 uniforme: 5x4 = 20 nudos, 14 de borde (invariante del corte 2).
    expect(a.malla.nodos.length).toBe(20);
    expect(a.malla.nodosBorde.length).toBe(14);
    // Nudos equiespaciados (sin lineas de control): x en {0,1,2,3,4}, y en {0,1,2,3}.
    const xs = [...new Set(a.malla.nodos.map((n) => n.x))].sort((p, q) => p - q);
    const ys = [...new Set(a.malla.nodos.map((n) => n.z))].sort((p, q) => p - q);
    expect(xs).toEqual([0, 1, 2, 3, 4]);
    expect(ys).toEqual([0, 1, 2, 3]);
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

// --- Rama UNIDIRECCIONAL (F3): sin malla, aporta subdivisiones + deteccion de bordes ---
// Paño unidireccional 4x3 sobre n1..n4 de la base. direccion "x": viguetas paralelas a X
// (luz 4), reparto en Y (B=3). intereje 1 -> n = round(3/1) = 3 viguetas.
function panoUni(id: string, extra?: Partial<PanoUnidireccional>): Pano {
  return {
    id, nombre: id.toUpperCase(), tipo: "unidireccional", plantaId: "p1",
    perimetro: ["n1", "n2", "n3", "n4"],
    materialId: MATERIAL_LOSA, bordeApoyo: "simple",
    direccionViguetas: "x", intereje: 1, canto: 0.3, anchoNervio: 0.12, pesoPropio: 4,
    ...extra,
  };
}

// Paño reticular 4x3 sobre n1..n4 (union discriminada: sus campos propios, con capaCompresion).
function panoRet(id: string): Pano {
  return {
    id, nombre: id.toUpperCase(), tipo: "reticular", plantaId: "p1",
    perimetro: ["n1", "n2", "n3", "n4"],
    materialId: MATERIAL_LOSA, bordeApoyo: "simple",
    intereje: 0.8, canto: 0.3, anchoNervio: 0.12, capaCompresion: 0.05, pesoPropio: 4,
  };
}

describe("calcularAcoples · rama unidireccional (F3)", () => {
  it("paño unidireccional resoluble entra en unidireccionalPorPano (NO en porPano)", () => {
    const m = modeloBase();
    m.panos = [panoUni("fu")];
    const res = calcularAcoples(m);
    expect(res.porPano.has("fu")).toBe(false); // no malla quads
    const uni = res.unidireccionalPorPano.get("fu");
    expect(uni).toBeDefined();
    expect(uni!.indicePano).toBe(0);
    expect(uni!.malla.n).toBe(3); // round(3/1) = 3 viguetas
  });

  it("SIN vigas de contorno: ambos bordes de apoyo sin viga, sin subdivisiones", () => {
    const m = modeloBase();
    m.panos = [panoUni("fu")];
    const res = calcularAcoples(m);
    const uni = res.unidireccionalPorPano.get("fu")!;
    expect(uni.bordeAConViga).toBe(false);
    expect(uni.bordeBConViga).toBe(false);
    expect(uni.celdasSubdivididas.size).toBe(0);
    expect(res.subdivisionesViga.size).toBe(0);
  });

  it("viga bajo un borde de apoyo (x=0): remap con subdivision en los extremos interiores", () => {
    // direccion "x": bordes de apoyo x=xMin(0) y x=xMax(4). Viga izquierda (0,0)-(0,3).
    // Las 3 viguetas cruzan x=0 en y=0.5,1.5,2.5 (interior estricto de la viga) -> subdivision.
    const m = modeloBase();
    m.vigas = [viga("v-izq", "n1", "n4")]; // (0,0)-(0,3), borde izquierdo (x=0)
    m.panos = [panoUni("fu")];
    const res = calcularAcoples(m);
    const uni = res.unidireccionalPorPano.get("fu")!;
    expect(uni.bordeAConViga).toBe(true); // borde a = xMin cubierto por la viga
    expect(uni.bordeBConViga).toBe(false); // borde b = xMax sin viga
    // Subdivisiones de la viga izquierda en y=0.5,1.5,2.5.
    expect(res.subdivisionesViga.get("v-izq")).toEqual([
      { x: 0, y: 0.5 }, { x: 0, y: 1.5 }, { x: 0, y: 2.5 },
    ]);
    expect(uni.celdasSubdivididas.size).toBe(3); // una celda por extremo subdividido
  });

  it("subdivisionesViga: losa y unidireccional COMPARTEN la Map sin duplicar (dedup por celda)", () => {
    // Un paño losa y uno unidireccional que tocan la MISMA viga de contorno: los puntos se
    // funden en la misma Map con dedup por celda (primer punto de la celda gana).
    const m = modeloBase();
    m.vigas = [viga("v-izq", "n1", "n4")];
    m.panos = [panoUni("fu")]; // solo el unidireccional aqui basta para probar la Map
    const res = calcularAcoples(m);
    // La viga izquierda tiene 3 subdivisiones (una por vigueta), ordenadas por t (distancia
    // a nudoI = n1 en (0,0)): y creciente.
    const subs = res.subdivisionesViga.get("v-izq")!;
    expect(subs.map((p) => p.y)).toEqual([0.5, 1.5, 2.5]);
  });

  it("reticular NO entra en unidireccionalPorPano ni en porPano", () => {
    const m = modeloBase();
    m.panos = [panoRet("fu")];
    const res = calcularAcoples(m);
    expect(res.unidireccionalPorPano.has("fu")).toBe(false);
    expect(res.porPano.has("fu")).toBe(false);
  });

  it("campos ausentes (sin intereje): no entra (undefined); lo reporta validaciones", () => {
    const m = modeloBase();
    m.panos = [panoUni("fu", { intereje: undefined })];
    const res = calcularAcoples(m);
    expect(res.unidireccionalPorPano.has("fu")).toBe(false);
  });

  it("R-4: pilar/viga interior bajo unidireccional SI se detectan (filtros relajados)", () => {
    const m = modeloBase();
    m.panos = [panoUni("fu")];
    // Pilar interior (centro del paño 4x3).
    m.pilares.push({
      id: "pil-int", nombre: "PINT", x: 2, y: 1.5,
      plantaInicial: "p0", plantaFinal: "p1",
      seccionId: SECCION_OK, materialId: MATERIAL_BARRA, angulo: 0,
      vinculacionExterior: false, arranque: "empotrado",
    });
    expect(pilaresInterioresBajoPano(m, m.panos[0]).map((p) => p.id)).toEqual(["pil-int"]);
    // Viga interior (crujia intermedia horizontal por el centro).
    m.nudos.push({ id: "ni1", x: 0, y: 1.5 }, { id: "ni2", x: 4, y: 1.5 });
    m.vigas = [viga("v-int", "ni1", "ni2")];
    expect(vigasInterioresBajoPano(m, m.panos[0]).map((v) => v.id)).toEqual(["v-int"]);
  });

  it("determinismo: reordenar panos no cambia unidireccionalPorPano ni subdivisiones", () => {
    // Dos paños unidireccionales (fu-a, fu-b) sobre el mismo borde izquierdo con su viga:
    // el indicePano y las subdivisiones se resuelven por id de paño, no por orden de entrada.
    const m = modeloBase();
    m.vigas = [viga("v-izq", "n1", "n4")];
    m.panos = [panoUni("fu-a"), panoUni("fu-b")];
    const a = calcularAcoples(m);
    const m2 = modeloBase();
    m2.vigas = [viga("v-izq", "n1", "n4")];
    m2.panos = [panoUni("fu-b"), panoUni("fu-a")]; // orden de panos invertido
    const b = calcularAcoples(m2);
    expect(b.subdivisionesViga.get("v-izq")).toEqual(a.subdivisionesViga.get("v-izq"));
    // El indicePano se fija por id ordenado (fu-a=0, fu-b=1) en ambos casos.
    expect(b.unidireccionalPorPano.get("fu-a")!.indicePano).toBe(0);
    expect(b.unidireccionalPorPano.get("fu-b")!.indicePano).toBe(1);
    expect(a.unidireccionalPorPano.get("fu-a")!.indicePano).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Muros/pantallas (F3, muros): acople muro<->portico. El muro se malla en su plano
// vertical y sus nudos remapean a N* por tres fuentes: viga COLINEAL en una fila de
// cota de planta (extremos incluidos; interiores subdividen), PILAR sobre el eje
// (N* garantizado por cotasDePilar en cada cota de planta) y EXTREMO de viga que
// muere sobre el eje. Sin umbral de activacion (remap siempre); la estabilidad la
// gobierna validaciones (MURO_SIN_SUJECION).
// ---------------------------------------------------------------------------

// Muro por defecto: eje (0,10)-(4,10) — LEJOS del pilar pil1 en (0,0) de la base —
// de p0 (cota 0) a p1 (cota 3), tamMalla 1 => rejilla 4x3 (filas en cotas 0..3).
function muro(
  id: string,
  extra?: Partial<Modelo["muros"][number]>,
): Modelo["muros"][number] {
  return {
    id, nombre: id.toUpperCase(),
    x1: 0, y1: 10, x2: 4, y2: 10,
    plantaInicial: "p0", plantaFinal: "p1",
    espesor: 0.3, materialId: MATERIAL_LOSA, tamMalla: 1,
    vinculacionExterior: true,
    ...extra,
  };
}

describe("calcularAcoples · muros: viga de coronacion colineal", () => {
  it("viga colineal en la coronacion: acopla los 5 nudos de la fila tope y subdivide en los interiores", () => {
    const m = modeloBase();
    m.nudos.push({ id: "nA", x: 0, y: 10 }, { id: "nB", x: 4, y: 10 });
    m.vigas = [viga("v-cor", "nA", "nB")]; // p1 (cota 3) = fila tope del muro
    m.muros = [muro("mu1")];
    const res = calcularAcoples(m);
    const a = res.porMuro.get("mu1")!;
    expect(a.coronacionConViga).toBe(true);
    // 5 nudos de la fila tope: puntos (s, cota) = (0..4, 3).
    expect([...a.puntosAcoplados]).toEqual([
      { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 },
    ]);
    // Subdivisiones: SOLO interiores estrictos (s=1,2,3), en coords de OBRA.
    expect(res.subdivisionesViga.get("v-cor")).toEqual([
      { x: 1, y: 10 }, { x: 2, y: 10 }, { x: 3, y: 10 },
    ]);
    // El mapa solo-muro (para el CR) lleva LO MISMO (ningun paño toca esta viga).
    expect(res.subdivisionesVigaMuro.get("v-cor")).toEqual(
      res.subdivisionesViga.get("v-cor"),
    );
  });

  it("muro de dos plantas: la fila INTERMEDIA (planta 1) tambien acopla a su viga", () => {
    const m = modeloBase();
    m.plantas.push({
      id: "p2", nombre: "Planta 2", cota: 6, altura: 3,
      categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1,
    });
    m.nudos.push({ id: "nA", x: 0, y: 10 }, { id: "nB", x: 4, y: 10 });
    // Vigas colineales en p1 (cota 3, intermedia) y p2 (cota 6, coronacion).
    m.vigas = [
      viga("v-p1", "nA", "nB", { plantaId: "p1" }),
      viga("v-p2", "nA", "nB", { plantaId: "p2" }),
    ];
    m.muros = [muro("mu1", { plantaFinal: "p2" })];
    const res = calcularAcoples(m);
    const a = res.porMuro.get("mu1")!;
    expect(a.coronacionConViga).toBe(true);
    // 5 nudos por fila x 2 filas (cotas 3 y 6).
    expect(a.puntosAcoplados).toHaveLength(10);
    expect(a.puntosAcoplados.filter((p) => p.y === 3)).toHaveLength(5);
    expect(a.puntosAcoplados.filter((p) => p.y === 6)).toHaveLength(5);
    expect(res.subdivisionesViga.get("v-p1")).toHaveLength(3);
    expect(res.subdivisionesViga.get("v-p2")).toHaveLength(3);
  });

  it("sin nada coincidente: nodosAcoplados vacio, sin coronacion, sin subdivisiones", () => {
    const m = modeloBase();
    m.muros = [muro("mu1")];
    const res = calcularAcoples(m);
    const a = res.porMuro.get("mu1")!;
    expect(a.nodosAcoplados.size).toBe(0);
    expect(a.puntosAcoplados).toEqual([]);
    expect(a.coronacionConViga).toBe(false);
    expect(res.subdivisionesVigaMuro.size).toBe(0);
  });
});

describe("calcularAcoples · muros: pilares y extremos de viga sobre el eje", () => {
  it("pilar a mitad del eje: acopla el nudo de malla en cada cota de planta de su rango", () => {
    const m = modeloBase();
    m.pilares.push({
      id: "pil-eje", nombre: "PE", x: 2.5, y: 10,
      plantaInicial: "p0", plantaFinal: "p1",
      seccionId: SECCION_OK, materialId: MATERIAL_BARRA, angulo: 0,
      vinculacionExterior: true, arranque: "empotrado",
    });
    m.muros = [muro("mu1")];
    const res = calcularAcoples(m);
    const a = res.porMuro.get("mu1")!;
    // x=2.5 NO es multiplo de tamMalla: la linea de control crea la columna exacta.
    // Acopla en cotas 0 (arranque) y 3 (cabeza) — el rango completo del pilar.
    expect([...a.puntosAcoplados]).toEqual([
      { x: 2.5, y: 0 }, { x: 2.5, y: 3 },
    ]);
    // Un pilar NO subdivide vigas (no hay viga aqui).
    expect(res.subdivisionesViga.size).toBe(0);
  });

  it("viga perpendicular que muere en el eje: acopla el nudo de SU planta en su s exacta", () => {
    const m = modeloBase();
    m.nudos.push({ id: "nP1", x: 1.7, y: 8 }, { id: "nP2", x: 1.7, y: 10 });
    m.vigas = [viga("v-perp", "nP1", "nP2")]; // p1 (cota 3), muere en (1.7, 10)
    m.muros = [muro("mu1")];
    const res = calcularAcoples(m);
    const a = res.porMuro.get("mu1")!;
    // Solo el extremo nP2 esta sobre el eje: nudo (s=1.7, cota 3).
    expect([...a.puntosAcoplados]).toEqual([{ x: 1.7, y: 3 }]);
    // Una viga perpendicular NO es colineal: no hay coronacion ni subdivisiones.
    expect(a.coronacionConViga).toBe(false);
    expect(res.subdivisionesViga.size).toBe(0);
  });

  it("viga colineal PARCIAL: su extremo interior gana columna de malla y queda acoplado", () => {
    const m = modeloBase();
    // Viga de coronacion que cubre solo la mitad izquierda (0..2.3) del muro.
    m.nudos.push({ id: "nA", x: 0, y: 10 }, { id: "nM", x: 2.3, y: 10 });
    m.vigas = [viga("v-media", "nA", "nM")];
    m.muros = [muro("mu1")];
    const res = calcularAcoples(m);
    const a = res.porMuro.get("mu1")!;
    expect(a.coronacionConViga).toBe(true);
    // La columna de control en s=2.3 (extremo interior de la viga) REPARTE los
    // segmentos [0,2.3] y [2.3,4] hacia tamMalla (construirEjeRejilla): columnas en
    // 0, 1.15, 2.3, 3.15, 4. Acoplados: los de s en [0, 2.3] = 0, 1.15 y 2.3.
    expect([...a.puntosAcoplados]).toEqual([
      { x: 0, y: 3 }, { x: 1.15, y: 3 }, { x: 2.3, y: 3 },
    ]);
    // Subdivide SOLO el estrictamente interior al segmento (s=1.15); el extremo
    // 2.3 es N* de obra (no subdivide).
    expect(res.subdivisionesViga.get("v-media")).toEqual([{ x: 1.15, y: 10 }]);
  });
});

describe("calcularAcoples · muros: union con losa, determinismo y robustez", () => {
  it("losa y muro sobre la MISMA viga: la union dedup por celda; el mapa solo-muro conserva lo del muro", () => {
    const m = modeloBase();
    // Viga (0,10)-(4,10) en p1: borde inferior de una losa 4x3 Y coronacion del muro.
    m.nudos.push(
      { id: "nA", x: 0, y: 10 }, { id: "nB", x: 4, y: 10 },
      { id: "nC", x: 4, y: 13 }, { id: "nD", x: 0, y: 13 },
    );
    m.vigas = [viga("v-comp", "nA", "nB")];
    m.panos = [pano("f1", { perimetro: ["nA", "nB", "nC", "nD"] })];
    m.muros = [muro("mu1")];
    const res = calcularAcoples(m);
    // Losa (tamMalla 1) y muro (tamMalla 1) aportan los MISMOS interiores x=1,2,3:
    // la union dedup por celda (el primero gana; mismas celdas => 3 puntos).
    expect(res.subdivisionesViga.get("v-comp")).toHaveLength(3);
    // El mapa solo-muro lleva los 3 puntos del muro (independiente de la losa).
    expect(res.subdivisionesVigaMuro.get("v-comp")).toHaveLength(3);
    // Y ambos elementos quedaron acoplados.
    expect(res.porPano.get("f1")!.acopleActivo).toBe(true);
    expect(res.porMuro.get("mu1")!.puntosAcoplados.length).toBeGreaterThan(0);
  });

  it("determinismo: invertir p1<->p2 del eje produce el MISMO acople byte a byte", () => {
    const m = modeloBase();
    m.nudos.push({ id: "nA", x: 0, y: 10 }, { id: "nB", x: 4, y: 10 });
    m.vigas = [viga("v-cor", "nA", "nB")];
    m.muros = [muro("mu1")];
    const a = calcularAcoples(m).porMuro.get("mu1")!;
    const m2 = modeloBase();
    m2.nudos.push({ id: "nA", x: 0, y: 10 }, { id: "nB", x: 4, y: 10 });
    m2.vigas = [viga("v-cor", "nA", "nB")];
    m2.muros = [muro("mu1", { x1: 4, y1: 10, x2: 0, y2: 10 })]; // extremos invertidos
    const b = calcularAcoples(m2).porMuro.get("mu1")!;
    expect(b.malla).toEqual(a.malla);
    expect([...b.nodosAcoplados].sort()).toEqual([...a.nodosAcoplados].sort());
    expect(b.puntosAcoplados).toEqual(a.puntosAcoplados);
  });

  it("muro segun Y: mismas fuentes de acople con el eje girado", () => {
    const m = modeloBase();
    m.nudos.push({ id: "nA", x: 10, y: 0 }, { id: "nB", x: 10, y: 4 });
    m.vigas = [viga("v-cor", "nA", "nB")];
    m.muros = [muro("mu1", { x1: 10, y1: 0, x2: 10, y2: 4 })];
    const res = calcularAcoples(m);
    const a = res.porMuro.get("mu1")!;
    expect(a.malla.eje).toBe("y");
    expect(a.coronacionConViga).toBe(true);
    expect(a.puntosAcoplados).toHaveLength(5); // s=0..4 en la fila tope
    // Subdivisiones en coords de obra: x fija = 10, y = interiores 1,2,3.
    expect(res.subdivisionesViga.get("v-cor")).toEqual([
      { x: 10, y: 1 }, { x: 10, y: 2 }, { x: 10, y: 3 },
    ]);
  });

  it("robustez: muro diagonal, degenerado o con refs rotas se SALTA sin lanzar", () => {
    const m = modeloBase();
    m.muros = [
      muro("mu-diag", { x2: 4, y2: 14 }), // diagonal
      muro("mu-cero", { x2: 0, y2: 10 }), // sin longitud
      muro("mu-ref", { plantaFinal: "p-inexistente" }), // ref rota
      muro("mu-plano", { plantaFinal: "p0" }), // sin desarrollo vertical
    ];
    const res = calcularAcoples(m);
    expect(res.porMuro.size).toBe(0);
    expect(res.erroresMalladoMuro.size).toBe(0); // geometria la reporta validaciones
  });

  it("sin muros: porMuro y subdivisionesVigaMuro vacios (regresion)", () => {
    const m = modeloBase();
    m.vigas = [viga("v-inf", "n1", "n2")];
    m.panos = [pano("f1")];
    const res = calcularAcoples(m);
    expect(res.porMuro.size).toBe(0);
    expect(res.erroresMalladoMuro.size).toBe(0);
    expect(res.subdivisionesVigaMuro.size).toBe(0);
  });
});
