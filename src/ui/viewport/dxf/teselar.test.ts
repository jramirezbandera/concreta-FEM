// Tests de verticesArco (feature-15, T2): teselado puro de arcos DXF. El caso clave
// es el arco que cruza 0 grados (350->10): debe barrer +20 CCW (corto), NO -340.
import { describe, it, expect } from "vitest";
import { verticesArco } from "./teselar";

const SEG = 48; // segmentos de un circulo completo
const grados = (d: number) => (d * Math.PI) / 180;

// (x,y) inicial y final de la polilinea devuelta (pares planos x,y,x,y,...).
function extremos(v: number[]): { ini: [number, number]; fin: [number, number] } {
  return {
    ini: [v[0]!, v[1]!],
    fin: [v[v.length - 2]!, v[v.length - 1]!],
  };
}

describe("verticesArco", () => {
  it("un arco 350->10 barre +20 CCW (corto), no 340", () => {
    const v = verticesArco(0, 0, 1, grados(350), grados(10), SEG);
    const { ini, fin } = extremos(v);

    // Empieza en 350 grados y TERMINA en 10 grados (= 370 CCW), no en 350-340.
    expect(ini[0]).toBeCloseTo(Math.cos(grados(350)), 5);
    expect(ini[1]).toBeCloseTo(Math.sin(grados(350)), 5);
    expect(fin[0]).toBeCloseTo(Math.cos(grados(10)), 5);
    expect(fin[1]).toBeCloseTo(Math.sin(grados(10)), 5);

    // ~20 grados -> ceil(48*20/360)=3 pasos = 3 segmentos = 12 numeros. Un barrido
    // de 340 daria ~46 pasos (>180 numeros): este test caza ese bug.
    expect(v.length).toBeLessThan(20);
  });

  it("un arco 0->90 empieza en +X y termina en +Y", () => {
    const v = verticesArco(0, 0, 2, 0, grados(90), SEG);
    const { ini, fin } = extremos(v);
    expect(ini[0]).toBeCloseTo(2, 5);
    expect(ini[1]).toBeCloseTo(0, 5);
    expect(fin[0]).toBeCloseTo(0, 5);
    expect(fin[1]).toBeCloseTo(2, 5);
  });

  it("un circulo completo (0->2pi) usa la resolucion de SEG segmentos", () => {
    const v = verticesArco(1, 1, 1, 0, Math.PI * 2, SEG);
    // SEG segmentos * 2 puntos * 2 coords.
    expect(v.length).toBe(SEG * 2 * 2);
  });

  it("respeta el centro: el primer punto es centro + (r,0) a 0 grados", () => {
    const v = verticesArco(5, -3, 2, 0, grados(90), SEG);
    expect(v[0]).toBeCloseTo(7, 5); // 5 + 2
    expect(v[1]).toBeCloseTo(-3, 5);
  });
});
