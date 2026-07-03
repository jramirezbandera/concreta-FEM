import { describe, it, expect } from "vitest";
import { calcularCentroMasaPlanta } from "./centros";
import { type Modelo } from "../dominio";
import { SCHEMA_VERSION, ID_HIP_PESO_PROPIO } from "../dominio";

// Tests del centro de masas (F2.1, F2a Fase 2). Vitest en Node PURO: sin Pyodide.
// Verifican el REPARTO especificado en E5: peso propio (A·rho·L via helper) + cargas
// lineales permanentes sobre vigas + cargas nodales permanentes; medio pilar a cada
// forjado; SIEMPRE incluye peso propio (independiente de incluirPesoPropio); excluye
// Grupo.cargasMuertas; planta sin masa -> null.

const MATERIAL = "S275"; // acero, peso = 78.5 kN/m³ (catalogo)
const RHO = 78.5;

// Seccion generica de area A directa (m²): math de peso exacta y controlable
// (peso barra = A·rho·L), sin depender de la geometria de un perfil tabulado.
function secGenerica(id: string, A: number): Modelo["secciones"][number] {
  return { id, nombre: id, tipo: "generico", A, Iy: 1e-4, Iz: 1e-4, J: 1e-4 };
}

// Modelo base vacio (kN-m) sin elementos: cada test anade lo que necesita. Hipotesis:
// una permanente y una variable de usuario + la automatica de peso propio (sembrada
// como en crearModeloVacio, pero el CM no la usa: el peso propio sale del helper).
function modeloBase(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [{ id: "g1", nombre: "G1", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 0 }],
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, grupoId: "g1" },
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, grupoId: "g1" },
    ],
    secciones: [],
    nudos: [],
    pilares: [],
    vigas: [],
    panos: [],
    muros: [],
    cargas: [],
    hipotesis: [
      { id: "hip-perm", nombre: "Permanente", tipo: "permanente", automatica: false },
      { id: "hip-var", nombre: "Variable", tipo: "variable", automatica: false },
      { id: ID_HIP_PESO_PROPIO, nombre: "Peso propio", tipo: "permanente", automatica: true },
    ],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
  };
}

// Pilar vertical p0->p1 en (x,y), seccion de area A, vinculado/empotrado.
function pilar(
  id: string,
  x: number,
  y: number,
  seccionId: string,
  plantaInicial = "p0",
  plantaFinal = "p1",
): Modelo["pilares"][number] {
  return {
    id, nombre: id, x, y, plantaInicial, plantaFinal,
    seccionId, materialId: MATERIAL, angulo: 0,
    vinculacionExterior: true, arranque: "empotrado",
  };
}

// Viga en una planta entre dos nudos por id.
function viga(
  id: string,
  plantaId: string,
  nudoI: string,
  nudoJ: string,
  seccionId: string,
): Modelo["vigas"][number] {
  return {
    id, nombre: id, plantaId, nudoI, nudoJ,
    seccionId, materialId: MATERIAL,
    extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
  };
}

describe("calcularCentroMasaPlanta - casos basicos", () => {
  it("planta sin masa -> null (sin division por cero)", () => {
    const m = modeloBase(); // sin pilares/vigas/cargas
    expect(calcularCentroMasaPlanta(m, "p1")).toBeNull();
  });

  it("plantaId inexistente -> null", () => {
    const m = modeloBase();
    expect(calcularCentroMasaPlanta(m, "no-existe")).toBeNull();
  });

  it("planta simetrica (4 pilares iguales en esquinas) -> CM centrado", () => {
    const m = modeloBase();
    m.secciones = [secGenerica("s1", 0.01)];
    // Cuadrado [0,10]x[0,10]: el centroide es (5,5) por simetria.
    m.pilares = [
      pilar("a", 0, 0, "s1"),
      pilar("b", 10, 0, "s1"),
      pilar("c", 0, 10, "s1"),
      pilar("d", 10, 10, "s1"),
    ];
    const cm = calcularCentroMasaPlanta(m, "p1");
    expect(cm).not.toBeNull();
    expect(cm!.x).toBeCloseTo(5, 9);
    expect(cm!.y).toBeCloseTo(5, 9);
  });

  it("peso propio de pilar = A·rho·L; medio peso a cada forjado conectado", () => {
    const m = modeloBase();
    const A = 0.02;
    m.secciones = [secGenerica("s1", A)];
    m.pilares = [pilar("a", 3, 4, "s1")]; // L = |3-0| = 3 m
    // Peso total del pilar = A·rho·L = 0.02·78.5·3 = 4.71 kN. Medio a p0 y medio a p1.
    const pesoTotalPilar = A * RHO * 3; // 4.71
    const cmP1 = calcularCentroMasaPlanta(m, "p1");
    const cmP0 = calcularCentroMasaPlanta(m, "p0");
    expect(cmP1).not.toBeNull();
    expect(cmP0).not.toBeNull();
    expect(cmP1!.pesoTotal).toBeCloseTo(pesoTotalPilar / 2, 9);
    expect(cmP0!.pesoTotal).toBeCloseTo(pesoTotalPilar / 2, 9);
    // El (x,y) del pilar fija el CM de ambas plantas.
    expect(cmP1!.x).toBeCloseTo(3, 9);
    expect(cmP1!.y).toBeCloseTo(4, 9);
  });

  it("pilar degenerado (plantaInicial===plantaFinal) -> peso entero en esa planta", () => {
    const m = modeloBase();
    const A = 0.02;
    m.secciones = [secGenerica("s1", A)];
    // plantaInicial===plantaFinal fuerza L=0 (misma cota): la longitud del pilar es
    // |cota_final - cota_inicial|. Peso = A·rho·0 = 0 => no aporta (acumular ignora
    // w<=0) => planta sin masa => null. Cubre la rama defensiva fraccion=1.0 sin
    // division por cero: un pilar de una sola planta no introduce masa espuria.
    m.pilares = [pilar("a", 1, 1, "s1", "p0", "p0")];
    expect(calcularCentroMasaPlanta(m, "p0")).toBeNull(); // L=0 => sin masa
  });
});

describe("calcularCentroMasaPlanta - asimetrico calculable a mano", () => {
  it("dos pilares de pesos distintos -> CM ponderado en la posicion exacta", () => {
    const m = modeloBase();
    // Pilar A: area 0.01 en x=0 ; Pilar B: area 0.03 en x=10. Misma y=0, misma L=3.
    // peso A = 0.01·78.5·3 ; peso B = 0.03·78.5·3 (factor 3:1, rho/L se cancelan).
    m.secciones = [secGenerica("sA", 0.01), secGenerica("sB", 0.03)];
    m.pilares = [pilar("a", 0, 0, "sA"), pilar("b", 10, 0, "sB")];
    // x_cm = (1·0 + 3·10)/(1+3) = 30/4 = 7.5 (los pesos van como 1:3).
    const cm = calcularCentroMasaPlanta(m, "p1");
    expect(cm).not.toBeNull();
    expect(cm!.x).toBeCloseTo(7.5, 9);
    expect(cm!.y).toBeCloseTo(0, 9);
  });

  it("viga: peso propio en su punto medio; carga lineal permanente q·L tambien", () => {
    const m = modeloBase();
    m.secciones = [secGenerica("s1", 0.01)];
    m.nudos = [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 8, y: 0 },
    ];
    m.vigas = [viga("v1", "p1", "n1", "n2", "s1")]; // centro (4,0), L=8
    // Solo la viga: CM en su centro (4,0).
    const cmSolo = calcularCentroMasaPlanta(m, "p1");
    expect(cmSolo).not.toBeNull();
    expect(cmSolo!.x).toBeCloseTo(4, 9);
    expect(cmSolo!.y).toBeCloseTo(0, 9);
    // Peso propio viga = A·rho·L = 0.01·78.5·8 = 6.28 kN.
    expect(cmSolo!.pesoTotal).toBeCloseTo(0.01 * RHO * 8, 9);

    // Anade carga lineal permanente q=10 kN/m sobre la viga: peso q·L = 80 kN, en (4,0).
    m.cargas = [{ id: "c1", tipo: "lineal", ambito: "v1", valor: 10, hipotesisId: "hip-perm" }];
    const cmConCarga = calcularCentroMasaPlanta(m, "p1");
    expect(cmConCarga).not.toBeNull();
    // Ambas contribuciones en (4,0) => CM sigue en (4,0), pero pesoTotal crece.
    expect(cmConCarga!.x).toBeCloseTo(4, 9);
    expect(cmConCarga!.pesoTotal).toBeCloseTo(0.01 * RHO * 8 + 10 * 8, 9);
  });

  it("carga lineal VARIABLE no cuenta para el CM (solo permanentes)", () => {
    const m = modeloBase();
    m.secciones = [secGenerica("s1", 0.01)];
    m.nudos = [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 8, y: 0 },
    ];
    m.vigas = [viga("v1", "p1", "n1", "n2", "s1")];
    m.cargas = [{ id: "c1", tipo: "lineal", ambito: "v1", valor: 10, hipotesisId: "hip-var" }];
    const cm = calcularCentroMasaPlanta(m, "p1")!;
    // Solo el peso propio de la viga (la carga variable no aporta).
    expect(cm.pesoTotal).toBeCloseTo(0.01 * RHO * 8, 9);
  });
});

describe("calcularCentroMasaPlanta - invariantes E5", () => {
  it("CM invariante al flag incluirPesoPropio (ON vs OFF -> mismo CM y mismo peso)", () => {
    const base = modeloBase();
    base.secciones = [secGenerica("sA", 0.01), secGenerica("sB", 0.03)];
    base.pilares = [pilar("a", 0, 0, "sA"), pilar("b", 10, 0, "sB")];

    const on: Modelo = { ...base, analisis: { ...base.analisis, incluirPesoPropio: true } };
    const off: Modelo = { ...base, analisis: { ...base.analisis, incluirPesoPropio: false } };

    const cmOn = calcularCentroMasaPlanta(on, "p1")!;
    const cmOff = calcularCentroMasaPlanta(off, "p1")!;
    expect(cmOff.x).toBeCloseTo(cmOn.x, 12);
    expect(cmOff.y).toBeCloseTo(cmOn.y, 12);
    expect(cmOff.pesoTotal).toBeCloseTo(cmOn.pesoTotal, 12);
  });

  it("CM excluye Grupo.cargasMuertas (cambiar cargasMuertas no mueve el CM ni el peso)", () => {
    const sin = modeloBase();
    sin.secciones = [secGenerica("s1", 0.01)];
    sin.pilares = [pilar("a", 2, 7, "s1")];
    const con = structuredClone(sin);
    con.grupos[0].cargasMuertas = 999; // kN/m²: debe ser ignorado (sin area tributaria)

    const cmSin = calcularCentroMasaPlanta(sin, "p1")!;
    const cmCon = calcularCentroMasaPlanta(con, "p1")!;
    expect(cmCon.x).toBeCloseTo(cmSin.x, 12);
    expect(cmCon.y).toBeCloseTo(cmSin.y, 12);
    expect(cmCon.pesoTotal).toBeCloseTo(cmSin.pesoTotal, 12);
  });
});

describe("calcularCentroMasaPlanta - cargas nodales (regla primera-viga)", () => {
  it("carga nodal permanente cuenta en la planta de la primera viga que usa el nudo", () => {
    const m = modeloBase();
    m.secciones = [secGenerica("s1", 0.01)];
    // Un nudo n1 usado por DOS vigas en plantas distintas (p0 y p1). El nudo no porta
    // cota; la PRIMERA viga por id (orden canonico) fija la planta. Ids: "vA" < "vB".
    m.nudos = [
      { id: "n1", x: 5, y: 5 },
      { id: "n2", x: 9, y: 5 },
      { id: "n3", x: 1, y: 5 },
    ];
    m.vigas = [
      viga("vA", "p1", "n1", "n2", "s1"), // primera por id => fija n1 a p1
      viga("vB", "p0", "n1", "n3", "s1"),
    ];
    // Carga nodal permanente sobre n1 (peso 50 kN). Debe contar en p1 (no en p0).
    m.cargas = [{ id: "c1", tipo: "puntual", ambito: "n1", valor: 50, hipotesisId: "hip-perm" }];

    const cmP1 = calcularCentroMasaPlanta(m, "p1")!;
    const cmP0 = calcularCentroMasaPlanta(m, "p0")!;

    // p1 incluye la carga nodal de 50 kN en (5,5); p0 NO.
    const pesoVigaP1 = 0.01 * RHO * 4; // vA: L=4 (de x=5 a x=9)
    const pesoVigaP0 = 0.01 * RHO * 4; // vB: L=4 (de x=5 a x=1)
    expect(cmP1.pesoTotal).toBeCloseTo(pesoVigaP1 + 50, 9);
    expect(cmP0.pesoTotal).toBeCloseTo(pesoVigaP0, 9); // sin la carga nodal
  });

  it("carga nodal VARIABLE no cuenta para el CM", () => {
    const m = modeloBase();
    m.secciones = [secGenerica("s1", 0.01)];
    m.nudos = [
      { id: "n1", x: 5, y: 5 },
      { id: "n2", x: 9, y: 5 },
    ];
    m.vigas = [viga("vA", "p1", "n1", "n2", "s1")];
    m.cargas = [{ id: "c1", tipo: "puntual", ambito: "n1", valor: 50, hipotesisId: "hip-var" }];
    const cm = calcularCentroMasaPlanta(m, "p1")!;
    expect(cm.pesoTotal).toBeCloseTo(0.01 * RHO * 4, 9); // solo el peso propio de la viga
  });

  it("carga puntual sobre BARRA (no nudo) no aporta al CM (ambito = id de viga)", () => {
    const m = modeloBase();
    m.secciones = [secGenerica("s1", 0.01)];
    m.nudos = [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 8, y: 0 },
    ];
    m.vigas = [viga("v1", "p1", "n1", "n2", "s1")];
    // Puntual con ambito = id de viga (no de nudo): no es nodal => se omite del CM.
    m.cargas = [{ id: "c1", tipo: "puntual", ambito: "v1", valor: 99, hipotesisId: "hip-perm" }];
    const cm = calcularCentroMasaPlanta(m, "p1")!;
    expect(cm.pesoTotal).toBeCloseTo(0.01 * RHO * 8, 9); // solo el peso propio de la viga
  });
});

describe("calcularCentroMasaPlanta - reparto pilar entre forjados (asimetria por mitades)", () => {
  it("pilar contribuye con medio peso a cada planta, en su (x,y), ponderado con una viga", () => {
    const m = modeloBase();
    // Pilar en (0,0), area 0.01, L=3 => peso total 2.355, medio (1.1775) a p1.
    // Viga en p1 en (10,0), peso propio que domine para verificar la mezcla.
    m.secciones = [secGenerica("sPil", 0.01), secGenerica("sViga", 0.01)];
    m.pilares = [pilar("a", 0, 0, "sPil")];
    // Viga horizontal centrada en (10,0): nudos a +/- 1 en x.
    m.nudos = [
      { id: "n1", x: 9, y: 0 },
      { id: "n2", x: 11, y: 0 },
    ];
    m.vigas = [viga("v1", "p1", "n1", "n2", "sViga")]; // centro (10,0), L=2

    const pesoPilarMitad = 0.01 * RHO * 3 / 2; // medio pilar en p1
    const pesoViga = 0.01 * RHO * 2; // viga completa en p1
    const cm = calcularCentroMasaPlanta(m, "p1")!;
    // x_cm = (pesoPilarMitad·0 + pesoViga·10)/(pesoPilarMitad + pesoViga)
    const xEsperado = (pesoPilarMitad * 0 + pesoViga * 10) / (pesoPilarMitad + pesoViga);
    expect(cm.x).toBeCloseTo(xEsperado, 9);
    expect(cm.y).toBeCloseTo(0, 9);
    expect(cm.pesoTotal).toBeCloseTo(pesoPilarMitad + pesoViga, 9);
  });
});

// FIX #1: el CM corre sobre el modelo VIVO (sin la pasada de validaciones del
// discretizador). Una referencia colgante (seccion borrada en uso, material o planta
// inexistente) NO debe romper el render: se OMITE la contribucion de esa barra y el
// CM se calcula con el resto (o null si no queda masa). Contrato del modulo: "el CM
// no lanza".
describe("calcularCentroMasaPlanta - robustez sobre modelo vivo no validado (FIX #1)", () => {
  it("pilar con seccionId colgante -> NO lanza; se omite ese pilar, CM del resto", () => {
    const m = modeloBase();
    m.secciones = [secGenerica("s1", 0.01)];
    // Pilar bueno en (0,0) y pilar con seccion inexistente en (100,100): el malo se
    // omite, el CM queda en (0,0) (solo el bueno aporta), no en el punto medio.
    m.pilares = [
      pilar("bueno", 0, 0, "s1"),
      pilar("malo", 100, 100, "no-existe"),
    ];
    let cm: ReturnType<typeof calcularCentroMasaPlanta>;
    expect(() => {
      cm = calcularCentroMasaPlanta(m, "p1");
    }).not.toThrow();
    expect(cm!).not.toBeNull();
    expect(cm!.x).toBeCloseTo(0, 9);
    expect(cm!.y).toBeCloseTo(0, 9);
  });

  it("viga con materialId colgante -> NO lanza; se omite esa viga", () => {
    const m = modeloBase();
    m.secciones = [secGenerica("s1", 0.01)];
    m.nudos = [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 8, y: 0 },
    ];
    // Viga con material inexistente (no en el catalogo): propiedadesDeViga lanzaria.
    const vMala = viga("vMala", "p1", "n1", "n2", "s1");
    vMala.materialId = "MATERIAL-INEXISTENTE";
    m.vigas = [vMala];
    let cm: ReturnType<typeof calcularCentroMasaPlanta>;
    expect(() => {
      cm = calcularCentroMasaPlanta(m, "p1");
    }).not.toThrow();
    // Era la unica masa de la planta: omitida => sin masa => null (no lanza).
    expect(cm!).toBeNull();
  });

  it("pilar cuya planta fue eliminada -> NO lanza (longitudPilar no revienta)", () => {
    const m = modeloBase();
    m.secciones = [secGenerica("s1", 0.01)];
    // El pilar conecta p1 con una planta que ya no existe: longitudPilar haria
    // `plantaPorId(...) as Planta` y leeria .cota de undefined (TypeError) sin la red.
    m.pilares = [pilar("p", 5, 5, "s1", "p1", "planta-borrada")];
    let cm: ReturnType<typeof calcularCentroMasaPlanta>;
    expect(() => {
      cm = calcularCentroMasaPlanta(m, "p1");
    }).not.toThrow();
    expect(cm!).toBeNull(); // su contribucion se omite, no queda mas masa
  });
});

// ==============================================================================
// [AUDITORIA M-7] PILAR PASANTE de 3+ plantas: la planta INTERMEDIA debe recibir
// su masa tributaria. El reparto anterior (medio pilar a plantaInicial, medio a
// plantaFinal) daba CERO a las plantas intermedias que el pilar atraviesa y
// SOBREPESABA los extremos: el CM por planta (y la excentricidad CM<->CR que se
// muestra al usuario) salia distorsionado. Criterio correcto (tributario): cada
// planta que el pilar toca recibe la mitad de cada tramo adyacente.
// ==============================================================================
describe("AUDITORIA M-7: pilar pasante y masa tributaria por planta", () => {
  // p0(0) - p1(3) - p2(6); pilar pasante de p0 a p2 con A=0.01, rho=78.5.
  // Peso total = A·rho·L = 0.01·78.5·6 = 4.71 kN. Tributario:
  //   p0 (extremo):    medio tramo inferior  = 1.5 m -> 1.1775 kN
  //   p1 (intermedia): medio+medio            = 3.0 m -> 2.355 kN
  //   p2 (extremo):    medio tramo superior  = 1.5 m -> 1.1775 kN
  function modeloPasante(): Modelo {
    const m = modeloBase();
    m.plantas.push({ id: "p2", nombre: "Planta 2", cota: 6, altura: 3, grupoId: "g1" });
    m.secciones = [secGenerica("s1", 0.01)];
    m.pilares = [pilar("pas", 4, 7, "s1", "p0", "p2")];
    return m;
  }

  it("la planta intermedia recibe la masa tributaria del pilar (antes: 0 -> null)", () => {
    const cm = calcularCentroMasaPlanta(modeloPasante(), "p1");
    expect(cm, "p1 debe tener masa (el pilar la atraviesa)").not.toBeNull();
    expect(cm!.x).toBeCloseTo(4, 10);
    expect(cm!.y).toBeCloseTo(7, 10);
    expect(cm!.pesoTotal).toBeCloseTo(0.01 * RHO * 3.0, 10); // 2.355 kN
  });

  it("los extremos reciben solo su medio tramo adyacente (no medio pilar ENTERO)", () => {
    const m = modeloPasante();
    const cm0 = calcularCentroMasaPlanta(m, "p0");
    const cm2 = calcularCentroMasaPlanta(m, "p2");
    expect(cm0!.pesoTotal).toBeCloseTo(0.01 * RHO * 1.5, 10); // 1.1775 kN
    expect(cm2!.pesoTotal).toBeCloseTo(0.01 * RHO * 1.5, 10);
  });

  it("conservacion: la suma por plantas = peso total del pilar A·rho·L", () => {
    const m = modeloPasante();
    const total =
      (calcularCentroMasaPlanta(m, "p0")?.pesoTotal ?? 0) +
      (calcularCentroMasaPlanta(m, "p1")?.pesoTotal ?? 0) +
      (calcularCentroMasaPlanta(m, "p2")?.pesoTotal ?? 0);
    expect(total).toBeCloseTo(0.01 * RHO * 6, 10); // 4.71 kN
  });

  it("regresion: pilar de UNA planta (p0->p1) reparte mitad y mitad como antes", () => {
    const m = modeloBase();
    m.secciones = [secGenerica("s1", 0.01)];
    m.pilares = [pilar("simple", 2, 3, "s1", "p0", "p1")];
    const cm0 = calcularCentroMasaPlanta(m, "p0");
    const cm1 = calcularCentroMasaPlanta(m, "p1");
    // Peso total = 0.01·78.5·3 = 2.355; mitad a cada forjado = 1.1775.
    expect(cm0!.pesoTotal).toBeCloseTo(1.1775, 10);
    expect(cm1!.pesoTotal).toBeCloseTo(1.1775, 10);
  });
});

// ============================================================================
// F3.2 · Termino 4: PAÑOS LOSA en el CM (cierra T-cm-cargas-muertas). Con el
// acople la masa de la losa existe de verdad: peso propio rho·t·A + cargas
// muertas del GRUPO·A (fuente unica, solo permanente) + superficiales
// PERMANENTES de usuario·A, en el centroide del rectangulo.
// ============================================================================
describe("centro de masas · paños losa (F3.2, T-cm-cargas-muertas)", () => {
  // Paño 4x2 en p1 con esquinas (0,0)-(4,0)-(4,2)-(0,2): area 8 m², centroide (2,1).
  function conLosa(m: Modelo, extra?: Partial<Modelo["panos"][number]>): Modelo {
    m.nudos.push(
      { id: "q1", x: 0, y: 0 },
      { id: "q2", x: 4, y: 0 },
      { id: "q3", x: 4, y: 2 },
      { id: "q4", x: 0, y: 2 },
    );
    m.panos.push({
      id: "f1", nombre: "F1", tipo: "losa", plantaId: "p1",
      perimetro: ["q1", "q2", "q3", "q4"],
      espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "simple",
      ...extra,
    });
    return m;
  }
  const AREA = 8; // m²
  const PP_LOSA = 25 * 0.2 * AREA; // rho HA-25 · espesor · area = 40 kN

  it("losa sola: CM en el centroide del rectangulo con peso rho·t·A + CM_grupo·A", () => {
    const m = conLosa(modeloBase());
    m.grupos = [{ ...m.grupos[0], cargasMuertas: 1.5 }]; // 1.5·8 = 12 kN
    const cm = calcularCentroMasaPlanta(m, "p1");
    expect(cm).not.toBeNull();
    expect(cm!.x).toBeCloseTo(2, 10);
    expect(cm!.y).toBeCloseTo(1, 10);
    expect(cm!.pesoTotal).toBeCloseTo(PP_LOSA + 12, 10);
  });

  it("la SOBRECARGA DE USO del grupo NO entra (el CM cuenta solo permanentes)", () => {
    const base = conLosa(modeloBase());
    const conUso = calcularCentroMasaPlanta(
      { ...base, grupos: [{ ...base.grupos[0], sobrecargaUso: 5 }] },
      "p1",
    );
    const sinUso = calcularCentroMasaPlanta(
      { ...base, grupos: [{ ...base.grupos[0], sobrecargaUso: 0 }] },
      "p1",
    );
    expect(conUso!.pesoTotal).toBeCloseTo(sinUso!.pesoTotal, 12);
  });

  it("superficial PERMANENTE de usuario suma q·A; la VARIABLE no", () => {
    const m = conLosa(modeloBase());
    m.cargas.push(
      { id: "cp", tipo: "superficial", ambito: "f1", valor: 3, hipotesisId: "hip-perm" },
      { id: "cv", tipo: "superficial", ambito: "f1", valor: 9, hipotesisId: "hip-var" },
    );
    const cm = calcularCentroMasaPlanta(m, "p1");
    // pp losa (40) + 3·8 = 64; la variable (9·8) NO aparece.
    expect(cm!.pesoTotal).toBeCloseTo(PP_LOSA + 24, 10);
  });

  it("el peso de la losa entra SIEMPRE, tambien con incluirPesoPropio OFF (masa fisica, E5)", () => {
    const m = conLosa(modeloBase());
    m.analisis = { ...m.analisis, incluirPesoPropio: false };
    expect(calcularCentroMasaPlanta(m, "p1")!.pesoTotal).toBeCloseTo(PP_LOSA, 10);
  });

  it("el paño de OTRA planta no contamina; geometria irresoluble se omite sin lanzar", () => {
    const m = conLosa(modeloBase());
    // El paño esta en p1: p0 sigue sin masa.
    expect(calcularCentroMasaPlanta(m, "p0")).toBeNull();
    // Perimetro roto: se omite la contribucion (CM de p1 vuelve a null), sin lanzar.
    m.panos[0] = { ...m.panos[0], perimetro: ["q1", "q2", "q3", "NO_EXISTE"] };
    expect(() => calcularCentroMasaPlanta(m, "p1")).not.toThrow();
    expect(calcularCentroMasaPlanta(m, "p1")).toBeNull();
  });

  it("losa + pilar: el CM pondera ambos pesos (se mueve del pilar hacia la losa)", () => {
    const m = conLosa(modeloBase());
    m.secciones.push(secGenerica("s1", 0.01));
    // Pilar en (10, 0): tributaria en p1 = mitad del tramo = 1.5 m -> 0.01·78.5·1.5.
    m.pilares.push(pilar("pA", 10, 0, "s1"));
    const wPilar = 0.01 * RHO * 1.5;
    const cm = calcularCentroMasaPlanta(m, "p1");
    const esperadoX = (PP_LOSA * 2 + wPilar * 10) / (PP_LOSA + wPilar);
    const esperadoY = (PP_LOSA * 1 + wPilar * 0) / (PP_LOSA + wPilar);
    expect(cm!.x).toBeCloseTo(esperadoX, 10);
    expect(cm!.y).toBeCloseTo(esperadoY, 10);
    expect(cm!.pesoTotal).toBeCloseTo(PP_LOSA + wPilar, 10);
  });
});
