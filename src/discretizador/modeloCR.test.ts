// Tests PUROS de prepararModeloCR (F1.1, centro de rigidez). Corre en Node (sin
// Pyodide): demuestra (1) maestro=centroide, (2) que el modeloFEM base NO lleva cargas
// de usuario, (3) que una planta sin nudos se omite, (4) el FACTORING (Codex #15): un
// modelo con carga superficial — que `discretizar` BLOQUEARIA — SI produce CR ok, y
// (5) que referencias rotas / sin sujecion dan ok:false en lenguaje de obra.
import { describe, it, expect } from "vitest";
import { prepararModeloCR } from "./modeloCR";
import { discretizar } from "./discretizar";
import { SCHEMA_VERSION } from "../dominio";
import type { Modelo } from "../dominio";

const MATERIAL = "S275"; // acero del catalogo (rho>0)

// Seccion generica de obra (A/Iy/Iz/J directos): evita depender del catalogo PERFILES.
function seccion(id: string) {
  return {
    id,
    nombre: id,
    tipo: "generico" as const,
    A: 0.01,
    Iy: 1e-4,
    Iz: 1e-4,
    J: 1e-6,
  };
}

const GRUPO = {
  id: "g1",
  nombre: "Grupo",
  categoriaUso: "A" as const,
  sobrecargaUso: 2,
  cargasMuertas: 1,
};

function pilar(id: string, x: number, y: number) {
  return {
    id,
    nombre: id.toUpperCase(),
    x,
    y,
    plantaInicial: "p0",
    plantaFinal: "p1",
    seccionId: "sec",
    materialId: MATERIAL,
    angulo: 0,
    vinculacionExterior: true,
    arranque: "empotrado" as const,
  };
}

function viga(id: string, nudoI: string, nudoJ: string) {
  return {
    id,
    nombre: id.toUpperCase(),
    plantaId: "p1",
    nudoI,
    nudoJ,
    seccionId: "sec",
    materialId: MATERIAL,
    extremoI: "empotrado" as const,
    extremoJ: "empotrado" as const,
    tirante: false,
  };
}

// Portico simple de 1 planta: 4 pilares (cuadrado de lado 4) de cota 0 a 3, + 1 viga
// de borde. Sujecion suficiente (4 bases empotradas). Plano X-Z de la planta a Y=3.
function fixturePortico1Planta(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [GRUPO],
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, grupoId: "g1" },
      { id: "p1", nombre: "Planta", cota: 3, altura: 3, grupoId: "g1" },
    ],
    secciones: [seccion("sec")],
    nudos: [
      { id: "na", x: 0, y: 0 },
      { id: "nb", x: 4, y: 0 },
      { id: "nc", x: 4, y: 4 },
      { id: "nd", x: 0, y: 4 },
    ],
    pilares: [
      pilar("pa", 0, 0),
      pilar("pb", 4, 0),
      pilar("pc", 4, 4),
      pilar("pd", 0, 4),
    ],
    vigas: [viga("v1", "na", "nb")],
    panos: [],
    muros: [],
    cargas: [],
    hipotesis: [
      { id: "G", nombre: "Permanente", tipo: "permanente", automatica: false },
    ],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

describe("prepararModeloCR", () => {
  it("maestro = centroide (X,Z) de los nudos de la planta, a la cota de la planta (Y)", () => {
    const res = prepararModeloCR(fixturePortico1Planta());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Dos plantas con nudos: p0 (pies, Y=0) y p1 (cabezas + viga, Y=3).
    const p1 = res.plantasInfo.find((p) => p.plantaId === "p1");
    expect(p1).toBeDefined();
    // Centroide de las 4 cabezas en (0,4),(4,0),(4,4),(0,4 obra) -> FEM (X=obra x,
    // Z=obra y). Las cabezas estan en (0,0),(4,0),(4,4),(0,4) -> centroide (2,2).
    expect(p1!.maestro.x).toBeCloseTo(2, 9);
    expect(p1!.maestro.z).toBeCloseTo(2, 9);
    expect(p1!.maestro.y).toBe(3); // cota de la planta p1 (Y FEM vertical)
    // Los pies estan a Y=0 -> planta p0 (cimentacion); su maestro va a Y=0.
    const p0 = res.plantasInfo.find((p) => p.plantaId === "p0");
    expect(p0).toBeDefined();
    expect(p0!.maestro.y).toBe(0);
    expect(p0!.maestro.x).toBeCloseTo(2, 9);
    expect(p0!.maestro.z).toBeCloseTo(2, 9);
  });

  it("nodos de plantasInfo = todos los nudos FEM de esa planta (cobertura total)", () => {
    const res = prepararModeloCR(fixturePortico1Planta());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // La union de los nodos de todas las plantas = todos los nodes del modeloFEM base.
    const todos = res.plantasInfo.flatMap((p) => p.nodos).sort();
    expect(todos).toEqual(res.modeloFEM.nodes.map((n) => n.name).sort());
    // Plano de planta p1: 4 cabezas (8 pilares? no: 4 pilares, 4 cabezas).
    const p1 = res.plantasInfo.find((p) => p.plantaId === "p1")!;
    expect(p1.nodos).toHaveLength(4);
  });

  it("modeloFEM base SIN cargas de usuario (node/dist/pt loads vacios; combos vacios)", () => {
    const res = prepararModeloCR(fixturePortico1Planta());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.modeloFEM.node_loads).toEqual([]);
    expect(res.modeloFEM.dist_loads).toEqual([]);
    expect(res.modeloFEM.pt_loads).toEqual([]);
    expect(res.modeloFEM.combos).toEqual([]);
    // Pero SI lleva geometria + rigidez.
    expect(res.modeloFEM.members.length).toBeGreaterThan(0);
    expect(res.modeloFEM.supports.length).toBe(4); // 4 bases empotradas
    expect(res.modeloFEM.materials.map((m) => m.name)).toContain(MATERIAL);
  });

  it("incluso con peso propio ACTIVO, el modeloFEM base no emite dist_loads de peso propio", () => {
    // El CR no usa peso propio; aunque el modelo lo tenga activo, la base va sin cargas.
    const m = fixturePortico1Planta();
    const conPP: Modelo = {
      ...m,
      analisis: { ...m.analisis, incluirPesoPropio: true },
      hipotesis: [
        ...m.hipotesis,
        { id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true },
      ],
    };
    const res = prepararModeloCR(conPP);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.modeloFEM.dist_loads).toEqual([]);
  });

  it("planta sin nudos FEM se OMITE de plantasInfo (no es error)", () => {
    // Anade una planta extra (p2, otro grupo/cota) que ningun elemento usa: sin nudos.
    const m = fixturePortico1Planta();
    const conPlantaVacia: Modelo = {
      ...m,
      grupos: [...m.grupos, { ...GRUPO, id: "g2", nombre: "Grupo 2" }],
      plantas: [
        ...m.plantas,
        { id: "p2", nombre: "Vacia", cota: 9, altura: 3, grupoId: "g2" },
      ],
    };
    const res = prepararModeloCR(conPlantaVacia);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // p2 no aparece (no tiene nudos FEM); p0 y p1 si.
    expect(res.plantasInfo.map((p) => p.plantaId).sort()).toEqual(["p0", "p1"]);
  });

  it("plantasInfo en orden determinista por plantaId", () => {
    const res = prepararModeloCR(fixturePortico1Planta());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ids = res.plantasInfo.map((p) => p.plantaId);
    expect(ids).toEqual([...ids].sort());
  });

  it("FACTORING (Codex #15): carga superficial bloquea discretizar pero NO el CR", () => {
    const m = fixturePortico1Planta();
    // Carga superficial sobre un pano inexistente como ambito: pero para que pase
    // validarReferencias necesita un ambito valido. Se aplica sobre la viga v1 (ambito
    // valido) con tipo "superficial": discretizar la BLOQUEA (PANO_NO_SOPORTADO) en su
    // Paso 6 de traduccion de cargas.
    const conSuperficial: Modelo = {
      ...m,
      cargas: [
        { id: "qs", tipo: "superficial", ambito: "v1", valor: 5, hipotesisId: "G" },
      ],
    };
    // discretizar BLOQUEA por la carga superficial.
    const dis = discretizar(conSuperficial);
    expect(dis.ok).toBe(false);
    if (!dis.ok) {
      expect(dis.errores.some((e) => e.codigo === "PANO_NO_SOPORTADO")).toBe(true);
    }
    // El CR NO se bloquea: la carga no afecta a la geometria+rigidez.
    const cr = prepararModeloCR(conSuperficial);
    expect(cr.ok).toBe(true);
    if (!cr.ok) return;
    expect(cr.modeloFEM.dist_loads).toEqual([]);
    expect(cr.plantasInfo.length).toBeGreaterThan(0);
  });

  it("referencia rota (material inexistente) -> ok:false en lenguaje de obra", () => {
    const m = fixturePortico1Planta();
    const conRefRota: Modelo = {
      ...m,
      pilares: m.pilares.map((p) =>
        p.id === "pa" ? { ...p, materialId: "NO_EXISTE" } : p,
      ),
    };
    const res = prepararModeloCR(conRefRota);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errores.some((e) => e.codigo === "REF_MATERIAL")).toBe(true);
  });

  it("sin sujecion -> ok:false en lenguaje de obra (SIN_SUJECION)", () => {
    const m = fixturePortico1Planta();
    const sinSujecion: Modelo = {
      ...m,
      pilares: m.pilares.map((p) => ({ ...p, vinculacionExterior: false })),
    };
    const res = prepararModeloCR(sinSujecion);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errores.some((e) => e.codigo === "SIN_SUJECION")).toBe(true);
  });

  it("determinista: barajar plantas/pilares/vigas NO cambia plantasInfo ni el modeloFEM base", () => {
    const base = fixturePortico1Planta();
    const reordenado: Modelo = {
      ...base,
      plantas: [...base.plantas].reverse(),
      pilares: [...base.pilares].reverse(),
      vigas: [...base.vigas].reverse(),
      nudos: [...base.nudos].reverse(),
    };
    const a = prepararModeloCR(base);
    const b = prepararModeloCR(reordenado);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(b.modeloFEM)).toBe(JSON.stringify(a.modeloFEM));
    expect(JSON.stringify(b.plantasInfo)).toBe(JSON.stringify(a.plantasInfo));
  });
});
