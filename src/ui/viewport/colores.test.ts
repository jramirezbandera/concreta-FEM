// Tests de rampaIsovalores (colores.ts): la rampa de color de isovalores/deformada
// interpola entre las 5 paradas del Spec §1.4 en posiciones NO equidistantes
// (0/0.28/0.52/0.74/1). Verifica que en la posicion de cada parada cae EXACTAMENTE su
// color (sin mezcla) y que leyenda 3D y CSS comparten esas paradas (RAMPA_PARADAS_POS).
// Sin DOM: cae al fallback hex del Spec (getComputedStyle no existe en node).
import { describe, it, expect } from "vitest";
import { Color } from "three";
import { rampaIsovalores, RAMPA_PARADAS_POS, colorToken, hexToken } from "./colores";

// Fallback del Spec §1.4 (DEBE coincidir con tokens.css --ramp-0..4).
const HEX = ["#2563eb", "#38bdf8", "#22c55e", "#f59e0b", "#dc2626"] as const;

function hexEn(t: number): string {
  const c = new Color();
  rampaIsovalores(t, c);
  return `#${c.getHexString()}`;
}

describe("rampaIsovalores · paradas del Spec §1.4", () => {
  it("las posiciones de parada son 0/0.28/0.52/0.74/1 (no equidistantes)", () => {
    expect(Array.from(RAMPA_PARADAS_POS)).toEqual([0, 0.28, 0.52, 0.74, 1.0]);
  });

  it("en la posicion de cada parada devuelve EXACTAMENTE su color", () => {
    RAMPA_PARADAS_POS.forEach((pos, i) => {
      expect(hexEn(pos)).toBe(HEX[i]);
    });
  });

  it("t=0.28 cae exactamente en --ramp-1 (#38bdf8), no en una mezcla equidistante", () => {
    // Antes (paradas equidistantes 0/.25/.5/.75/1) t=0.28 daba una mezcla ramp-1/ramp-2;
    // con las paradas del Spec cae justo en ramp-1.
    expect(hexEn(0.28)).toBe("#38bdf8");
  });

  it("acota fuera de rango a los extremos", () => {
    expect(hexEn(-1)).toBe(HEX[0]);
    expect(hexEn(2)).toBe(HEX[4]);
  });

  it("interpola dentro de un tramo (mezcla intermedia entre dos paradas)", () => {
    // Punto medio del primer tramo [0, 0.28]: ni ramp-0 ni ramp-1 puros.
    const medio = hexEn(0.14);
    expect(medio).not.toBe(HEX[0]);
    expect(medio).not.toBe(HEX[1]);
  });
});

// Token propio del paño (UX-C13/G11): --pano / --pano-line, ampliacion del mapa §1.3.
// El fallback de colores.ts DEBE coincidir con tokens.css. Sin DOM (Node) se resuelve al
// fallback; este test lo fija para que un cambio de tokens.css sin actualizar el fallback
// (o viceversa) se detecte aqui, y comprueba que NO colisiona con los tokens vecinos del
// mapa (pilar/viga/muro), que era el bug (el paño reusaba el token del pilar).
describe("token del paño · --pano / --pano-line (Spec §1.3, ampliacion)", () => {
  it("hexToken('pano') y ('panoLine') caen en el fallback documentado (sage)", () => {
    expect(hexToken("pano")).toBe("#8fb5a3");
    expect(hexToken("panoLine")).toBe("#a7c8bb");
  });

  it("colorToken('pano') es un THREE.Color con ese hex", () => {
    expect(`#${colorToken("pano").getHexString()}`).toBe("#8fb5a3");
  });

  it("el paño NO comparte color con pilar/viga/muro (mapa color->elemento)", () => {
    const pano = hexToken("pano");
    expect(pano).not.toBe(hexToken("pilar"));
    expect(pano).not.toBe(hexToken("viga"));
    // --muro no tiene entrada en colores.ts (no se dibuja aun); se comprueba el literal
    // de tokens.css para que ampliar el mapa no reintroduzca la colision.
    expect(pano).not.toBe("#7c8aa3");
  });
});
