import { describe, it, expect } from "vitest";
import { ModeloSchema, OpcionesAnalisisSchema, type Modelo } from "./modelo";
import { NudoSchema } from "./nudo";
import { SeccionSchema } from "./seccion";
import { PanoSchema } from "./pano";
import { MuroSchema } from "./muro";
import { HipotesisSchema } from "./carga";
import { crearModeloVacio } from "./helpers";
import { SCHEMA_VERSION } from "./comunes";

// Porticio minimo de F1: 2 plantas, 1 pilar, 1 viga, 1 hipotesis, 1 carga.
// Sin paños losa: la planta lleva SU/CM a 0 (esos valores eran inertes sin paño;
// ponerlos a 0 mantiene la Capa 2 identica y no dispara PLANTA_CARGA_SIN_PANO).
function modeloPorticoMinimo(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, categoriaUso: "A", sobrecargaUso: 0, cargasMuertas: 0 },
    ],
    secciones: [
      { id: "s1", nombre: "IPE 300", tipo: "perfilMetalico", perfilId: "IPE300" },
    ],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 5, y: 0 },
    ],
    pilares: [
      {
        id: "pil1",
        nombre: "P1",
        x: 0,
        y: 0,
        plantaInicial: "p0",
        plantaFinal: "p1",
        seccionId: "s1",
        materialId: "m1",
        angulo: 0,
        vinculacionExterior: true,
        arranque: "empotrado",
      },
    ],
    vigas: [
      {
        id: "v1",
        nombre: "V1",
        plantaId: "p1",
        nudoI: "n1",
        nudoJ: "n2",
        seccionId: "s1",
        materialId: "m1",
        extremoI: "empotrado",
        extremoJ: "articulado",
        tirante: false,
      },
    ],
    panos: [],
    muros: [],
    cargas: [
      {
        id: "c1",
        tipo: "lineal",
        ambito: "v1",
        valor: -10,
        hipotesisId: "h1",
      },
    ],
    hipotesis: [{ id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false }],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
  };
}

describe("ModeloSchema (forma/tipos/enums)", () => {
  it("(a) acepta el modelo vacio de la factoria", () => {
    const res = ModeloSchema.safeParse(crearModeloVacio());
    expect(res.success).toBe(true);
  });

  it("(b) acepta un portico minimo de F1", () => {
    const res = ModeloSchema.safeParse(modeloPorticoMinimo());
    expect(res.success).toBe(true);
  });

  describe("(c) rechaza datos corruptos y apunta al campo culpable", () => {
    it("campo obligatorio faltante (falta schemaVersion)", () => {
      const m = crearModeloVacio() as Record<string, unknown>;
      delete m.schemaVersion;
      const res = ModeloSchema.safeParse(m);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.path.join(".") === "schemaVersion")).toBe(true);
      }
    });

    it("valor de enum invalido (categoriaUso = 'Z')", () => {
      const m = modeloPorticoMinimo() as unknown as Record<string, unknown>;
      // v4: el uso vive en la planta (antes en el grupo).
      (m.plantas as Array<Record<string, unknown>>)[0].categoriaUso = "Z";
      const res = ModeloSchema.safeParse(m);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.path.join(".") === "plantas.0.categoriaUso")).toBe(true);
      }
    });

    it("tipo equivocado (pilar.x = 'foo')", () => {
      const m = modeloPorticoMinimo() as unknown as Record<string, unknown>;
      (m.pilares as Array<Record<string, unknown>>)[0].x = "foo";
      const res = ModeloSchema.safeParse(m);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.path.join(".") === "pilares.0.x")).toBe(true);
      }
    });

    it("unidades distinto del literal kN-m", () => {
      const m = crearModeloVacio() as unknown as Record<string, unknown>;
      m.unidades = "N-mm";
      const res = ModeloSchema.safeParse(m);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.path.join(".") === "unidades")).toBe(true);
      }
    });

    it("id vacio rechazado (IdSchema min(1))", () => {
      const m = modeloPorticoMinimo() as unknown as Record<string, unknown>;
      (m.pilares as Array<Record<string, unknown>>)[0].id = "";
      const res = ModeloSchema.safeParse(m);
      expect(res.success).toBe(false);
    });
  });

  it("(d) round-trip JSON estable (parse(stringify) deep-equals)", () => {
    const m = modeloPorticoMinimo();
    const roundTrip = ModeloSchema.parse(JSON.parse(JSON.stringify(m)));
    expect(roundTrip).toEqual(m);
  });

  it("NO comprueba integridad referencial (carga con hipotesisId inexistente pasa)", () => {
    // El ambito/hipotesisId 'fantasma' es valido en forma; lo cazara feature-4.
    const m = modeloPorticoMinimo();
    m.cargas[0].hipotesisId = "no-existe";
    expect(ModeloSchema.safeParse(m).success).toBe(true);
  });
});

describe("NudoSchema (punto en planta x, y)", () => {
  it("acepta un nudo bien formado", () => {
    expect(NudoSchema.safeParse({ id: "n1", x: 1.5, y: -2 }).success).toBe(true);
  });

  it("rechaza coordenada no numerica", () => {
    const res = NudoSchema.safeParse({ id: "n1", x: "0", y: 0 });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.join(".") === "x")).toBe(true);
    }
  });

  it("rechaza id vacio", () => {
    expect(NudoSchema.safeParse({ id: "", x: 0, y: 0 }).success).toBe(false);
  });

  it("no admite `nombre` como obligatorio (los nudos son implicitos)", () => {
    // Forma minima: solo id + coordenadas; sin nombre exigido.
    expect(NudoSchema.safeParse({ id: "n1", x: 0, y: 0 }).success).toBe(true);
  });
});

describe("SeccionSchema (union discriminada por tipo)", () => {
  it("acepta cada variante con sus campos especificos", () => {
    expect(
      SeccionSchema.safeParse({
        id: "s1", nombre: "IPE 300", tipo: "perfilMetalico", perfilId: "IPE300",
      }).success,
    ).toBe(true);
    expect(
      SeccionSchema.safeParse({
        id: "s2", nombre: "30x50", tipo: "hormigonRectangular", b: 0.3, h: 0.5,
      }).success,
    ).toBe(true);
    expect(
      SeccionSchema.safeParse({
        id: "s3", nombre: "D400", tipo: "hormigonCircular", d: 0.4,
      }).success,
    ).toBe(true);
    expect(
      SeccionSchema.safeParse({
        id: "s4", nombre: "Custom", tipo: "generico",
        A: 0.01, Iy: 1e-4, Iz: 1e-4, J: 1e-5,
      }).success,
    ).toBe(true);
  });

  it("rechaza una variante a la que le falta su dimension especifica", () => {
    // hormigonRectangular sin `h`.
    const res = SeccionSchema.safeParse({
      id: "s2", nombre: "30x?", tipo: "hormigonRectangular", b: 0.3,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.join(".") === "h")).toBe(true);
    }
    // hormigonCircular sin `d`.
    expect(
      SeccionSchema.safeParse({ id: "s3", nombre: "D?", tipo: "hormigonCircular" }).success,
    ).toBe(false);
    // perfilMetalico sin `perfilId`.
    expect(
      SeccionSchema.safeParse({ id: "s1", nombre: "IPE", tipo: "perfilMetalico" }).success,
    ).toBe(false);
    // generico sin todas las propiedades.
    expect(
      SeccionSchema.safeParse({ id: "s4", nombre: "C", tipo: "generico", A: 0.01 }).success,
    ).toBe(false);
  });

  it("rechaza tipo desconocido y mezcla de campos de otra variante", () => {
    expect(
      SeccionSchema.safeParse({ id: "s", nombre: "x", tipo: "desconocido" }).success,
    ).toBe(false);
    // hormigonRectangular con `perfilId` pero sin b/h: no cuela.
    expect(
      SeccionSchema.safeParse({
        id: "s", nombre: "x", tipo: "hormigonRectangular", perfilId: "IPE300",
      }).success,
    ).toBe(false);
  });

  it("rechaza dimensiones no positivas", () => {
    expect(
      SeccionSchema.safeParse({
        id: "s2", nombre: "x", tipo: "hormigonRectangular", b: 0, h: 0.5,
      }).success,
    ).toBe(false);
  });
});

describe("OpcionesAnalisisSchema (shape F2a)", () => {
  it("acepta los 3 tipos de analisis (lineal / general / pDelta)", () => {
    for (const tipo of ["lineal", "general", "pDelta"] as const) {
      const res = OpcionesAnalisisSchema.safeParse({
        tipo, comprobarEstatica: true, incluirPesoPropio: true,
      });
      expect(res.success, `tipo ${tipo}`).toBe(true);
    }
  });

  it("rechaza un tipo desconocido", () => {
    expect(
      OpcionesAnalisisSchema.safeParse({
        tipo: "modal", comprobarEstatica: true, incluirPesoPropio: true,
      }).success,
    ).toBe(false);
  });

  it("incluirPesoPropio es obligatorio (forma del contrato)", () => {
    const res = OpcionesAnalisisSchema.safeParse({ tipo: "lineal", comprobarEstatica: true });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.join(".") === "incluirPesoPropio")).toBe(true);
    }
  });
});

describe("HipotesisSchema (shape F2a: automatica)", () => {
  it("aplica automatica:false por defecto cuando no se aporta", () => {
    const res = HipotesisSchema.parse({ id: "h1", nombre: "Uso", tipo: "variable" });
    expect(res.automatica).toBe(false);
  });

  it("respeta automatica:true cuando se aporta (la automatica)", () => {
    const res = HipotesisSchema.parse({
      id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true,
    });
    expect(res.automatica).toBe(true);
  });
});

describe("PanoSchema (losa v4 + campos del forjado unidireccional v5)", () => {
  // Losa v4 SIN los campos nuevos: debe seguir pasando (los de vigueta son opcionales).
  function losaV4(): Record<string, unknown> {
    return {
      id: "pano1",
      nombre: "Forjado 1",
      tipo: "losa",
      plantaId: "p1",
      perimetro: ["n1", "n2", "n3", "n4"],
      espesor: 0.25,
      materialId: "m1",
      tamMalla: 0.5,
      bordeApoyo: "simple",
    };
  }

  // Unidireccional VALIDO con los 5 campos nuevos. espesor/tamMalla se ignoran bajo
  // unidireccional pero siguen obligatorios a nivel Zod (se portan con valor inocuo).
  function unidireccionalValido(): Record<string, unknown> {
    return {
      ...losaV4(),
      tipo: "unidireccional",
      direccionViguetas: "x",
      intereje: 0.7,
      canto: 0.3,
      anchoNervio: 0.12,
      pesoPropio: 3.5,
    };
  }

  it("una LOSA v4 sin los campos nuevos sigue pasando (opcionales)", () => {
    expect(PanoSchema.safeParse(losaV4()).success).toBe(true);
  });

  it("un unidireccional con los campos de vigueta pasa", () => {
    expect(PanoSchema.safeParse(unidireccionalValido()).success).toBe(true);
  });

  it("acepta pesoPropio = 0 (>=0 legitimo) y direccionViguetas 'y'", () => {
    const p = unidireccionalValido();
    p.pesoPropio = 0;
    p.direccionViguetas = "y";
    expect(PanoSchema.safeParse(p).success).toBe(true);
  });

  it("acepta direccionViguetas ausente (la presencia la exige validaciones, no el schema)", () => {
    const p = unidireccionalValido();
    delete p.direccionViguetas;
    expect(PanoSchema.safeParse(p).success).toBe(true);
  });

  describe("rechaza campos de vigueta invalidos", () => {
    const casos: Array<[string, (p: Record<string, unknown>) => void]> = [
      ["direccionViguetas fuera del enum ('z')", (p) => { p.direccionViguetas = "z"; }],
      ["intereje negativo", (p) => { p.intereje = -0.7; }],
      ["intereje cero (.positive)", (p) => { p.intereje = 0; }],
      ["intereje Infinity (.finite)", (p) => { p.intereje = Infinity; }],
      ["canto negativo", (p) => { p.canto = -0.3; }],
      ["canto no finito (NaN)", (p) => { p.canto = NaN; }],
      ["anchoNervio negativo", (p) => { p.anchoNervio = -0.12; }],
      ["anchoNervio Infinity", (p) => { p.anchoNervio = Infinity; }],
      ["pesoPropio negativo", (p) => { p.pesoPropio = -1; }],
      ["pesoPropio -Infinity", (p) => { p.pesoPropio = -Infinity; }],
    ];
    it.each(casos)("%s", (_titulo, mutar) => {
      const p = unidireccionalValido();
      mutar(p);
      expect(PanoSchema.safeParse(p).success).toBe(false);
    });
  });
});

describe("MuroSchema (pantalla v6: segmento en planta + tramo de plantas)", () => {
  function muroValido(): Record<string, unknown> {
    return {
      id: "muro1",
      nombre: "M1",
      x1: 0,
      y1: 0,
      x2: 4,
      y2: 0,
      plantaInicial: "p0",
      plantaFinal: "p2",
      espesor: 0.3,
      materialId: "m1",
      tamMalla: 0.5,
      vinculacionExterior: true,
    };
  }

  it("un muro completo pasa", () => {
    expect(MuroSchema.safeParse(muroValido()).success).toBe(true);
  });

  it("acepta coordenadas negativas y vinculacionExterior false", () => {
    const m = muroValido();
    m.x1 = -3.5;
    m.y2 = -1.25;
    m.vinculacionExterior = false;
    expect(MuroSchema.safeParse(m).success).toBe(true);
  });

  it("el stub v1..v5 {id} ya NO pasa (v6 exige la forma completa)", () => {
    expect(MuroSchema.safeParse({ id: "muro-stub" }).success).toBe(false);
  });

  describe("rechaza campos invalidos", () => {
    const casos: Array<[string, (m: Record<string, unknown>) => void]> = [
      ["x1 no finito (Infinity)", (m) => { m.x1 = Infinity; }],
      ["y2 NaN", (m) => { m.y2 = NaN; }],
      ["espesor cero (.positive)", (m) => { m.espesor = 0; }],
      ["espesor negativo", (m) => { m.espesor = -0.3; }],
      ["espesor Infinity (.finite)", (m) => { m.espesor = Infinity; }],
      ["tamMalla cero", (m) => { m.tamMalla = 0; }],
      ["tamMalla negativo", (m) => { m.tamMalla = -0.5; }],
      ["plantaInicial vacia", (m) => { m.plantaInicial = ""; }],
      ["materialId vacio", (m) => { m.materialId = ""; }],
      ["vinculacionExterior no booleana", (m) => { m.vinculacionExterior = "si"; }],
    ];
    it.each(casos)("%s", (_titulo, mutar) => {
      const m = muroValido();
      mutar(m);
      expect(MuroSchema.safeParse(m).success).toBe(false);
    });
  });
});
