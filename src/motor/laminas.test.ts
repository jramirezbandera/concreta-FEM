/**
 * Láminas de E3 en el motor: patch test de MacNeal–Harder (membrana y flexión a la vez) con
 * multiplicadores y ejes de usuario girados, convenio de signos (H02), cargas de lámina,
 * resultantes y diagnósticos. Con los dos solvers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos, errorPorGrupos } from "../pruebas/comparar.ts";
import { carga, Constructor, EMPOTRADO } from "../pruebas/constructor.ts";
import { PARCHE_EXTERIORES, PARCHE_NUDOS, PARCHE_QUADS } from "../pruebas/parche.ts";
import { mallaRectangular } from "../pruebas/placa.ts";
import { invertirLaminas } from "../pruebas/transformar.ts";
import type { MultiplicadoresLamina } from "../elementos/lamina.ts";
import { calcular } from "./calcular.ts";
import { ResultantesLaminas } from "./laminas.ts";
import type { CargaLamina, ModeloAnalitico, Vec3 } from "./modelo.ts";
import type { TipoSolver } from "./solucion.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const SOLVERS: TipoSolver[] = ["nucleo", "perfil"];
const RETICULAR: MultiplicadoresLamina = { f11: 0.55, f22: 0.4, f12: 0.25, m11: 0.32, m22: 0.27, m12: 0.12, v13: 0.2, v23: 0.15 };
const max = (v: ArrayLike<number>) => Math.max(...Array.from(v, Math.abs));
const res = (r: { esfuerzosLaminas: Float64Array }, l: number) => Array.from(r.esfuerzosLaminas.subarray(8 * l, 8 * l + 8));

describe.each(SOLVERS)("láminas (solver %s)", (solver) => {
  describe("patch test de MacNeal–Harder: membrana y flexión a la vez", () => {
    const casos: { nombre: string; mult?: MultiplicadoresLamina; angulo?: number }[] = [
      { nombre: "isótropa, ejes de CSI" },
      { nombre: "reticular, ejes de CSI", mult: RETICULAR },
      { nombre: "reticular, eje 1 a 30°", mult: RETICULAR, angulo: 30 },
      { nombre: "reticular, eje 1 a −110°", mult: RETICULAR, angulo: -110 },
    ];
    for (const c of casos) {
      it(`${c.nombre}: nudos interiores exactos y resultantes constantes`, () => {
        const E = 1e6;
        const nu = 0.25;
        const t = 0.001;
        const k = 1e-3;
        // membrana: u = k(2x + 2y), v = 3ky, ψ = ω = −k; flexión: w = k(x² + xy + y²)/2, θx = ∂w/∂y, θy = −∂w/∂x
        const exacto = ([x, y]: readonly [number, number]) => [k * (2 * x + 2 * y), 3 * k * y, (k * (x * x + x * y + y * y)) / 2, k * (x / 2 + y), -k * (x + y / 2), -k];
        const a = ((c.angulo ?? 0) * Math.PI) / 180;
        const eje1: Vec3 | undefined = c.angulo === undefined ? undefined : [Math.cos(a), Math.sin(a), 0];
        const m = new Constructor();
        PARCHE_NUDOS.forEach(([x, y]) => m.nudo(x, y, 0));
        PARCHE_QUADS.forEach((q) => m.lamina(q, { E, nu, t }, { eje1, multiplicadores: c.mult }));
        for (const v of PARCHE_EXTERIORES) m.apoyo(v, EMPOTRADO);
        m.caso(
          "parche",
          [],
          PARCHE_EXTERIORES.flatMap((v) => exacto(PARCHE_NUDOS[v]!).map((valor, g) => ({ nudo: v, gdl: g as 0, valor }))),
        );
        const [r] = casosValidos(calcular(m.modelo(), { solver }));
        const calc: number[] = [];
        const ref: number[] = [];
        PARCHE_NUDOS.forEach((p, v) => {
          calc.push(...r!.u.subarray(6 * v, 6 * v + 6));
          ref.push(...exacto(p));
        });
        expect(errorPorGrupos(calc, ref)).toBeLessThan(1e-10);

        // Resultantes exactas en los ejes de usuario (giro α respecto a X; normal +Z)
        const [C, S] = [Math.cos(a), Math.sin(a)];
        const giro = ([ex, ey, g]: number[]) => [C * C * ex! + S * S * ey! + C * S * g!, S * S * ex! + C * C * ey! - C * S * g!, -2 * C * S * ex! + 2 * C * S * ey! + (C * C - S * S) * g!];
        const eps = giro([2 * k, 3 * k, 2 * k]);
        const kap = giro([-k, -k, -k]); // curvaturas de Batoz [βx,x, βy,y, βx,y + βy,x], con βx = θy y βy = −θx
        const mu = c.mult ?? {};
        const ortotropa = (D: number, s: number[]) => [
          [s[0]! * s[0]! * D, s[0]! * s[1]! * D * nu, 0],
          [s[0]! * s[1]! * D * nu, s[1]! * s[1]! * D, 0],
          [0, 0, (s[2]! * s[2]! * D * (1 - nu)) / 2],
        ];
        const Cm = ortotropa((E * t) / (1 - nu * nu), [Math.sqrt(mu.f11 ?? 1), Math.sqrt(mu.f22 ?? 1), Math.sqrt(mu.f12 ?? 1)]);
        const Hb = ortotropa((E * t ** 3) / (12 * (1 - nu * nu)), [Math.sqrt(mu.m11 ?? 1), Math.sqrt(mu.m22 ?? 1), Math.sqrt(mu.m12 ?? 1)]);
        const N = Cm.map((fila) => fila[0]! * eps[0]! + fila[1]! * eps[1]! + fila[2]! * eps[2]!);
        const M = Hb.map((fila) => -(fila[0]! * kap[0]! + fila[1]! * kap[1]! + fila[2]! * kap[2]!));
        for (let l = 0; l < PARCHE_QUADS.length; l++) {
          const s = res(r!, l);
          expect(max(s.slice(0, 3).map((v, i) => v - N[i]!)) / max(N), `N ${l}`).toBeLessThan(1e-9);
          expect(max(s.slice(3, 6).map((v, i) => v - M[i]!)) / max(M), `M ${l}`).toBeLessThan(1e-9);
          expect(max(s.slice(6)) / (max(M) / 0.24), `Q ${l}`).toBeLessThan(1e-9);
        }
      });
    }
  });

  describe("convenio de signos (H02)", () => {
    /** Banda de L × 1 en el plano XY (normal +Z), ν = 0, malla nx × 2. */
    function banda(L: number, nx: number, invertida = false) {
      const m = new Constructor();
      const malla = mallaRectangular(m, { a: L, b: 1, nx, ny: 2, material: { E: 3e7, nu: 0, t: 0.2 } });
      const modelo = () => (invertida ? invertirLaminas(m.modelo()).modelo : m.modelo());
      return { m, malla, modelo };
    }

    it("ménsula con carga de línea en la punta: Mx = −F·(L − x) (negativo, tracción arriba) y Qx = −F", () => {
      const L = 4;
      const F = 10;
      const { m, malla, modelo } = banda(L, 8);
      for (const v of malla.nudos[0]!) m.apoyo(v, EMPOTRADO);
      const lineas: CargaLamina[] = [0, 1].map((j) => ({
        tipo: "linea",
        lamina: malla.laminas[7]![j]!,
        ejes: "global",
        a: malla.punto(L, j / 2),
        b: malla.punto(L, (j + 1) / 2),
        qa: [0, 0, -F],
      }));
      m.caso("punta", [], [], [], lineas);
      const [r] = casosValidos(calcular(modelo(), { solver }));
      for (let i = 0; i < 8; i++) {
        for (const j of [0, 1]) {
          const s = res(r!, malla.laminas[i]![j]!);
          const xc = (i + 0.5) * (L / 8);
          expect(Math.abs(s[3]! + F * (L - xc)) / (F * L), `Mx ${i}`).toBeLessThan(1e-9);
          expect(Math.abs(s[6]! + F) / F, `Qx ${i}`).toBeLessThan(1e-9);
          expect(Math.abs(s[4]!) + Math.abs(s[5]!) + Math.abs(s[7]!)).toBeLessThan(1e-9 * F * L);
        }
      }
      let Rz = 0;
      for (const v of malla.nudos[0]!) Rz += r!.reacciones[6 * v + 2]!;
      expect(Math.abs(Rz - F) / F).toBeLessThan(1e-12);
    });

    it("biapoyada con gravedad: Mx de vano positivo y Qx negativo junto al apoyo de x = 0, exactos para la carga repartida a los nudos", () => {
      // La presión se reparte a los nudos con las funciones bilineales (como PyNite): la banda es
      // una viga con cargas nudales. Mx en el centroide es la media de los momentos exactos en los
      // dos nudos del elemento (−q·h²/8 respecto a qx(L − x)/2: orden 2) y Qx es el exacto.
      const L = 4;
      const q = 10;
      const nx = 16;
      const { m, malla, modelo } = banda(L, nx);
      for (const v of malla.nudos[0]!) m.apoyo(v, [true, true, true, false, false, false]);
      for (const v of malla.nudos[nx]!) m.apoyo(v, [false, true, true, false, false, false]);
      m.caso("g", [], [], [], malla.laminas.flat().map((l) => ({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, -q] })));
      const [r] = casosValidos(calcular(modelo(), { solver }));
      const Mx = (x: number) => (q * x * (L - x)) / 2;
      const h = L / nx;
      for (let i = 0; i < nx; i++) {
        for (const j of [0, 1]) {
          const s = res(r!, malla.laminas[i]![j]!);
          const xc = (i + 0.5) * h;
          expect(Math.abs(s[3]! - (Mx(i * h) + Mx((i + 1) * h)) / 2) / Mx(L / 2), `Mx ${i}`).toBeLessThan(1e-9);
          expect(Math.abs(s[6]! + (q * (L - 2 * xc)) / 2) / (q * L), `Qx ${i}`).toBeLessThan(1e-9);
        }
      }
      expect(res(r!, malla.laminas[nx / 2]![0]!)[3]!).toBeGreaterThan(0);
      expect(res(r!, malla.laminas[0]![0]!)[6]!).toBeLessThan(0);
    });

    it("H01: placa de 4 × 4 girada 30° en su plano, con el eje 1 según X global: los momentos globales de referencia de la investigación", () => {
      // investigacion/experimentos/03-resultados/exp_pynite_signos_placas.py, apartado (3): placa
      // apoyada de 4 × 4 m, t = 0,20, E = 30 GPa, ν = 0,3, q = 10 kPa hacia −Z, malla 16 × 16, girada
      // 30° alrededor de Z; elemento (2, 5). Referencia (Rz·T0·Rzᵀ, convenio de PyNite, N·m/m):
      // Mx = −5 765,24, My = −2 394,19, Mxy = 655,76. En el motor (kN, signo de CSI): −1e-3 × eso.
      const n = 16;
      const c = Math.cos(Math.PI / 6);
      const s = Math.sin(Math.PI / 6);
      const m = new Constructor();
      const g = mallaRectangular(m, { a: 4, b: 4, nx: n, ny: n, ex: [c, s, 0], ey: [-s, c, 0], material: { E: 3e7, nu: 0.3, t: 0.2 }, lamina: { eje1: [1, 0, 0] } });
      for (let i = 0; i <= n; i++) {
        for (let j = 0; j <= n; j++) {
          const borde = i === 0 || i === n || j === 0 || j === n;
          m.apoyo(g.nudos[i]![j]!, [i === 0 && j === 0, (i === 0 && j === 0) || (i === n && j === 0), borde, false, false, true]);
        }
      }
      m.caso("q", [], [], [], g.laminas.flat().map((l) => ({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, -10] })));
      const [r] = casosValidos(calcular(m.modelo(), { solver }));
      const s25 = res(r!, g.laminas[2]![5]!);
      expect(Math.abs(s25[3]! - 5.76524)).toBeLessThan(1e-5);
      expect(Math.abs(s25[4]! - 2.39419)).toBeLessThan(1e-5);
      expect(Math.abs(s25[5]! + 0.65576)).toBeLessThan(1e-5);
    });

    it("invertir el orden de los nudos cambia los signos que dice la cabecera", () => {
      const L = 4;
      const F = 10;
      for (const conEje of [false, true]) {
        const m = new Constructor();
        const malla = mallaRectangular(m, { a: L, b: 1, nx: 4, ny: 2, material: { E: 3e7, nu: 0.2, t: 0.2 }, lamina: conEje ? { eje1: [1, 0.4, 0] } : {} });
        for (const v of malla.nudos[0]!) m.apoyo(v, EMPOTRADO);
        // carga oblicua para que salgan las 8 resultantes
        m.caso("oblicua", [carga(malla.nudos[4]![0]!, { fx: 5, fy: 3, fz: -F, mz: 2 })], [], [], [
          { tipo: "superficie", lamina: malla.laminas[1]![1]!, ejes: "local", q: [1, -2, 3] },
        ]);
        const base = m.modelo();
        const inv = invertirLaminas(base);
        const [a] = casosValidos(calcular(base, { solver }));
        const [b] = casosValidos(calcular(inv.modelo, { solver }));
        expect(errorPorGrupos(b!.u, a!.u)).toBeLessThan(1e-12);
        for (let l = 0; l < base.laminas!.length; l++) {
          const sa = res(a!, l);
          const sb = res(b!, l);
          const sg = inv.signos(l);
          const escala = max(a!.esfuerzosLaminas);
          for (let c = 0; c < 8; c++) expect(Math.abs(sb[c]! - sg[c]! * sa[c]!) / escala, `${conEje} ${l} ${c}`).toBeLessThan(1e-10);
        }
      }
    });
  });

  describe("cargas de lámina", () => {
    /** Placa de 2 × 2 elementos de 1 m apoyada en las esquinas. */
    function placa() {
      const m = new Constructor();
      const malla = mallaRectangular(m, { a: 2, b: 2, nx: 2, ny: 2, material: { E: 3e7, nu: 0.2, t: 0.2 } });
      const esquinas = [malla.nudos[0]![0]!, malla.nudos[2]![0]!, malla.nudos[2]![2]!, malla.nudos[0]![2]!];
      m.apoyo(esquinas[0]!, [true, true, true, false, false, true]);
      m.apoyo(esquinas[1]!, [false, true, true, false, false, false]);
      m.apoyo(esquinas[2]!, [false, false, true, false, false, false]);
      m.apoyo(esquinas[3]!, [true, false, true, false, false, false]);
      return { m, malla };
    }
    const resolver = (modelo: ModeloAnalitico) => casosValidos(calcular(modelo, { solver }));

    it("puntual sobre un nudo = carga nodal; superficie por nudo igual = uniforme; local = global con normal +Z", () => {
      const { m, malla } = placa();
      const c = malla.nudos[1]![1]!;
      m.caso("nodal", [carga(c, { fz: -7, mx: 1.5 })]);
      m.caso("puntual", [], [], [], [{ tipo: "puntual", lamina: malla.laminas[0]![0]!, ejes: "global", punto: malla.punto(1, 1), F: [0, 0, -7], M: [1.5, 0, 0] }]);
      const sup = (ejes: "local" | "global", q: CargaLamina extends never ? never : Vec3 | readonly [Vec3, Vec3, Vec3, Vec3]): CargaLamina[] =>
        malla.laminas.flat().map((l) => ({ tipo: "superficie", lamina: l, ejes, q }));
      m.caso("uniforme", [], [], [], sup("global", [0, 0, -5]));
      m.caso("por-nudo", [], [], [], sup("global", [[0, 0, -5], [0, 0, -5], [0, 0, -5], [0, 0, -5]]));
      m.caso("local", [], [], [], sup("local", [0, 0, -5]));
      const r = resolver(m.modelo());
      expect(errorPorGrupos(r[1]!.u, r[0]!.u)).toBeLessThan(1e-13);
      expect(errorPorGrupos(r[3]!.u, r[2]!.u)).toBeLessThan(1e-14);
      expect(errorPorGrupos(r[4]!.u, r[2]!.u)).toBeLessThan(1e-14);
    });

    it("línea a lo largo de un lado = q·L/2 en sus dos nudos", () => {
      const { m, malla } = placa();
      const [i, j] = [malla.nudos[1]![0]!, malla.nudos[1]![1]!];
      m.caso("linea", [], [], [], [{ tipo: "linea", lamina: malla.laminas[1]![0]!, ejes: "global", a: malla.punto(1, 0), b: malla.punto(1, 1), qa: [0, 0, -4], qb: [0, 0, -8] }]);
      // trapecial: nudo a recibe L(2qa + qb)/6, nudo b L(qa + 2qb)/6
      m.caso("nodal", [carga(i, { fz: -16 / 6 }), carga(j, { fz: -20 / 6 })]);
      const r = resolver(m.modelo());
      expect(errorPorGrupos(r[0]!.u, r[1]!.u)).toBeLessThan(1e-13);
    });

    it("empuje hidrostático por nudos sobre un muro: resultante γH²B/2 y momento γH³B/6 exactos", () => {
      const m = new Constructor();
      const [H, B, g] = [3, 2, 10];
      // muro en el plano XZ (normal −Y), empotrado en la base
      const malla = mallaRectangular(m, { a: B, b: H, nx: 4, ny: 6, ex: [1, 0, 0], ey: [0, 0, 1], material: { E: 3e7, nu: 0.2, t: 0.25 } });
      for (let i = 0; i <= 4; i++) m.apoyo(malla.nudos[i]![0]!, EMPOTRADO);
      const p = (z: number): Vec3 => [0, g * (H - z), 0];
      const cargas: CargaLamina[] = [];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 6; j++) {
          const z0 = (j * H) / 6;
          const z1 = ((j + 1) * H) / 6;
          cargas.push({ tipo: "superficie", lamina: malla.laminas[i]![j]!, ejes: "global", q: [p(z0), p(z0), p(z1), p(z1)] });
        }
      }
      m.caso("empuje", [], [], [], cargas);
      const [r] = resolver(m.modelo());
      let Ry = 0;
      let Mx = 0;
      for (let i = 0; i <= 4; i++) {
        const v = malla.nudos[i]![0]!;
        Ry += r!.reacciones[6 * v + 1]!;
        Mx += r!.reacciones[6 * v + 3]!;
      }
      expect(Math.abs(Ry + (g * H * H * B) / 2) / ((g * H * H * B) / 2)).toBeLessThan(1e-12);
      expect(Math.abs(Mx - (g * H ** 3 * B) / 6) / ((g * H ** 3 * B) / 6)).toBeLessThan(1e-12);
      expect(r!.equilibrio.fuerzas).toBeLessThan(1e-12);
      expect(r!.equilibrio.momentos).toBeLessThan(1e-12);
    });

    it("cargas puntuales y de línea en el interior de un elemento distorsionado, en ejes locales de una lámina inclinada: equilibrio con la resultante real", () => {
      const m = new Constructor();
      const s = Math.SQRT1_2;
      const malla = mallaRectangular(m, { a: 3, b: 2, nx: 3, ny: 2, origen: [1, 2, 3], ex: [s, 0, s], ey: [0, 1, 0], material: { E: 3e7, nu: 0.2, t: 0.2 }, lamina: { eje1: [0, 1, 0] } });
      // distorsiona el nudo interior (1, 1) dentro de su plano
      const n11 = m.nudos[malla.nudos[1]![1]!]!;
      const d = malla.punto(1.2, 0.85);
      Object.assign(n11, { x: d[0], y: d[1], z: d[2] });
      for (const v of malla.nudos[0]!) m.apoyo(v, EMPOTRADO);
      m.caso("interior", [], [], [], [
        { tipo: "puntual", lamina: malla.laminas[0]![0]!, ejes: "local", punto: malla.punto(0.6, 0.4), F: [2, -3, -11], M: [0.5, 1, -2] },
        { tipo: "linea", lamina: malla.laminas[1]![1]!, ejes: "local", a: malla.punto(1.5, 1.2), b: malla.punto(1.9, 1.8), qa: [1, 0, -6], qb: [-1, 2, -2] },
        { tipo: "superficie", lamina: malla.laminas[1]![0]!, ejes: "local", q: [[0.5, 0, -3], [0, 0.2, -4], [0, 0, -5], [-0.4, 0, -6]] },
      ]);
      const [r] = resolver(m.modelo());
      expect(r!.equilibrio.fuerzas).toBeLessThan(1e-12);
      expect(r!.equilibrio.momentos).toBeLessThan(1e-12);
    });
  });

  describe("resultantes en cualquier punto (ResultantesLaminas)", () => {
    it("centroide = esfuerzosLaminas = media de los puntos de Gauss; lineales en u (combinaciones)", () => {
      const m = new Constructor();
      const malla = mallaRectangular(m, { a: 3, b: 2, nx: 3, ny: 2, material: { E: 3e7, nu: 0.2, t: 0.2 }, lamina: (i) => (i === 1 ? { multiplicadores: RETICULAR, eje1: [1, 1, 0] } : {}) });
      for (const v of malla.nudos[0]!) m.apoyo(v, EMPOTRADO);
      m.caso("a", [carga(malla.nudos[3]![1]!, { fz: -10, fx: 3 })]);
      m.caso("b", [], [], [], malla.laminas.flat().map((l) => ({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 1, -4] })));
      const modelo = m.modelo();
      const [a, b] = casosValidos(calcular(modelo, { solver }));
      const rl = new ResultantesLaminas(modelo);
      const comb = a!.u.map((v, i) => 1.35 * v + 1.5 * b!.u[i]!);
      for (let l = 0; l < 6; l++) {
        const c = rl.centroide(l, a!.u);
        expect(max(c.map((v, i) => v - res(a!, l)[i]!)) / max(a!.esfuerzosLaminas)).toBeLessThan(1e-14);
        const g = rl.enGauss(l, a!.u);
        const media = c.map((_, k) => (g[k]! + g[8 + k]! + g[16 + k]! + g[24 + k]!) / 4);
        expect(max(media.map((v, i) => v - c[i]!)) / max(a!.esfuerzosLaminas)).toBeLessThan(1e-14);
        expect(max(rl.en(l, a!.u, 0, 0).map((v, i) => v - c[i]!)) / max(a!.esfuerzosLaminas)).toBeLessThan(1e-14);
        const cc = rl.centroide(l, comb);
        const esperado = c.map((v, i) => 1.35 * v + 1.5 * res(b!, l)[i]!);
        expect(max(cc.map((v, i) => v - esperado[i]!)) / max(esperado)).toBeLessThan(1e-13);
      }
      // en un punto de Gauss, la extrapolación bilineal devuelve el valor de ese punto
      const g = rl.enGauss(4, a!.u);
      const en = rl.en(4, a!.u, 1 / Math.sqrt(3), 1 / Math.sqrt(3));
      expect(max(en.map((v, i) => v - g[16 + i]!)) / max(g)).toBeLessThan(1e-13);
      expect(rl.enNudos(4, a!.u).length).toBe(32);
    });
  });
});

describe("diagnósticos de láminas", () => {
  /** Placa válida de 2 × 1 con una carga; `mod` estropea algo. */
  function modelo(mod: (m: ModeloAnalitico) => ModeloAnalitico) {
    const m = new Constructor();
    const malla = mallaRectangular(m, { a: 2, b: 1, nx: 2, ny: 1, material: { E: 3e7, nu: 0.2, t: 0.2 } });
    for (const v of malla.nudos[0]!) m.apoyo(v, EMPOTRADO);
    m.caso("g", [], [], [], [{ tipo: "superficie", lamina: 0, ejes: "global", q: [0, 0, -5] }]);
    return calcular(mod(m.modelo()), { solver: "perfil" });
  }
  const conLamina = (cambio: object) => (m: ModeloAnalitico) => ({ ...m, laminas: m.laminas!.map((l, k) => (k === 1 ? { ...l, ...cambio } : l)) });
  const conCarga = (c: unknown) => (m: ModeloAnalitico) => ({ ...m, casos: [{ id: "g", laminas: [c as CargaLamina] }] });
  const codigos = (r: ReturnType<typeof calcular>) => r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.codigo);

  it("un modelo válido no da ningún diagnóstico", () => {
    const r = modelo((m) => m);
    expect(r.valido).toBe(true);
    expect(r.diagnosticos).toEqual([]);
  });

  const casos: [string, (m: ModeloAnalitico) => ModeloAnalitico, string][] = [
    ["multiplicador nulo", conLamina({ multiplicadores: { m11: 0 } }), "modelo/propiedad-no-valida"],
    ["multiplicador no finito", conLamina({ multiplicadores: { v23: Number.NaN } }), "modelo/propiedad-no-valida"],
    ["γ negativo", conLamina({ membrana: { gamma: -1 } }), "modelo/propiedad-no-valida"],
    ["eje 1 normal al plano", conLamina({ eje1: [0, 0, 1] }), "modelo/orientacion-no-valida"],
    ["eje 1 no finito", conLamina({ eje1: [1, Number.POSITIVE_INFINITY, 0] }), "modelo/orientacion-no-valida"],
    ["lámina inexistente", conCarga({ tipo: "superficie", lamina: 7, ejes: "global", q: [0, 0, 1] }), "carga/no-valida"],
    ["ejes desconocidos", conCarga({ tipo: "superficie", lamina: 0, ejes: "otro", q: [0, 0, 1] }), "carga/no-valida"],
    ["q con 3 nudos", conCarga({ tipo: "superficie", lamina: 0, ejes: "global", q: [[0, 0, 1], [0, 0, 1], [0, 0, 1]] }), "carga/no-valida"],
    ["q no finita", conCarga({ tipo: "superficie", lamina: 0, ejes: "global", q: [0, Number.NaN, 1] }), "carga/no-valida"],
    ["puntual fuera del contorno", conCarga({ tipo: "puntual", lamina: 0, ejes: "global", punto: [1.5, 0.5, 0], F: [0, 0, 1] }), "carga/fuera-de-lamina"],
    ["puntual fuera del plano", conCarga({ tipo: "puntual", lamina: 0, ejes: "global", punto: [0.5, 0.5, 0.01], F: [0, 0, 1] }), "carga/fuera-de-lamina"],
    ["línea con un extremo fuera", conCarga({ tipo: "linea", lamina: 0, ejes: "global", a: [0.5, 0.5, 0], b: [1.5, 0.5, 0], qa: [0, 0, 1] }), "carga/fuera-de-lamina"],
    ["línea de longitud nula", conCarga({ tipo: "linea", lamina: 0, ejes: "global", a: [0.5, 0.5, 0], b: [0.5, 0.5, 0], qa: [0, 0, 1] }), "carga/no-valida"],
    ["tipo desconocido", conCarga({ tipo: "volumen", lamina: 0, ejes: "global" }), "carga/no-valida"],
  ];
  for (const [nombre, mod, codigo] of casos) {
    it(`${nombre} → ${codigo}`, () => {
      const r = modelo(mod);
      expect(r.valido).toBe(false);
      expect(codigos(r)).toEqual([codigo]);
    });
  }

  it("una carga en el borde común de dos láminas, en cualquiera de las dos, es válida", () => {
    for (const lamina of [0, 1]) {
      const r = modelo(conCarga({ tipo: "puntual", lamina, ejes: "global", punto: [1, 0.3, 0], F: [0, 0, -1] }));
      expect(r.valido).toBe(true);
    }
  });
});
