/**
 * Patch test de MacNeal–Harder con la lámina de E3 en el motor: membrana y flexión a la vez, con
 * multiplicadores y el eje 1 girado. Lo usan el test (src/motor/laminas.test.ts) y el resumen.
 *
 * Campos exactos (MacNeal y Harder, FEAD 1, 1985): membrana u = k(2x + 2y), v = 3ky, ψ = ω = −k;
 * flexión w = k(x² + xy + y²)/2, θx = ∂w/∂y, θy = −∂w/∂x. Los 4 nudos exteriores llevan el campo
 * impuesto; los 4 interiores tienen que reproducirlo y las resultantes tienen que ser constantes:
 * N = C·ε y M = −Hb·κ en los ejes de usuario, Q = 0.
 */
import type { MultiplicadoresLamina } from "../../src/elementos/lamina.ts";
import { calcular } from "../../src/motor/calcular.ts";
import type { Vec3 } from "../../src/motor/modelo.ts";
import type { TipoSolver } from "../../src/motor/solucion.ts";
import { casosValidos, errorPorGrupos } from "../../src/pruebas/comparar.ts";
import { Constructor, EMPOTRADO } from "../../src/pruebas/constructor.ts";
import { PARCHE_EXTERIORES, PARCHE_NUDOS, PARCHE_QUADS } from "../../src/pruebas/parche.ts";

export interface ErroresParche {
  /** Desplazamientos de todos los nudos frente al campo exacto (por grupos). */
  u: number;
  /** Resultantes de todas las láminas frente a las exactas: N, M (relativos) y Q (frente a M/L). */
  N: number;
  M: number;
  Q: number;
}

/** `angulo` (grados) del eje 1 respecto a X; sin él, la regla de CSI (eje 1 = X). */
export function parcheMacNealHarder(mult: MultiplicadoresLamina = {}, angulo?: number, solver: TipoSolver = "nucleo"): ErroresParche {
  const E = 1e6;
  const nu = 0.25;
  const t = 0.001;
  const k = 1e-3;
  const exacto = ([x, y]: readonly [number, number]) => [k * (2 * x + 2 * y), 3 * k * y, (k * (x * x + x * y + y * y)) / 2, k * (x / 2 + y), -k * (x + y / 2), -k];
  const a = ((angulo ?? 0) * Math.PI) / 180;
  const eje1: Vec3 | undefined = angulo === undefined ? undefined : [Math.cos(a), Math.sin(a), 0];
  const m = new Constructor();
  PARCHE_NUDOS.forEach(([x, y]) => m.nudo(x, y, 0));
  PARCHE_QUADS.forEach((q) => m.lamina(q, { E, nu, t }, { eje1, multiplicadores: mult }));
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

  // Resultantes exactas en los ejes de usuario (giro α respecto a X; normal +Z)
  const [C, S] = [Math.cos(a), Math.sin(a)];
  const giro = ([ex, ey, g]: number[]) => [C * C * ex! + S * S * ey! + C * S * g!, S * S * ex! + C * C * ey! - C * S * g!, -2 * C * S * ex! + 2 * C * S * ey! + (C * C - S * S) * g!];
  const eps = giro([2 * k, 3 * k, 2 * k]);
  const kap = giro([-k, -k, -k]); // curvaturas de Batoz [βx,x, βy,y, βx,y + βy,x], con βx = θy y βy = −θx
  const ortotropa = (D: number, s: number[]) => [
    [s[0]! * s[0]! * D, s[0]! * s[1]! * D * nu, 0],
    [s[0]! * s[1]! * D * nu, s[1]! * s[1]! * D, 0],
    [0, 0, (s[2]! * s[2]! * D * (1 - nu)) / 2],
  ];
  const Cm = ortotropa((E * t) / (1 - nu * nu), [Math.sqrt(mult.f11 ?? 1), Math.sqrt(mult.f22 ?? 1), Math.sqrt(mult.f12 ?? 1)]);
  const Hb = ortotropa((E * t ** 3) / (12 * (1 - nu * nu)), [Math.sqrt(mult.m11 ?? 1), Math.sqrt(mult.m22 ?? 1), Math.sqrt(mult.m12 ?? 1)]);
  const N = Cm.map((fila) => fila[0]! * eps[0]! + fila[1]! * eps[1]! + fila[2]! * eps[2]!);
  const M = Hb.map((fila) => -(fila[0]! * kap[0]! + fila[1]! * kap[1]! + fila[2]! * kap[2]!));
  const max = (v: number[]) => Math.max(...v.map(Math.abs));
  const e = { u: errorPorGrupos(calc, ref), N: 0, M: 0, Q: 0 };
  for (let l = 0; l < PARCHE_QUADS.length; l++) {
    const s = Array.from(r!.esfuerzosLaminas.subarray(8 * l, 8 * l + 8));
    e.N = Math.max(e.N, max(s.slice(0, 3).map((v, i) => v - N[i]!)) / max(N));
    e.M = Math.max(e.M, max(s.slice(3, 6).map((v, i) => v - M[i]!)) / max(M));
    e.Q = Math.max(e.Q, max(s.slice(6)) / (max(M) / 0.24));
  }
  return e;
}
