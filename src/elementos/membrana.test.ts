/**
 * Membrana con drilling (Allman + Hughes–Brezzi) y lámina completa (DKMQ + membrana).
 * Criterio 2 del spike E0: el muro 1×3 y la viga en el plano de un muro a ≤ 5 % de OpenSeesPy
 * ASDShellQ4 (__fixtures__/membrana-opensees.json, spike/e0/membrana/oraculo_opensees.py).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { macnealHarder, muro, vigaEnMuro } from "../../spike/e0/membrana/modelos.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { asimetria, autovaloresSimetrica, errorRelativo, maxAbs, producto } from "../pruebas/densa.ts";
import { ModeloPrueba } from "../pruebas/ensamblador.ts";
import { PARCHE_EXTERIORES, PARCHE_NUDOS, PARCHE_QUADS } from "../pruebas/parche.ts";
import type { MaterialLamina } from "./dkmq.ts";
import { marcoLocal, rigidezAGlobales, rigidezLaminaLocal, vectorALocales, GDL_MEMBRANA } from "./lamina.ts";
import { esfuerzosMembrana, rigidezMembrana } from "./membrana.ts";

const fixtures = join(import.meta.dirname, "__fixtures__");
const os = JSON.parse(readFileSync(join(fixtures, "membrana-opensees.json"), "utf8"));
const congelada = JSON.parse(readFileSync(join(fixtures, "lamina-congelada.json"), "utf8")).valores as Record<string, number>;

const FORMAS: Record<string, number[]> = {
  cuadrado: [0, 0, 1, 0, 1, 1, 0, 1],
  rectangulo: [0, 0, 3, 0, 3, 0.5, 0, 0.5],
  paralelogramo: [0, 0, 2, 0, 2.6, 1, 0.6, 1],
  trapecio: [0, 0, 2, 0, 1.5, 1, 0.5, 1],
  distorsionado: [0, 0, 1.3, 0, 1.5, 1.1, -0.2, 0.8],
};
const MAT: MaterialLamina = { E: 3e7, nu: 0.2, t: 0.25 };

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("membrana: propiedades del elemento", () => {
  for (const [nombre, xy] of Object.entries(FORMAS)) {
    for (const gamma of [1, 1e-3]) {
      it(`${nombre}, γ = ${gamma}·G: simétrica y con exactamente 3 modos rígidos`, () => {
        const k = rigidezMembrana(xy, MAT, { gamma });
        expect(asimetria(k, 12)).toBeLessThan(1e-14);
        const rigidos = [[], [], []] as number[][];
        for (let a = 0; a < 4; a++) {
          rigidos[0]!.push(1, 0, 0);
          rigidos[1]!.push(0, 1, 0);
          rigidos[2]!.push(-xy[2 * a + 1]!, xy[2 * a]!, 1); // giro en el plano con ψ = θ
        }
        for (const r of rigidos) expect(maxAbs(producto(k, r, 12)) / maxAbs(k)).toBeLessThan(1e-12);
        const lambda = autovaloresSimetrica(k, 12);
        expect(Math.abs(lambda[2]!) / lambda[11]!).toBeLessThan(1e-12);
        expect(lambda[3]! / lambda[11]!).toBeGreaterThan(1e-8);
      });
    }
  }

  it("lámina completa en una orientación cualquiera: exactamente 6 modos rígidos en globales", () => {
    // Paralelogramo girado en el espacio
    const P = FORMAS.paralelogramo!;
    const [c1, s1, c2, s2] = [Math.cos(0.7), Math.sin(0.7), Math.cos(-0.4), Math.sin(-0.4)];
    const X: number[] = [];
    for (let a = 0; a < 4; a++) {
      const [x, y] = [P[2 * a]!, P[2 * a + 1]!];
      const p = [x, y * c1, y * s1];
      X.push(c2 * p[0]! - s2 * p[1]! + 1, s2 * p[0]! + c2 * p[1]! - 2, p[2]! + 3);
    }
    const m = marcoLocal(X);
    expect(m.alabeo).toBeLessThan(1e-14);
    const k = rigidezAGlobales(rigidezLaminaLocal(m.xy, MAT), m.R);
    const lambda = autovaloresSimetrica(k, 24);
    expect(Math.abs(lambda[5]!) / lambda[23]!).toBeLessThan(1e-12);
    expect(lambda[6]! / lambda[23]!).toBeGreaterThan(1e-9);
    // Giro rígido alrededor del eje global Z: u = θ × r, θ = (0, 0, 1)
    const r: number[] = [];
    for (let a = 0; a < 4; a++) r.push(-X[3 * a + 1]!, X[3 * a]!, 0, 0, 0, 1);
    expect(maxAbs(producto(k, r, 24)) / maxAbs(k)).toBeLessThan(1e-12);
  });
});

describe("membrana: patch test de MacNeal–Harder", () => {
  for (const gamma of [1, 1e-3]) {
    it(`deformación constante con giro, γ = ${gamma}·G: nudos interiores exactos y N constante`, () => {
      // u = 1e-3·(2x + 2y), v = 1e-3·(3y): εx = 2e-3, εy = 3e-3, γxy = 2e-3, ω = −1e-3 = ψ
      const exacto = ([x, y]: readonly [number, number]) => [1e-3 * (2 * x + 2 * y), 1e-3 * 3 * y, -1e-3];
      const mat: MaterialLamina = { E: 1e6, nu: 0.25, t: 0.001 };
      const modelo = new ModeloPrueba(6 * PARCHE_NUDOS.length);
      const elems = PARCHE_QUADS.map((q) => {
        const marco = marcoLocal(q.flatMap((v) => [...PARCHE_NUDOS[v]!, 0]));
        const gdl = q.flatMap((v) => [0, 1, 2, 3, 4, 5].map((g) => 6 * v + g));
        modelo.sumarRigidez(gdl, rigidezAGlobales(rigidezLaminaLocal(marco.xy, mat, { gamma }), marco.R));
        return { marco, gdl };
      });
      PARCHE_NUDOS.forEach((p, v) => {
        for (const g of [2, 3, 4]) modelo.coartar(6 * v + g); // flexión fuera
        if ((PARCHE_EXTERIORES as readonly number[]).includes(v)) {
          const [u, w, psi] = exacto(p);
          modelo.coartar(6 * v, u);
          modelo.coartar(6 * v + 1, w);
          modelo.coartar(6 * v + 5, psi);
        }
      });
      const { u } = modelo.resolver();
      const calc: number[] = [];
      const ref: number[] = [];
      PARCHE_NUDOS.forEach((p, v) => {
        calc.push(u[6 * v]!, u[6 * v + 1]!, u[6 * v + 5]!);
        ref.push(...exacto(p));
      });
      expect(errorRelativo(calc, ref)).toBeLessThan(1e-10);
      const f = (mat.E * mat.t) / (1 - mat.nu ** 2);
      const Nref = [f * (2e-3 + mat.nu * 3e-3), f * (3e-3 + mat.nu * 2e-3), (f * (1 - mat.nu) * 2e-3) / 2];
      for (const { marco, gdl } of elems) {
        const ul = vectorALocales(gdl.map((g) => u[g]!), marco.R);
        const N = esfuerzosMembrana(marco.xy, mat, GDL_MEMBRANA.map((g) => ul[g]!));
        // Ejes locales girados: se comprueban los invariantes del tensor
        for (let g = 0; g < 4; g++) {
          const [nx, ny, nxy] = [N[3 * g]!, N[3 * g + 1]!, N[3 * g + 2]!];
          expect(Math.abs(nx + ny - Nref[0]! - Nref[1]!) / Nref[1]!).toBeLessThan(1e-9);
          expect(Math.abs(nx * ny - nxy * nxy - (Nref[0]! * Nref[1]! - Nref[2]! ** 2)) / Nref[1]! ** 2).toBeLessThan(1e-9);
        }
      }
    });
  }
});

describe("criterio 2: frente a ASDShellQ4", () => {
  it("muro 1×3 (H17) a ≤ 5 %, y las mallas finas a ≤ 1 %", () => {
    for (const m of os.muro.mallas.slice(0, 4)) {
      const d = muro(m.nx, m.ny);
      const err = Math.abs(d / m.ASDShellQ4 - 1);
      expect(err, `${m.nx}×${m.ny}`).toBeLessThan(m.nx === 1 ? 0.05 : 0.01);
    }
  });

  // Embebida según la regla del compilador de H05: al menos un lado de elemento y el canto (0,5 m).
  for (const [n, emb] of [[6, 1], [6, 6], [12, 2], [12, 12]] as const) {
    it(`viga en el plano del muro, malla ${n}×${n}, embebida ${emb} elementos: a ≤ 5 % y ΣF, ΣM ≤ 1e-9`, () => {
      const ref = os.viga_en_muro.casos.find((c: { n: number; embebida: number }) => c.n === n && c.embebida === emb).ASDShellQ4.punta;
      const r = vigaEnMuro(n, emb);
      expect(Math.abs(r.punta / ref - 1)).toBeLessThan(0.05);
      expect(r.equilibrio.fuerzas).toBeLessThan(1e-9);
      expect(r.equilibrio.momentos).toBeLessThan(1e-9);
    });
  }

  it("viga unida en un solo nudo (H05): ya no es un mecanismo y ΣM cierra", () => {
    // PyNite daba 1 205× la flecha de referencia y ΣM = 0,49. Aquí la unión puntual sigue siendo
    // singular al refinar (como en ASDShellQ4), pero el giro tiene rigidez real y hay equilibrio.
    for (const n of [6, 12]) {
      const r = vigaEnMuro(n, 0);
      const embebida = vigaEnMuro(n, n).punta;
      expect(r.punta / embebida).toBeLessThan(3);
      expect(r.equilibrio.momentos).toBeLessThan(1e-9);
    }
  });
});

describe("membrana: insensibilidad a γ (Hughes–Brezzi)", () => {
  it("muro 4×12 y viga embebida: < 0,5 % y < 3 % entre γ = 1e-3·G y γ = G", () => {
    const a = muro(4, 12, { gamma: 1 });
    const b = muro(4, 12, { gamma: 1e-3 });
    expect(Math.abs(a / b - 1)).toBeLessThan(0.005);
    const va = vigaEnMuro(6, 1, { gamma: 1 }).punta;
    const vb = vigaEnMuro(6, 1, { gamma: 1e-3 }).punta;
    expect(Math.abs(va / vb - 1)).toBeLessThan(0.03);
  });
});

describe("lámina: regresión congelada (__fixtures__/lamina-congelada.json)", () => {
  it("muros, MacNeal–Harder y viga en muro", () => {
    for (const [clave, valor] of Object.entries(congelada)) {
      const [tipo, ...p] = clave.split("_");
      let calc: number;
      if (tipo === "muro") {
        const [nx, ny] = p[0]!.split("x").map(Number);
        calc = muro(nx!, ny!);
      } else if (tipo === "mh") {
        calc = macnealHarder(p[0] as "rectangular", p[1] as "cortante");
      } else {
        calc = vigaEnMuro(Number(p[0]), Number(p[1])).punta;
      }
      expect(Math.abs(calc / valor - 1), clave).toBeLessThan(1e-9);
    }
  });
});
