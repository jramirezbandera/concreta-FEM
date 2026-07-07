// Tests del helper PURO ejeLocalY (replica de Pynite/Member3D.py::T(), wheel 2.0.2).
// Corre en el project node (sin React/R3F). Cubre los tres casos de PyNite (vertical
// ascendente/descendente, horizontal +X/+Z, inclinado), el giro `rotation` (grados,
// Rodrigues) y la barra degenerada (L≈0 -> null). Los valores esperados salen de
// aplicar la formula de PyNite a mano.
import { describe, it, expect } from "vitest";
import { ejeLocalY, type Vec3FEM } from "./ejesLocalesFEM";

// Compara componente a componente con tolerancia (los productos vectoriales generan
// ruido float; igualdad estricta seria fragil).
function esperaVec(v: Vec3FEM | null, esperado: Vec3FEM): void {
  expect(v).not.toBeNull();
  expect(v![0]).toBeCloseTo(esperado[0], 10);
  expect(v![1]).toBeCloseTo(esperado[1], 10);
  expect(v![2]).toBeCloseTo(esperado[2], 10);
}

describe("ejeLocalY (convenio PyNite 2.0.2)", () => {
  it("pilar vertical ASCENDENTE (pie->cabeza, el caso del discretizador) -> y=[-1,0,0]", () => {
    const y = ejeLocalY({ x: 2, y: 0, z: 3 }, { x: 2, y: 3, z: 3 }, 0);
    esperaVec(y, [-1, 0, 0]);
  });

  it("pilar vertical DESCENDENTE -> y=[1,0,0]", () => {
    const y = ejeLocalY({ x: 2, y: 3, z: 3 }, { x: 2, y: 0, z: 3 }, 0);
    esperaVec(y, [1, 0, 0]);
  });

  it("viga horizontal en +X -> y=[0,1,0] (la vertical global)", () => {
    const y = ejeLocalY({ x: 0, y: 3, z: 0 }, { x: 5, y: 3, z: 0 }, 0);
    esperaVec(y, [0, 1, 0]);
  });

  it("viga horizontal en +Z -> y=[0,1,0] (mismo convenio en cualquier rumbo)", () => {
    const y = ejeLocalY({ x: 1, y: 3, z: 0 }, { x: 1, y: 3, z: 4 }, 0);
    esperaVec(y, [0, 1, 0]);
  });

  it("barra INCLINADA ascendente en el plano XY -> y con componente ascendente", () => {
    // i=(0,0,0), j=(1,1,0): x=[1,1,0]/√2; proj=[1,0,0]; Yj>Yi -> z=proj×x=[0,0,1]/‖·‖;
    // y=z×x = [0,0,1]×[1,1,0]/√2 = [-1,1,0]/√2. Componente Y positiva (PyNite: "the top
    // of the beam is always on top").
    const y = ejeLocalY({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, 0);
    const r = Math.SQRT1_2;
    esperaVec(y, [-r, r, 0]);
  });

  it("rotation=90 (grados) gira y hacia x×y: viga +X pasa de [0,1,0] a [0,0,1]", () => {
    // x=[1,0,0], y0=[0,1,0]; x×y0=[0,0,1]. Con θ=90: y' = y0·cos90 + (x×y0)·sin90 = [0,0,1].
    const y = ejeLocalY({ x: 0, y: 3, z: 0 }, { x: 5, y: 3, z: 0 }, 90);
    esperaVec(y, [0, 0, 1]);
  });

  it("rotation=45 en pilar ascendente: y0=[-1,0,0] gira hacia z0=[0,0,1]", () => {
    // x=[0,1,0], y0=[-1,0,0]; x×y0 = [0,1,0]×[-1,0,0] = [0*0-0*0, 0*(-1)-0*0, 0*0-1*(-1)]
    // = [0,0,1]. θ=45: y' = [-cos45, 0, sin45].
    const y = ejeLocalY({ x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 0 }, 45);
    const r = Math.SQRT1_2;
    esperaVec(y, [-r, 0, r]);
  });

  it("rotation=360 equivale a 0 (vuelta completa)", () => {
    const y = ejeLocalY({ x: 0, y: 3, z: 0 }, { x: 5, y: 3, z: 0 }, 360);
    esperaVec(y, [0, 1, 0]);
  });

  it("barra degenerada (i==j) -> null (se omite, nunca lanza)", () => {
    expect(ejeLocalY({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, 0)).toBeNull();
  });
});
