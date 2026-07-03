// Tests de cargasGrupo (F3.2, D-1): la FUENTE UNICA de las cargas automaticas de
// grupo sobre paños [2A] y su integracion con generarCombos (mismo criterio de
// activacion: sin consumidor, sin termino fantasma). Node puro.
import { describe, it, expect } from "vitest";
import {
  CASE_CM_GRUPO,
  CASE_USO_GRUPO,
  cargasGrupoDePano,
  casesGrupoActivos,
  gruposConValorNegativo,
} from "./cargasGrupo";
import { generarCombos } from "./combinaciones";
import { GAMMA_G_DESFAV, GAMMA_Q_DESFAV, GAMMA_ELS } from "../biblioteca";
import type { Modelo, Pano } from "../dominio";
import { SCHEMA_VERSION } from "../dominio";

function modeloConPano(opts?: {
  sobrecargaUso?: number;
  cargasMuertas?: number;
  sinPano?: boolean;
  tipoPano?: Pano["tipo"];
}): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [
      {
        id: "g1", nombre: "Grupo 1", categoriaUso: "A",
        sobrecargaUso: opts?.sobrecargaUso ?? 2,
        cargasMuertas: opts?.cargasMuertas ?? 1,
      },
    ],
    plantas: [{ id: "p1", nombre: "Planta 1", cota: 3, altura: 3, grupoId: "g1" }],
    secciones: [],
    nudos: [
      { id: "q1", x: 0, y: 0 },
      { id: "q2", x: 4, y: 0 },
      { id: "q3", x: 4, y: 3 },
      { id: "q4", x: 0, y: 3 },
    ],
    pilares: [],
    vigas: [],
    panos: opts?.sinPano
      ? []
      : [
          {
            id: "f1", nombre: "F1", tipo: opts?.tipoPano ?? "losa", plantaId: "p1",
            perimetro: ["q1", "q2", "q3", "q4"],
            espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "simple",
          },
        ],
    muros: [],
    cargas: [],
    hipotesis: [{ id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false }],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
  };
}

describe("cargasGrupoDePano", () => {
  it("emite CM (G) y uso (Q) del grupo de la planta del paño, en ese orden", () => {
    const m = modeloConPano({ cargasMuertas: 1.5, sobrecargaUso: 2 });
    expect(cargasGrupoDePano(m, m.panos[0])).toEqual([
      { case: CASE_CM_GRUPO, presion: 1.5 },
      { case: CASE_USO_GRUPO, presion: 2 },
    ]);
  });

  it("valor 0 o negativo NO se emite (el negativo lo avisa validaciones)", () => {
    const m = modeloConPano({ cargasMuertas: 0, sobrecargaUso: -2 });
    expect(cargasGrupoDePano(m, m.panos[0])).toEqual([]);
  });

  it("paño no losa o con planta/grupo irresolubles -> [] (sin lanzar)", () => {
    const ret = modeloConPano({ tipoPano: "reticular" });
    expect(cargasGrupoDePano(ret, ret.panos[0])).toEqual([]);
    const rota = modeloConPano();
    rota.panos[0] = { ...rota.panos[0], plantaId: "NO_EXISTE" };
    expect(cargasGrupoDePano(rota, rota.panos[0])).toEqual([]);
  });
});

describe("casesGrupoActivos + generarCombos (fuente unica, sin termino fantasma)", () => {
  it("con paño y valores > 0: los cases sinteticos entran en ELU/ELS con su gamma", () => {
    const m = modeloConPano();
    expect(casesGrupoActivos(m)).toEqual({ cm: true, uso: true });
    const combos = generarCombos(m);
    const elu = combos.find((c) => c.name === "ELU")!;
    const els = combos.find((c) => c.name === "ELS")!;
    expect(elu.factors[CASE_CM_GRUPO]).toBe(GAMMA_G_DESFAV); // G: 1,35
    expect(elu.factors[CASE_USO_GRUPO]).toBe(GAMMA_Q_DESFAV); // Q: 1,50
    expect(els.factors[CASE_CM_GRUPO]).toBe(GAMMA_ELS);
    expect(els.factors[CASE_USO_GRUPO]).toBe(GAMMA_ELS);
  });

  it("SIN paños: combos byte-identicos a los de siempre (sin claves sinteticas)", () => {
    const m = modeloConPano({ sinPano: true });
    expect(casesGrupoActivos(m)).toEqual({ cm: false, uso: false });
    const combos = generarCombos(m);
    for (const combo of combos) {
      expect(combo.factors[CASE_CM_GRUPO]).toBeUndefined();
      expect(combo.factors[CASE_USO_GRUPO]).toBeUndefined();
    }
  });

  it("grupo a CERO con paño: sin cases sinteticos (sin termino fantasma, espejo E4)", () => {
    const m = modeloConPano({ cargasMuertas: 0, sobrecargaUso: 0 });
    expect(casesGrupoActivos(m)).toEqual({ cm: false, uso: false });
    const elu = generarCombos(m).find((c) => c.name === "ELU")!;
    expect(elu.factors[CASE_CM_GRUPO]).toBeUndefined();
    expect(elu.factors[CASE_USO_GRUPO]).toBeUndefined();
  });

  it("solo CM > 0: entra el case de CM y NO el de uso (activacion por case)", () => {
    const m = modeloConPano({ cargasMuertas: 1, sobrecargaUso: 0 });
    expect(casesGrupoActivos(m)).toEqual({ cm: true, uso: false });
    const elu = generarCombos(m).find((c) => c.name === "ELU")!;
    expect(elu.factors[CASE_CM_GRUPO]).toBe(GAMMA_G_DESFAV);
    expect(elu.factors[CASE_USO_GRUPO]).toBeUndefined();
  });
});

describe("gruposConValorNegativo", () => {
  it("detecta el negativo SOLO si el grupo tiene paños losa que lo recibirian", () => {
    const con = modeloConPano({ cargasMuertas: -1 });
    expect(gruposConValorNegativo(con)).toEqual([
      { grupoId: "g1", nombre: "Grupo 1", campo: "cargasMuertas" },
    ]);
    const sin = modeloConPano({ cargasMuertas: -1, sinPano: true });
    expect(gruposConValorNegativo(sin)).toEqual([]);
  });
});
