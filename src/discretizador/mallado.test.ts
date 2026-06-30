import { describe, it, expect } from "vitest";
import { mallarPano, CAP_QUADS, type ParametrosMallado, type PuntoPlano } from "./mallado";

// Tests PUROS del mallado (F1.1). Node puro, sin Pyodide, sin verificacion fisica:
// solo la TRADUCCION geometria de paño -> rejilla de quads. Cubre: rejilla correcta y
// determinista (orden de nudos/quads, orden canonico i,j,m,n CCW), nudos de borde,
// estabilizacion en el plano, cap (4A) y geometria degenerada -> error de obra.

// Rectangulo 4x2 m alineado con los ejes, esquina inferior izquierda en el origen.
// Recorrido del perimetro en CCW de entrada (no impone el orden interno).
function rect(
  x0: number,
  y0: number,
  ancho: number,
  alto: number,
): [PuntoPlano, PuntoPlano, PuntoPlano, PuntoPlano] {
  return [
    { x: x0, y: y0 },
    { x: x0 + ancho, y: y0 },
    { x: x0 + ancho, y: y0 + alto },
    { x: x0, y: y0 + alto },
  ];
}

function params(over: Partial<ParametrosMallado> = {}): ParametrosMallado {
  return {
    perimetro: rect(0, 0, 4, 2),
    cota: 3,
    tamMalla: 1,
    indicePano: 0,
    ...over,
  };
}

function mallarOk(p: ParametrosMallado) {
  const res = mallarPano(p);
  if (!res.ok) throw new Error("esperaba ok:true, error: " + JSON.stringify(res.error));
  return res.malla;
}

describe("mallado - rejilla y determinismo", () => {
  it("rectangulo 4x2 con tamMalla 1 -> rejilla 4x2 celdas, 5x3 nudos", () => {
    const m = mallarOk(params());
    expect(m.nx).toBe(4);
    expect(m.ny).toBe(2);
    expect(m.quads).toHaveLength(4 * 2);
    expect(m.nodos).toHaveLength(5 * 3);
    expect(m.capAplicado).toBe(false);
    expect(m.tamMallaEfectivo).toBe(1);
  });

  it("nudos en coords FEM via mapearEjes: plano Y=cota, X=obra-x, Z=obra-y", () => {
    const m = mallarOk(params());
    // Todos los nudos en el plano horizontal Y = cota.
    expect(m.nodos.every((n) => n.y === 3)).toBe(true);
    // Extremos del rectangulo presentes (esquinas en X y Z).
    const xs = m.nodos.map((n) => n.x);
    const zs = m.nodos.map((n) => n.z);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(4, 9);
    expect(Math.min(...zs)).toBeCloseTo(0, 9);
    expect(Math.max(...zs)).toBeCloseTo(2, 9);
    // Equiespaciado en X: paso 4/4 = 1 m.
    const xsUnicos = [...new Set(xs)].sort((a, b) => a - b);
    expect(xsUnicos).toEqual([0, 1, 2, 3, 4]);
  });

  it("orden canonico i,j,m,n del primer quad (CCW visto desde +Y)", () => {
    const m = mallarOk(params());
    const q0 = m.quads[0];
    const byName = new Map(m.nodos.map((n) => [n.name, n]));
    const i = byName.get(q0.i)!;
    const j = byName.get(q0.j)!;
    const mm = byName.get(q0.m)!;
    const nn = byName.get(q0.n)!;
    // i = (xMin,zMin); j = (xMin+paso, zMin); m = (xMin+paso, zMin+paso); n=(xMin, zMin+paso).
    expect([i.x, i.z]).toEqual([0, 0]);
    expect([j.x, j.z]).toEqual([1, 0]);
    expect([mm.x, mm.z]).toEqual([1, 1]);
    expect([nn.x, nn.z]).toEqual([0, 1]);
    // CCW visto desde +Y (mirando -Y): el area orientada (shoelace en X-Z, con Z como
    // "vertical de pantalla") recorrida i->j->m->n debe ser positiva.
    const pts = [i, j, mm, nn];
    let area2 = 0;
    for (let k = 0; k < 4; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % 4];
      area2 += a.x * b.z - b.x * a.z;
    }
    expect(area2).toBeGreaterThan(0);
  });

  it("nudos y quads tienen nombres PROPIOS del paño (prefijo PQ<idx>), sin colision N../M..", () => {
    const m = mallarOk(params({ indicePano: 2 }));
    expect(m.nodos.every((n) => n.name.startsWith("PQ2-N"))).toBe(true);
    expect(m.quads.every((q) => q.name.startsWith("PQ2-Q"))).toBe(true);
  });

  it("determinista byte a byte: dos mallados de la misma entrada son identicos", () => {
    const a = JSON.stringify(mallarOk(params()));
    const b = JSON.stringify(mallarOk(params()));
    expect(a).toBe(b);
  });

  it("orden del perimetro de ENTRADA no altera la malla (CW vs CCW)", () => {
    const ccw = mallarOk(params());
    // Mismo rectangulo recorrido al reves (CW): la malla canonica debe ser identica.
    const cw = mallarOk(
      params({
        perimetro: [
          { x: 0, y: 0 },
          { x: 0, y: 2 },
          { x: 4, y: 2 },
          { x: 4, y: 0 },
        ],
      }),
    );
    expect(JSON.stringify(cw)).toBe(JSON.stringify(ccw));
  });
});

describe("mallado - nudos de borde", () => {
  it("rejilla 4x2: borde = perimetro (todos menos el nudo interior)", () => {
    const m = mallarOk(params());
    // 5x3 = 15 nudos; interiores = 3x1 = 3 -> borde = 12.
    expect(m.nodosBorde).toHaveLength(12);
    // Ningun nudo de borde repetido.
    expect(new Set(m.nodosBorde).size).toBe(m.nodosBorde.length);
    // Las 4 esquinas estan en el borde.
    const byName = new Map(m.nodos.map((n) => [n.name, n]));
    const corner = (x: number, z: number) =>
      m.nodos.find((n) => n.x === x && n.z === z)!.name;
    for (const c of [corner(0, 0), corner(4, 0), corner(4, 2), corner(0, 2)]) {
      expect(m.nodosBorde).toContain(c);
      expect(byName.has(c)).toBe(true);
    }
  });

  it("el nudo interior NO esta en el borde", () => {
    const m = mallarOk(params());
    // Interior de la rejilla 5x3: (col,fila) = (1..3, 1). Tomamos (1,1) -> (x=1,z=1).
    const interior = m.nodos.find((n) => n.x === 1 && n.z === 1)!.name;
    expect(m.nodosBorde).not.toContain(interior);
  });
});

describe("mallado - estabilizacion en el plano (anti-singular)", () => {
  it("restringe DX/DZ en 2 nudos NO coincidentes del borde", () => {
    const m = mallarOk(params());
    expect(m.estabilizacion).toHaveLength(2);
    const [e0, e1] = m.estabilizacion;
    // Distintos nudos.
    expect(e0.node).not.toBe(e1.node);
    // Ambos son nudos de borde.
    expect(m.nodosBorde).toContain(e0.node);
    expect(m.nodosBorde).toContain(e1.node);
  });

  it("fija las 3 GDL de cuerpo rigido del plano: DX+DZ en una esquina, DZ en otra", () => {
    const m = mallarOk(params());
    const byName = new Map(m.nodos.map((n) => [n.name, n]));
    const e0 = m.estabilizacion[0];
    const e1 = m.estabilizacion[1];
    // e0 = esquina (0,0): DX y DZ.
    expect([e0.DX, e0.DZ]).toEqual([true, true]);
    expect([byName.get(e0.node)!.x, byName.get(e0.node)!.z]).toEqual([0, 0]);
    // e1 = esquina (xMax,0): solo DZ (par DZ con e0 impide el giro alrededor de Y).
    expect([e1.DX, e1.DZ]).toEqual([false, true]);
    expect([byName.get(e1.node)!.x, byName.get(e1.node)!.z]).toEqual([4, 0]);
    // Total de restricciones en el plano = 3 (DX@e0, DZ@e0, DZ@e1).
    const total = m.estabilizacion.reduce(
      (acc, e) => acc + (e.DX ? 1 : 0) + (e.DZ ? 1 : 0),
      0,
    );
    expect(total).toBe(3);
  });
});

describe("mallado - cap de quads (4A)", () => {
  it("malla fina que excede el cap -> eleva tamMalla y respeta CAP_QUADS", () => {
    // 50x50 m con tamMalla 0.5 daria 100x100 = 10000 quads > 2000.
    const m = mallarOk(params({ perimetro: rect(0, 0, 50, 50), tamMalla: 0.5 }));
    expect(m.capAplicado).toBe(true);
    expect(m.nx * m.ny).toBeLessThanOrEqual(CAP_QUADS);
    expect(m.tamMallaEfectivo).toBeGreaterThan(0.5);
    // Coherencia: quads y nudos cuadran con nx,ny.
    expect(m.quads).toHaveLength(m.nx * m.ny);
    expect(m.nodos).toHaveLength((m.nx + 1) * (m.ny + 1));
  });

  it("justo en el cap NO lo eleva", () => {
    // Buscamos una malla exactamente al limite o por debajo: 40x40 m, tamMalla 1 ->
    // 40x40 = 1600 <= 2000.
    const m = mallarOk(params({ perimetro: rect(0, 0, 40, 40), tamMalla: 1 }));
    expect(m.capAplicado).toBe(false);
    expect(m.nx * m.ny).toBe(1600);
  });
});

describe("mallado - geometria degenerada -> error de obra", () => {
  it("area ~ 0 (rectangulo sin alto) -> PANO_DEGENERADO", () => {
    const res = mallarPano(params({ perimetro: rect(0, 0, 4, 0) }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.codigo).toBe("PANO_DEGENERADO");
      // Mensaje en lenguaje de obra, sin jerga FEM.
      expect(res.error.mensaje.toLowerCase()).not.toContain("quad");
      expect(res.error.mensaje.toLowerCase()).not.toContain("nodo");
    }
  });

  it("cuadrilatero NO rectangular (rotado) -> PANO_NO_RECTANGULAR", () => {
    const res = mallarPano(
      params({
        perimetro: [
          { x: 0, y: 0 },
          { x: 4, y: 0.5 }, // rotado: no casa con esquina del bounding box
          { x: 4, y: 2 },
          { x: 0, y: 2 },
        ],
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.codigo).toBe("PANO_NO_RECTANGULAR");
  });

  it("rectangulo minimo (1x1 celda) tambien malla correctamente", () => {
    const m = mallarOk(params({ perimetro: rect(0, 0, 1, 1), tamMalla: 5 }));
    expect(m.nx).toBe(1);
    expect(m.ny).toBe(1);
    expect(m.quads).toHaveLength(1);
    expect(m.nodos).toHaveLength(4);
    // Con 1 celda, los 4 nudos son borde y la estabilizacion usa 2 esquinas distintas.
    expect(m.nodosBorde).toHaveLength(4);
    expect(m.estabilizacion[0].node).not.toBe(m.estabilizacion[1].node);
  });
});
