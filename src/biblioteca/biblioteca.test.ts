import { describe, it, expect } from "vitest";
import {
  MATERIALES,
  SECCIONES,
  ACEROS,
  HORMIGONES,
  PERFILES,
  IPE,
  HEB,
  getMaterial,
  getSeccion,
  listarMateriales,
  listarSecciones,
  derivarEcm,
  seccionRectangular,
  seccionCircular,
} from "./index";
import {
  mmToM,
  cm2ToM2,
  cm4ToM4,
  internoToMpa,
} from "../unidades";
import type {
  EntradaMaterialAcero,
  EntradaMaterialHormigon,
} from "./tipos";

// Tests de la BIBLIOTECA (feature-3, T3.1). Proyecto `node` (sin DOM): la
// biblioteca es pura (datos + funciones). Estrategia anti-magia: el valor
// esperado se RECALCULA en el propio test con la formula cerrada / la cadena de
// conversion de unidades, nunca se cablea un numero ya transformado. Asi un test
// rojo senala una discrepancia real, no un descuadre de constante copiada.

describe("derivarEcm (modulo secante del Codigo Estructural)", () => {
  // Formula vigente (Codigo Estructural / EC2): Ecm = 22000·(fcm/10)^0,3, fcm=fck+8.
  const ecmEsperado = (fck: number): number =>
    22000 * Math.pow((fck + 8) / 10, 0.3);
  // Formula EHE-08 DEROGADA, usada solo como contraste (no debe coincidir).
  const ecmEhe08Derogada = (fck: number): number =>
    8500 * Math.pow(fck + 8, 1 / 3);

  for (const fck of [25, 30, 35]) {
    it(`fck=${fck}: coincide con 22000·((fck+8)/10)^0,3 [MPa]`, () => {
      // derivarEcm devuelve MPa (es una formula normativa en MPa; ver hormigon.ts).
      expect(derivarEcm(fck)).toBeCloseTo(ecmEsperado(fck), 6);
    });

    it(`fck=${fck}: NO coincide con la formula EHE-08 derogada (sanity)`, () => {
      // Distintas por construccion: si coincidieran, alguien resucito EHE-08.
      const diff = Math.abs(derivarEcm(fck) - ecmEhe08Derogada(fck));
      expect(diff).toBeGreaterThan(1); // > 1 MPa de separacion
    });
  }

  it("valores informativos de hormigon.ts (fck25≈31476, 30≈32837, 35≈34077 MPa)", () => {
    expect(derivarEcm(25)).toBeCloseTo(31476, 0);
    expect(derivarEcm(30)).toBeCloseTo(32837, 0);
    expect(derivarEcm(35)).toBeCloseTo(34077, 0);
  });

  it("el catalogo HA-xx guarda Ecm en internas (kN/m²) coherente con derivarEcm", () => {
    // El material persiste en internas; al volver a MPa debe dar la misma formula.
    for (const [id, fck] of [
      ["HA-25", 25],
      ["HA-30", 30],
      ["HA-35", 35],
    ] as const) {
      const mat = getMaterial(id) as EntradaMaterialHormigon | undefined;
      expect(mat).toBeDefined();
      if (mat) {
        expect(internoToMpa(mat.Ecm)).toBeCloseTo(derivarEcm(fck), 3);
        // En F1 Ecm se usa como E del FEM (modulo del material hormigon).
        expect(mat.E).toBeCloseTo(mat.Ecm, 6);
        // fck del material, de vuelta a MPa, es el caracteristico nominal.
        expect(internoToMpa(mat.fck)).toBeCloseTo(fck, 6);
      }
    }
  });
});

describe("seccionRectangular (formula cerrada de geometria pura)", () => {
  // Parametros en mm (UI); se convierten a m con la MISMA cadena que produccion.
  const b = 300;
  const h = 500;
  const bM = mmToM(b);
  const hM = mmToM(h);
  const sec = seccionRectangular(b, h);

  it(`A = b·h en m² (${b}x${h} mm)`, () => {
    expect(sec.A).toBeCloseTo(bM * hM, 12);
  });

  it("Iy = b·h³/12 (el canto h gobierna)", () => {
    expect(sec.Iy).toBeCloseTo((bM * Math.pow(hM, 3)) / 12, 12);
  });

  it("Iz = h·b³/12 (el ancho b gobierna)", () => {
    expect(sec.Iz).toBeCloseTo((hM * Math.pow(bM, 3)) / 12, 12);
  });

  it("J = 0 documentado para rectangular (no introduce rigidez torsional espuria)", () => {
    expect(sec.J).toBe(0);
  });

  it("metadatos: tipo, id y nombre derivados de b/h", () => {
    expect(sec.tipo).toBe("hormigonRectangular");
    expect(sec.id).toBe(`HR-${b}x${h}`);
    expect(sec.nombre).toBe(`${b}x${h}`);
  });

  it("J=0 nunca es el momento polar Iy+Iz (que seria > 0)", () => {
    // Documenta la decision: para rectangular NO se usa el polar como torsion.
    expect(sec.Iy + sec.Iz).toBeGreaterThan(0);
    expect(sec.J).not.toBeCloseTo(sec.Iy + sec.Iz, 12);
  });
});

describe("seccionCircular (formula cerrada; J = polar VALIDO solo en circulo macizo)", () => {
  const d = 400; // diametro en mm
  const dM = mmToM(d);
  const rM = dM / 2;
  const sec = seccionCircular(d);

  it(`A = π·r² en m² (D${d} mm)`, () => {
    expect(sec.A).toBeCloseTo(Math.PI * Math.pow(rM, 2), 12);
  });

  it("Iy = Iz = π·r⁴/4 (seccion simetrica)", () => {
    const inercia = (Math.PI * Math.pow(rM, 4)) / 4;
    expect(sec.Iy).toBeCloseTo(inercia, 12);
    expect(sec.Iz).toBeCloseTo(inercia, 12);
    expect(sec.Iy).toBeCloseTo(sec.Iz, 12);
  });

  it("J = π·r⁴/2 (momento polar; valido como torsion SOLO en circulo macizo)", () => {
    expect(sec.J).toBeCloseTo((Math.PI * Math.pow(rM, 4)) / 2, 12);
  });

  it("en el circulo macizo J = Iy + Iz (unico caso donde el polar es la torsion)", () => {
    expect(sec.J).toBeCloseTo(sec.Iy + sec.Iz, 12);
  });

  it("metadatos: tipo, id y nombre derivados de d", () => {
    expect(sec.tipo).toBe("hormigonCircular");
    expect(sec.id).toBe(`HC-${d}`);
    expect(sec.nombre).toBe(`D${d}`);
  });
});

describe("Lookups por id (getMaterial / getSeccion)", () => {
  it("getMaterial('S275') devuelve el acero correcto", () => {
    const m = getMaterial("S275");
    expect(m).toBeDefined();
    expect(m?.id).toBe("S275");
    expect(m?.tipo).toBe("acero");
  });

  it("getMaterial('HA-25') devuelve el hormigon correcto", () => {
    const m = getMaterial("HA-25");
    expect(m).toBeDefined();
    expect(m?.id).toBe("HA-25");
    expect(m?.tipo).toBe("hormigon");
  });

  it("getMaterial de un id inexistente devuelve undefined", () => {
    expect(getMaterial("NO_EXISTE")).toBeUndefined();
  });

  it("getSeccion('IPE200') devuelve el perfil correcto", () => {
    const s = getSeccion("IPE200");
    expect(s).toBeDefined();
    expect(s?.id).toBe("IPE200");
    expect(s?.tipo).toBe("perfilMetalico");
  });

  it("getSeccion de un id inexistente devuelve undefined", () => {
    expect(getSeccion("NO_EXISTE")).toBeUndefined();
  });

  it("las secciones parametricas de hormigon NO estan indexadas (se generan bajo demanda)", () => {
    // seccionRectangular genera la entrada, pero no se cataloga como seccion fija.
    expect(getSeccion("HR-300x500")).toBeUndefined();
    expect(getSeccion("HC-400")).toBeUndefined();
  });

  it("listarMateriales / listarSecciones devuelven copia (no la referencia interna)", () => {
    expect(listarMateriales()).not.toBe(MATERIALES);
    expect(listarSecciones()).not.toBe(SECCIONES);
    expect(listarMateriales()).toHaveLength(MATERIALES.length);
    expect(listarSecciones()).toHaveLength(SECCIONES.length);
  });
});

describe("Catalogo F1 completo (IPE 18 + HEB 19) y consultables por id", () => {
  it("IPE tiene 18 entradas (IPE80…IPE600)", () => {
    expect(IPE).toHaveLength(18);
    expect(IPE[0].id).toBe("IPE80");
    expect(IPE[IPE.length - 1].id).toBe("IPE600");
  });

  it("HEB tiene 19 entradas (HEB100…HEB600)", () => {
    expect(HEB).toHaveLength(19);
    expect(HEB[0].id).toBe("HEB100");
    expect(HEB[HEB.length - 1].id).toBe("HEB600");
  });

  it("PERFILES = IPE + HEB (37 perfiles) y SECCIONES los contiene todos", () => {
    expect(PERFILES).toHaveLength(IPE.length + HEB.length);
    expect(SECCIONES).toHaveLength(PERFILES.length);
  });

  it("todos los perfiles del catalogo son consultables por id via getSeccion", () => {
    for (const s of PERFILES) {
      expect(getSeccion(s.id)).toBe(s);
    }
  });

  it("IPE200: A/Iy/Iz/J coinciden con EN 10365 tras conversion cm -> internas (m)", () => {
    const s = getSeccion("IPE200");
    expect(s).toBeDefined();
    if (s) {
      // Valores de catalogo (cm², cm⁴) convertidos con la MISMA cadena de borde.
      expect(s.A).toBeCloseTo(cm2ToM2(28.48), 12);
      expect(s.Iy).toBeCloseTo(cm4ToM4(19430), 12);
      expect(s.Iz).toBeCloseTo(cm4ToM4(1424), 12);
      expect(s.J).toBeCloseTo(cm4ToM4(68.46), 12);
    }
  });

  it("IPE200: J es la constante de torsion (It), NO el momento polar Iy+Iz", () => {
    // Sanity #6: en perfil abierto en I, It << Ip = Iy+Iz (un orden de magnitud).
    const s = getSeccion("IPE200");
    expect(s).toBeDefined();
    if (s) {
      const polar = s.Iy + s.Iz; // lo que J NO debe ser
      expect(s.J).toBeLessThan(polar);
      // It (68.46 cm⁴) es mucho menor que Ip (~20854 cm⁴): ratio > 100.
      expect(polar / s.J).toBeGreaterThan(100);
    }
  });
});

describe("Aceros estructurales (S235/S275/S355), comprobados en MPa", () => {
  // E, G, nu y peso son comunes; solo cambia fy. Se comprueba en MPa volviendo
  // de internas con internoToMpa (los catalogos guardan kN/m²).
  it("ACEROS tiene los tres grados de F1", () => {
    expect(ACEROS.map((a) => a.id)).toEqual(["S235", "S275", "S355"]);
  });

  for (const [id, fyEsperadoMpa] of [
    ["S235", 235],
    ["S275", 275],
    ["S355", 355],
  ] as const) {
    it(`${id}: E=210000, G=81000, nu=0.3, peso=78.5, fy=${fyEsperadoMpa} MPa`, () => {
      const m = getMaterial(id) as EntradaMaterialAcero | undefined;
      expect(m).toBeDefined();
      if (m) {
        expect(m.tipo).toBe("acero");
        expect(internoToMpa(m.E)).toBeCloseTo(210000, 6);
        expect(internoToMpa(m.G)).toBeCloseTo(81000, 6);
        expect(m.nu).toBeCloseTo(0.3, 12);
        expect(m.peso).toBeCloseTo(78.5, 12); // ya en kN/m³ (interno)
        expect(internoToMpa(m.fy)).toBeCloseTo(fyEsperadoMpa, 6);
      }
    });
  }
});

describe("Catalogo combinado MATERIALES", () => {
  it("MATERIALES = ACEROS + HORMIGONES, todos consultables por id", () => {
    expect(MATERIALES).toHaveLength(ACEROS.length + HORMIGONES.length);
    for (const m of MATERIALES) {
      expect(getMaterial(m.id)).toBe(m);
    }
  });

  it("contiene los 3 aceros y los 3 hormigones de F1", () => {
    expect(ACEROS).toHaveLength(3);
    expect(HORMIGONES).toHaveLength(3);
    expect(HORMIGONES.map((h) => h.id)).toEqual(["HA-25", "HA-30", "HA-35"]);
  });
});
