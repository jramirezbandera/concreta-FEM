/**
 * Criterio 4 de E1: propiedades del núcleo y pruebas metamórficas (H38) sobre un edificio con
 * todo lo que hay en E1: láminas, barras, muro, diafragma rígido, huella encadenada al
 * diafragma, muelles y desplazamientos impuestos.
 * - T reproduce los 6 movimientos de sólido rígido (también a través de las cadenas) y K'
 *   tiene exactamente 6 autovalores nulos sin apoyos;
 * - giro + traslación, renumeración, superposición y reciprocidad de Maxwell–Betti a ≤ 1e-9;
 * - faer y el solver de perfil coinciden a ≤ 1e-11 (se mide 1,0e-12).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { MODELOS_ORACULO } from "../../validacion/e1/modelos-oraculo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos, errorPorGrupos } from "../pruebas/comparar.ts";
import { autovaloresSimetrica } from "../pruebas/densa.ts";
import { edificio, type OpcionesEdificio } from "../pruebas/edificio.ts";
import { girarModelo, girarVector6, matrizGiro, permutacion, renumerarModelo } from "../pruebas/transformar.ts";
import { calcular } from "./calcular.ts";
import { Diagnosticos } from "./diagnosticos.ts";
import { elementosDelModelo, geometria } from "./elementos.ts";
import { ensamblarRigidez, patronSistema, productoSimetrico } from "./ensamblado.ts";
import { desplazamientosFisicos, numerar, TipoGdl } from "./gdl.ts";
import type { ModeloAnalitico } from "./modelo.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const BASE: OpcionesEdificio = { vanosX: 2, vanosY: 2, luzX: 5, luzY: 4, plantas: 2, altura: 3, malla: 1, huella: 1, muro: true, vigas: true };
const CON_DIAFRAGMA = edificio({ ...BASE, diafragma: true }).modelo;
const SIN_DIAFRAGMA_MUELLES = edificio({ ...BASE, muelles: true }).modelo;

/** Sistema reducido sin apoyos ni muelles a tierra: todo libre. */
function sistemaLibre(m: ModeloAnalitico) {
  const libre: ModeloAnalitico = { ...m, apoyos: [], muelles: (m.muelles ?? []).filter((mu) => mu.nudos.length === 2) };
  const diag = new Diagnosticos();
  const geo = geometria(libre);
  const elementos = elementosDelModelo(libre, geo, diag);
  const num = numerar(libre, elementos, geo, diag)!;
  expect(diag.hayErrores).toBe(false);
  const ps = patronSistema(num, elementos);
  const K = ensamblarRigidez(libre, geo.xyz, num, elementos, ps);
  return { libre, geo, num, ps, K };
}

describe("propiedades", () => {
  for (const [nombre, modelo] of [
    ["edificio con diafragma y huella encadenada", CON_DIAFRAGMA],
    ["edificio sin diafragma con huella y muelles", SIN_DIAFRAGMA_MUELLES],
  ] as const) {
    it(`${nombre}: T reproduce los 6 movimientos de sólido rígido y K'·û = 0`, () => {
      const { geo, num, ps, K } = sistemaLibre(modelo);
      const nn = num.nNudos;
      const { xyz } = geo;
      for (let modo = 0; modo < 6; modo++) {
        const t = [0, 0, 0];
        const th = [0, 0, 0];
        if (modo < 3) t[modo] = 1e-3;
        else th[modo - 3] = 1e-4;
        const rigido = new Float64Array(6 * nn);
        for (let v = 0; v < nn; v++) {
          const [x, y, z] = [xyz[3 * v]!, xyz[3 * v + 1]!, xyz[3 * v + 2]!];
          rigido.set([t[0]! + th[1]! * z - th[2]! * y, t[1]! + th[2]! * x - th[0]! * z, t[2]! + th[0]! * y - th[1]! * x, ...th], 6 * v);
        }
        // û: el movimiento rígido en los GDL independientes; T lo tiene que reproducir en todos
        const u = desplazamientosFisicos(num, rigido);
        for (let p = 0; p < 6 * nn; p++) if (num.tipo[p] === TipoGdl.SinRigidez) rigido[p] = 0;
        expect(errorPorGrupos(u, rigido), `modo ${modo}`).toBeLessThan(1e-14);
        // (K'·û)ᵢ frente a la escala de su fila, maxⱼ|K'ᵢⱼ|·‖û‖ (las cancelaciones del ensamblado
        // no se ven en |K'|·|û|: un acoplamiento que debería ser nulo queda como redondeo)
        const x = Float64Array.from(num.gdlDeEcuacion, (p) => rigido[p]!);
        const Kx = productoSimetrico(ps.patron, K.valores, x);
        const filaMax = new Float64Array(x.length);
        for (let j = 0; j < x.length; j++) {
          for (let q = ps.patron.colPtr[j]!; q < ps.patron.colPtr[j + 1]!; q++) {
            const i = ps.patron.rowIdx[q]!;
            const v = Math.abs(K.valores[q]!);
            filaMax[i] = Math.max(filaMax[i]!, v);
            filaMax[j] = Math.max(filaMax[j]!, v);
          }
        }
        const normaX = x.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
        let peor = 0;
        for (let i = 0; i < x.length; i++) peor = Math.max(peor, Math.abs(Kx[i]!) / (filaMax[i]! * normaX));
        expect(peor, `modo ${modo}`).toBeLessThan(1e-12);
      }
    });
  }

  it("K' sin apoyos tiene exactamente 6 autovalores nulos (modelo de cadenas del oráculo)", () => {
    const { ps, K } = sistemaLibre(MODELOS_ORACULO.cadenas!());
    const n = ps.patron.n;
    const A = new Float64Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let q = ps.patron.colPtr[j]!; q < ps.patron.colPtr[j + 1]!; q++) {
        const i = ps.patron.rowIdx[q]!;
        A[n * i + j] = K.valores[q]!;
        A[n * j + i] = K.valores[q]!;
      }
    }
    const lam = autovaloresSimetrica(A, n);
    const max = lam[n - 1]!;
    const nulos = [...lam].filter((l) => Math.abs(l) < 1e-10 * max).length;
    expect(nulos).toBe(6);
    expect(lam[6]! / max).toBeGreaterThan(1e-8);
  });
});

describe("pruebas metamórficas", () => {
  it("giro alrededor de Z + traslación con diafragma: u y reacciones giran (≤ 1e-9)", () => {
    const R = matrizGiro([0, 0, 1], 0.7);
    const a = casosValidos(calcular(CON_DIAFRAGMA));
    const b = casosValidos(calcular(girarModelo(CON_DIAFRAGMA, R, [12.3, -4.5, 2.0])));
    for (let k = 0; k < a.length; k++) {
      expect(errorPorGrupos(b[k]!.u, girarVector6(R, a[k]!.u)), a[k]!.id).toBeLessThan(1e-9);
      expect(errorPorGrupos(b[k]!.reacciones, girarVector6(R, a[k]!.reacciones)), a[k]!.id).toBeLessThan(1e-9);
    }
  });

  it("giro general en 3D + traslación sin diafragma (huella y muelles girados)", () => {
    const R = matrizGiro([0.3, -0.5, 0.8], 1.1);
    const a = casosValidos(calcular(SIN_DIAFRAGMA_MUELLES));
    const b = casosValidos(calcular(girarModelo(SIN_DIAFRAGMA_MUELLES, R, [-3, 7, 1.5])));
    for (let k = 0; k < a.length; k++) {
      expect(errorPorGrupos(b[k]!.u, girarVector6(R, a[k]!.u)), a[k]!.id).toBeLessThan(1e-9);
      expect(errorPorGrupos(b[k]!.reacciones, girarVector6(R, a[k]!.reacciones)), a[k]!.id).toBeLessThan(1e-9);
    }
  });

  it("renumeración de nudos, elementos, restricciones y nudo inicial de las láminas", () => {
    for (const modelo of [CON_DIAFRAGMA, SIN_DIAFRAGMA_MUELLES]) {
      const nuevo = permutacion(modelo.nudos.length);
      const a = casosValidos(calcular(modelo));
      const b = casosValidos(calcular(renumerarModelo(modelo, nuevo)));
      for (let k = 0; k < a.length; k++) {
        const ua = new Float64Array(a[k]!.u.length);
        const ra = new Float64Array(a[k]!.u.length);
        nuevo.forEach((nv, v) => {
          ua.set(a[k]!.u.subarray(6 * v, 6 * v + 6), 6 * nv);
          ra.set(a[k]!.reacciones.subarray(6 * v, 6 * v + 6), 6 * nv);
        });
        expect(errorPorGrupos(b[k]!.u, ua), a[k]!.id).toBeLessThan(1e-9);
        expect(errorPorGrupos(b[k]!.reacciones, ra), a[k]!.id).toBeLessThan(1e-9);
      }
    }
  });

  it("superposición: G + 1,5·Vx − 0,8·asiento como un solo caso", () => {
    const m = CON_DIAFRAGMA;
    const caso = (id: string) => m.casos.find((c) => c.id === id)!;
    const comb = {
      id: "comb",
      nodales: [...caso("G").nodales!, ...caso("Vx").nodales!.map((c) => ({ ...c, f: c.f.map((v) => 1.5 * v) as never }))],
      impuestos: caso("asiento").impuestos!.map((d) => ({ ...d, valor: -0.8 * d.valor })),
    };
    const r = casosValidos(calcular({ ...m, casos: [...m.casos, comb] }));
    const por = (id: string) => r.find((c) => c.id === id)!;
    const suma = por("G").u.map((v, i) => v + 1.5 * por("Vx").u[i]! - 0.8 * por("asiento").u[i]!);
    const sumaR = por("G").reacciones.map((v, i) => v + 1.5 * por("Vx").reacciones[i]! - 0.8 * por("asiento").reacciones[i]!);
    expect(errorPorGrupos(por("comb").u, suma)).toBeLessThan(1e-9);
    expect(errorPorGrupos(por("comb").reacciones, sumaR)).toBeLessThan(1e-9);
  });

  it("reciprocidad de Maxwell–Betti entre todos los pares de casos de carga", () => {
    for (const modelo of [CON_DIAFRAGMA, SIN_DIAFRAGMA_MUELLES]) {
      const casos = modelo.casos.filter((c) => !c.impuestos?.length);
      const r = casosValidos(calcular({ ...modelo, casos }));
      const f = casos.map((c) => {
        const v = new Float64Array(6 * modelo.nudos.length);
        for (const n of c.nodales ?? []) for (let g = 0; g < 6; g++) v[6 * n.nudo + g]! += n.f[g]!;
        return v;
      });
      const dot = (a: Float64Array, b: Float64Array) => a.reduce((s, x, i) => s + x * b[i]!, 0);
      const absdot = (a: Float64Array, b: Float64Array) => a.reduce((s, x, i) => s + Math.abs(x * b[i]!), 0);
      for (let i = 0; i < casos.length; i++) {
        for (let j = i + 1; j < casos.length; j++) {
          const wij = dot(r[i]!.u, f[j]!);
          const wji = dot(r[j]!.u, f[i]!);
          expect(Math.abs(wij - wji) / (absdot(r[i]!.u, f[j]!) + absdot(r[j]!.u, f[i]!)), `${casos[i]!.id}–${casos[j]!.id}`).toBeLessThan(1e-9);
        }
      }
    }
  });

  // Los dos son estables hacia atrás (ω ≤ 1e-14), así que su diferencia hacia delante está acotada
  // por κ(K')·ω; con κ ≈ 1e4–1e6 en estos modelos se mide 1,0e-12. La tolerancia es 1e-11.
  it("faer y el solver de perfil coinciden a ≤ 1e-11", () => {
    for (const modelo of [CON_DIAFRAGMA, SIN_DIAFRAGMA_MUELLES]) {
      const a = casosValidos(calcular(modelo, { solver: "nucleo" }));
      const b = casosValidos(calcular(modelo, { solver: "perfil" }));
      for (let k = 0; k < a.length; k++) {
        expect(errorPorGrupos(a[k]!.u, b[k]!.u), a[k]!.id).toBeLessThan(1e-11);
        expect(errorPorGrupos(a[k]!.reacciones, b[k]!.reacciones), a[k]!.id).toBeLessThan(1e-11);
      }
    }
  });
});
