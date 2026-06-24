// Test del helper PURO resolverPunto (iman de vigas, feature-12): el iman gana a
// la rejilla cuando hay un punto existente cerca (nudo de viga o cabeza de pilar);
// si no hay nada en el radio, cae al punto ajustado a rejilla. Sin DOM; corre en
// el project `jsdom` por vivir bajo src/ui, pero no necesita render.
import { describe, it, expect } from "vitest";
import { crearModeloVacio } from "../../dominio";
import type { Modelo, Planta, Pilar, Viga, Nudo } from "../../dominio";
import { resolverPunto, RADIO_IMAN_M, PASO_REJILLA_M } from "./imanViga";

const planta = (id: string, cota: number): Planta => ({
  id,
  nombre: id,
  cota,
  altura: 3,
  grupoId: "g1",
});
const nudo = (id: string, x: number, y: number): Nudo => ({ id, x, y });
const pilar = (
  id: string,
  x: number,
  y: number,
  plantaInicial: string,
  plantaFinal: string,
): Pilar => ({
  id,
  nombre: id,
  x,
  y,
  plantaInicial,
  plantaFinal,
  seccionId: "s1",
  materialId: "m1",
  angulo: 0,
  vinculacionExterior: true,
  arranque: "empotrado",
});
const viga = (id: string, plantaId: string, nudoI: string, nudoJ: string): Viga => ({
  id,
  nombre: id,
  plantaId,
  nudoI,
  nudoJ,
  seccionId: "s1",
  materialId: "m1",
  extremoI: "empotrado",
  extremoJ: "empotrado",
  tirante: false,
});

const modeloCon = (patch: Partial<Modelo>): Modelo => ({
  ...crearModeloVacio(),
  plantas: [planta("p0", 0)],
  ...patch,
});

describe("resolverPunto (iman de vigas)", () => {
  it("expone los defaults como constantes con nombre", () => {
    expect(RADIO_IMAN_M).toBe(0.6);
    expect(PASO_REJILLA_M).toBe(0.5);
  });

  it("sin candidatos: cae a la rejilla redondeada", () => {
    const m = modeloCon({});
    // 1.23,2.78 -> redondeo a paso 0.5 => 1.0, 3.0 (no es un punto de obra).
    expect(resolverPunto(m, "p0", 1.23, 2.78)).toEqual({ x: 1.0, y: 3.0 });
  });

  it("iman GANA a la rejilla cuando hay un nudo de viga cercano", () => {
    // Nudo de obra en (5,5); clic en (5.1,5.05) esta dentro del radio (0.6).
    const m = modeloCon({
      nudos: [nudo("n1", 5, 5), nudo("n2", 8, 5)],
      vigas: [viga("v1", "p0", "n1", "n2")],
    });
    expect(resolverPunto(m, "p0", 5.1, 5.05)).toEqual({ nudoId: "n1" });
  });

  it("clic cerca de una cabeza de pilar SIN nudo: engancha a las coords del pilar", () => {
    // Pilar cuyo tramo (cota 0..3) incluye la cota de p0 (0). No hay nudo en (2,2),
    // asi que el iman devuelve las coords del pilar para que crearViga cree el nudo.
    const m = modeloCon({
      plantas: [planta("p0", 0), planta("p1", 3)],
      pilares: [pilar("P1", 2, 2, "p0", "p1")],
    });
    expect(resolverPunto(m, "p0", 2.2, 1.9)).toEqual({ x: 2, y: 2 });
  });

  it("cabeza de pilar CON nudo existente en su (x,y): engancha por id de nudo", () => {
    const m = modeloCon({
      plantas: [planta("p0", 0), planta("p1", 3)],
      nudos: [nudo("nP", 2, 2)],
      pilares: [pilar("P1", 2, 2, "p0", "p1")],
    });
    expect(resolverPunto(m, "p0", 2.1, 2.1)).toEqual({ nudoId: "nP" });
  });

  it("pilar cuyo tramo NO alcanza la cota de la planta: no engancha, cae a rejilla", () => {
    // Pilar de p1(3)..p2(6); clic en planta p0(0): el tramo no llega a cota 0.
    const m = modeloCon({
      plantas: [planta("p0", 0), planta("p1", 3), planta("p2", 6)],
      pilares: [pilar("P1", 2, 2, "p1", "p2")],
    });
    expect(resolverPunto(m, "p0", 2.0, 2.0)).toEqual({ x: 2.0, y: 2.0 });
  });

  it("candidato fuera del radio: no engancha, cae a rejilla", () => {
    // Nudo en (5,5), clic en (6,6): dist ~1.41 > 0.6. Cae a rejilla (6,6).
    const m = modeloCon({
      nudos: [nudo("n1", 5, 5), nudo("n2", 8, 5)],
      vigas: [viga("v1", "p0", "n1", "n2")],
    });
    expect(resolverPunto(m, "p0", 6, 6)).toEqual({ x: 6, y: 6 });
  });

  it("elige el candidato MAS cercano cuando hay varios en el radio", () => {
    const m = modeloCon({
      nudos: [nudo("cerca", 5.1, 5), nudo("lejos", 5.5, 5), nudo("n3", 8, 5)],
      vigas: [viga("v1", "p0", "cerca", "n3"), viga("v2", "p0", "lejos", "n3")],
    });
    expect(resolverPunto(m, "p0", 5, 5)).toEqual({ nudoId: "cerca" });
  });

  it("respeta radioIman y pasoRejilla pasados por opts", () => {
    const m = modeloCon({
      nudos: [nudo("n1", 5, 5), nudo("n2", 8, 5)],
      vigas: [viga("v1", "p0", "n1", "n2")],
    });
    // Con radio 0.05, el clic en (5.1,5) queda fuera -> rejilla con paso 1 => (5,5).
    expect(
      resolverPunto(m, "p0", 5.1, 5, { radioIman: 0.05, pasoRejilla: 1 }),
    ).toEqual({ x: 5, y: 5 });
  });

  it("snapRejilla=false: sin candidato devuelve coords CRUDAS (no rejilla)", () => {
    // Paridad con ColocacionPilar/snapActivo: con snap off, el fallback NO ajusta a
    // rejilla. El clic en (6.37, 6.42) sin candidato cercano sale tal cual.
    const m = modeloCon({
      nudos: [nudo("n1", 5, 5), nudo("n2", 8, 5)],
      vigas: [viga("v1", "p0", "n1", "n2")],
    });
    expect(
      resolverPunto(m, "p0", 6.37, 6.42, { snapRejilla: false }),
    ).toEqual({ x: 6.37, y: 6.42 });
  });

  it("snapRejilla=false: el iman a un nudo SIGUE enganchando (osnap independiente del snap)", () => {
    // Aunque el snap a rejilla este off, el iman a un nudo existente sigue activo.
    const m = modeloCon({
      nudos: [nudo("n1", 5, 5), nudo("n2", 8, 5)],
      vigas: [viga("v1", "p0", "n1", "n2")],
    });
    expect(
      resolverPunto(m, "p0", 5.1, 5.05, { snapRejilla: false }),
    ).toEqual({ nudoId: "n1" });
  });

  // --- Iman a entidades DXF (feature-15): obra > DXF > rejilla ----------------

  it("engancha a un punto DXF dentro del radio cuando no hay obra cerca", () => {
    // Sin nudos/pilares; un punto de calco en (3,3); clic en (3.1,2.95) en radio.
    const m = modeloCon({});
    expect(
      resolverPunto(m, "p0", 3.1, 2.95, { puntosSnapExtra: [{ x: 3, y: 3 }] }),
    ).toEqual({ x: 3, y: 3 });
  });

  it("la obra GANA al DXF cuando ambos estan en radio", () => {
    // Nudo de obra en (5,5) y punto DXF en (5.3,5); clic en (5.1,5). Ambos dentro
    // del radio (0.6) pero la obra tiene prioridad: engancha al nudo por id.
    const m = modeloCon({
      nudos: [nudo("n1", 5, 5), nudo("n2", 8, 5)],
      vigas: [viga("v1", "p0", "n1", "n2")],
    });
    expect(
      resolverPunto(m, "p0", 5.1, 5, { puntosSnapExtra: [{ x: 5.3, y: 5 }] }),
    ).toEqual({ nudoId: "n1" });
  });

  it("DXF fuera del radio: cae a la rejilla", () => {
    // Punto DXF en (3,3) pero clic en (5.1,5.1): >0.6 del DXF y sin obra -> rejilla.
    const m = modeloCon({});
    expect(
      resolverPunto(m, "p0", 5.1, 5.1, { puntosSnapExtra: [{ x: 3, y: 3 }] }),
    ).toEqual({ x: 5, y: 5 });
  });

  it("elige el punto DXF MAS cercano entre varios en radio", () => {
    const m = modeloCon({});
    expect(
      resolverPunto(m, "p0", 3, 3, {
        puntosSnapExtra: [
          { x: 3.4, y: 3 },
          { x: 3.1, y: 3 },
        ],
      }),
    ).toEqual({ x: 3.1, y: 3 });
  });

  it("snapRejilla=false: NO engancha al DXF (el calco va con el interruptor de snap)", () => {
    // Con snap off, ni rejilla ni DXF: coords crudas. (El osnap a OBRA sigue activo,
    // pero aqui no hay obra.)
    const m = modeloCon({});
    expect(
      resolverPunto(m, "p0", 3.1, 2.95, {
        snapRejilla: false,
        puntosSnapExtra: [{ x: 3, y: 3 }],
      }),
    ).toEqual({ x: 3.1, y: 2.95 });
  });
});
