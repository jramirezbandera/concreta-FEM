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
