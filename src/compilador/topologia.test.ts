/**
 * Topología del compilador (H28, COM-05): las dos tolerancias, encuentros en T, cruces, vigas que
 * pasan por pilares, casi encuentros y encuentros ambiguos, con sus diagnósticos.
 */
import { describe, expect, it } from "vitest";
import { calcular } from "../motor/calcular.ts";
import { compilar, type ResultadoCompilacion } from "./compilar.ts";
import type { ModeloFisico, Pilar, Vec2, Viga } from "./fisico.ts";
import { traducirDiagnosticos } from "./mapeo.ts";

function modelo(pilares: Pilar[], vigas: Viga[], extra: Partial<ModeloFisico> = {}): ModeloFisico {
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "C", altura: 3, tipo: "sotano" },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "v", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares,
    vigas,
    casos: [{ id: "G", pesoPropio: true }],
    ...extra,
  };
}
const pilar = (id: string, x: number, y: number): Pilar => ({ id, x, y, desde: "C", hasta: "P1", seccion: "p30" });
const viga = (id: string, ...puntos: Vec2[]): Viga => ({ id, planta: "P1", puntos, seccion: "v" });
const codigos = (r: ResultadoCompilacion) => r.diagnosticos.map((d) => d.codigo);
const valido = (r: ResultadoCompilacion) => {
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  return r;
};
/** Pórtico de 4 pilares en (0,0), (6,0), (6,5), (0,5) con sus 4 vigas de borde. */
const cuatro = () => [pilar("A", 0, 0), pilar("B", 6, 0), pilar("C2", 6, 5), pilar("D", 0, 5)];
const bordes = () => [viga("V1", [0, 0], [6, 0]), viga("V2", [6, 0], [6, 5]), viga("V3", [6, 5], [0, 5]), viga("V4", [0, 5], [0, 0])];

describe("topología: dos tolerancias", () => {
  it("dos extremos de viga a 1e-7 m se unen sin decir nada; a 3 cm, con aviso y la distancia", () => {
    const silencio = valido(compilar(modelo(cuatro(), [...bordes(), viga("Va", [0, 2.5], [3, 2.5]), viga("Vb", [3 + 1e-7, 2.5], [6, 2.5])])));
    expect(codigos(silencio)).toEqual([]);
    const aviso = valido(compilar(modelo(cuatro(), [...bordes(), viga("Va", [0, 2.5], [3, 2.5]), viga("Vb", [3.03, 2.5], [6, 2.5])])));
    expect(codigos(aviso)).toEqual(["topologia/fusion"]);
    expect(aviso.diagnosticos[0]!.ids).toContain("Vb");
    expect(aviso.diagnosticos[0]!.detalles!.distancia).toBeCloseTo(0.03, 12);
    // Mismo nudo central en los dos casos
    expect(silencio.modelo.nudos.length).toBe(aviso.modelo.nudos.length);
    expect(silencio.modelo.barras!.length).toBe(aviso.modelo.barras!.length);
  });

  it("a 8 cm (entre ε_snap y 3·ε_snap) no se unen: aviso de casi encuentro; a 20 cm, nada", () => {
    // Vb no llega a ningún sitio en su arranque: es un voladizo desde B (cuelga de V2 en (6, 2.5))
    const casi = compilar(modelo(cuatro(), [...bordes(), viga("Va", [0, 2.5], [3, 2.5]), viga("Vb", [3.08, 2.5], [6, 2.5])]));
    expect(codigos(casi)).toEqual(["topologia/casi-encuentro", "topologia/casi-encuentro"]);
    const lejos = valido(compilar(modelo(cuatro(), [...bordes(), viga("Va", [0, 2.5], [3, 2.5]), viga("Vb", [3.2, 2.5], [6, 2.5])])));
    expect(codigos(lejos)).toEqual([]);
  });

  it("retícula de 4 × 3 vanos con ±2 cm de ruido en los vértices: misma topología que sin ruido, con avisos (H28)", () => {
    const xs = [0, 5, 10, 15, 20];
    const ys = [0, 6, 12, 18];
    let semilla = 7;
    const ruido = () => {
      semilla = (semilla * 16807) % 2147483647;
      return ((semilla / 2147483647) * 2 - 1) * 0.02;
    };
    const construir = (r: () => number) => {
      const pilares: Pilar[] = [];
      for (const x of xs) for (const y of ys) pilares.push(pilar(`P${x}-${y}`, x, y));
      const vigas: Viga[] = [];
      // vigas largas de lado a lado que pasan por los pilares, y vigas cortas de vano entre ejes intermedios
      for (const y of ys) vigas.push(viga(`H${y}`, [xs[0]! + r(), y + r()], [xs[4]! + r(), y + r()]));
      for (const x of xs) vigas.push(viga(`W${x}`, [x + r(), ys[0]! + r()], [x + r(), ys[3]! + r()]));
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) vigas.push(viga(`Z${i}-${j}`, [xs[i]! + 2.5 + r(), ys[j]! + r()], [xs[i]! + 2.5 + r(), ys[j]! + 3 + r()]));
      return modelo(pilares, vigas);
    };
    const exacta = valido(compilar(construir(() => 0)));
    const ruidosa = valido(compilar(construir(ruido)));
    expect(codigos(exacta)).toEqual([]);
    expect(ruidosa.modelo.nudos.length).toBe(exacta.modelo.nudos.length);
    expect(ruidosa.modelo.barras!.length).toBe(exacta.modelo.barras!.length);
    expect(new Set(codigos(ruidosa))).toEqual(new Set(["topologia/fusion"]));
    // Y calcula con el equilibrio de la regla de oro 2
    const c = calcular(ruidosa.modelo, { solver: "perfil" });
    expect(c.valido).toBe(true);
  });
});

describe("topología: encuentros", () => {
  it("viga que pasa por un pilar sin forma conocida (sección general sin b ni h): se parte en su nudo", () => {
    const f = modelo([pilar("A", 0, 0), pilar("B", 8, 0), { ...pilar("M", 4, 0), seccion: "g" }], [viga("V", [0, 0], [8, 0])]);
    const r = valido(compilar({ ...f, secciones: [...f.secciones, { id: "g", material: "HA", forma: "general", A: 0.09, Iy: 6.75e-4, Iz: 6.75e-4, J: 1.1e-3 }] }));
    expect(r.mapeo.piezas.V!.length).toBe(2);
    // sin huella: el tramo flexible llega al eje
    expect(r.mapeo.barras[r.mapeo.piezas.V![0]!]!.s[2]).toBe(4);
  });

  it("una viga que pasa a 8 cm de la cara de un pilar no se une: aviso de casi encuentro", () => {
    const r = compilar(modelo([...cuatro(), pilar("M", 3, 2.5)], [...bordes(), viga("V", [0, 2.5 + 0.15 + 0.08], [6, 2.5 + 0.15 + 0.08])]));
    expect(codigos(r)).toContain("topologia/casi-encuentro");
  });

  it("cruce reutilizado a 4 cm de otro nudo: aviso con la distancia", () => {
    const r = valido(compilar(modelo(cuatro(), [...bordes(), viga("X", [0, 2.5], [6, 2.5]), viga("Y1", [3, 0], [3, 5]), viga("Y2", [3.02, 0.5], [3.06, 4.5])])));
    expect(codigos(r)).toContain("topologia/fusion");
  });

  it("dos extremos que no se unen entre sí y caen a 4 cm sobre la misma viga: encuentro ambiguo (error)", () => {
    const r = compilar(modelo(cuatro(), [...bordes(), viga("X", [0, 2.5], [6, 2.5]), viga("Ya", [3, 0], [3, 2.54]), viga("Yb", [3.04, 5], [3.04, 2.46])]));
    expect(r.valido).toBe(false);
    expect(codigos(r)).toContain("topologia/nudos-proximos");
  });

  it("una viga dibujada 10 cm más allá de la cara del pilar se une a él y no da aviso de casi encuentro con él", () => {
    const r = valido(compilar(modelo([pilar("A", 0, 0), pilar("B", 6, 0)], [viga("V", [0, 0], [6.25, 0])])));
    expect(codigos(r)).toEqual([]);
    // el tramo flexible (con la mitad del nudo rígida) y un voladizo hasta 10 cm más allá de la cara de B
    expect(r.mapeo.piezas.V!.map((b) => r.mapeo.barras[b]!.s.map((x) => +x.toFixed(9)))).toEqual([
      [0, 0.075, 5.925, 6],
      [6, 6.075, 6.25, 6.25],
    ]);
  });

  it("dos vigas colineales dibujadas hasta la cara lejana del pilar intermedio se solapan dentro de él: no es un error", () => {
    const r = valido(compilar(modelo([pilar("A", 0, 0), pilar("B", 6, 0), pilar("C2", 12, 0)], [viga("V1", [0, 0], [6.15, 0]), viga("V2", [5.85, 0], [12, 0])])));
    expect(codigos(r)).toEqual([]);
    expect(r.mapeo.piezas.V1!.length + r.mapeo.piezas.V2!.length).toBe(2);
  });

  it("vigas solapadas, pilares solapados y viga dentro de un pilar: errores con los ids físicos", () => {
    const solapadas = compilar(modelo(cuatro(), [...bordes(), viga("S", [1, 0.02], [4, 0.02])]));
    expect(codigos(solapadas)).toContain("topologia/vigas-solapadas");
    expect(solapadas.diagnosticos.find((d) => d.codigo === "topologia/vigas-solapadas")!.ids).toEqual(["S", "V1"]);
    const pilares = compilar(modelo([...cuatro(), pilar("A2", 0.01, 0)], bordes()));
    expect(codigos(pilares)).toContain("topologia/pilares-solapados");
    const dentro = compilar(modelo(cuatro(), [...bordes(), viga("Z", [-0.1, 0], [0.1, 0.05])]));
    expect(codigos(dentro)).toContain("viga/sin-tramo-flexible");
  });

  it("apoyos y cargas sin destino; apoyo en un GDL del diafragma", () => {
    const sinApoyo = compilar(modelo(cuatro(), bordes(), { apoyos: [{ id: "Ap", planta: "P1", x: 3, y: 2.5, coartados: [false, false, true, false, false, false] }] }));
    expect(codigos(sinApoyo)).toEqual(["apoyo/sin-destino"]);
    const sinCarga = compilar(modelo(cuatro(), bordes(), { cargas: [{ tipo: "puntual", id: "F", caso: "G", planta: "P1", x: 3, y: 2.5, F: [0, 0, -1] }] }));
    expect(codigos(sinCarga)).toEqual(["carga/sin-destino"]);
    const enDiafragma = compilar(modelo(cuatro(), bordes(), { apoyos: [{ id: "Ap", planta: "P1", x: 3, y: 0, coartados: [true, false, false, false, false, false] }] }));
    expect(codigos(enDiafragma)).toEqual(["apoyo/en-diafragma"]);
    // Sin diafragma en la planta, el apoyo parte V1 y vale
    const sin = valido(compilar({ ...modelo(cuatro(), bordes(), { apoyos: [{ id: "Ap", planta: "P1", x: 3, y: 0, coartados: [true, false, false, false, false, false] }] }), plantas: [{ id: "P1", altura: null, diafragma: "ninguno" }, { id: "C", altura: 3, tipo: "sotano" }] }));
    expect(sin.mapeo.piezas.V1!.length).toBe(2);
    expect(sin.mapeo.apoyos.Ap).toBeDefined();
  });

  it("pilar apeado sin nada debajo: error; los diagnósticos del motor se traducen a objetos físicos", () => {
    const apeado = compilar(modelo(cuatro(), bordes(), { pilares: [...cuatro(), { id: "AP", x: 3, y: 2.5, desde: "P1", hasta: "P1", seccion: "p30" }] }));
    expect(codigos(apeado)).toContain("fisico/valor-no-valido");
    // Un mecanismo: una viga en voladizo articulada en su arranque
    const r = valido(compilar(modelo(cuatro(), [...bordes(), { ...viga("M", [6, 2.5], [8, 2.5]), liberaciones: { inicio: [false, false, false, false, true, true] } }])));
    const c = calcular(r.modelo, { solver: "perfil" });
    expect(c.valido).toBe(false);
    const fisicos = traducirDiagnosticos(c.diagnosticos, r.modelo, r.mapeo).filter((d) => d.severidad === "error");
    expect(fisicos.some((d) => d.ids?.includes("M"))).toBe(true);
    expect(fisicos.flatMap((d) => d.ids ?? []).every((id) => !id.includes(":"))).toBe(true);
  });
});

describe("mapeo", () => {
  it("estaciones de los tramos de una viga en polilínea y nudos de los pilares por planta", () => {
    const r = valido(compilar(modelo(cuatro(), [...bordes(), viga("L", [0, 0], [3, 2.5], [6, 5])])));
    const tramos = r.mapeo.piezas.L!.map((b) => r.mapeo.barras[b]!.s);
    // Dos tramos rectos de 3,905 m: el primero arranca en la cara de A y el segundo acaba en la de C2
    expect(tramos.length).toBe(2);
    expect(tramos[0]![0]).toBe(0);
    expect(tramos[1]![3]).toBeCloseTo(2 * Math.hypot(3, 2.5), 12);
    expect(tramos[0]![1]).toBeGreaterThan(0);
    expect(r.mapeo.nudosPilar["A@P1"]).toBe(r.modelo.barras![r.mapeo.piezas.L![0]!]!.nudos[0]);
    expect(r.mapeo.nudos[r.mapeo.nudosPilar["A@C"]!]!.fisicos).toEqual(["A"]);
  });
});
