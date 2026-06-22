import { describe, it, expect } from "vitest";
import {
  discretizar,
  TOL_NODO,
  mapearEjes,
  clavePosicion,
  releasesDeExtremo,
} from "./discretizar";
import { ModeloFEMSchema } from "./contratoFEM";
import { type Modelo } from "../dominio";
import { SCHEMA_VERSION } from "../dominio";

// Tests del discretizador (feature-4, T2.1). Vitest en Node PURO: SIN Pyodide, SIN
// verificacion fisica (M=qL²/8, deformada: eso es feature-6). Aqui se prueba la
// TRADUCCION Capa 1 -> Capa 2: determinismo, mapeo de ejes (#18), snapping,
// releases (#8), signo/direccion de carga (#3), combos, y validez de salida.

// Ids reales del catalogo: material acero "S275", perfil "IPE300".
const MATERIAL = "S275";
const PERFIL = "IPE300";
const SECCION = "sec-ipe"; // seccion de obra que referencia el perfil

// Portico minimo F1: 1 pilar sujeto (p0->p1, empotrado) + 1 viga en p1 entre dos
// nudos, con una carga lineal gravitatoria en hipotesis permanente.
function modeloPortico(): Modelo {
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
      { id: SECCION, nombre: "IPE 300", tipo: "perfilMetalico", perfilId: PERFIL },
    ],
    nudos: [
      { id: "n1", x: 2, y: 5 },
      { id: "n2", x: 7, y: 5 },
    ],
    pilares: [
      {
        id: "pil1", nombre: "P1", x: 2, y: 5,
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION, materialId: MATERIAL, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
    ],
    vigas: [
      {
        id: "v1", nombre: "V1", plantaId: "p1", nudoI: "n1", nudoJ: "n2",
        seccionId: SECCION, materialId: MATERIAL,
        extremoI: "empotrado", extremoJ: "articulado", tirante: false,
      },
    ],
    panos: [],
    muros: [],
    cargas: [{ id: "c1", tipo: "lineal", ambito: "v1", valor: 10, hipotesisId: "h1" }],
    hipotesis: [{ id: "h1", nombre: "Peso propio", tipo: "permanente" }],
    analisis: { tipo: "lineal", comprobarEstatica: true },
  };
}

function discretizarOk(m: Modelo) {
  const res = discretizar(m);
  if (!res.ok) throw new Error("esperaba ok:true, errores: " + JSON.stringify(res.errores));
  return res.modeloFEM;
}

describe("helpers puros", () => {
  it("mapearEjes (#18 Y vertical): planta (x,y) + cota -> [x, cota, y]", () => {
    expect(mapearEjes(2, 5, 0)).toEqual([2, 0, 5]);
    expect(mapearEjes(2, 5, 3)).toEqual([2, 3, 5]);
  });

  it("clavePosicion cuantiza a la rejilla de TOL_NODO (snapping determinista)", () => {
    // Dos puntos a < TOL_NODO comparten clave.
    expect(clavePosicion([1, 0, 0], TOL_NODO)).toBe(
      clavePosicion([1.0004, 0, 0], TOL_NODO),
    );
    // Dos puntos a > TOL_NODO NO la comparten.
    expect(clavePosicion([1, 0, 0], TOL_NODO)).not.toBe(
      clavePosicion([1.002, 0, 0], TOL_NODO),
    );
  });

  it("releasesDeExtremo (#8): articulado en i libera solo Ryi,Rzi", () => {
    const r = releasesDeExtremo("articulado", "empotrado", false)!;
    // Orden: [Dxi,Dyi,Dzi,Rxi,Ryi,Rzi, Dxj,Dyj,Dzj,Rxj,Ryj,Rzj]
    expect(r[4]).toBe(true); // Ryi
    expect(r[5]).toBe(true); // Rzi
    expect(r[3]).toBe(false); // Rxi NUNCA
    expect(r[10]).toBe(false); // Ryj
    expect(r[11]).toBe(false); // Rzj
  });

  it("releasesDeExtremo (#8): tirante libera los 4 giros de flexion", () => {
    const r = releasesDeExtremo("empotrado", "empotrado", true)!;
    expect([r[4], r[5], r[10], r[11]]).toEqual([true, true, true, true]);
  });

  it("releasesDeExtremo: NUNCA libera Rx en ambos extremos (Rxi && Rxj imposible)", () => {
    for (const i of ["empotrado", "articulado"] as const) {
      for (const j of ["empotrado", "articulado"] as const) {
        for (const tirante of [false, true]) {
          const r = releasesDeExtremo(i, j, tirante);
          if (r === null) continue;
          expect(r[3] && r[9], `Rxi&&Rxj con ${i}/${j}/tirante=${tirante}`).toBe(false);
        }
      }
    }
  });

  it("releasesDeExtremo: ambos empotrados y no tirante -> null", () => {
    expect(releasesDeExtremo("empotrado", "empotrado", false)).toBeNull();
  });
});

describe("discretizar - traduccion Capa 1 -> Capa 2", () => {
  it("modelo invalido (sin sujecion) -> ok:false con SIN_SUJECION", () => {
    const m = modeloPortico();
    m.pilares[0].vinculacionExterior = false;
    const res = discretizar(m);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errores.some((e) => e.codigo === "SIN_SUJECION")).toBe(true);
    }
  });

  it("mapeo de ejes (#18): pilar cota 0->3 en (2,5) -> nodos (2,0,5) y (2,3,5)", () => {
    const fem = discretizarOk(modeloPortico());
    const coords = fem.nodes.map((n) => [n.x, n.y, n.z]);
    expect(coords).toContainEqual([2, 0, 5]); // pie
    expect(coords).toContainEqual([2, 3, 5]); // cabeza
  });

  it("snapping: pie de pilar y arranque de viga coincidentes comparten nodo", () => {
    // El pilar esta en (2,5); la viga arranca en el nudo n1 (2,5) en planta p1 (cota
    // 3). La cabeza del pilar (2,3,5) coincide con el arranque de la viga -> 1 nodo.
    const fem = discretizarOk(modeloPortico());
    // Nodos esperados: pie pilar (2,0,5), cabeza pilar = arranque viga (2,3,5),
    // fin viga (7,3,5) => 3 nodos, no 4.
    expect(fem.nodes).toHaveLength(3);
  });

  it("snapping: a > TOL_NODO NO comparten nodo", () => {
    const m = modeloPortico();
    // Desplaza el nudo de arranque de la viga 1cm (> 1mm) respecto al pilar.
    m.nudos[0] = { id: "n1", x: 2.01, y: 5 };
    const fem = discretizarOk(m);
    expect(fem.nodes).toHaveLength(4); // ya no comparten
  });

  it("signo/direccion (#3): carga gravitatoria -> dist_load FY negativo", () => {
    const fem = discretizarOk(modeloPortico());
    expect(fem.dist_loads).toHaveLength(1);
    const dl = fem.dist_loads[0];
    expect(dl.direction).toBe("FY"); // GLOBAL, vertical
    expect(dl.w1).toBe(-10); // negativo (descendente) aunque el dominio diera +10
    expect(dl.w2).toBe(-10);
    expect(dl.case).toBe("h1");
  });

  it("releases (#8): la viga articulada en j libera Ryj,Rzj en su barra", () => {
    const fem = discretizarOk(modeloPortico());
    // La viga es la unica barra con releases (el pilar empotrado lleva releases:null).
    const viga = fem.members.find((mm) => mm.releases !== null)!;
    expect(viga.releases).not.toBeNull();
    const r = viga.releases!;
    expect(r[10]).toBe(true); // Ryj (articulado en j)
    expect(r[11]).toBe(true); // Rzj
    expect(r[3] && r[9]).toBe(false); // nunca Rx en ambos
  });

  it("apoyo: pilar empotrado con vinculacion exterior -> 6 GDL en su pie", () => {
    const fem = discretizarOk(modeloPortico());
    expect(fem.supports).toHaveLength(1);
    const s = fem.supports[0];
    expect([s.DX, s.DY, s.DZ, s.RX, s.RY, s.RZ]).toEqual([true, true, true, true, true, true]);
    // El apoyo va en el nodo del pie (cota 0): y === 0.
    const nodoApoyo = fem.nodes.find((n) => n.name === s.node)!;
    expect(nodoApoyo.y).toBe(0);
  });

  it("combos provisionales: ELU (1.35 perm) y ELS (1.0) con sus tags", () => {
    const fem = discretizarOk(modeloPortico());
    const elu = fem.combos.find((cb) => cb.name === "ELU")!;
    const els = fem.combos.find((cb) => cb.name === "ELS")!;
    expect(elu.factors.h1).toBe(1.35); // h1 es permanente
    expect(elu.combo_tags).toEqual(["ELU"]);
    expect(els.factors.h1).toBe(1.0);
    expect(els.combo_tags).toEqual(["ELS"]);
  });

  it("combos: hipotesis variable lleva 1.5 en ELU", () => {
    const m = modeloPortico();
    m.hipotesis.push({ id: "h2", nombre: "Uso", tipo: "variable" });
    m.cargas.push({ id: "c2", tipo: "lineal", ambito: "v1", valor: 5, hipotesisId: "h2" });
    const fem = discretizarOk(m);
    const elu = fem.combos.find((cb) => cb.name === "ELU")!;
    expect(elu.factors.h2).toBe(1.5);
  });

  it("analisis: lineal -> 'linear'; general -> 'analyze'", () => {
    expect(discretizarOk(modeloPortico()).analysis.type).toBe("linear");
    const m = modeloPortico();
    m.analisis.tipo = "general";
    expect(discretizarOk(m).analysis.type).toBe("analyze");
  });

  it("salida valida contra ModeloFEMSchema", () => {
    const fem = discretizarOk(modeloPortico());
    expect(ModeloFEMSchema.safeParse(fem).success).toBe(true);
  });

  it("seccion de hormigon de obra resuelve a A/Iy/Iz/J via biblioteca (borde m->mm)", () => {
    const m = modeloPortico();
    m.secciones[0] = { id: SECCION, nombre: "30x50", tipo: "hormigonRectangular", b: 0.3, h: 0.5 };
    const fem = discretizarOk(m);
    const sec = fem.sections.find((s) => s.name === SECCION)!;
    // A = 0.3*0.5 = 0.15 m²; Iy = b·h³/12 = 0.3·0.125/12 = 0.003125 m⁴.
    expect(sec.A).toBeCloseTo(0.15, 9);
    expect(sec.Iy).toBeCloseTo((0.3 * 0.5 ** 3) / 12, 9);
    expect(sec.Iz).toBeCloseTo((0.5 * 0.3 ** 3) / 12, 9);
  });

  describe("DETERMINISMO byte a byte (CLAUDE.md §2)", () => {
    it("dos llamadas al mismo modelo dan JSON identico", () => {
      const a = JSON.stringify(discretizarOk(modeloPortico()));
      const b = JSON.stringify(discretizarOk(modeloPortico()));
      expect(a).toBe(b);
    });

    it("reordenar la entrada (mismo modelo logico) da la misma Capa 2", () => {
      // Modelo con varios pilares, vigas y cargas para que el orden de cada array de
      // entrada pueda importar (y comprobar que NO altera la Capa 2).
      const base = modeloPortico();
      base.hipotesis.push({ id: "h2", nombre: "Uso", tipo: "variable" });
      // Segundo pilar sujeto en otra columna, y segunda viga que lo conecta, para que
      // barajar `pilares`/`vigas` sea un reordenamiento real (no un no-op).
      base.nudos.push({ id: "n3", x: 12, y: 5 });
      base.pilares.push({
        id: "pil2", nombre: "P2", x: 7, y: 5,
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION, materialId: MATERIAL, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      });
      base.vigas.push({
        id: "v2", nombre: "V2", plantaId: "p1", nudoI: "n2", nudoJ: "n3",
        seccionId: SECCION, materialId: MATERIAL,
        extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
      });
      base.cargas.push({ id: "c2", tipo: "lineal", ambito: "v1", valor: 5, hipotesisId: "h2" });
      base.cargas.push({ id: "c3", tipo: "puntual", ambito: "n2", valor: 8, hipotesisId: "h1" });
      base.cargas.push({ id: "c4", tipo: "lineal", ambito: "v2", valor: 7, hipotesisId: "h1" });

      const original = base;
      // Modelo logicamente identico pero con arrays reordenados (nudos, cargas,
      // pilares, vigas). La numeracion FEM va por geometria (nodos) y por id de
      // dominio (barras/cargas), nunca por orden de entrada.
      const reordenado: Modelo = {
        ...original,
        nudos: [...original.nudos].reverse(),
        cargas: [...original.cargas].reverse(),
        secciones: [...original.secciones],
        pilares: [...original.pilares].reverse(),
        vigas: [...original.vigas].reverse(),
      };
      const a = JSON.stringify(discretizarOk(original));
      const b = JSON.stringify(discretizarOk(reordenado));
      expect(b).toBe(a);
    });
  });

  describe("avisos y errores de traduccion (tres canales)", () => {
    it("arranque elastico -> ok:true con aviso ELASTICO_NO_SOPORTADO (no bloquea)", () => {
      // El plan: elastico se calcula como empotrado (6 GDL) + aviso. NO bloquea: el
      // codigo sabe tratarlo de forma segura, asi que el arquitecto puede calcular.
      const m = modeloPortico();
      m.pilares[0].arranque = "elastico";
      const res = discretizar(m);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.avisos.some((e) => e.codigo === "ELASTICO_NO_SOPORTADO")).toBe(true);
        // Se trata como empotrado: 6 GDL en el pie.
        const s = res.modeloFEM.supports[0];
        expect([s.DX, s.DY, s.DZ, s.RX, s.RY, s.RZ]).toEqual([
          true, true, true, true, true, true,
        ]);
      }
    });

    it("modelo valido sin limitaciones -> ok:true con avisos vacios", () => {
      const res = discretizar(modeloPortico());
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.avisos).toEqual([]);
    });

    it("carga superficial -> ok:false con PANO_NO_SOPORTADO (bloquea)", () => {
      // BLOQUEA: descartar una carga de paño daria un calculo con menos carga real
      // sin que el arquitecto lo sepa. Mas seguro bloquear hasta F3.
      const m = modeloPortico();
      // Pano (F3) es solo { id }; basta para que REF_AMBITO de la carga resuelva.
      m.panos.push({ id: "pano1" });
      m.cargas.push({ id: "c2", tipo: "superficial", ambito: "pano1", valor: 4, hipotesisId: "h1" });
      const res = discretizar(m);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errores.some((e) => e.codigo === "PANO_NO_SOPORTADO")).toBe(true);
      }
    });

    it("hipotesis sin cargas (COMBO_SIN_CARGAS) -> ok:true con aviso (NO bloquea)", () => {
      // Severidad aviso: una hipotesis vacia no impide calcular, solo no aporta.
      const m = modeloPortico();
      m.hipotesis.push({ id: "h2", nombre: "Nieve", tipo: "variable" }); // sin cargas
      const res = discretizar(m);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.avisos.some((e) => e.codigo === "COMBO_SIN_CARGAS")).toBe(true);
      }
    });

    it("nudo flotante (FLOTANTE) -> ok:true con aviso (NO bloquea)", () => {
      // Severidad aviso: un punto huerfano ensucia el modelo pero no impide calcular.
      const m = modeloPortico();
      m.nudos.push({ id: "n9", x: 99, y: 99 }); // ninguna viga lo usa
      const res = discretizar(m);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.avisos.some((e) => e.codigo === "FLOTANTE")).toBe(true);
      }
    });

    it("carga puntual sobre VIGA -> ok:false con CARGA_PUNTUAL_SIN_POSICION (bloquea)", () => {
      // El dominio no tiene posicion para una puntual sobre barra; aplicarla en el
      // apoyo (x=0) la perderia sin avisar. BLOQUEA hasta que haya posicion.
      const m = modeloPortico();
      m.cargas.push({ id: "c2", tipo: "puntual", ambito: "v1", valor: 8, hipotesisId: "h1" });
      const res = discretizar(m);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errores.some((e) => e.codigo === "CARGA_PUNTUAL_SIN_POSICION")).toBe(true);
      }
    });

    it("carga puntual sobre NUDO -> sigue dando node_load (uso valido en F1)", () => {
      const m = modeloPortico();
      m.cargas.push({ id: "c2", tipo: "puntual", ambito: "n2", valor: 8, hipotesisId: "h1" });
      const fem = discretizarOk(m);
      expect(fem.node_loads).toHaveLength(1);
      const nl = fem.node_loads[0];
      expect(nl.direction).toBe("FY");
      expect(nl.P).toBe(-8); // gravitatoria descendente (#3)
      // F1 no emite cargas puntuales sobre barra.
      expect(fem.pt_loads).toHaveLength(0);
    });
  });

  describe("cobertura: pilar pasante, apoyo compartido", () => {
    it("pilar pasante (3 cotas) -> 2 barras compartiendo el nodo intermedio con su viga", () => {
      const m = modeloPortico();
      // Tercera planta intermedia: p0(0) - p1(3) - p2(6). El pilar va de p0 a p2.
      m.plantas.push({ id: "p2", nombre: "Planta 2", cota: 6, altura: 3, grupoId: "g1" });
      m.pilares[0].plantaFinal = "p2";
      // La viga vive en p1 (cota 3) sobre el punto del pilar (2,5): comparte el nudo
      // intermedio del pilar.
      const fem = discretizarOk(m);

      // El pilar se trocea en 2 barras (p0->p1 y p1->p2). La viga es la 3a barra.
      expect(fem.members).toHaveLength(3);
      // Nodos del pilar (X=2, Z=5) a cotas 0, 3, 6.
      const nodosPilar = fem.nodes.filter((n) => n.x === 2 && n.z === 5);
      const cotasPilar = nodosPilar.map((n) => n.y).sort((a, b) => a - b);
      expect(cotasPilar).toEqual([0, 3, 6]);
      // El nodo intermedio (2,3,5) lo comparten el pilar y el arranque de la viga.
      const intermedio = fem.nodes.find((n) => n.x === 2 && n.y === 3 && n.z === 5)!;
      expect(intermedio).toBeDefined();
      // Dos barras del pilar (vertical, x e z constantes) y la viga (que arranca ahi).
      const barrasPilar = fem.members.filter((mm) => {
        const ni = fem.nodes.find((n) => n.name === mm.i)!;
        const nj = fem.nodes.find((n) => n.name === mm.j)!;
        return ni.x === 2 && ni.z === 5 && nj.x === 2 && nj.z === 5;
      });
      expect(barrasPilar).toHaveLength(2);
      // El nodo intermedio es extremo de una barra del pilar y de la viga.
      const tocanIntermedio = fem.members.filter(
        (mm) => mm.i === intermedio.name || mm.j === intermedio.name,
      );
      expect(tocanIntermedio.length).toBeGreaterThanOrEqual(2);
    });

    it("apoyo compartido: dos pilares con vinculacion en el MISMO arranque -> un solo support", () => {
      const m = modeloPortico();
      // Segundo pilar exactamente en el mismo punto/cota de arranque que el primero.
      m.pilares.push({
        id: "pil2", nombre: "P2", x: 2, y: 5,
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION, materialId: MATERIAL, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      });
      const fem = discretizarOk(m);
      // Ambos pilares arrancan en (2,0,5): un unico support en ese nodo, no duplicado.
      const apoyosEnPie = fem.supports.filter((s) => {
        const n = fem.nodes.find((nn) => nn.name === s.node)!;
        return n.x === 2 && n.y === 0 && n.z === 5;
      });
      expect(apoyosEnPie).toHaveLength(1);
    });
  });
});
