// Tests del modulo PURO del rayado de viguetas (F3, unidireccional). Node puro (sin
// three/R3F): verifican el reparto (n = max(1, round(B/intereje)), s = B/n, linea k en
// min + s·(k+½)), la direccion y los casos degenerados. El rayado dibujado debe COINCIDIR
// con las viguetas que el discretizador monta (mismo criterio que generarViguetas), por eso
// se blinda el reparto aqui.
import { describe, it, expect } from "vitest";
import { numeroViguetas, verticesRayado } from "./panoRayadoGeometria";

// Rectangulo de ejes [0,ancho] x [0,alto].
function rect(ancho: number, alto: number): { x: number; y: number }[] {
  return [
    { x: 0, y: 0 },
    { x: ancho, y: 0 },
    { x: ancho, y: alto },
    { x: 0, y: alto },
  ];
}

// Pares (x0,y0,x1,y1) -> segmentos [{a:{x,y}, b:{x,y}}].
function segmentos(v: number[]): { a: { x: number; y: number }; b: { x: number; y: number } }[] {
  const out = [];
  for (let i = 0; i < v.length; i += 4) {
    out.push({ a: { x: v[i]!, y: v[i + 1]! }, b: { x: v[i + 2]!, y: v[i + 3]! } });
  }
  return out;
}

describe("numeroViguetas", () => {
  it("redondea B/intereje y nunca baja de 1", () => {
    expect(numeroViguetas(5, 1)).toBe(5);
    expect(numeroViguetas(5.4, 1)).toBe(5); // round(5.4)=5
    expect(numeroViguetas(5.6, 1)).toBe(6); // round(5.6)=6
    // Paño mas estrecho que el intereje: max(1,0) = 1 (no pierde la lectura de direccion).
    expect(numeroViguetas(0.4, 1)).toBe(1);
    expect(numeroViguetas(1, 100)).toBe(1);
  });
  it("devuelve 0 ante ancho/intereje no positivos (degenerado)", () => {
    expect(numeroViguetas(0, 1)).toBe(0);
    expect(numeroViguetas(5, 0)).toBe(0);
    expect(numeroViguetas(-1, 1)).toBe(0);
  });
});

describe("verticesRayado", () => {
  it("direccion 'x': lineas paralelas al eje X, repartidas en Y a s = B/n", () => {
    // Ancho en Y (eje de reparto) = 4, intereje 1 -> n = 4, s = 1.
    const v = verticesRayado({ contorno: rect(6, 4), direccion: "x", intereje: 1 });
    const segs = segmentos(v);
    expect(segs).toHaveLength(4);
    // Cada linea recorre X de 0 a 6 (la luz), a la Y de su vigueta.
    const ys = segs.map((s) => {
      expect(s.a.x).toBe(0);
      expect(s.b.x).toBe(6);
      expect(s.a.y).toBe(s.b.y); // horizontal
      return s.a.y;
    });
    // Vigueta k en y = s·(k+½) = 0.5, 1.5, 2.5, 3.5.
    expect(ys).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  it("direccion 'y': lineas paralelas al eje Y, repartidas en X a s = B/n", () => {
    // Ancho en X (eje de reparto) = 6, intereje 2 -> n = 3, s = 2.
    const v = verticesRayado({ contorno: rect(6, 4), direccion: "y", intereje: 2 });
    const segs = segmentos(v);
    expect(segs).toHaveLength(3);
    const xs = segs.map((s) => {
      expect(s.a.y).toBe(0);
      expect(s.b.y).toBe(4);
      expect(s.a.x).toBe(s.b.x); // vertical
      return s.a.x;
    });
    // Vigueta k en x = 2·(k+½) = 1, 3, 5.
    expect(xs).toEqual([1, 3, 5]);
  });

  it("reparte el ancho a partes iguales (s = B/n exacto): las lineas cubren B centradas", () => {
    // B = 4, intereje 1.5 -> n = round(2.67) = 3, s = 4/3.
    const v = verticesRayado({ contorno: rect(6, 4), direccion: "x", intereje: 1.5 });
    const segs = segmentos(v);
    expect(segs).toHaveLength(3);
    const s = 4 / 3;
    const esperado = [s * 0.5, s * 1.5, s * 2.5];
    segs.forEach((seg, k) => expect(seg.a.y).toBeCloseTo(esperado[k]!, 10));
    // Simetria: la ultima esta tan lejos del borde superior (yMax=4) como la primera del
    // inferior (yMin=0). s·0.5 == 4 - s·2.5.
    expect(segs[0]!.a.y).toBeCloseTo(4 - segs[2]!.a.y, 10);
  });

  it("paño mas estrecho que el intereje: una sola linea centrada (n=1)", () => {
    // B en Y = 0.4, intereje 1 -> n = 1, s = 0.4, linea en y = 0.2 (centro).
    const v = verticesRayado({ contorno: rect(3, 0.4), direccion: "x", intereje: 1 });
    const segs = segmentos(v);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.a.y).toBeCloseTo(0.2, 10);
  });

  it("contorno degenerado (sin area) o vacio -> [] sin lanzar", () => {
    expect(verticesRayado({ contorno: [], direccion: "x", intereje: 1 })).toEqual([]);
    // Linea (ancho Y = 0): degenerado.
    const linea = [
      { x: 0, y: 1 },
      { x: 5, y: 1 },
    ];
    expect(verticesRayado({ contorno: linea, direccion: "x", intereje: 1 })).toEqual([]);
  });

  it("resuelve el bbox desde un contorno no ordenado desde el origen", () => {
    // Rectangulo [2,8] x [3,7]: B en Y = 4, intereje 2 -> n = 2, s = 2, y = 4, 6.
    const contorno = [
      { x: 8, y: 7 },
      { x: 2, y: 7 },
      { x: 2, y: 3 },
      { x: 8, y: 3 },
    ];
    const v = verticesRayado({ contorno, direccion: "x", intereje: 2 });
    const segs = segmentos(v);
    expect(segs).toHaveLength(2);
    segs.forEach((s) => {
      expect(s.a.x).toBe(2);
      expect(s.b.x).toBe(8);
    });
    expect(segs.map((s) => s.a.y)).toEqual([4, 6]);
  });
});
