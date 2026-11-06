/**
 * VS2 (`docs/fem3d/viento-sismo.md` §5): masas por diafragma y modos de vibración en el motor.
 * - Criterio 1: Σ m·g es el peso de los casos con sus fracciones.
 * - Criterio 3: un edificio de cortante de 3 plantas con su solución cerrada a 1e-10.
 * - Criterio 5: φᵀ·M·φ = I y φᵀ·K·φ = Ω²; cada modo es la respuesta estática a sus fuerzas de inercia
 *   ω²·M·φ (con un cálculo aparte); masas ×4, periodos ×2; girar la planta y renumerar, lo mismo.
 * Los periodos de SAP2000 1-022 y 1-024 (criterio 2), en `csi.test.ts`; el oráculo externo
 * (criterio 4), en `oraculo-vs2.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { carga, Constructor, seccionRectangular } from "../pruebas/constructor.ts";
import { girarModelo, matrizGiro, permutacion, renumerarModelo } from "../pruebas/transformar.ts";
import { calcular } from "./calcular.ts";
import { GRAVEDAD, type CargaNodal, type ModeloAnalitico, type ResultadoModal } from "./modelo.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function modalDe(m: ModeloAnalitico, solver: "nucleo" | "perfil" = "nucleo"): ResultadoModal {
  const r = calcular(m, { solver });
  casosValidos(r);
  if (!r.valido || !r.modal) throw new Error("sin modal");
  return r.modal;
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));

// ─── Edificio de cortante ───────────────────────────────────────────────────────────────────────

const [A, B, H] = [6, 4, 3];
const PESO = 800; // kN por planta, en el caso G
const SEC = seccionRectangular(0.3, 0.5);

/**
 * Edificio de cortante de `n` plantas iguales: cuatro pilares en las esquinas de A × B con los giros
 * rx y ry y el uz coartados en cada planta (forjado infinitamente rígido), diafragma por planta con
 * el maestro en `maestro` (no tiene por qué ser el centro) y el peso de cada planta en sus cuatro
 * esquinas, `pesos[k]` de la planta k (por defecto, PESO), repartido como `reparto` (4 fracciones).
 */
function cortante(n = 3, o: { maestro?: [number, number]; pesos?: number[]; reparto?: number[] } = {}): ModeloAnalitico {
  const m = new Constructor();
  const xy = [
    [0, 0],
    [A, 0],
    [A, B],
    [0, B],
  ] as const;
  const [xm, ym] = o.maestro ?? [A / 2, B / 2];
  const niveles = Array.from({ length: n + 1 }, (_, k) => xy.map(([x, y]) => m.nudo(x, y, k * H)));
  for (const v of niveles[0]!) m.apoyo(v);
  const nodales: CargaNodal[] = [];
  for (let k = 1; k <= n; k++) {
    niveles[k]!.forEach((v, c) => {
      m.barra(niveles[k - 1]![c]!, v, SEC, [1, 0, 0]);
      m.apoyo(v, [false, false, true, true, true, false]);
      nodales.push(carga(v, { fz: -(o.pesos?.[k - 1] ?? PESO) * (o.reparto?.[c] ?? 0.25) }));
    });
    m.diafragma(m.nudo(xm, ym, k * H, `M${k}`), niveles[k]!, `D${k}`);
  }
  m.caso("G", nodales);
  m.caso("Q", nodales.map((c) => ({ ...c, f: c.f.map((v) => 0.5 * v) as never })));
  return { ...m.modelo(), modal: { masas: [{ caso: "G", fraccion: 1 }] } };
}

/** ω² de la cadena de n masas m iguales unidas por n muelles k iguales, empotrada en un extremo. */
const cadena = (n: number, k: number, m: number) => Array.from({ length: n }, (_, j) => ((4 * k) / m) * Math.sin(((2 * j + 1) * Math.PI) / (2 * (2 * n + 1))) ** 2);

/** Rigideces de una planta del edificio de cortante: en X (Iy, con vz = X), en Y (Iz) y de giro respecto al centro. */
function rigideces() {
  const kx = (4 * 12 * SEC.E * SEC.Iy) / H ** 3;
  const ky = (4 * 12 * SEC.E * SEC.Iz) / H ** 3;
  const kt = kx * (B / 2) ** 2 + ky * (A / 2) ** 2 + (4 * SEC.G * SEC.J) / H;
  return { kx, ky, kt };
}

describe("VS2: masas de los diafragmas", () => {
  it("criterio 1: Σ m·g es el peso del caso con su fracción, con el centro de masas y la inercia de giro de cada planta", () => {
    const md = modalDe({ ...cortante(), modal: { masas: [{ caso: "G", fraccion: 1 }, { caso: "Q", fraccion: 0.5 }] } });
    // G entero y la mitad de Q, que es la mitad de G
    const peso = 3 * PESO * 1.25;
    expect(rel(md.masas.total * GRAVEDAD, peso)).toBeLessThan(1e-12);
    expect(rel(md.masas.diafragmas, md.masas.total)).toBeLessThan(1e-12);
    expect(md.masas.terreno).toBe(0);
    expect(md.masas.repartida).toBe(0);
    for (const df of md.diafragmas) {
      const m = (PESO * 1.25) / GRAVEDAD;
      expect(rel(df.masa, m)).toBeLessThan(1e-12);
      expect(Math.hypot(df.cm[0] - A / 2, df.cm[1] - B / 2)).toBeLessThan(1e-12);
      expect(rel(df.J, (m * (A * A + B * B)) / 4)).toBeLessThan(1e-12);
    }
  });

  it("el centro de masas sigue al reparto del peso, y no depende de dónde esté el maestro", () => {
    const reparto = [0.4, 0.3, 0.2, 0.1];
    const [cx, cy] = [A * (reparto[1]! + reparto[2]!), B * (reparto[2]! + reparto[3]!)];
    for (const maestro of [undefined, [-3, 11]] as const) {
      const md = modalDe(cortante(3, { reparto, maestro: maestro as [number, number] | undefined }));
      for (const df of md.diafragmas) {
        expect(Math.hypot(df.cm[0] - cx, df.cm[1] - cy)).toBeLessThan(1e-12);
        const m = PESO / GRAVEDAD;
        const J = m * (0.4 * (cx * cx + cy * cy) + 0.3 * ((A - cx) ** 2 + cy * cy) + 0.2 * ((A - cx) ** 2 + (B - cy) ** 2) + 0.1 * (cx * cx + (B - cy) ** 2));
        expect(rel(df.J, J)).toBeLessThan(1e-12);
      }
    }
  });

  it("la masa de un nudo que no es de un diafragma se reparte por su cota, y la de un nudo con apoyo va al terreno", () => {
    const base = cortante(2);
    const c = new Constructor();
    Object.assign(c, { nudos: [...base.nudos], barras: [...base.barras!], apoyos: [...base.apoyos!], restricciones: [...base.restricciones!], casos: [] });
    // Un pilar suelto de dos tramos junto al edificio, con un nudo a 1/3 de la primera planta y otro en la cota de la segunda
    const pie = c.nudo(10, 2, 0, "pie");
    const medio = c.nudo(10, 2, H / 3, "medio");
    const arriba = c.nudo(10, 2, 2 * H, "arriba");
    c.apoyo(pie);
    c.barra(pie, medio, SEC, [1, 0, 0]);
    c.barra(medio, arriba, SEC, [1, 0, 0]);
    c.caso("G", [carga(pie, { fz: -30 }), carga(medio, { fz: -60 }), carga(arriba, { fz: -90 })]);
    const md = modalDe({ ...c.modelo(), modal: { masas: [{ caso: "G", fraccion: 1 }] } });
    const g = GRAVEDAD;
    expect(rel(md.masas.total, 180 / g)).toBeLessThan(1e-12);
    // el pie y 2/3 del nudo intermedio, al terreno; 1/3 del intermedio, a la planta 1; el de arriba, a la 2
    expect(rel(md.masas.terreno, (30 + 40) / g)).toBeLessThan(1e-12);
    expect(rel(md.diafragmas[0]!.masa, 20 / g)).toBeLessThan(1e-12);
    expect(rel(md.diafragmas[1]!.masa, 90 / g)).toBeLessThan(1e-12);
    expect(rel(md.masas.repartida, 110 / g)).toBeLessThan(1e-12);
    for (const df of md.diafragmas) {
      expect(df.repartida).toBe(df.masa);
      expect(Math.hypot(df.cm[0] - 10, df.cm[1] - 2)).toBeLessThan(1e-12);
      expect(df.J).toBe(0);
    }
  });

  it("errores: sin diafragmas, sin masa, masa negativa y una definición que no vale", () => {
    const codigos = (m: ModeloAnalitico) => calcular(m).diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo);
    const base = cortante();
    expect(codigos({ ...base, restricciones: [] })).toContain("modal/sin-diafragmas");
    expect(codigos({ ...base, modal: { masas: [] } })).toEqual(["modal/sin-masa"]);
    expect(codigos({ ...base, modal: { masas: [{ caso: "G", fraccion: -1 }] } })).toEqual(["modal/definicion-no-valida"]);
    expect(codigos({ ...base, modal: { masas: [{ caso: "no", fraccion: 1 }] } })).toEqual(["modal/definicion-no-valida"]);
    expect(codigos({ ...base, modal: { nodales: [{ nudo: 999, m: 1 }] } })).toEqual(["modal/definicion-no-valida"]);
    expect(codigos({ ...base, modal: { masas: [{ caso: "G", fraccion: 1 }], g: 0 } })).toEqual(["modal/definicion-no-valida"]);
    const arriba = { ...base, casos: base.casos.map((c) => ({ ...c, nodales: c.nodales!.map((n) => ({ ...n, f: n.f.map((v) => -v) as never })) })) };
    expect(codigos(arriba)).toEqual(["modal/masa-no-positiva"]);
    // sin `modal`, el cálculo es el de siempre
    const { modal: _m, ...sin } = base;
    const r = calcular(sin);
    expect(r.valido && r.modal).toBe(undefined);
  });
});

describe("VS2: modos del edificio de cortante (criterio 3)", () => {
  it("los 9 modos de 3 plantas iguales son los de la solución cerrada a 1e-10, en X, en Y y en giro", () => {
    for (const solver of ["nucleo", "perfil"] as const) {
      const md = modalDe(cortante(), solver);
      const m = PESO / GRAVEDAD;
      const J = (m * (A * A + B * B)) / 4;
      const { kx, ky, kt } = rigideces();
      const cerrada = [
        ...cadena(3, kx, m).map((w2) => ({ w2, d: 0 })),
        ...cadena(3, ky, m).map((w2) => ({ w2, d: 1 })),
        ...cadena(3, kt, J).map((w2) => ({ w2, d: 2 })),
      ].sort((a, b) => a.w2 - b.w2);
      expect(md.modos.length).toBe(9);
      expect(md.gdl).toBe(9);
      md.modos.forEach((modo, i) => {
        expect(rel(modo.omega2, cerrada[i]!.w2), `${solver}, modo ${i + 1}`).toBeLessThan(1e-10);
        expect(rel(modo.periodo, (2 * Math.PI) / Math.sqrt(cerrada[i]!.w2))).toBeLessThan(1e-10);
        // cada modo es de una sola dirección
        const otras = [0, 1, 2].filter((d) => d !== cerrada[i]!.d);
        for (const d of otras) expect(modo.masaEfectiva[d]!).toBeLessThan(1e-18);
        expect(modo.participacion[cerrada[i]!.d]!).toBeGreaterThan(0);
        expect(modo.equilibrio.fuerzas).toBeLessThan(1e-9);
        expect(modo.equilibrio.momentos).toBeLessThan(1e-9);
      });
      // la masa efectiva del modo j de la cadena de 3: (Σ φ)² / Σ φ², con φₖ = sen((2j − 1)·k·π/7)
      const efectiva = [0, 1, 2].map((j) => {
        const phi = [1, 2, 3].map((k) => Math.sin(((2 * j + 1) * k * Math.PI) / 7));
        return phi.reduce((s, x) => s + x, 0) ** 2 / (3 * phi.reduce((s, x) => s + x * x, 0));
      });
      for (const d of [0, 1, 2]) {
        const suyos = md.modos.filter((_, i) => cerrada[i]!.d === d);
        suyos.forEach((modo, j) => expect(rel(modo.masaEfectiva[d]!, efectiva[j]!)).toBeLessThan(1e-10));
        expect(Math.abs(md.modos.reduce((s, modo) => s + modo.masaEfectiva[d]!, 0) - 1)).toBeLessThan(1e-12);
      }
    }
  });

  it("con el maestro fuera del centro de masas (el bloque de masa 3 × 3 entero), los mismos modos", () => {
    const a = modalDe(cortante());
    const b = modalDe(cortante(3, { maestro: [-7.5, 13] }));
    expect(b.modos.length).toBe(9);
    b.modos.forEach((modo, i) => {
      expect(rel(modo.omega2, a.modos[i]!.omega2)).toBeLessThan(1e-10);
      for (let k = 0; k < modo.forma.length; k++) expect(Math.abs(modo.forma[k]! - a.modos[i]!.forma[k]!)).toBeLessThan(1e-9 * Math.max(...a.modos[i]!.forma.map(Math.abs)));
    });
  });

  it("una planta sin masa no es dinámica: sigue a las demás, y los modos son los de la cadena condensada", () => {
    // dos plantas con masa y la del medio sin ella: dos muelles k en serie entre la 1 y la 3
    const md = modalDe(cortante(3, { pesos: [PESO, 0, PESO] }));
    expect(md.gdl).toBe(6);
    expect(md.modos.length).toBe(6);
    expect(md.diafragmas[1]!.masa).toBe(0);
    const m = PESO / GRAVEDAD;
    const { kx } = rigideces();
    // K = [[k + k/2, −k/2], [−k/2, k/2]] con M = m·I: ω² = (k/m)·(1 ∓ √2/2)
    const enX = md.modos.filter((modo) => modo.masaEfectiva[0] > 0.01).map((modo) => modo.omega2);
    expect(enX.length).toBe(2);
    expect(rel(enX[0]!, (kx / m) * (1 - Math.SQRT1_2))).toBeLessThan(1e-10);
    expect(rel(enX[1]!, (kx / m) * (1 + Math.SQRT1_2))).toBeLessThan(1e-10);
  });
});

// ─── Propiedades ────────────────────────────────────────────────────────────────────────────────

/** Edificio de cortante con las masas y su reparto distintos en cada planta: X, Y y el giro, acoplados. */
const acoplado = () => cortante(3, { pesos: [900, 700, 450], reparto: [0.45, 0.25, 0.2, 0.1], maestro: [1, 3.5] });

describe("VS2: propiedades de los modos (criterio 5)", () => {
  it("φᵀ·M·φ = I y φᵀ·K·φ = Ω² a 1e-10, con M de las masas de los diafragmas en su centro de masas", () => {
    const m = acoplado();
    const md = modalDe(m);
    expect(md.modos.length).toBe(9);
    // las fuerzas de inercia van en el maestro: su momento, al centro de masas, para que trabajen con la forma
    const fuerzasCm = md.modos.map((modo) =>
      md.diafragmas.flatMap((df, d) => {
        const [fx, fy, mz] = [modo.fuerzas[3 * d]!, modo.fuerzas[3 * d + 1]!, modo.fuerzas[3 * d + 2]!];
        const [dx, dy] = [df.cm[0] - m.nudos[df.maestro]!.x, df.cm[1] - m.nudos[df.maestro]!.y];
        return [fx, fy, mz - (dx * fy - dy * fx)];
      }),
    );
    const masas = md.diafragmas.flatMap((df) => [df.masa, df.masa, df.J]);
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) {
        const [a, b] = [md.modos[i]!, md.modos[j]!];
        const mij = masas.reduce((s, mk, k) => s + mk * a.forma[k]! * b.forma[k]!, 0);
        expect(Math.abs(mij - (i === j ? 1 : 0)), `M ${i},${j}`).toBeLessThan(1e-10);
        const kij = fuerzasCm[j]!.reduce((s, f, k) => s + f * a.forma[k]!, 0);
        expect(Math.abs(kij - (i === j ? a.omega2 : 0)) / Math.sqrt(a.omega2 * b.omega2), `K ${i},${j}`).toBeLessThan(1e-10);
        // y las fuerzas de inercia son ω²·M·φ
        if (i === j) fuerzasCm[i]!.forEach((f, k) => expect(Math.abs(f - a.omega2 * masas[k]! * a.forma[k]!)).toBeLessThan(1e-9 * Math.max(...fuerzasCm[i]!.map(Math.abs))));
      }
    }
    for (const d of [0, 1, 2]) expect(Math.abs(md.modos.reduce((s, modo) => s + modo.masaEfectiva[d]!, 0) - 1)).toBeLessThan(1e-12);
  });

  /**
   * Lo más físico, sin pasar por la masa de los diafragmas: en cada modo, cada nudo con masa m se
   * lleva la fuerza de inercia ω²·m·(ux, uy) de su propio desplazamiento, y la respuesta estática a
   * todas ellas (un cálculo aparte, sin modal) tiene que ser el modo. Comprueba de una vez el centro
   * de masas, la inercia de giro, el acoplamiento con el maestro y los valores propios.
   */
  function comprobarInercia(m: ModeloAnalitico, md: ResultadoModal, tol = 1e-10): void {
    const { modal: _m, ...sin } = m;
    const masas = m.casos[0]!.nodales!.map((c) => ({ nudo: c.nudo, m: -c.f[2] / GRAVEDAD }));
    const casos = md.modos.map((modo, i) => ({
      id: `modo${i + 1}`,
      nodales: masas.map((x) => carga(x.nudo, { fx: modo.omega2 * x.m * modo.u[6 * x.nudo]!, fy: modo.omega2 * x.m * modo.u[6 * x.nudo + 1]! })),
    }));
    casosValidos(calcular({ ...sin, casos })).forEach((c, i) => {
      const u = md.modos[i]!.u;
      const escala = Math.max(...u.map(Math.abs));
      let dif = 0;
      for (let k = 0; k < u.length; k++) dif = Math.max(dif, Math.abs(u[k]! - c.u[k]!));
      expect(dif / escala, `modo ${i + 1}`).toBeLessThan(tol);
    });
  }

  it("cada modo es la respuesta estática a las fuerzas de inercia ω²·m·u de sus nudos con masa", () => {
    const m = acoplado();
    comprobarInercia(m, modalDe(m));
  });

  it("con un GDL del maestro coartado, su masa no se mueve en él: un modo menos por planta, y cada uno sigue siendo la respuesta a su inercia", () => {
    // El maestro, fuera del centro de masas y con su ux coartado: quedan uy y rz, con el bloque de masa de esos dos
    const base = acoplado();
    const maestros = new Set(base.restricciones!.map((r) => r.maestro));
    const m: ModeloAnalitico = { ...base, apoyos: [...base.apoyos!, ...[...maestros].map((nudo) => ({ nudo, coartados: [true, false, false, false, false, false] as const }))] };
    const md = modalDe(m);
    expect(md.gdl).toBe(6);
    expect(md.modos.length).toBe(6);
    comprobarInercia(m, md);
    for (const modo of md.modos) {
      // el maestro no se mueve en X
      for (const df of md.diafragmas) expect(modo.u[6 * df.maestro]).toBe(0);
      expect(modo.equilibrio.fuerzas).toBeLessThan(1e-9);
      expect(modo.equilibrio.momentos).toBeLessThan(1e-9);
    }
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        // φᵀ·M·φ = I con la masa de los nudos
        const mij = m.casos[0]!.nodales!.reduce((s, c) => s + (-c.f[2] / GRAVEDAD) * (md.modos[i]!.u[6 * c.nudo]! * md.modos[j]!.u[6 * c.nudo]! + md.modos[i]!.u[6 * c.nudo + 1]! * md.modos[j]!.u[6 * c.nudo + 1]!), 0);
        expect(Math.abs(mij - (i === j ? 1 : 0))).toBeLessThan(1e-10);
      }
    }
  });

  it("con dos diafragmas a la misma cota, la masa de un nudo de fuera va al de la caja más cercana", () => {
    // Dos edificios de cortante de una planta, separados 20 m, y un nudo suelto con masa junto al segundo
    const c = new Constructor();
    const esquinas = (x0: number) => [
      [x0, 0],
      [x0 + A, 0],
      [x0 + A, B],
      [x0, B],
    ];
    const nodales: CargaNodal[] = [];
    for (const [k, x0] of [0, 20].entries()) {
      const arriba = esquinas(x0).map(([x, y]) => {
        const [pie, cabeza] = [c.nudo(x!, y!, 0), c.nudo(x!, y!, H)];
        c.apoyo(pie);
        c.barra(pie, cabeza, SEC, [1, 0, 0]);
        c.apoyo(cabeza, [false, false, true, true, true, false]);
        nodales.push(carga(cabeza, { fz: -100 }));
        return cabeza;
      });
      c.diafragma(c.nudo(x0 + A / 2, B / 2, H, `M${k}`), arriba, `D${k}`);
    }
    const [pie, suelto] = [c.nudo(29, 2, 0), c.nudo(29, 2, H)];
    c.apoyo(pie);
    c.barra(pie, suelto, SEC, [1, 0, 0]);
    nodales.push(carga(suelto, { fz: -50 }));
    c.caso("G", nodales);
    const md = modalDe({ ...c.modelo(), modal: { masas: [{ caso: "G", fraccion: 1 }] } });
    expect(rel(md.diafragmas[0]!.masa, 400 / GRAVEDAD)).toBeLessThan(1e-12);
    expect(rel(md.diafragmas[1]!.masa, 450 / GRAVEDAD)).toBeLessThan(1e-12);
    expect(md.diafragmas[0]!.repartida).toBe(0);
    expect(rel(md.diafragmas[1]!.repartida, 50 / GRAVEDAD)).toBeLessThan(1e-12);
  });

  it("cada modo es la respuesta estática a sus fuerzas de inercia ω²·M·φ, en un cálculo aparte sin modal", () => {
    const m = acoplado();
    const md = modalDe(m);
    const { modal: _m, ...sin } = m;
    const casos = md.modos.map((modo, i) => ({
      id: `modo${i + 1}`,
      nodales: md.diafragmas.map((df, d) => carga(df.maestro, { fx: modo.fuerzas[3 * d]!, fy: modo.fuerzas[3 * d + 1]!, mz: modo.fuerzas[3 * d + 2]! })),
    }));
    const estaticos = casosValidos(calcular({ ...sin, casos }));
    estaticos.forEach((c, i) => {
      const u = md.modos[i]!.u;
      const escala = Math.max(...u.map(Math.abs));
      let dif = 0;
      for (let k = 0; k < u.length; k++) dif = Math.max(dif, Math.abs(u[k]! - c.u[k]!));
      expect(dif / escala, `modo ${i + 1}`).toBeLessThan(1e-10);
    });
  });

  it("masas ×4, periodos ×2; con otra g, los mismos periodos si el peso es el mismo", () => {
    const m = acoplado();
    const a = modalDe(m);
    const b = modalDe({ ...m, modal: { masas: [{ caso: "G", fraccion: 4 }] } });
    const c = modalDe({ ...m, modal: { masas: [{ caso: "G", fraccion: 1 }], g: GRAVEDAD / 4 } });
    a.modos.forEach((modo, i) => {
      expect(rel(b.modos[i]!.periodo, 2 * modo.periodo)).toBeLessThan(1e-12);
      expect(rel(c.modos[i]!.periodo, 2 * modo.periodo)).toBeLessThan(1e-12);
    });
    expect(rel(b.masas.total, 4 * a.masas.total)).toBeLessThan(1e-14);
  });

  it("las masas puestas en los nudos dan lo mismo que las de las cargas", () => {
    const m = acoplado();
    const a = modalDe(m);
    const nodales = m.casos[0]!.nodales!.map((c) => ({ nudo: c.nudo, m: -c.f[2] / GRAVEDAD }));
    const b = modalDe({ ...m, modal: { nodales } });
    a.modos.forEach((modo, i) => expect(rel(b.modos[i]!.omega2, modo.omega2)).toBeLessThan(1e-12));
  });

  it("girar la planta alrededor de Z, trasladarla y renumerar los nudos no cambian los periodos ni las masas", () => {
    const m = acoplado();
    const a = modalDe(m);
    const girado = girarModelo(m, matrizGiro([0, 0, 1], 0.7), [12, -5, 2]);
    const renumerado = renumerarModelo(m, permutacion(m.nudos.length, 77));
    for (const otro of [girado, renumerado]) {
      const b = modalDe(otro);
      expect(b.modos.length).toBe(a.modos.length);
      a.modos.forEach((modo, i) => expect(rel(b.modos[i]!.omega2, modo.omega2), `modo ${i + 1}`).toBeLessThan(1e-10));
      const porId = new Map(b.diafragmas.map((df) => [df.id, df] as const));
      for (const df of a.diafragmas) {
        expect(rel(porId.get(df.id)!.masa, df.masa)).toBeLessThan(1e-12);
        expect(rel(porId.get(df.id)!.J, df.J)).toBeLessThan(1e-10);
      }
    }
    // girada, la masa efectiva de cada modo se reparte entre X e Y, pero su suma no cambia
    const b = modalDe(girado);
    a.modos.forEach((modo, i) => {
      expect(Math.abs(b.modos[i]!.masaEfectiva[2] - modo.masaEfectiva[2])).toBeLessThan(1e-9);
    });
  });
});
