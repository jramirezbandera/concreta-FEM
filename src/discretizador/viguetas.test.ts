// Tests PUROS del generador de viguetas (forjado unidireccional, T2.1). Node puro, sin
// Pyodide, sin verificacion fisica: solo la TRADUCCION geometria de paño unidireccional ->
// viguetas de Capa 2. Cubre: reparto (n/s/posiciones) para varios casos, vigueta unica
// (n=1), direccion "x" vs "y", invariante Σ tributarios == B, releases biapoyada exactos
// (#8 / I6), seccion sintetica (valores cerrados b·h³/12 + convenio de swap), determinismo
// byte a byte y a reordenaciones, y la precondicion (campos ausentes -> undefined, la
// politica de error la decide validaciones aguas arriba).
import { describe, it, expect } from "vitest";
import {
  generarViguetas,
  seccionFEMDeVigueta,
  nombreSeccionVigueta,
  nombreMemberVigueta,
  extremosDeVigueta,
  subdivisionesDeBordes,
  anchosTributarios,
  RELEASES_VIGUETA_BIAPOYADA,
  APOYO_VIGUETA_AISLADA_I,
  APOYO_VIGUETA_AISLADA_J,
  type MallaViguetas,
} from "./viguetas";
import { releasesDeExtremo } from "./discretizar";
import { seccionRectangular } from "../biblioteca";
import { mToMm } from "../unidades";
import type { Modelo, Pano, PanoUnidireccional } from "../dominio";
import { SCHEMA_VERSION } from "../dominio";

const MATERIAL_LOSA = "HA-25";

// Modelo base: una planta (cota 3) y 4 nudos en un rectangulo `ancho × alto` en planta,
// esquina inferior izquierda en el origen. Cada test coloca su paño unidireccional sobre
// estos 4 nudos y ajusta las dimensiones.
function modeloBase(ancho: number, alto: number): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    plantas: [
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
    ],
    secciones: [],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: ancho, y: 0 },
      { id: "n3", x: ancho, y: alto },
      { id: "n4", x: 0, y: alto },
    ],
    pilares: [],
    vigas: [],
    panos: [],
    muros: [],
    cargas: [],
    hipotesis: [{ id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false }],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

// Paño unidireccional sobre n1..n4 con los 5 campos de vigueta. Defaults del corte
// (canto 0.30, anchoNervio 0.12, pesoPropio 4). El caller pasa direccion e intereje.
function panoUni(extra?: Partial<PanoUnidireccional>): Pano {
  return {
    id: "pano1",
    nombre: "PANO1",
    tipo: "unidireccional",
    plantaId: "p1",
    perimetro: ["n1", "n2", "n3", "n4"],
    materialId: MATERIAL_LOSA,
    bordeApoyo: "simple",
    direccionViguetas: "x",
    intereje: 0.7,
    canto: 0.3,
    anchoNervio: 0.12,
    pesoPropio: 4,
    ...extra,
  };
}

function generarOk(modelo: Modelo, pano: Pano): MallaViguetas {
  const m = generarViguetas(modelo, pano);
  if (m === undefined) throw new Error("esperaba MallaViguetas, obtuve undefined");
  return m;
}

// --- Geometria: reparto n/s/posiciones ----------------------------------------

describe("viguetas - reparto (n, s, posiciones)", () => {
  it("6x5 direccion x intereje 0.7 -> reparto en Y, B=5, n=round(5/0.7)=7, s=5/7", () => {
    // direccion "x": viguetas paralelas a X (luz = 6), reparto en Y (B = 5).
    const modelo = modeloBase(6, 5);
    const m = generarOk(modelo, panoUni({ direccionViguetas: "x", intereje: 0.7 }));
    expect(m.direccion).toBe("x");
    expect(m.luz).toBeCloseTo(6, 12); // dimension en X
    expect(m.ancho).toBeCloseTo(5, 12); // B en Y
    expect(m.n).toBe(Math.round(5 / 0.7)); // round(7.14) = 7
    expect(m.n).toBe(7);
    expect(m.interejeEfectivo).toBeCloseTo(5 / 7, 12);
    expect(m.viguetas).toHaveLength(7);
    // Viguetas corren en X (a.x = xMin=0, b.x = xMax=6), separadas en Y.
    for (const v of m.viguetas) {
      expect(v.a.x).toBeCloseTo(0, 12);
      expect(v.b.x).toBeCloseTo(6, 12);
      expect(v.a.y).toBeCloseTo(v.b.y, 12); // vigueta horizontal: misma Y en ambos extremos
      expect(v.tributario).toBeCloseTo(5 / 7, 12);
    }
    // Posicion transversal de la vigueta k = yMin + s·(k+½). Interior estricto.
    const s = 5 / 7;
    m.viguetas.forEach((v, k) => {
      expect(v.a.y).toBeCloseTo(0 + s * (k + 0.5), 12);
      expect(v.a.y).toBeGreaterThan(0); // nunca sobre el borde paralelo yMin
      expect(v.a.y).toBeLessThan(5); // nunca sobre yMax
    });
  });

  it("direccion y intereje 0.7 sobre 6x5 -> reparto en X, B=6, luz=5", () => {
    // Espejo: direccion "y" -> viguetas paralelas a Y (luz = 5), reparto en X (B = 6).
    const modelo = modeloBase(6, 5);
    const m = generarOk(modelo, panoUni({ direccionViguetas: "y", intereje: 0.7 }));
    expect(m.direccion).toBe("y");
    expect(m.luz).toBeCloseTo(5, 12); // dimension en Y
    expect(m.ancho).toBeCloseTo(6, 12); // B en X
    expect(m.n).toBe(Math.round(6 / 0.7)); // round(8.57) = 9
    expect(m.n).toBe(9);
    const s = 6 / 9;
    m.viguetas.forEach((v, k) => {
      expect(v.a.y).toBeCloseTo(0, 12); // corre en Y: a en yMin, b en yMax
      expect(v.b.y).toBeCloseTo(5, 12);
      expect(v.a.x).toBeCloseTo(v.b.x, 12); // misma X en ambos extremos
      expect(v.a.x).toBeCloseTo(0 + s * (k + 0.5), 12);
      expect(v.tributario).toBeCloseTo(s, 12);
    });
  });

  it("extremo a = coord menor de la luz, extremo b = mayor (i->j en luz creciente)", () => {
    const modelo = modeloBase(6, 5);
    const m = generarOk(modelo, panoUni({ direccionViguetas: "x" }));
    for (const v of m.viguetas) {
      expect(v.a.x).toBeLessThan(v.b.x); // a antes que b a lo largo de la luz (X)
    }
  });
});

// --- Vigueta unica (n=1, R-3) -------------------------------------------------

describe("viguetas - vigueta unica (n=1)", () => {
  it("B < intereje -> round(B/intereje)=0 -> max(1,0)=1, tributario=B, centrada en B/2", () => {
    // Paño 6 (luz X) x 0.5 (B en Y) con intereje 0.7: round(0.5/0.7)=round(0.71)=1.
    const modelo = modeloBase(6, 0.5);
    const m = generarOk(modelo, panoUni({ direccionViguetas: "x", intereje: 0.7 }));
    expect(m.n).toBe(1);
    expect(m.viguetas).toHaveLength(1);
    expect(m.interejeEfectivo).toBeCloseTo(0.5, 12); // s = B/1 = B
    expect(m.viguetas[0].tributario).toBeCloseTo(0.5, 12);
    expect(m.viguetas[0].a.y).toBeCloseTo(0.25, 12); // centrada en B/2
  });

  it("intereje enorme (>> B) -> tambien n=1 (no pierde la vigueta en silencio)", () => {
    const modelo = modeloBase(6, 5);
    const m = generarOk(modelo, panoUni({ direccionViguetas: "x", intereje: 100 }));
    expect(m.n).toBe(1);
    expect(m.viguetas[0].tributario).toBeCloseTo(5, 12);
  });
});

// --- Invariante I1: Σ tributarios == B ----------------------------------------

describe("viguetas - invariante Σ tributarios == B (I1)", () => {
  it("6x5 x 0.7: la suma de anchos tributarios es EXACTAMENTE B", () => {
    const modelo = modeloBase(6, 5);
    const m = generarOk(modelo, panoUni({ direccionViguetas: "x", intereje: 0.7 }));
    const suma = anchosTributarios(m).reduce((acc, t) => acc + t, 0);
    // s = B/n reparte B a partes iguales: Σ = n·(B/n) = B. Se admite el epsilon de la
    // suma en punto flotante (15 digitos), pero para muchos n·s la aritmetica es exacta.
    expect(suma).toBeCloseTo(m.ancho, 12);
    expect(anchosTributarios(m)).toHaveLength(m.n);
  });

  it("Σ == B para un barrido de dimensiones e interejes (todos los tributarios iguales)", () => {
    const casos: Array<[number, number, "x" | "y", number]> = [
      [4, 3, "x", 0.5],
      [4, 3, "y", 0.8],
      [7.3, 2.9, "x", 0.6],
      [10, 10, "y", 1.0],
      [0.4, 5, "x", 0.7], // B pequeño -> n=1
    ];
    for (const [ancho, alto, dir, intereje] of casos) {
      const modelo = modeloBase(ancho, alto);
      const m = generarOk(modelo, panoUni({ direccionViguetas: dir, intereje }));
      const trib = anchosTributarios(m);
      // Todos iguales.
      expect(new Set(trib.map((t) => t)).size).toBe(1);
      const suma = trib.reduce((acc, t) => acc + t, 0);
      expect(suma).toBeCloseTo(m.ancho, 12);
    }
  });
});

// --- Releases biapoyada exactos (#8 / I6) -------------------------------------

describe("viguetas - releases biapoyada canonicos (#8, I6)", () => {
  it("RELEASES_VIGUETA_BIAPOYADA == releasesDeExtremo('articulado','articulado', false)", () => {
    // El modulo hoja copia la constante (no puede importar discretizar); este test verifica
    // que la copia coincide EXACTAMENTE con la fuente canonica.
    const canonica = releasesDeExtremo("articulado", "articulado", false);
    expect(canonica).not.toBeNull();
    expect([...RELEASES_VIGUETA_BIAPOYADA]).toEqual(canonica);
  });

  it("libera Ry,Rz de ambos extremos; NUNCA Rx (indices 3 y 9 == false)", () => {
    const r = RELEASES_VIGUETA_BIAPOYADA;
    expect(r).toHaveLength(12);
    // Rxi (indice 3) y Rxj (indice 9): jamas liberados (mecanismo torsional).
    expect(r[3]).toBe(false);
    expect(r[9]).toBe(false);
    // Ryi,Rzi (4,5) y Ryj,Rzj (10,11): liberados (rotula de flexion en ambos extremos).
    expect(r[4]).toBe(true);
    expect(r[5]).toBe(true);
    expect(r[10]).toBe(true);
    expect(r[11]).toBe(true);
    // Traslaciones (0,1,2 y 6,7,8): nunca liberadas.
    for (const i of [0, 1, 2, 6, 7, 8]) expect(r[i]).toBe(false);
  });

  it("patron de apoyo aislado ([SPIKE T0.2]): i restringe todo, j todo menos DX", () => {
    // i (arranque): todos true. j (final): todo true menos DX.
    expect(APOYO_VIGUETA_AISLADA_I).toEqual({
      DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true,
    });
    expect(APOYO_VIGUETA_AISLADA_J).toEqual({
      DX: false, DY: true, DZ: true, RX: true, RY: true, RZ: true,
    });
  });
});

// --- Seccion sintetica (valores cerrados + swap declarado, I7) ----------------

describe("viguetas - seccion sintetica VIG-<idx>", () => {
  it("nombre VIG-<idx> y propiedades del rectangulo anchoNervio×canto (convenio dominio)", () => {
    const pano = panoUni({ canto: 0.3, anchoNervio: 0.12 });
    const sec = seccionFEMDeVigueta(pano, 2);
    expect(sec).toBeDefined();
    expect(sec!.name).toBe("VIG-2");
    expect(sec!.name).toBe(nombreSeccionVigueta(2));
    // Valores cerrados: b=0.12 m, h=0.30 m (canto). Convenio DOMINIO (sin swap a PyNite):
    //   A  = b·h            = 0.036
    //   Iy = b·h³/12 (fuerte, canto) = 0.12·0.027/12 = 2.7e-4
    //   Iz = h·b³/12 (debil, ancho)  = 0.30·0.001728/12 = 4.32e-5
    //   J  = 0 (rectangular, decision F1)
    expect(sec!.A).toBeCloseTo(0.036, 12);
    expect(sec!.Iy).toBeCloseTo((0.12 * Math.pow(0.3, 3)) / 12, 15);
    expect(sec!.Iy).toBeCloseTo(2.7e-4, 15);
    expect(sec!.Iz).toBeCloseTo((0.3 * Math.pow(0.12, 3)) / 12, 15);
    expect(sec!.J).toBe(0);
    // El canto gobierna el eje FUERTE (Iy > Iz): tras el swap a PyNite (que hace T2.2) la
    // flexion vertical usa el canto (invariante I7, no "acostada").
    expect(sec!.Iy).toBeGreaterThan(sec!.Iz);
  });

  it("coincide con seccionRectangular(mToMm(ancho), mToMm(canto)) (fuente unica)", () => {
    const pano = panoUni({ canto: 0.5, anchoNervio: 0.1 });
    const sec = seccionFEMDeVigueta(pano, 0)!;
    const e = seccionRectangular(mToMm(0.1), mToMm(0.5));
    expect(sec.A).toBeCloseTo(e.A, 15);
    expect(sec.Iy).toBeCloseTo(e.Iy, 15);
    expect(sec.Iz).toBeCloseTo(e.Iz, 15);
    expect(sec.J).toBe(e.J);
  });

  it("undefined si el paño no es unidireccional (la union discriminada garantiza canto/anchoNervio > 0)", () => {
    // Tras la union discriminada (T-f3-pano-schema-union) canto/anchoNervio son obligatorios y
    // > 0 en la variante unidireccional (borde Zod): ya no se puede construir un paño uni con
    // esos campos ausentes o <= 0. El unico caso de undefined es que el paño NO sea uni.
    const losa: Pano = {
      id: "losa1", nombre: "L1", tipo: "losa", plantaId: "p1",
      perimetro: ["n1", "n2", "n3", "n4"], materialId: MATERIAL_LOSA, bordeApoyo: "simple",
      espesor: 0.2, tamMalla: 1,
    };
    expect(seccionFEMDeVigueta(losa, 0)).toBeUndefined();
  });
});

// --- Extremos: clave de celda + borde de apoyo (para T2.2) --------------------

describe("viguetas - extremos con clave de celda y borde de apoyo", () => {
  it("clave de celda usa mapearEjes(x,y,cota) (mismo criterio del remap 6c)", () => {
    const modelo = modeloBase(6, 5);
    const pano = panoUni({ direccionViguetas: "x" });
    const m = generarOk(modelo, pano);
    const e = extremosDeVigueta(modelo, pano, m.viguetas[0])!;
    // coordFEM = [X=obra-x, Y=cota, Z=obra-y].
    expect(e[0].coordFEM[1]).toBe(3); // Y = cota de la planta
    expect(e[0].coordFEM[0]).toBeCloseTo(0, 12); // X = xMin (extremo a)
    expect(e[1].coordFEM[0]).toBeCloseTo(6, 12); // X = xMax (extremo b)
    // La clave es el clavePosicion del coordFEM; dos extremos distintos -> claves distintas.
    expect(e[0].clave).not.toBe(e[1].clave);
  });

  it("direccion x: bordes de apoyo corren en obra-Y -> torsion RZ", () => {
    const modelo = modeloBase(6, 5);
    const m = generarOk(modelo, panoUni({ direccionViguetas: "x" }));
    const e = extremosDeVigueta(modelo, panoUni({ direccionViguetas: "x" }), m.viguetas[0])!;
    expect(e[0].borde).toEqual({ lado: "xMin", corre: "y", torsion: "RZ" });
    expect(e[1].borde).toEqual({ lado: "xMax", corre: "y", torsion: "RZ" });
  });

  it("direccion y: bordes de apoyo corren en obra-X -> torsion RX", () => {
    const modelo = modeloBase(6, 5);
    const m = generarOk(modelo, panoUni({ direccionViguetas: "y" }));
    const e = extremosDeVigueta(modelo, panoUni({ direccionViguetas: "y" }), m.viguetas[0])!;
    expect(e[0].borde).toEqual({ lado: "yMin", corre: "x", torsion: "RX" });
    expect(e[1].borde).toEqual({ lado: "yMax", corre: "x", torsion: "RX" });
  });

  it("puntos de subdivision por borde = coords de obra de los extremos, ordenados", () => {
    const modelo = modeloBase(6, 5);
    const pano = panoUni({ direccionViguetas: "x", intereje: 0.7 });
    const m = generarOk(modelo, pano);
    const subs = subdivisionesDeBordes(modelo, pano, m)!;
    expect(subs.bordeA.borde.lado).toBe("xMin");
    expect(subs.bordeB.borde.lado).toBe("xMax");
    expect(subs.bordeA.puntos).toHaveLength(m.n);
    expect(subs.bordeB.puntos).toHaveLength(m.n);
    // Los puntos del borde A estan todos en x=xMin (el borde de apoyo), ordenados por y.
    for (const p of subs.bordeA.puntos) expect(p.x).toBeCloseTo(0, 12);
    const ys = subs.bordeA.puntos.map((p) => p.y);
    const ordenados = [...ys].sort((a, b) => a - b);
    expect(ys).toEqual(ordenados);
  });
});

// --- Nombres ------------------------------------------------------------------

describe("viguetas - nombres deterministas (prefijo PV<idx>)", () => {
  it("member PV<idx>-V<k>, disjunto de N../M../PQ..", () => {
    expect(nombreMemberVigueta(2, 0)).toBe("PV2-V0");
    expect(nombreMemberVigueta(0, 5)).toBe("PV0-V5");
    expect(nombreMemberVigueta(3, 0).startsWith("PV")).toBe(true);
    // No colisiona con los otros prefijos.
    expect(nombreMemberVigueta(1, 1)).not.toMatch(/^(N|M|PQ)/);
  });
});

// --- Precondicion: no unidireccional / campos ausentes -> undefined ----------

describe("viguetas - precondicion (undefined, no lanza)", () => {
  it("paño no unidireccional (losa/reticular) -> undefined", () => {
    const modelo = modeloBase(6, 5);
    const comun = {
      id: "pano1", nombre: "PANO1", plantaId: "p1",
      perimetro: ["n1", "n2", "n3", "n4"], materialId: MATERIAL_LOSA, bordeApoyo: "simple" as const,
    };
    const losa: Pano = { ...comun, tipo: "losa", espesor: 0.2, tamMalla: 1 };
    const reticular: Pano = {
      ...comun, tipo: "reticular",
      intereje: 0.8, canto: 0.3, anchoNervio: 0.12, capaCompresion: 0.05, pesoPropio: 4,
    };
    expect(generarViguetas(modelo, losa)).toBeUndefined();
    expect(generarViguetas(modelo, reticular)).toBeUndefined();
  });

  it("campos de vigueta ausentes o <= 0 -> undefined (no lanza; validaciones bloquea antes)", () => {
    const modelo = modeloBase(6, 5);
    expect(generarViguetas(modelo, panoUni({ direccionViguetas: undefined }))).toBeUndefined();
    expect(generarViguetas(modelo, panoUni({ intereje: undefined }))).toBeUndefined();
    expect(generarViguetas(modelo, panoUni({ intereje: 0 }))).toBeUndefined();
    expect(generarViguetas(modelo, panoUni({ intereje: -0.7 }))).toBeUndefined();
  });

  it("perimetro no resoluble (refs rotas / != 4 nudos) -> undefined", () => {
    const modelo = modeloBase(6, 5);
    expect(
      generarViguetas(modelo, panoUni({ perimetro: ["n1", "n2", "nX", "n4"] })),
    ).toBeUndefined();
    expect(generarViguetas(modelo, panoUni({ perimetro: ["n1", "n2", "n3"] }))).toBeUndefined();
  });

  it("bbox no rectangular / degenerado -> undefined (error de obra lo emite validaciones)", () => {
    // Nudos que NO forman un rectangulo alineado (n3 desplazado -> no rectangular).
    const modelo = modeloBase(6, 5);
    modelo.nudos = [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 6, y: 0 },
      { id: "n3", x: 5, y: 5 }, // esquina fuera del bbox rectangular
      { id: "n4", x: 0, y: 5 },
    ];
    expect(generarViguetas(modelo, panoUni())).toBeUndefined();
    // Degenerado (area ~ 0).
    const modelo2 = modeloBase(6, 0);
    expect(generarViguetas(modelo2, panoUni())).toBeUndefined();
  });
});

// --- Determinismo -------------------------------------------------------------

describe("viguetas - determinismo", () => {
  it("byte a byte: dos generaciones de la misma entrada son identicas", () => {
    const modelo = modeloBase(6, 5);
    const a = JSON.stringify(generarOk(modelo, panoUni()));
    const b = JSON.stringify(generarOk(modelo, panoUni()));
    expect(a).toBe(b);
  });

  it("estable a reordenar modelo.panos/nudos (funcion pura del par modelo,pano)", () => {
    const modelo = modeloBase(6, 5);
    const pano = panoUni();
    const antes = JSON.stringify(generarOk(modelo, pano));
    // Reordenar los nudos del modelo (el perimetro los referencia por id, no por posicion).
    const modeloReordenado: Modelo = {
      ...modelo,
      nudos: [...modelo.nudos].reverse(),
      // añadir un segundo paño y reordenar la lista no afecta a generarViguetas de ESTE paño
      // (es funcion pura del par; el indicePano lo aporta el discretizador, no este modulo).
      panos: [panoUni({ id: "otro", direccionViguetas: "y" }), pano],
    };
    const despues = JSON.stringify(generarOk(modeloReordenado, pano));
    expect(despues).toBe(antes);
  });

  it("no usa Date/random: sin campos temporales en la salida", () => {
    const modelo = modeloBase(6, 5);
    const m = generarOk(modelo, panoUni());
    // Salida 100% derivada de la geometria: los indices son 0..n-1 en orden.
    expect(m.viguetas.map((v) => v.indice)).toEqual(
      Array.from({ length: m.n }, (_, k) => k),
    );
  });
});
