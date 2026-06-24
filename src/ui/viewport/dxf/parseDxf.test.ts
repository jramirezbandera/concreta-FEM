import { describe, it, expect } from "vitest";
import { parseDxf } from "./parseDxf";
import {
  dxfConEntidades,
  lineDxf,
  lwpolylineDxf,
  pointDxf,
  circleDxf,
  arcDxf,
  textDxf,
} from "./fixtures";
import type { EntidadDxf } from "./tiposDxf";

// Helper: primera entidad de un tipo concreto (acota la union para los asserts).
function deTipo<T extends EntidadDxf["tipo"]>(
  entidades: EntidadDxf[],
  tipo: T,
): Extract<EntidadDxf, { tipo: T }> {
  const e = entidades.find((x) => x.tipo === tipo);
  if (!e) throw new Error(`no se encontro entidad ${tipo}`);
  return e as Extract<EntidadDxf, { tipo: T }>;
}

describe("parseDxf", () => {
  it("parsea LINE como linea con sus dos extremos (sin $INSUNITS => metros)", async () => {
    const dxf = dxfConEntidades(lineDxf(0, 0, 3, 4));
    const { entidades, avisos } = await parseDxf(dxf);
    const linea = deTipo(entidades, "linea");
    expect(linea).toEqual({ tipo: "linea", x1: 0, y1: 0, x2: 3, y2: 4 });
    // Sin header de unidades: se asume metros y se avisa.
    expect(avisos.some((a) => a.includes("$INSUNITS"))).toBe(true);
  });

  it("parsea LWPOLYLINE abierta y cerrada con su flag", async () => {
    const abierta = await parseDxf(
      dxfConEntidades(
        lwpolylineDxf(
          [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
          false,
        ),
      ),
    );
    const pa = deTipo(abierta.entidades, "polilinea");
    expect(pa.cerrada).toBe(false);
    expect(pa.puntos).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);

    const cerrada = await parseDxf(
      dxfConEntidades(
        lwpolylineDxf(
          [
            [0, 0],
            [2, 0],
          ],
          true,
        ),
      ),
    );
    expect(deTipo(cerrada.entidades, "polilinea").cerrada).toBe(true);
  });

  it("parsea POINT", async () => {
    const { entidades } = await parseDxf(dxfConEntidades(pointDxf(5, 7)));
    expect(deTipo(entidades, "punto")).toEqual({ tipo: "punto", x: 5, y: 7 });
  });

  it("parsea CIRCLE y ARC (angulos del arco en radianes)", async () => {
    const { entidades } = await parseDxf(
      dxfConEntidades(circleDxf(1, 2, 3) + "\n" + arcDxf(0, 0, 1, 0, 90)),
    );
    expect(deTipo(entidades, "circulo")).toEqual({
      tipo: "circulo",
      cx: 1,
      cy: 2,
      r: 3,
    });
    const arco = deTipo(entidades, "arco");
    expect(arco.cx).toBe(0);
    expect(arco.r).toBe(1);
    expect(arco.anguloInicio).toBeCloseTo(0, 10);
    expect(arco.anguloFin).toBeCloseTo(Math.PI / 2, 10);
  });

  it("calcula la bbox de todas las entidades soportadas", async () => {
    const dxf = dxfConEntidades(
      lineDxf(0, 0, 3, 4) + "\n" + pointDxf(-2, 10),
    );
    const { bbox } = await parseDxf(dxf);
    expect(bbox).toEqual({ minX: -2, minY: 0, maxX: 3, maxY: 10 });
  });

  it("incluye el radio del circulo en la bbox", async () => {
    const { bbox } = await parseDxf(dxfConEntidades(circleDxf(0, 0, 5)));
    expect(bbox).toEqual({ minX: -5, minY: -5, maxX: 5, maxY: 5 });
  });

  it("convierte unidades a metros segun $INSUNITS=4 (mm)", async () => {
    // 1000 mm -> 1 m.
    const dxf = dxfConEntidades(lineDxf(0, 0, 1000, 2000), { insunits: 4 });
    const { entidades, bbox, avisos } = await parseDxf(dxf);
    const linea = deTipo(entidades, "linea");
    expect(linea).toEqual({ tipo: "linea", x1: 0, y1: 0, x2: 1, y2: 2 });
    expect(bbox).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 2 });
    // mm es una unidad reconocida: no debe avisar de unidades.
    expect(avisos).toEqual([]);
  });

  it("convierte cm ($INSUNITS=5) a metros", async () => {
    const dxf = dxfConEntidades(pointDxf(100, 250), { insunits: 5 });
    const { entidades } = await parseDxf(dxf);
    expect(deTipo(entidades, "punto")).toEqual({ tipo: "punto", x: 1, y: 2.5 });
  });

  it("recopila los tipos no soportados sin duplicados", async () => {
    const dxf = dxfConEntidades(
      textDxf(1, 1, "A") + "\n" + textDxf(2, 2, "B") + "\n" + lineDxf(0, 0, 1, 1),
    );
    const { entidades, noSoportadas } = await parseDxf(dxf);
    // La linea si se parsea; el TEXT (x2) aparece una sola vez en noSoportadas.
    expect(entidades.some((e) => e.tipo === "linea")).toBe(true);
    expect(noSoportadas).toEqual(["TEXT"]);
  });

  it("avisa cuando las unidades son desconocidas (codigo raro)", async () => {
    const dxf = dxfConEntidades(pointDxf(1, 1), { insunits: 99 });
    const { entidades, avisos } = await parseDxf(dxf);
    // Sin conversion (factor 1) y con aviso.
    expect(deTipo(entidades, "punto")).toEqual({ tipo: "punto", x: 1, y: 1 });
    expect(avisos.some((a) => a.includes("no reconocidas"))).toBe(true);
  });

  it("es defensivo: texto basura no lanza y devuelve listas vacias", async () => {
    const { entidades, bbox, noSoportadas } = await parseDxf(
      "esto no es un DXF valido",
    );
    expect(entidades).toEqual([]);
    expect(noSoportadas).toEqual([]);
    // bbox degenerada (sin geometria).
    expect(bbox).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it("DXF sin entidades: bbox degenerada, sin crash", async () => {
    const { entidades, bbox } = await parseDxf(dxfConEntidades(""));
    expect(entidades).toEqual([]);
    expect(bbox).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});
