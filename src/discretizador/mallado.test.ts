import { describe, it, expect } from "vitest";
import {
  mallarPano,
  planificarRejilla,
  CAP_QUADS,
  type ParametrosMallado,
  type PuntoPlano,
  type LimitesRectangulo,
} from "./mallado";

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

// --- Losa plana: lineas de control (rejilla NO uniforme) ----------------------
// El pilar bajo la losa fuerza una linea de rejilla en su x/y para que un nudo caiga
// EXACTO en su cabeza (== N* del pilar). Cubre: regresion (sin lineas = uniforme
// byte-identico), colocacion exacta, dedup por celda, precedencia de CAP y aspecto.
describe("mallado - lineas de control (losa plana)", () => {
  it("REGRESION: lineasControl vacias/ausentes = malla uniforme byte-identica", () => {
    const sin = mallarOk(params());
    const vacias = mallarOk(params({ lineasControlX: [], lineasControlY: [] }));
    expect(JSON.stringify(vacias)).toBe(JSON.stringify(sin));
    expect(sin.aspectoRelajado).toBe(false);
    // Y sigue siendo la rejilla 4x2 de siempre.
    expect(sin.nx).toBe(4);
    expect(sin.ny).toBe(2);
  });

  it("una linea de control X cae EXACTA en un nudo de malla (piedra angular del remap)", () => {
    const m = mallarOk(params({ lineasControlX: [1.5] }));
    // Existe un nudo en x=1.5 EXACTO (igualdad estricta, no toBeCloseTo): asi su clave
    // de celda casa con la cabeza del pilar y el remap PQ*->N* no falla.
    expect(m.nodos.some((n) => n.x === 1.5)).toBe(true);
    // Los bordes 0 y 4 siguen presentes exactos.
    expect(m.nodos.some((n) => n.x === 0)).toBe(true);
    expect(m.nodos.some((n) => n.x === 4)).toBe(true);
    // Todos los nudos de una MISMA columna x=1.5 (una por fila).
    const enLinea = m.nodos.filter((n) => n.x === 1.5);
    expect(enLinea).toHaveLength(m.ny + 1);
  });

  it("linea de control en Y tambien fuerza un nudo exacto", () => {
    const m = mallarOk(params({ lineasControlY: [0.7] }));
    expect(m.nodos.some((n) => n.z === 0.7)).toBe(true);
  });

  it("determinista byte a byte con lineas de control", () => {
    const a = JSON.stringify(mallarOk(params({ lineasControlX: [1.5], lineasControlY: [0.7] })));
    const b = JSON.stringify(mallarOk(params({ lineasControlX: [1.5], lineasControlY: [0.7] })));
    expect(a).toBe(b);
  });

  it("dos lineas de control en la MISMA celda se funden en una (dedup por cuantizar)", () => {
    // 1.5 y 1.5004 cuantizan a la misma celda (TOL_NODO=1e-3): una sola linea, la menor.
    const m = mallarOk(params({ lineasControlX: [1.5, 1.5004] }));
    const en15 = m.nodos.filter((n) => n.x === 1.5);
    expect(en15.length).toBe(m.ny + 1); // existe la columna 1.5
    // No hay una segunda columna espuria a 1.5004.
    expect(m.nodos.some((n) => n.x === 1.5004)).toBe(false);
  });

  it("linea de control SOBRE o FUERA del borde se ignora (defensivo)", () => {
    // 0 y 4 son bordes; 5 y -1 quedan fuera: todas se descartan -> malla uniforme.
    const m = mallarOk(params({ lineasControlX: [0, 4, 5, -1] }));
    const uniforme = mallarOk(params());
    expect(JSON.stringify(m)).toBe(JSON.stringify(uniforme));
  });

  it("las lineas de control preservan la topologia (quads a ambos lados comparten la columna)", () => {
    const m = mallarOk(params({ lineasControlX: [1.5] }));
    // Un nudo interior en x=1.5 es referenciado por quads a su izquierda y a su derecha.
    const byName = new Map(m.nodos.map((n) => [n.name, n]));
    const interior = m.nodos.find((n) => n.x === 1.5 && n.z > 0 && n.z < 2)!;
    const tocan = m.quads.filter(
      (q) => q.i === interior.name || q.j === interior.name || q.m === interior.name || q.n === interior.name,
    );
    // Un nudo interior de una columna intermedia toca 4 quads (2 a cada lado).
    expect(tocan.length).toBe(4);
    expect(byName.has(interior.name)).toBe(true);
  });

  it("estabilizacion sigue usando 2 esquinas distintas con lineas de control", () => {
    const m = mallarOk(params({ lineasControlX: [1.5], lineasControlY: [0.7] }));
    expect(m.estabilizacion).toHaveLength(2);
    expect(m.estabilizacion[0].node).not.toBe(m.estabilizacion[1].node);
    // La estabilizacion sigue anclada en la arista inferior (z=0) del rectangulo.
    const byName = new Map(m.nodos.map((n) => [n.name, n]));
    expect(byName.get(m.estabilizacion[0].node)!.z).toBe(0);
    expect(byName.get(m.estabilizacion[1].node)!.z).toBe(0);
  });

  it("CAP: demasiadas lineas de control (rejilla minima > CAP_QUADS) -> PANO_DEMASIADOS_PILARES", () => {
    // 50 lineas en X y 50 en Y sobre un rectangulo grande -> 51*51 = 2601 > 2000.
    const lineas = Array.from({ length: 50 }, (_, k) => k + 1); // 1..50, celdas distintas
    const res = mallarPano(
      params({ perimetro: rect(0, 0, 100, 100), tamMalla: 10, lineasControlX: lineas, lineasControlY: lineas }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.codigo).toBe("PANO_DEMASIADOS_PILARES");
      // Lenguaje de obra, sin jerga FEM.
      expect(res.error.mensaje.toLowerCase()).not.toContain("quad");
      expect(res.error.mensaje.toLowerCase()).not.toContain("cap");
    }
  });

  it("aspecto: una linea cerca del borde subdivide el otro eje (MEJORA de una pasada, NO garantiza ASPECTO_MAX)", () => {
    // Pilar a 0.2 m del borde en X sobre 10x10: crea una franja fina; el eje Y se subdivide
    // (mejora del aspecto -> mas filas que la base ny=2). NO se afirma aspecto <= ASPECTO_MAX:
    // la pasada usa los minimos PREVIOS a refinar, asi que en franjas asimetricas el aspecto
    // real puede seguir alto (documentado; medido en el describe directo + T-f3-convergencia).
    const m = mallarOk(params({ perimetro: rect(0, 0, 10, 10), tamMalla: 5, lineasControlX: [0.2] }));
    expect(m.aspectoRelajado).toBe(false);
    expect(m.ny).toBeGreaterThan(2); // la pasada subdividio el otro eje
    expect(m.nodos.some((n) => n.x === 0.2)).toBe(true); // la franja fina sigue exacta
    expect(m.quads).toHaveLength(m.nx * m.ny);
    expect(m.nodos).toHaveLength((m.nx + 1) * (m.ny + 1));
  });

  it("aspecto: una franja EXTREMA relaja el aspecto (no explota la malla)", () => {
    // Pilar a 2 mm del borde: acotar el aspecto pediria una subdivision enorme del otro
    // eje que excede el cap -> se RELAJA el aspecto (aspectoRelajado) en vez de bloquear.
    const m = mallarOk(params({ perimetro: rect(0, 0, 10, 10), tamMalla: 5, lineasControlX: [0.002] }));
    expect(m.aspectoRelajado).toBe(true);
    expect(m.nx * m.ny).toBeLessThanOrEqual(CAP_QUADS);
    // Sigue habiendo un nudo exacto en la linea de control (el remap no se sacrifica).
    expect(m.nodos.some((n) => n.x === 0.002)).toBe(true);
  });

  it("linea de control a media crujia reparte los huecos hacia tamMalla a ambos lados", () => {
    const m = mallarOk(params({ lineasControlX: [2] }));
    // 4x2, tamMalla 1, control en x=2: [0,2] -> 2 celdas, [2,4] -> 2 celdas = 4 en X.
    expect(m.nx).toBe(4);
    const xsUnicos = [...new Set(m.nodos.map((n) => n.x))].sort((a, b) => a - b);
    expect(xsUnicos).toEqual([0, 1, 2, 3, 4]);
  });
});

// --- planificarRejilla (directo): matriz de cap/aspecto sobre xs/ys, sin reconstruir nudos.
// Peor aspecto de una rejilla tensorial: max sobre celdas de max(lado)/min(lado).
function peorAspecto(xs: readonly number[], ys: readonly number[]): number {
  const gx = xs.slice(1).map((v, i) => v - xs[i]);
  const gy = ys.slice(1).map((v, i) => v - ys[i]);
  let peor = 0;
  for (const dx of gx) for (const dy of gy) peor = Math.max(peor, Math.max(dx, dy) / Math.min(dx, dy));
  return peor;
}

describe("planificarRejilla (directo)", () => {
  const lim: LimitesRectangulo = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };

  it("sin lineas de control delega en el camino uniforme (equiespaciado, aspectoRelajado false)", () => {
    const plan = planificarRejilla(lim, [], [], 5);
    if ("codigo" in plan) throw new Error("esperaba plan, no error");
    expect(plan.xs).toEqual([0, 5, 10]);
    expect(plan.ys).toEqual([0, 5, 10]);
    expect(plan.capAplicado).toBe(false);
    expect(plan.aspectoRelajado).toBe(false);
  });

  it("demasiadas lineas de control (rejilla minima > CAP) -> PANO_DEMASIADOS_PILARES", () => {
    const lineas = Array.from({ length: 50 }, (_, k) => k + 1); // 1..50, celdas distintas
    const plan = planificarRejilla(
      { xMin: 0, xMax: 100, yMin: 0, yMax: 100 },
      lineas,
      lineas,
      10,
    );
    expect("codigo" in plan).toBe(true);
    if ("codigo" in plan) expect(plan.codigo).toBe("PANO_DEMASIADOS_PILARES");
  });

  it("engrose CON lineas de control: la rejilla a tamMalla excede el CAP -> capAplicado, cap respetado, linea EXACTA", () => {
    // 100x100, tamMalla 0.5 daria 200x200 = 40000 > CAP; 1 linea de control en x=50. nMin=2
    // pasa, pero el tamMalla fuerza el engrose (rama del paso 2, distinta del bloqueo nMin>CAP).
    const plan = planificarRejilla({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 }, [50], [], 0.5);
    if ("codigo" in plan) throw new Error("esperaba plan, no error: " + plan.codigo);
    expect(plan.capAplicado).toBe(true);
    expect((plan.xs.length - 1) * (plan.ys.length - 1)).toBeLessThanOrEqual(CAP_QUADS);
    // La linea de control x=50 sigue EXACTA tras el engrose (piedra angular del remap).
    expect(plan.xs).toContain(50);
  });

  it("la mejora de aspecto REDUCE el peor aspecto frente a la rejilla base (aunque NO lo acote a ASPECTO_MAX)", () => {
    // Franja fina en X (x=0.2) sobre 10x10, tamMalla 5. La base (sin mejora) es xs=[0,0.2,5.1,10],
    // ys=[0,5,10] (peor celda 0.2x5 = 25:1). La pasada subdivide Y y baja el peor aspecto, pero
    // NO llega a <=4 (franja asimetrica): esto FIJA la mejora real y la limitacion honesta.
    const plan = planificarRejilla(lim, [0.2], [], 5);
    if ("codigo" in plan) throw new Error("esperaba plan");
    const peorBase = peorAspecto([0, 0.2, 5.1, 10], [0, 5, 10]);
    const peorConMejora = peorAspecto(plan.xs, plan.ys);
    expect(peorConMejora).toBeLessThan(peorBase); // la pasada MEJORA el aspecto
    expect(plan.aspectoRelajado).toBe(false);
    expect(plan.xs).toContain(0.2); // franja exacta preservada
  });

  it("[FIX code-review #3] tamMalla invalido (0, negativo, NaN) -> LANZA en vez de colgar", () => {
    // Bug del llamante (validaciones/acople ya guardan tamMalla>0): sin el guard, h=0
    // hacia celdasDeSegmento=Infinity y el bucle de insercion de construirEjeRejilla
    // no terminaba (cuelgue). Lanzar alto lo hace visible y depurable.
    for (const tam of [0, -1, Number.NaN]) {
      expect(() => planificarRejilla(lim, [5], [], tam)).toThrow(/tamMalla invalido/);
    }
  });
});
