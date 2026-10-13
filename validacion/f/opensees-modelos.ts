/**
 * Oráculo externo de la fase F (`docs/fem3d/franjas.md` §4, criterio 3): la losa plana de H25 (y su
 * reticular con ábacos) para OpenSeesPy ASDShellQ4 (`oraculo_franjas.py`).
 *
 * El resolutor de E6 (`validacion/e6/oraculo_opensees.py`) sabe de láminas, apoyos, enlaces rígidos,
 * diafragmas y cargas nodales. Así que el modelo analítico compilado se cambia, igual para el motor
 * y para OpenSees: los pilares (articulados en cabeza en H25) pasan a apoyos fijos en el nudo de su
 * cabeza (el maestro de su huella), sin diafragma (esos apoyos sujetan la membrana), y la carga de superficie de cada lámina a sus fuerzas nodales
 * consistentes (∫Nᵢ q dA con Gauss 2 × 2, sin momentos: lo que hace el motor). El motor calcula ese
 * modelo y da sus franjas; se exporta, por estación de cara o de apoyo (por fuerzas nodales) y de paso
 * en una recta de la malla, la recta del corte y el intervalo (la franja o la ventana del pilar) en la
 * y del corte, con el My del motor (mx · ancho en losa).
 *
 * `bun validacion/f/opensees-modelos.ts` escribe validacion/f/opensees-modelos.json (regenerable,
 * fuera del repositorio).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosFranjas } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { ejesArmado } from "../../src/compilador/franjas.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import type { CargaNodal, ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { losaPlanaFisica, OPCIONES_LOSA_PLANA } from "../c2/losaPlana.ts";
import { reticularH25 } from "../c5/modelos.ts";

export interface EstacionOraculo {
  franja: string;
  s: number;
  tipo: string;
  lado: number;
  /** El corte de la recta entera, como lo define cortes.ts. */
  corte: { origen: number[]; x: number[]; vz: number[]; y: [number, number] };
  /** El intervalo (la franja o la ventana del pilar) en la y del corte. */
  intervalo: [number, number];
  /** My del motor por caso, kN·m. */
  my: number[];
  /** En una de paso sobre una recta de la malla, el My del motor por fuerzas nodales (como las caras). */
  myNodal?: number[];
}

/** El modelo analítico con los pilares como apoyos en su cabeza y las cargas de superficie como nodales. */
export function sinPilares(m: ModeloAnalitico, cabezas: number[]): ModeloAnalitico {
  const xyz = (v: number) => [m.nudos[v]!.x, m.nudos[v]!.y, m.nudos[v]!.z];
  const casos = m.casos.map((c) => {
    const f = new Map<number, number[]>();
    const sumar = (v: number, q: number[]) => {
      const a = f.get(v) ?? [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 3; i++) a[i]! += q[i]!;
      f.set(v, a);
    };
    for (const n of c.nodales ?? []) sumar(n.nudo, [...n.f]);
    for (const cl of c.laminas ?? []) {
      if (cl.tipo !== "superficie" || cl.ejes !== "global" || !Array.isArray(cl.q) || typeof cl.q[0] !== "number") throw new Error("sólo cargas de superficie uniformes y globales");
      const l = m.laminas![cl.lamina]!;
      const X = l.nudos.map(xyz);
      const g = 1 / Math.sqrt(3);
      for (const xi of [-g, g])
        for (const eta of [-g, g]) {
          const N = [0.25 * (1 - xi) * (1 - eta), 0.25 * (1 + xi) * (1 - eta), 0.25 * (1 + xi) * (1 + eta), 0.25 * (1 - xi) * (1 + eta)];
          const dN = [-0.25 * (1 - eta), 0.25 * (1 - eta), 0.25 * (1 + eta), -0.25 * (1 + eta), -0.25 * (1 - xi), -0.25 * (1 + xi), 0.25 * (1 + xi), 0.25 * (1 - xi)];
          // Jacobiano en el plano (losa horizontal)
          let [a, b, cc, d] = [0, 0, 0, 0];
          for (let k = 0; k < 4; k++) {
            a += dN[k]! * X[k]![0]!;
            b += dN[k]! * X[k]![1]!;
            cc += dN[4 + k]! * X[k]![0]!;
            d += dN[4 + k]! * X[k]![1]!;
          }
          const J = Math.abs(a * d - b * cc);
          for (let k = 0; k < 4; k++) sumar(l.nudos[k]!, (cl.q as number[]).map((q) => q * N[k]! * J));
        }
    }
    const nodales: CargaNodal[] = [...f.entries()].map(([nudo, v]) => ({ nudo, f: v as unknown as CargaNodal["f"] }));
    return { id: c.id, nodales };
  });
  // Sin diafragma (los apoyos de las cabezas sujetan la membrana); su maestro, sin elementos, apartado y fijo
  const maestros = new Set((m.restricciones ?? []).filter((r) => r.tipo === "diafragma").map((r) => r.maestro));
  // Y los nudos que se quedan sin elementos ni enlaces (las bases de los pilares), fijos
  const usados = new Set<number>([...(m.laminas ?? []).flatMap((l) => l.nudos), ...(m.restricciones ?? []).filter((r) => r.tipo !== "diafragma").flatMap((r) => [r.maestro, ...r.esclavos])]);
  m.nudos.forEach((_, i) => {
    if (!usados.has(i)) maestros.add(i);
  });
  return {
    nudos: m.nudos.map((n, i) => (maestros.has(i) ? { ...n, z: n.z + 10 } : n)),
    laminas: m.laminas,
    restricciones: (m.restricciones ?? []).filter((r) => r.tipo !== "diafragma"),
    apoyos: [...cabezas.map((nudo) => ({ nudo, coartados: [true, true, true, false, false, false] as const })), ...[...maestros].map((nudo) => ({ nudo, coartados: [true, true, true, true, true, true] as const }))],
    casos,
  };
}

export function estacionesOraculo(nombre: string, f: ModeloFisico, op: OpcionesCompilacion): { modelo: ModeloAnalitico; estaciones: EstacionOraculo[] } {
  const r = compilar(f, op);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  // La cabeza de cada pilar: el maestro del enlace de su huella
  const cabezas = (r.modelo.restricciones ?? []).filter((x) => x.tipo === "enlace-rigido").map((x) => x.maestro);
  const modelo = sinPilares(r.modelo, cabezas);
  const c = calcular(modelo);
  if (!c.valido) throw new Error(`${nombre}: ${c.diagnosticos.map((d) => d.mensaje).join("\n")}`);
  const casos = casosValidos(c);
  const ctx = validar(f, resolverOpciones(op), new Diagnosticos())!;
  const cortes = new Cortes(modelo);
  const ef = new EsfuerzosFranjas(ctx, { modelo, mapeo: r.mapeo }, casos, { cortes });
  /** My por fuerzas nodales del intervalo [a, b] de la recta, repartido por láminas como en esfuerzosFranjas.ts; null si la atraviesan. */
  const nodal = (corte: EstacionOraculo["corte"], [a, b]: [number, number]): number[] | null => {
    const x = cortes.cortar({ ...corte, origen: corte.origen as [number, number, number], x: corte.x as [number, number, number], vz: [0, 0, 1], metodo: "fuerzas-nodales", soloLaminas: true, porLamina: true }, casos);
    if (!x.valido || !x.porLamina) return null;
    const my = casos.map(() => 0);
    for (const p of x.porLamina) {
      if (r.mapeo.laminas![p.lamina]!.losa === undefined) continue;
      const [ya, yb] = p.y;
      const largo = yb - ya;
      const f = largo > 1e-6 ? Math.max(0, Math.min(yb, b) - Math.max(ya, a)) / largo : (ya + yb) / 2 > a && (ya + yb) / 2 < b ? 1 : 0;
      casos.forEach((_, k) => (my[k]! += f * p.esfuerzos[6 * k + 4]!));
    }
    return my;
  };
  const estaciones: EstacionOraculo[] = [];
  for (const fr of ef.franjas()) {
    const { d, n } = ejesArmado(ctx.losaDe.get(fr.losa)!.losa)[fr.direccion];
    const T0 = ef.franjas(fr.losa).filter((x) => x.direccion === fr.direccion)[0]!.t0;
    const T1 = ef.franjas(fr.losa).filter((x) => x.direccion === fr.direccion).at(-1)!.t1;
    for (const e of ef.estaciones(fr.id)!.estaciones) {
      if (!e.valido) continue;
      const lado = e.tipo === "paso" ? -1 : e.lado;
      const sx = lado === -1 ? 1 : -1;
      const yv = [-sx * d[1], sx * d[0]];
      const sigma = Math.sign(n[0] * yv[0]! + n[1] * yv[1]!);
      const O = [e.s * d[0] + T0 * n[0], e.s * d[1] + T0 * n[1], ctx.cotas[ctx.planta.get(fr.planta)!]!];
      const yb = sigma * (T1 - T0);
      const [ta, tb] = e.ventana ?? [fr.t0, fr.t1];
      const [ya, yb2] = [sigma * (ta - T0), sigma * (tb - T0)];
      const corteE = { origen: O, x: [sx * d[0], sx * d[1], 0], vz: [0, 0, 1], y: [Math.min(0, yb), Math.max(0, yb)] as [number, number] };
      const intervalo: [number, number] = [Math.min(ya, yb2), Math.max(ya, yb2)];
      const mn = e.tipo === "paso" ? nodal(corteE, intervalo) : null;
      estaciones.push({
        ...(mn ? { myNodal: mn } : {}),
        franja: fr.id,
        s: e.s,
        tipo: e.tipo === "cara" && e.ventana ? "cara (ventana del pilar)" : e.tipo,
        lado: e.lado,
        corte: { origen: O, x: [sx * d[0], sx * d[1], 0], vz: [0, 0, 1], y: [Math.min(0, yb), Math.max(0, yb)] },
        intervalo: [Math.min(ya, yb2), Math.max(ya, yb2)],
        my: casos.map((_, k) => e.medios[3 * k]! * e.anchoEnLosa),
      });
    }
  }
  return { modelo, estaciones };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const salida: Record<string, unknown> = {};
  for (const [nombre, f, op] of [
    ["h25-plana@0.75", losaPlanaFisica(), { ...OPCIONES_LOSA_PLANA, tamanoMalla: 0.75 }],
    ["h25-plana@0.375", losaPlanaFisica(), { ...OPCIONES_LOSA_PLANA, tamanoMalla: 0.375 }],
    ["h25-reticular@0.75", reticularH25(), { ...OPCIONES_LOSA_PLANA, tamanoMalla: 0.75 }],
  ] as [string, ModeloFisico, OpcionesCompilacion][]) {
    const x = estacionesOraculo(nombre, { ...f, bandas: undefined }, op);
    salida[nombre] = x;
    console.log(`${nombre}: ${x.modelo.nudos.length} nudos, ${x.estaciones.length} estaciones`);
  }
  writeFileSync(join(import.meta.dirname, "opensees-modelos.json"), JSON.stringify(salida));
}
