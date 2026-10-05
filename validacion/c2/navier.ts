/**
 * Criterio 1 de C2: las placas de Navier de E3 (6 × 4 m apoyadas «hard», q = −10 kN/m²) descritas
 * como modelo físico: una losa con apoyos lineales en su contorno, mallada por C2. Frente a la serie
 * de Mindlin (src/pruebas/navier.ts):
 * - w: máx |w − w_ex| en los nudos ÷ w_ex del centro;
 * - Mx, My recuperados por SPR (campos.ts, lo que usan los mapas y las bandas): máx |M − M_ex| en
 *   los nudos ÷ M_ex del centro, en toda la placa y en su interior (a más de 0,75 m de los bordes);
 * - Mx, My brutos del centroide (la media de los 4 puntos de Gauss) frente a M_ex en la media de los
 *   4 nudos: en los cuadriláteros de C2, que no son paralelogramos, converge con orden 1 (C2-1).
 * Para comparar, lo mismo con la rejilla de E3 (`modeloNavier`) del mismo h. C2 se mide con la
 * triangulación sola y con la rejilla alineada de H52 (C2-a), que en esta placa es la de E3.
 *
 * Uso: bun validacion/c2/navier.ts → validacion/c2/out_navier.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { navierMindlin } from "../../src/pruebas/navier.ts";
import { A, B, CASOS_NAVIER, modeloNavier, placaNavier, Q, type CasoNavier } from "../e3/navier.ts";

/** La placa de Navier como modelo físico: losa con apoyos lineales «hard» en el contorno. */
export function navierFisico(c: CasoNavier): ModeloFisico {
  const G = c.E / (2 * (1 + c.nu));
  // Bordes x = 0, A: w y θx; bordes y = 0, B: w y θy. Membrana fuera (ux, uy en todo el contorno).
  const bx = [true, true, true, true, false, false] as const;
  const by = [true, true, true, false, true, false] as const;
  return {
    plantas: [{ id: "P0", altura: null }],
    materiales: [{ id: "M", tipo: "general", E: c.E, G, peso: 0 }],
    secciones: [],
    losas: [
      {
        id: "L",
        planta: "P0",
        contorno: [
          [0, 0],
          [A, 0],
          [A, B],
          [0, B],
        ],
        espesor: c.t,
        material: "M",
      },
    ],
    apoyosLineales: [
      { id: "x0", planta: "P0", puntos: [[0, 0], [0, B]], coartados: bx },
      { id: "xA", planta: "P0", puntos: [[A, 0], [A, B]], coartados: bx },
      { id: "y0", planta: "P0", puntos: [[0, 0], [A, 0]], coartados: by },
      { id: "yB", planta: "P0", puntos: [[0, B], [A, B]], coartados: by },
    ],
    casos: [{ id: "q" }],
    cargas: [{ tipo: "superficie", id: "Q", caso: "q", planta: "P0", losa: "L", q: [0, 0, Q] }],
  };
}

export interface ErroresNavier {
  w: number;
  /** SPR en el centro de la placa (la medida de E3 y H29). */
  sprMxCentro: number;
  sprMyCentro: number;
  /** SPR en los nudos: en toda la placa y en su interior. */
  sprMx: number;
  sprMy: number;
  sprMxInterior: number;
  sprMyInterior: number;
  /** Valor bruto del centroide. */
  Mx: number;
  My: number;
  nudos: number;
  laminas: number;
}

/** Errores globales de un modelo de la placa (nudos en z = 0) frente a la serie. */
export function erroresGlobales(c: CasoNavier, modelo: ModeloAnalitico): ErroresNavier {
  const [r] = casosValidos(calcular(modelo));
  const p = placaNavier(c);
  const centro = navierMindlin(p, A / 2, B / 2);
  const ref = new Map<number, ReturnType<typeof navierMindlin>>();
  const exacta = (n: number) => {
    let v = ref.get(n);
    if (!v) ref.set(n, (v = navierMindlin(p, modelo.nudos[n]!.x, modelo.nudos[n]!.y, 151)));
    return v;
  };
  let ew = 0;
  modelo.nudos.forEach((_, i) => (ew = Math.max(ew, Math.abs(r!.u[6 * i + 2]! - exacta(i)[0]))));
  const e = { Mx: 0, My: 0, sMx: 0, sMy: 0, sMxI: 0, sMyI: 0 };
  const campos = new CamposLaminas(modelo);
  const ev = campos.evaluador(r!.u);
  (modelo.laminas ?? []).forEach((l, i) => {
    const x = l.nudos.reduce((s, n) => s + modelo.nudos[n]!.x, 0) / 4;
    const y = l.nudos.reduce((s, n) => s + modelo.nudos[n]!.y, 0) / 4;
    const ex = navierMindlin(p, x, y, 151);
    e.Mx = Math.max(e.Mx, Math.abs(r!.esfuerzosLaminas[8 * i + 3]! - ex[1]));
    e.My = Math.max(e.My, Math.abs(r!.esfuerzosLaminas[8 * i + 4]! - ex[2]));
    const XI = [-1, 1, 1, -1];
    const ETA = [-1, -1, 1, 1];
    l.nudos.forEach((n, a) => {
      const v = ev.en(i, XI[a]!, ETA[a]!);
      const dx = Math.abs(v[3]! - exacta(n)[1]);
      const dy = Math.abs(v[4]! - exacta(n)[2]);
      e.sMx = Math.max(e.sMx, dx);
      e.sMy = Math.max(e.sMy, dy);
      const N = modelo.nudos[n]!;
      if (N.x > 0.75 && N.x < A - 0.75 && N.y > 0.75 && N.y < B - 0.75) {
        e.sMxI = Math.max(e.sMxI, dx);
        e.sMyI = Math.max(e.sMyI, dy);
      }
    });
  });
  const [Mx0, My0] = [Math.abs(centro[1]), Math.abs(centro[2])];
  // SPR en el centro: la lámina que lo contiene
  let mc = [Number.NaN, Number.NaN];
  for (let k = 0; k < (modelo.laminas ?? []).length; k++) {
    const nat = ev.naturales(k, [A / 2, B / 2, 0]);
    if (nat && Math.abs(nat[0]) <= 1 + 1e-9 && Math.abs(nat[1]) <= 1 + 1e-9) {
      const v = ev.en(k, nat[0], nat[1]);
      mc = [v[3]!, v[4]!];
      break;
    }
  }
  return {
    w: ew / Math.abs(centro[0]),
    sprMxCentro: mc[0]! / centro[1] - 1,
    sprMyCentro: mc[1]! / centro[2] - 1,
    sprMx: e.sMx / Mx0,
    sprMy: e.sMy / My0,
    sprMxInterior: e.sMxI / Mx0,
    sprMyInterior: e.sMyI / My0,
    Mx: e.Mx / Mx0,
    My: e.My / My0,
    nudos: modelo.nudos.length,
    laminas: modelo.laminas?.length ?? 0,
  };
}

export function erroresNavierC2(c: CasoNavier, h: number, rejilla = true): ErroresNavier {
  return erroresGlobales(c, valido(compilar(navierFisico(c), { tamanoMalla: h, rejilla })).modelo);
}

export function erroresNavierRejilla(c: CasoNavier, h: number): ErroresNavier {
  return erroresGlobales(c, modeloNavier(c, Math.round(A / h), Math.round(B / h)).modelo);
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const lineas: string[] = [
    `# validacion/c2/navier.ts — ${new Date().toLocaleDateString("sv-SE")}: placa ${A} × ${B} m apoyada («hard»), q = ${Q} kN/m², como losa física (C2) y como rejilla (E3)`,
    "Errores globales: máx |w − w_ex| en los nudos ÷ w_ex del centro; máx |M − M_ex| en los centroides ÷ M_ex del centro.",
  ];
  const pct = (v: number) => `${(100 * v).toFixed(3)} %`;
  for (const c of CASOS_NAVIER.slice(0, 2)) {
    lineas.push(`
## ${c.nombre}`);
    lineas.push("| h (m) | malla | nudos | láminas | w | Mx SPR centro | My SPR centro | Mx SPR | My SPR | Mx SPR interior | My SPR interior | Mx centroide | My centroide |");
    lineas.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    const filas: Record<string, ErroresNavier[]> = { "C2, triangulación": [], "C2, rejilla alineada": [], "rejilla de E3": [] };
    for (const h of [0.5, 0.25, 0.125]) {
      for (const [nombre, f] of [
        ["C2, triangulación", (c: CasoNavier, h: number) => erroresNavierC2(c, h, false)],
        ["C2, rejilla alineada", (c: CasoNavier, h: number) => erroresNavierC2(c, h, true)],
        ["rejilla de E3", erroresNavierRejilla],
      ] as const) {
        const e = f(c, h);
        filas[nombre]!.push(e);
        lineas.push(`| ${h} | ${nombre} | ${e.nudos} | ${e.laminas} | ${pct(e.w)} | ${pct(e.sprMxCentro)} | ${pct(e.sprMyCentro)} | ${pct(e.sprMx)} | ${pct(e.sprMy)} | ${pct(e.sprMxInterior)} | ${pct(e.sprMyInterior)} | ${pct(e.Mx)} | ${pct(e.My)} |`);
      }
    }
    for (const nombre of Object.keys(filas)) {
      const f = filas[nombre]!;
      const o = (k: keyof ErroresNavier) => Math.log2((f[1]![k] as number) / (f[2]![k] as number)).toFixed(2);
      lineas.push(`Orden observado (${nombre}, 0,25 → 0,125): w ${o("w")}; SPR interior Mx ${o("sprMxInterior")}, My ${o("sprMyInterior")}; centroide Mx ${o("Mx")}, My ${o("My")}`);
    }
  }
  const texto = lineas.join("\n");
  console.log(texto);
  writeFileSync(join(import.meta.dirname, "out_navier.txt"), texto + "\n");
}
