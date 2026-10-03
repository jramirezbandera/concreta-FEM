/**
 * Criterio 3 de E1: cada modelo inestable o mal definido da su error, con el código y los
 * objetos analíticos correctos, y nunca resultados; los modelos estables con rigideces muy
 * dispares no dan falsos positivos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { ARTICULADO, carga, Constructor, seccionRectangular } from "../pruebas/constructor.ts";
import { edificio } from "../pruebas/edificio.ts";
import { calcular } from "./calcular.ts";
import type { ModeloAnalitico, ResultadoCalculo } from "./modelo.ts";
import type { TipoSolver } from "./solucion.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const S = seccionRectangular(0.3, 0.4);
const MAT = { E: 3e7, nu: 0.2, t: 0.2 };

/** El cálculo no es válido, no trae casos y tiene un error con `codigo` que nombra `ids`. */
function esperarError(r: ResultadoCalculo, codigo: string, ids: string[] = []) {
  expect(r.valido).toBe(false);
  expect("casos" in r).toBe(false);
  const d = r.diagnosticos.find((x) => x.codigo === codigo && x.severidad === "error");
  expect(d, `falta ${codigo}; hay: ${r.diagnosticos.map((x) => x.codigo).join(", ")}`).toBeDefined();
  for (const id of ids) expect(d!.ids, `${codigo} no nombra ${id}`).toContain(id);
  return d!;
}

/** Ménsula horizontal a → b (3 m según X) con el pie empotrado salvo que se diga otra cosa. */
function mensula(coartados: readonly boolean[] | null = [true, true, true, true, true, true]) {
  const m = new Constructor();
  const a = m.nudo(0, 0, 0, "A");
  const b = m.nudo(3, 0, 0, "B");
  m.barra(a, b, S, [0, 0, 1], "BAR");
  if (coartados) m.apoyo(a, coartados as never);
  return { m, a, b };
}

/** Planta con diafragma sobre 4 pilares; `rotula`: la cabeza se une con un muelle sin rigidez a giro. */
function plantaSobrePilares(rotula: boolean) {
  const m = new Constructor();
  const cabezas: number[] = [];
  [
    [0, 0],
    [5, 0],
    [5, 4],
    [0, 4],
  ].forEach(([x, y], i) => {
    const pie = m.nudo(x!, y!, 0, `PIE${i}`);
    const alto = m.nudo(x!, y!, 3, `ALTO${i}`);
    m.barra(pie, alto, S, [1, 0, 0], `C${i}`);
    m.apoyo(pie, rotula ? ARTICULADO : undefined);
    if (rotula) {
      const cabeza = m.nudo(x!, y!, 3, `CAB${i}`);
      m.muelle([alto, cabeza], [1e9, 1e9, 1e9, 0, 0, 1e9], undefined, `ROT${i}`);
      cabezas.push(cabeza);
    } else cabezas.push(alto);
  });
  for (let i = 0; i < 4; i++) m.barra(cabezas[i]!, cabezas[(i + 1) % 4]!, S, [0, 0, 1], `V${i}`);
  const cm = m.nudo(2.5, 2, 3, "CM");
  m.diafragma(cm, cabezas, "D1");
  m.caso("X", [carga(cm, { fx: 10 })]);
  return { m, cabezas, cm };
}

describe.each<TipoSolver>(["nucleo", "perfil"])("mecanismos (solver %s)", (solver) => {
  it("modelo sin apoyos: parte sin apoyo con todos sus nudos", () => {
    const { m, b } = mensula(null);
    m.caso("P", [carga(b, { fz: -1 })]);
    esperarError(calcular(m.modelo(), { solver }), "modelo/parte-sin-apoyo", ["A", "B"]);
  });

  it("dos partes y una sin apoyo: sólo se señala la suelta", () => {
    const { m, b } = mensula();
    const c = m.nudo(10, 0, 0, "C");
    const d = m.nudo(12, 0, 0, "D");
    m.barra(c, d, S, [0, 0, 1], "SUELTA");
    m.caso("P", [carga(b, { fz: -1 })]);
    const d0 = esperarError(calcular(m.modelo(), { solver }), "modelo/parte-sin-apoyo", ["C", "D"]);
    expect(d0.ids).not.toContain("A");
  });

  it("barra con un extremo articulado y nada más: mecanismo que mueve sus dos nudos", () => {
    const { m, b } = mensula(ARTICULADO);
    m.caso("P", [carga(b, { fz: -1 })]);
    const r = calcular(m.modelo(), { solver });
    const d = esperarError(r, "solver/mecanismo", ["B"]);
    expect(d.mensaje).toMatch(/Mecanismo/);
  });

  it("barra biarticulada: el giro alrededor de su eje sólo se ve en los pivotes", () => {
    const { m, b } = mensula(ARTICULADO);
    m.apoyo(b, ARTICULADO);
    m.caso("P", [carga(b, { fz: -1 })]);
    const r = calcular(m.modelo(), { solver });
    const d = esperarError(r, "solver/mecanismo");
    expect(d.detalles!.gdl).toBe("rx");
  });

  it("barra biarticulada sesgada en 3D: el giro alrededor de su eje deja un pivote diminuto, no nulo", () => {
    const m = new Constructor();
    const a = m.nudo(0, 0, 0, "A");
    const b = m.nudo(3, 2.1, 0.9, "B");
    m.barra(a, b, S, [0, 0, 1], "BAR");
    m.apoyo(a, ARTICULADO);
    m.apoyo(b, ARTICULADO);
    m.caso("P", [carga(b, { fz: -1 })]);
    const d = esperarError(calcular(m.modelo(), { solver }), "solver/mecanismo", ["A", "B"]);
    // pasa por la comparación dⱼ/Kⱼⱼ, no por el error de pivote exactamente nulo de faer
    expect(Number.isNaN(d.detalles!.pivoteRelativo)).toBe(false);
    expect(Math.abs(d.detalles!.pivoteRelativo as number)).toBeLessThan(1e-11);
  });

  it("planta con diafragma sobre pilares biarticulados: el mecanismo mueve la planta entera", () => {
    const { m } = plantaSobrePilares(true);
    const r = calcular(m.modelo(), { solver });
    const d = esperarError(r, "solver/mecanismo");
    // el modo traslada o gira la planta: la mueven el maestro y las cuatro cabezas
    for (const id of ["CM", "CAB0", "CAB1", "CAB2", "CAB3"]) expect(d.ids).toContain(id);
  });

  it("muelle a tierra en una dirección girada 45°: la perpendicular es un mecanismo", () => {
    const m = new Constructor();
    const a = m.nudo(0, 0, 0, "A");
    const c = Math.SQRT1_2;
    m.muelle([a], [100, 0, 50, 10, 10, 10], [c, c, 0, -c, c, 0, 0, 0, 1], "MU");
    m.caso("P", [carga(a, { fx: 1 })]);
    esperarError(calcular(m.modelo(), { solver }), "solver/mecanismo", ["A"]);
  });
});

describe("modelos mal definidos", () => {
  const casos: [string, () => ModeloAnalitico, string, string[]][] = [
    [
      "GDL esclavo de dos restricciones",
      () => {
        const { m, b } = mensula();
        const c = m.nudo(3, 1, 0, "C");
        const d = m.nudo(3, 2, 0, "D");
        m.enlace(b, [d], "E1");
        m.enlace(c, [d], "E2");
        m.caso("P", [carga(b, { fz: -1 })]);
        return m.modelo();
      },
      "restriccion/esclavo-doble",
      ["D", "E1", "E2"],
    ],
    [
      "ciclo de restricciones",
      () => {
        const { m, b } = mensula();
        const c = m.nudo(3, 1, 0, "C");
        const d = m.nudo(3, 2, 0, "D");
        m.enlace(c, [d], "E1");
        m.enlace(d, [c], "E2");
        m.enlace(b, [], "E3");
        m.caso("P", [carga(b, { fz: -1 })]);
        return m.modelo();
      },
      "restriccion/ciclo",
      ["E1", "E2"],
    ],
    [
      "apoyo en un GDL esclavo",
      () => {
        const { m, b } = mensula();
        const c = m.nudo(3, 1, 0, "C");
        m.enlace(b, [c], "E1");
        m.apoyo(c, [false, false, true, false, false, false]);
        m.caso("P", [carga(b, { fz: -1 })]);
        return m.modelo();
      },
      "restriccion/apoyo-en-esclavo",
      ["C", "E1"],
    ],
    [
      "diafragma con un nudo fuera de su cota",
      () => {
        const { m } = plantaSobrePilares(false);
        const fuera = m.nudo(1, 1, 3.001, "FUERA");
        m.restricciones[0]!.esclavos = [...m.restricciones[0]!.esclavos, fuera];
        return m.modelo();
      },
      "restriccion/diafragma-no-plano",
      ["D1", "FUERA"],
    ],
    [
      "muelle entre nudos separados",
      () => {
        const { m, b } = mensula();
        const c = m.nudo(3, 0, 0.01, "C");
        m.muelle([b, c], [1, 1, 1, 1, 1, 1], undefined, "MU");
        m.apoyo(c);
        m.caso("P", [carga(b, { fz: -1 })]);
        return m.modelo();
      },
      "modelo/muelle-no-nulo",
      ["MU"],
    ],
    [
      "muelle con rigidez negativa",
      () => {
        const { m, b } = mensula();
        m.muelle([b], [1, -1, 1, 1, 1, 1], undefined, "MU");
        m.caso("P", [carga(b, { fz: -1 })]);
        return m.modelo();
      },
      "modelo/propiedad-no-valida",
      ["MU"],
    ],
    [
      "lámina alabeada",
      () => {
        const m = new Constructor();
        const n = [m.nudo(0, 0, 0), m.nudo(1, 0, 0), m.nudo(1, 1, 0), m.nudo(0, 1, 0.01)] as const;
        m.lamina(n, MAT, "LAM");
        n.forEach((v) => m.apoyo(v));
        m.caso("P", []);
        return m.modelo();
      },
      "modelo/lamina-alabeada",
      ["LAM"],
    ],
    [
      "lámina en pajarita (nudos desordenados)",
      () => {
        const m = new Constructor();
        const n = [m.nudo(0, 0, 0), m.nudo(1, 1, 0), m.nudo(1, 0, 0), m.nudo(0, 1, 0)] as const;
        m.lamina(n, MAT, "LAM");
        n.forEach((v) => m.apoyo(v));
        m.caso("P", []);
        return m.modelo();
      },
      "modelo/elemento-degenerado",
      ["LAM"],
    ],
    [
      "barra de longitud nula",
      () => {
        const m = new Constructor();
        const a = m.nudo(0, 0, 0, "A");
        const b = m.nudo(0, 0, 0, "B");
        m.barra(a, b, S, [0, 0, 1], "BAR");
        m.apoyo(a);
        m.caso("P", []);
        return m.modelo();
      },
      "modelo/elemento-degenerado",
      ["BAR"],
    ],
    [
      "vector de canto paralelo al eje",
      () => {
        const m = new Constructor();
        m.barra(m.nudo(0, 0, 0), m.nudo(0, 0, 3), S, [0, 0, 1], "PIL");
        m.apoyo(0);
        m.caso("P", []);
        return m.modelo();
      },
      "modelo/orientacion-no-valida",
      ["PIL"],
    ],
    [
      "barra con un nudo inexistente",
      () => {
        const { m } = mensula();
        m.barra(1, 7, S, [0, 0, 1], "MAL");
        m.caso("P", []);
        return m.modelo();
      },
      "modelo/nudo-no-valido",
      ["MAL"],
    ],
    [
      "coordenadas no finitas",
      () => {
        const { m } = mensula();
        m.nudo(NaN, 0, 0, "NAN");
        m.caso("P", []);
        return m.modelo();
      },
      "modelo/valor-no-finito",
      ["NAN"],
    ],
    [
      "desplazamiento impuesto en un GDL libre",
      () => {
        const { m, b } = mensula();
        m.caso("P", [], [{ nudo: b, gdl: 2, valor: 0.01 }]);
        return m.modelo();
      },
      "carga/impuesto-sin-apoyo",
      ["P", "B"],
    ],
    [
      "carga en un GDL sin rigidez",
      () => {
        const m = new Constructor();
        const a = m.nudo(0, 0, 0, "A");
        m.muelle([a], [100, 0, 0, 0, 0, 0], undefined, "MU");
        m.caso("P", [carga(a, { fy: 1 })]);
        return m.modelo();
      },
      "carga/gdl-sin-rigidez",
      ["P", "A"],
    ],
    [
      "carga en el GDL uz de un maestro de diafragma auxiliar",
      () => {
        const { m, cm } = plantaSobrePilares(false);
        m.casos[0] = { id: "X", nodales: [carga(cm, { fz: -10 })] };
        return m.modelo();
      },
      "carga/gdl-sin-rigidez",
      ["X", "CM"],
    ],
  ];
  for (const [nombre, fabrica, codigo, ids] of casos) {
    it(`${nombre} → ${codigo}`, () => {
      esperarError(calcular(fabrica()), codigo, ids);
    });
  }
});

describe("avisos que no impiden el cálculo", () => {
  it("nudo aislado y nudos coincidentes", () => {
    const { m, b } = mensula();
    m.nudo(50, 50, 50, "SUELTO");
    m.nudo(3, 0, 0, "DUPLICADO");
    m.caso("P", [carga(b, { fz: -1 })]);
    const r = calcular(m.modelo());
    expect(r.valido).toBe(true);
    const codigos = r.diagnosticos.map((d) => d.codigo);
    expect(codigos).toContain("modelo/nudo-aislado");
    expect(codigos).toContain("modelo/nudos-coincidentes");
  });

  it("GDL sin rigidez en un nudo con un muelle de una sola componente: se restringen con aviso", () => {
    const m = new Constructor();
    const a = m.nudo(0, 0, 0, "A");
    m.muelle([a], [100, 0, 0, 0, 0, 0], undefined, "MU");
    m.caso("P", [carga(a, { fx: 1 })]);
    const r = calcular(m.modelo());
    const [c] = casosValidos(r);
    expect(c!.u[0]).toBeCloseTo(0.01, 15);
    const d = r.diagnosticos.find((x) => x.codigo === "gdl/sin-rigidez");
    expect(d?.severidad).toBe("aviso");
    expect(d?.ids).toEqual(["A"]);
  });
});

describe("sin falsos positivos", () => {
  it("edificio con muelles de cimentación de 10 kN/m a 1e9 kN/m", () => {
    for (const escala of [1e-4, 1, 1e4]) {
      const e = edificio({ vanosX: 2, vanosY: 2, luzX: 5, luzY: 4, plantas: 2, altura: 3, malla: 1, muelles: true, vigas: true, muro: true, diafragma: true });
      const modelo = { ...e.modelo, muelles: e.modelo.muelles!.map((mu) => ({ ...mu, k: mu.k.map((v) => v * escala) })) };
      const r = calcular(modelo);
      expect(r.diagnosticos.filter((d) => d.severidad === "error"), `escala ${escala}`).toEqual([]);
    }
  });

  it("losa delgada (t = 2 cm) de 8×8 m con malla fina y pilares", () => {
    const e = edificio({ vanosX: 1, vanosY: 1, luzX: 8, luzY: 8, plantas: 1, altura: 3, malla: 0.25, espesor: 0.02 });
    const r = calcular(e.modelo);
    expect(r.diagnosticos.filter((d) => d.severidad === "error")).toEqual([]);
  });

  /** Viga de 3 tramos con el central (0,5 m) `factor` veces más rígido. */
  function conBarraRigida(factor: number) {
    const m = new Constructor();
    const a = m.nudo(0, 0, 0);
    const b = m.nudo(3, 0, 0);
    const c = m.nudo(3.5, 0, 0);
    const d = m.nudo(6.5, 0, 0);
    const rigida = { ...S, E: S.E * factor, G: S.G * factor };
    m.barra(a, b, S, [0, 0, 1]);
    m.barra(b, c, rigida, [0, 0, 1]);
    m.barra(c, d, S, [0, 0, 1]);
    m.apoyo(a);
    m.apoyo(d, ARTICULADO);
    m.caso("P", [carga(c, { fz: -10, fx: 3 })]);
    return m.modelo();
  }

  for (const solver of ["nucleo", "perfil"] as const) {
    it(`barra 1e3 y 1e4 veces más rígida entre barras normales (${solver})`, () => {
      for (const factor of [1e3, 1e4]) {
        const r = calcular(conBarraRigida(factor), { solver });
        expect(r.diagnosticos, `factor ${factor}`).toEqual([]);
      }
    });

    it(`barra 1e8 veces más rígida (penalización a mano): error de equilibrio que señala el condicionamiento (${solver})`, () => {
      const r = calcular(conBarraRigida(1e8), { solver });
      const d = esperarError(r, "equilibrio/no-cumple");
      expect(d.mensaje).toMatch(/enlaces rígidos/);
      expect(r.diagnosticos.some((x) => x.codigo === "solver/mal-condicionado")).toBe(true);
    });
  }
});
