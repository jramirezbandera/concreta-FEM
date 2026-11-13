/**
 * Criterio 2 de E5: corte por fuerzas nodales.
 * - Exactitud: un corte que separa el modelo da −(cargas + reacciones del lado A), calculadas por
 *   otro camino (validacion/e5/cortes.ts), con láminas, barras que cruzan, diafragmas y huellas.
 * - Soluciones cerradas isostáticas sin error de malla: losa unidireccional y ménsula.
 * - Convenio: una barra cortada da sus esfuerzos (diagrama de E2); con la normal al revés, Vz y Mz
 *   cambian de signo.
 * - Metamórficas: giro, renumeración e inversión de barras y láminas no cambian el corte.
 * - Diagnósticos del criterio 5.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cortesCompletos, erroresCortesCompletos, erroresMetamorficosCorte, GIRO_CORTES, losaUnidireccional, mensulaPlaca, portico } from "../../validacion/e5/cortes.ts";
import { BASE_E5 } from "../../validacion/e5/fuerzasNodales.ts";
import { laminaPlegada } from "../../validacion/e3/metamorficas.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { carga, Constructor, seccionRectangularTimoshenko } from "../pruebas/constructor.ts";
import { edificio } from "../pruebas/edificio.ts";
import { matrizGiro } from "../pruebas/transformar.ts";
import { DiagramasBarras } from "./barras.ts";
import { calcular } from "./calcular.ts";
import { Cortes, type Corte } from "./cortes.ts";
import { FuerzasNodales } from "./fuerzasNodales.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("criterio 2 de E5: un corte completo cierra el equilibrio con el lado A (≤ 1e-9)", () => {
  for (const [nombre, fabrica, cortes] of cortesCompletos()) {
    it(nombre, () => {
      const { error } = erroresCortesCompletos(fabrica, cortes);
      expect(error).toBeLessThan(1e-9);
    });
  }
});

describe("criterio 2 de E5: soluciones cerradas sin error de malla", () => {
  it("losa unidireccional: My = −q·b·x(L − x)/2, Vz = q·b(L/2 − x) y T = 0 en cada línea de la malla", () => {
    for (const [nx, ny] of [[6, 2], [12, 5]] as const) {
      const { modelo, L, b, q } = losaUnidireccional(nx, ny);
      const casos = casosValidos(calcular(modelo));
      const ct = new Cortes(modelo);
      for (let i = 1; i < nx; i++) {
        const x = (i * L) / nx;
        const r = ct.cortar({ origen: [x, b / 2, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-b / 2, b / 2] }, casos);
        expect(r.valido).toBe(true);
        const [N, Vy, Vz, T, My, Mz] = r.esfuerzos;
        const escala = Math.abs(q) * b * L * L;
        expect(Math.abs(My! + (q * b * x * (L - x)) / 2) / escala).toBeLessThan(1e-12);
        expect(Math.abs(Vz! - q * b * (L / 2 - x)) / escala).toBeLessThan(1e-12);
        for (const v of [N, Vy, T, Mz]) expect(Math.abs(v!) / escala).toBeLessThan(1e-12);
      }
    }
  });

  it("ménsula: My = −F·b(L − x) y Vz = −F·b en cada línea de la malla, con ν = 0,3", () => {
    const [L, b, F] = [3, 1.5, 4];
    const modelo = mensulaPlaca(6, 3, L, b, F);
    const casos = casosValidos(calcular(modelo));
    const ct = new Cortes(modelo);
    for (let i = 0; i < 6; i++) {
      const x = (i * L) / 6;
      const r = ct.cortar({ origen: [x, b / 2, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-b, b] }, casos);
      const [, , Vz, T, My] = r.esfuerzos;
      // en x = 0 el corte pasa por los apoyos: sus nudos son del lado B y A no tiene nada
      if (i === 0) {
        expect(r.diagnosticos.map((d) => d.codigo)).toContain("corte/vacio");
        continue;
      }
      expect(Math.abs(My! + F * b * (L - x)) / (F * b * L)).toBeLessThan(1e-12);
      expect(Math.abs(Vz! + F * b) / (F * b)).toBeLessThan(1e-12);
      expect(Math.abs(T!) / (F * b * L)).toBeLessThan(1e-12);
    }
  });
});

describe("F3: con soloLaminas, las restricciones nombradas sí entran", () => {
  it("ménsula con un enlace rígido en medio: por la recta que lo cruza, My = −F·b(L − x) con él, y sin él falta lo suyo", () => {
    const [L, b, F] = [3, 1.5, 4];
    const base = mensulaPlaca(6, 3, L, b, F);
    // Malla de 0,5 m: el enlace une los nudos de x ∈ [1, 2] e y ∈ [0,5, 1] (una «huella» en medio)
    const enHuella = base.nudos.flatMap((n, i) => (n.x >= 1 - 1e-9 && n.x <= 2 + 1e-9 && n.y >= 0.5 - 1e-9 && n.y <= 1 + 1e-9 ? [i] : []));
    const maestro = enHuella.find((i) => Math.abs(base.nudos[i]!.x - 1.5) < 1e-9 && Math.abs(base.nudos[i]!.y - 0.5) < 1e-9)!;
    const modelo = { ...base, restricciones: [{ tipo: "enlace-rigido" as const, id: "H", maestro, esclavos: enHuella.filter((i) => i !== maestro) }] };
    const casos = casosValidos(calcular(modelo));
    const ct = new Cortes(modelo);
    for (const x of [1, 1.5]) {
      const corte: Corte = { origen: [x, 0, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [0, b], soloLaminas: true };
      const con = ct.cortar({ ...corte, restricciones: ["H"] }, casos);
      const sin = ct.cortar(corte, casos);
      expect(con.valido && sin.valido).toBe(true);
      expect(con.restricciones).toHaveLength(x === 1.5 ? 1 : 0);
      const [, , Vz, , My] = con.esfuerzos;
      expect(Math.abs(My! + F * b * (L - x)) / (F * b * L)).toBeLessThan(1e-12);
      expect(Math.abs(Vz! + F * b) / (F * b)).toBeLessThan(1e-12);
      // Sin la restricción, lo que pasa por el enlace no está (en x = 1 sus nudos del corte son del lado B: no transmite)
      if (x === 1.5) expect(Math.abs(sin.esfuerzos[4]! + F * b * (L - x)) / (F * b * L)).toBeGreaterThan(0.05);
      else expect(sin.esfuerzos[4]).toBeCloseTo(con.esfuerzos[4]!, 10);
    }
    // Una restricción que no existe no cambia nada
    const c: Corte = { origen: [1.5, 0, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [0, b], soloLaminas: true };
    expect([...ct.cortar({ ...c, restricciones: ["otra"] }, casos).esfuerzos]).toEqual([...ct.cortar(c, casos).esfuerzos]);
  });

  it("con soloEsclavos (PB-8), del enlace sólo cuentan sus esclavos: con el maestro del otro lado, lo mismo bit a bit; del mismo lado, sin él", () => {
    const [L, b, F] = [3, 1.5, 4];
    const base = mensulaPlaca(6, 3, L, b, F);
    const enHuella = base.nudos.flatMap((n, i) => (n.x >= 1 - 1e-9 && n.x <= 2 + 1e-9 && n.y >= 0.5 - 1e-9 && n.y <= 1 + 1e-9 ? [i] : []));
    // El maestro en x = 1, a un lado de la recta x = 1,5 (como el eje de un pilar con un punto fijo)
    const maestro = enHuella.find((i) => Math.abs(base.nudos[i]!.x - 1) < 1e-9 && Math.abs(base.nudos[i]!.y - 0.5) < 1e-9)!;
    const modelo = { ...base, restricciones: [{ tipo: "enlace-rigido" as const, id: "H", maestro, esclavos: enHuella.filter((i) => i !== maestro) }] };
    const casos = casosValidos(calcular(modelo));
    const ct = new Cortes(modelo);
    const cambian: boolean[] = [];
    for (const sx of [1, -1] as const) {
      const corte: Corte = { origen: [1.5, 0, 0], x: [sx, 0, 0], vz: [0, 0, 1], y: sx > 0 ? [0, b] : [-b, 0], soloLaminas: true, restricciones: ["H"] };
      const con = ct.cortar(corte, casos);
      const esclavos = ct.cortar({ ...corte, soloEsclavos: true }, casos);
      expect(con.valido && esclavos.valido).toBe(true);
      cambian.push([...con.esfuerzos].some((v, k) => v !== esclavos.esfuerzos[k]));
      // Sin `restricciones`, no hace nada
      const sin = { ...corte, restricciones: undefined };
      expect([...ct.cortar({ ...sin, soloEsclavos: true }, casos).esfuerzos]).toEqual([...ct.cortar(sin, casos).esfuerzos]);
    }
    // Con una normal el maestro queda del lado B (igual) y con la otra, del lado A (cambia)
    expect(cambian.sort()).toEqual([false, true]);
  });

  it("con soloEsclavos y una cadena de enlaces (A2-40), lo mismo que con el enlace único: lo del segundo no cuenta dos veces", () => {
    const [L, b, F] = [3, 1.5, 4];
    const base = mensulaPlaca(12, 6, L, b, F);
    const en = (x: number, y: number) => base.nudos.findIndex((n) => Math.abs(n.x - x) < 1e-9 && Math.abs(n.y - y) < 1e-9);
    const enHuella = base.nudos.flatMap((n, i) => (n.x >= 1 - 1e-9 && n.x <= 2 + 1e-9 && n.y >= 0.5 - 1e-9 && n.y <= 1 + 1e-9 ? [i] : []));
    const maestro = en(1, 0.5);
    // La cadena: H2 (maestro en (1,25; 0,75), del lado A) cuelga de H1, con tres nudos del lado A
    const m2 = en(1.25, 0.75);
    const de2 = [en(1, 0.75), en(1, 1), en(1.25, 1)];
    const unico = { ...base, restricciones: [{ tipo: "enlace-rigido" as const, id: "H", maestro, esclavos: enHuella.filter((i) => i !== maestro) }] };
    const cadena = {
      ...base,
      restricciones: [
        { tipo: "enlace-rigido" as const, id: "H1", maestro, esclavos: enHuella.filter((i) => i !== maestro && !de2.includes(i)) },
        { tipo: "enlace-rigido" as const, id: "H2", maestro: m2, esclavos: de2 },
      ],
    };
    const corte: Corte = { origen: [1.5, 0, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [0, b], soloLaminas: true, soloEsclavos: true };
    const ru = new Cortes(unico).cortar({ ...corte, restricciones: ["H"] }, casosValidos(calcular(unico)));
    const rc = new Cortes(cadena).cortar({ ...corte, restricciones: ["H1", "H2"] }, casosValidos(calcular(cadena)));
    expect(ru.valido && rc.valido).toBe(true);
    expect(rc.restricciones).toHaveLength(2);
    const escala = Math.max(...[...ru.esfuerzos].map(Math.abs));
    expect(escala).toBeGreaterThan(1);
    ru.esfuerzos.forEach((v, k) => expect(Math.abs(rc.esfuerzos[k]! - v)).toBeLessThan(1e-9 * escala));
    // Con los maestros (sin soloEsclavos), la cadena tampoco cuenta dos veces
    const cu = new Cortes(unico).cortar({ ...corte, soloEsclavos: undefined, restricciones: ["H"] }, casosValidos(calcular(unico)));
    const cc = new Cortes(cadena).cortar({ ...corte, soloEsclavos: undefined, restricciones: ["H1", "H2"] }, casosValidos(calcular(cadena)));
    cu.esfuerzos.forEach((v, k) => expect(Math.abs(cc.esfuerzos[k]! - v)).toBeLessThan(1e-9 * escala));
  });

  it("con esclavos (PB-11), sólo esos nudos: todos, lo de soloEsclavos bit a bit; ninguno, sin la restricción; dos grupos, la suma", () => {
    const [L, b, F] = [3, 1.5, 4];
    const base = mensulaPlaca(6, 3, L, b, F);
    const enHuella = base.nudos.flatMap((n, i) => (n.x >= 1 - 1e-9 && n.x <= 2 + 1e-9 && n.y >= 0.5 - 1e-9 && n.y <= 1 + 1e-9 ? [i] : []));
    const maestro = enHuella.find((i) => Math.abs(base.nudos[i]!.x - 2) < 1e-9 && Math.abs(base.nudos[i]!.y - 0.5) < 1e-9)!;
    const esclavos = enHuella.filter((i) => i !== maestro);
    const modelo = { ...base, restricciones: [{ tipo: "enlace-rigido" as const, id: "H", maestro, esclavos }] };
    const casos = casosValidos(calcular(modelo));
    const ct = new Cortes(modelo);
    // Del lado A (x < 1,5) quedan los esclavos de x = 1
    const corte: Corte = { origen: [1.5, 0, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [0, b], soloLaminas: true, restricciones: ["H"], soloEsclavos: true };
    const todos = ct.cortar(corte, casos);
    expect(todos.valido && todos.restricciones.length === 1).toBe(true);
    expect([...ct.cortar({ ...corte, esclavos }, casos).esfuerzos]).toEqual([...todos.esfuerzos]);
    const ninguno = ct.cortar({ ...corte, esclavos: [] }, casos);
    expect(ninguno.restricciones).toEqual([]);
    expect([...ninguno.esfuerzos]).toEqual([...ct.cortar({ ...corte, restricciones: undefined, soloEsclavos: undefined }, casos).esfuerzos]);
    const enA = esclavos.filter((i) => base.nudos[i]!.x < 1.5);
    expect(enA.length).toBeGreaterThan(1);
    const [a, c] = [enA.slice(0, 1), enA.slice(1)];
    const ra = ct.cortar({ ...corte, esclavos: a }, casos).esfuerzos;
    const rc = ct.cortar({ ...corte, esclavos: c }, casos).esfuerzos;
    const escala = Math.max(...[...todos.esfuerzos].map(Math.abs));
    todos.esfuerzos.forEach((v, k) => expect(Math.abs(ra[k]! + rc[k]! - ninguno.esfuerzos[k]! - v)).toBeLessThan(1e-12 * escala));
    // Y uno que no es un índice, no válido
    expect(ct.cortar({ ...corte, esclavos: [0.5] }, casos).valido).toBe(false);
  });
});

describe("criterio 2 de E5: convenio de las barras", () => {
  it("una barra cortada da su diagrama; con la normal al revés, Vz y Mz cambian de signo", () => {
    const modelo = portico();
    const casos = casosValidos(calcular(modelo));
    const ct = new Cortes(modelo);
    const db = new DiagramasBarras(modelo);
    const pb = db.barra(1);
    const e1 = [pb.R[0]!, pb.R[1]!, pb.R[2]!];
    const vz = [pb.R[6]!, pb.R[7]!, pb.R[8]!] as const;
    for (const x of [0.3, 1.2, 2.9, 4.4]) {
      const O = [0, 1, 2].map((q) => pb.ip[q]! + x * e1[q]!) as [number, number, number];
      const d = db.diagrama(1, 0, casos[0]!).esfuerzosEn(x, -1);
      const directo = ct.cortar({ origen: O, x: e1 as [number, number, number], vz: [...vz] as [number, number, number] }, casos).esfuerzos;
      const inverso = ct.cortar({ origen: O, x: e1.map((c) => -c) as [number, number, number], vz: [...vz] as [number, number, number] }, casos).esfuerzos;
      const escala = Math.max(...d.map(Math.abs));
      for (let c = 0; c < 6; c++) {
        expect(Math.abs(directo[c]! - d[c]!) / escala).toBeLessThan(1e-12);
        const s = c === 2 || c === 5 ? -1 : 1;
        // con la normal al revés, el lado A es el (x, L]: el esfuerzo en x⁺ (aquí no hay saltos en x)
        expect(Math.abs(inverso[c]! - s * d[c]!) / escala).toBeLessThan(1e-12);
      }
    }
  });
});

describe("criterio 2 de E5: pruebas metamórficas de los cortes (≤ 1e-9)", () => {
  const franja: Corte = { id: "franja de la losa en x = 2", origen: [2, 0, 3], x: [1, 0, 0], vz: [0, 0, 1], y: [0, 2] };
  const casos: [string, () => ReturnType<typeof laminaPlegada>, Corte[], number[]][] = [
    ["lámina plegada", laminaPlegada, [...cortesCompletos()[1]![2], franja], GIRO_CORTES],
    ["pórtico", portico, cortesCompletos().find(([n]) => n === "pórtico")![2], GIRO_CORTES],
    ["edificio E3 con muelles", () => edificio({ ...BASE_E5, muelles: true }).modelo, cortesCompletos().find(([n]) => n === "edificio E3 con muelles")![2], matrizGiro([-0.6, 0.2, 0.4], 2.3)],
    ["edificio E3 con diafragma", () => edificio({ ...BASE_E5, diafragma: true }).modelo, cortesCompletos().find(([n]) => n === "edificio E3 con diafragma y huellas")![2], matrizGiro([0, 0, 1], -0.4)],
  ];
  for (const [nombre, fabrica, cortes, R] of casos) {
    it(nombre, () => {
      expect(erroresMetamorficosCorte(fabrica, cortes, R)).toBeLessThan(1e-9);
    });
  }
});

describe("criterio 5 de E5: diagnósticos de los cortes", () => {
  const modelo = edificio({ ...BASE_E5, diafragma: true }).modelo;
  let ct: Cortes;
  let casos: ReturnType<typeof casosValidos>;
  beforeAll(() => {
    casos = casosValidos(calcular(modelo));
    ct = new Cortes(modelo);
  });
  const codigos = (c: Corte) => ct.cortar(c, casos).diagnosticos.map((d) => d.codigo);

  it("un corte que atraviesa láminas por dentro no es válido por fuerzas nodales", () => {
    const r = ct.cortar({ origen: [5, 4, 1.4], x: [0, 0, 1], vz: [1, 0, 0], y: [-100, 100], z: [-100, 100] }, casos);
    expect(r.valido).toBe(false);
    expect(r.diagnosticos.map((d) => d.codigo)).toEqual(["corte/atraviesa-laminas"]);
    expect(r.esfuerzos.every(Number.isNaN)).toBe(true);
  });

  it("una franja de losa con diafragma: N, Vy y Mz sin valor (NaN); Vz, T y My sí", () => {
    const r = ct.cortar({ origen: [2, 2, 3], x: [1, 0, 0], vz: [0, 0, 1], y: [-1, 1] }, casos);
    expect(r.valido).toBe(true);
    expect(r.diagnosticos.map((d) => d.codigo)).toEqual(["corte/restriccion-partida"]);
    for (let k = 0; k < casos.length; k++) {
      const e = r.esfuerzos.subarray(6 * k, 6 * k + 6);
      expect([0, 1, 5].every((c) => Number.isNaN(e[c]!))).toBe(true);
      expect([2, 3, 4].every((c) => Number.isFinite(e[c]!))).toBe(true);
    }
  });

  it("una franja que parte una huella deja todo sin valor", () => {
    const r = ct.cortar({ origen: [5, 4.5, 3], x: [1, 0, 0], vz: [0, 0, 1], y: [0, 2] }, casos);
    expect(r.diagnosticos.map((d) => d.codigo)).toContain("corte/restriccion-partida");
    expect(r.esfuerzos.subarray(0, 6).every(Number.isNaN)).toBe(true);
  });

  it("bordes que no siguen la malla: aviso y extensión real", () => {
    const r = ct.cortar({ origen: [2, 2, 3], x: [1, 0, 0], vz: [0, 0, 1], y: [-0.4, 0.6] }, casos);
    expect(r.diagnosticos.map((d) => d.codigo)).toContain("corte/borde-no-sigue-malla");
    // malla de 1 m: sólo entra la lámina de y ∈ [2, 3] (centroide en y = +0,5 del corte)
    expect(r.extension!.y[0]).toBeCloseTo(0, 12);
    expect(r.extension!.y[1]).toBeCloseTo(1, 12);
  });

  it("una barra cuyos offsets cruzan el plano y vuelven es ambigua", () => {
    const m = new Constructor();
    const a = m.nudo(0, 0, 0);
    const b = m.nudo(0, 0, 3);
    m.barra(a, b, seccionRectangularTimoshenko(0.3, 0.3), [1, 0, 0], { offsets: { i: [1, 0, 0], j: [1, 0, 0] } });
    m.apoyo(a);
    m.caso("F", [carga(b, { fx: 2, fz: -5 })]);
    const modelo = m.modelo();
    const r = new Cortes(modelo).cortar({ origen: [0.5, 0, 1.5], x: [1, 0, 0], vz: [0, 0, 1], y: [-1, 1], z: [-5, 5] }, casosValidos(calcular(modelo)));
    expect(r.valido).toBe(false);
    expect(r.diagnosticos.map((d) => d.codigo)).toEqual(["corte/barra-ambigua"]);
  });

  it("definiciones no válidas y cortes vacíos", () => {
    expect(codigos({ origen: [0, 0, 0], x: [0, 0, 0], vz: [0, 0, 1] })).toEqual(["corte/no-valido"]);
    expect(codigos({ origen: [0, 0, 0], x: [0, 0, 1], vz: [0, 0, 2] })).toEqual(["corte/no-valido"]);
    expect(codigos({ origen: [0, 0, NaN], x: [1, 0, 0], vz: [0, 0, 1] })).toEqual(["corte/no-valido"]);
    expect(codigos({ origen: [0, 0, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [1, 0] })).toEqual(["corte/no-valido"]);
    expect(codigos({ origen: [50, 0, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-1, 1] })).toEqual(["corte/vacio"]);
  });

  it("los cortes de la validación no dan ningún diagnóstico", () => {
    for (const [, fabrica, cortes] of cortesCompletos()) {
      const { resultados } = erroresCortesCompletos(fabrica, cortes);
      for (const r of resultados) expect(r.diagnosticos).toEqual([]);
    }
  });
});

describe("AU-8: los resultados tienen que ser los de todos los casos, en el orden del modelo", () => {
  it("un corte con un caso suelto o desordenado es un error, no un resultado", () => {
    const { modelo: base, b } = losaUnidireccional(6, 2);
    // Un caso más, con su id (antes repetía «otras», que el motor ya no admite: AU-11)
    const modelo = { ...base, casos: [...base.casos, { ...base.casos[0]!, id: "q-2" }] };
    const casos = casosValidos(calcular(modelo));
    const ct = new Cortes(modelo);
    const corte: Corte = { origen: [2, b / 2, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-b / 2, b / 2] };
    expect(ct.cortar(corte, casos).valido).toBe(true);
    // Antes, con sólo el segundo caso, salía Vz = 2,1578 en vez de −5,8422, válido y sin diagnóstico
    for (const mal of [[casos[1]!], [...casos].reverse()]) {
      const r = ct.cortar(corte, mal);
      expect(r.valido).toBe(false);
      expect(r.diagnosticos.map((d) => d.codigo)).toEqual(["motor/error-interno"]);
      expect([...r.esfuerzos].every(Number.isNaN)).toBe(true);
    }
    const fn = new FuerzasNodales(modelo);
    expect(() => fn.laminaCasos(0, [casos[1]!])).toThrow(/resultados para los \d+ casos del modelo/);
    expect(() => fn.sumaEnNudos([0], [...casos].reverse())).toThrow(/orden del modelo/);
    expect(() => fn.lamina(0, 0, casos[1]!)).toThrow(/«otras»/);
    expect(fn.laminaCasos(0, casos)).toHaveLength(modelo.casos.length);
  });
});
