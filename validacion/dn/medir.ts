/**
 * DN-a (`docs/fem3d/desniveles.md` §3): ¿cuánto error añade poner los nudos de una losa con desnivel en
 * la cota de la planta (opción a), frente al que RV-b ya acepta al poner todo el forjado en su cara
 * superior?
 *
 * Todavía no hay `desnivel` en el modelo físico, así que todo se construye sobre el modelo analítico de
 * cada caso, compilado sin desnivel y sin diafragma rígido (un diafragma exige los nudos a la misma
 * cota, E1):
 * - **P0 y PΔ, planos** (el modelo de RV-b): todo en la cota. PΔ es la opción (a): sólo cambia la zona
 *   rígida de la cabeza de los pilares, hasta la cara inferior más baja que los toca. «PΔ rígido», con
 *   el diafragma rígido de por defecto;
 * - **E0 y EΔ, excéntricos** (la lámina y la barra en su sitio, el modelo elástico de referencia): los
 *   nudos de cada losa en su plano medio (el centroide de la T del nervio en un reticular aligerado),
 *   con el desnivel en EΔ; el eje de cada viga h/2 por debajo de su cara superior (en la cota); cada
 *   nudo que una losa comparte con una barra, con otra zona, con un apoyo o que es maestro de un enlace,
 *   duplicado a su cota y unido al de la cota con un enlace rígido; los enlaces de LV (caras de las
 *   vigas a su eje) y de C2-d (huellas al pilar) ganan el brazo vertical.
 * El error de RV-b sin desnivel es P0 frente a E0; el de (a), PΔ frente a EΔ. Si son del mismo orden,
 * (a) no añade nada a lo que ya se acepta.
 *
 *   bun validacion/dn/medir.ts > validacion/dn/out_medir.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar, type ResultadoCompilacion } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { EsfuerzosPiezas } from "../../src/compilador/resultados.ts";
import { calcular } from "../../src/motor/calcular.ts";
import type { ModeloAnalitico, NudoAnalitico, Restriccion, ResultadoCaso } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

type Valido = Extract<ResultadoCompilacion, { valido: true }>;
type V2 = [number, number];

interface Caso {
  nombre: string;
  descripcion: string;
  fisico: ModeloFisico;
  /** Desnivel de cada losa (m, negativo: más baja). */
  dz: Record<string, number>;
  /** Plano medio de cada zona («losa» o «losa*» para sus ábacos) bajo su cara superior (m). */
  medio: Record<string, number>;
  /** Cara inferior más baja de lo que toca a cada pilar, desde la cota, sin desnivel y con él. */
  juntas0: Record<string, number>;
  juntas: Record<string, number>;
  /** Viga del escalón, si la hay, y su canto. */
  viga?: { id: string; h: number };
}

const L = 6;
const ejes = [0, L, 2 * L];
const pilaresRet = ejes.flatMap((y, j) => ejes.map((x, i) => ({ id: `P${3 * j + i + 1}`, x, y })));

function base(losas: NonNullable<ModeloFisico["losas"]>, vigas: ModeloFisico["vigas"], seccionViga?: { b: number; h: number }): ModeloFisico {
  return {
    plantas: [
      { id: "N1", altura: null, diafragma: "ninguno" },
      { id: "N0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      ...(seccionViga ? [{ id: "v", material: "H", forma: "rectangular" as const, b: seccionViga.b, h: seccionViga.h }] : []),
    ],
    pilares: pilaresRet.map((p) => ({ ...p, desde: "N0", hasta: "N1", seccion: "p" })),
    vigas,
    losas,
    casos: [{ id: "G", pesoPropio: true }, { id: "CM" }, { id: "Vx" }],
    cargas: [
      ...losas.map((l) => ({ tipo: "superficie" as const, id: `cm-${l.id}`, caso: "CM", planta: "N1", losa: l.id, q: [0, 0, -3] as [number, number, number] })),
      { tipo: "puntual", id: "vx", caso: "Vx", planta: "N1", x: 3, y: 6, F: [100, 0, 0] },
    ],
  };
}

const e = 0.15; // la losa llega a la cara de fuera de los pilares de fachada
const losaA = { id: "A", planta: "N1", material: "H", espesor: 0.25, contorno: [[-e, -e], [L, -e], [L, 2 * L + e], [-e, 2 * L + e]] as V2[] };
const losaB = { id: "B", planta: "N1", material: "H", espesor: 0.25, contorno: [[L, -e], [2 * L + e, -e], [2 * L + e, 2 * L + e], [L, 2 * L + e]] as V2[] };
const vigaEscalon = [{ id: "VE", planta: "N1", puntos: [[L, 0], [L, 2 * L]] as V2[], seccion: "v" }];
const juntas = (a: number, b: number, escalon: number) => Object.fromEntries(pilaresRet.map((p) => [p.id, p.x < L ? a : p.x > L ? b : escalon]));

const abaco = (x0: number, x1: number, y: number) => [[x0, y - 1.2], [x1, y - 1.2], [x1, y + 1.2], [x0, y + 1.2]] as V2[];
const reticularA = {
  ...losaA,
  espesor: 0.3,
  reticular: { intereje: 0.8, nervio: 0.12, capa: 0.05, abacos: ejes.flatMap((y) => [abaco(-e, 1.2, y), abaco(L - 1.2, L, y)]) },
};
// el centroide de la T de un nervio de 25+5 a 80/12, bajo la cara superior
const centroideT = (0.8 * 0.05 * 0.025 + 0.12 * 0.25 * (0.05 + 0.125)) / (0.8 * 0.05 + 0.12 * 0.25);

const casos: Caso[] = [
  {
    nombre: "terraza-viga",
    descripcion: "dos macizas de 25 cm, B 10 cm más baja, viga descolgada de 30 × 50 en el escalón (solape de 15 cm en canto)",
    fisico: base([losaA, losaB], vigaEscalon, { b: 0.3, h: 0.5 }),
    dz: { B: -0.1 },
    medio: { A: 0.125, B: 0.125 },
    juntas0: juntas(0.25, 0.25, 0.5),
    juntas: juntas(0.25, 0.35, 0.5),
    viga: { id: "VE", h: 0.5 },
  },
  {
    nombre: "terraza-sin-viga",
    descripcion: "dos macizas de 25 cm, B 10 cm más baja, sin viga (solape de 15 cm en canto)",
    fisico: base([losaA, losaB], undefined),
    dz: { B: -0.1 },
    medio: { A: 0.125, B: 0.125 },
    juntas0: juntas(0.25, 0.25, 0.25),
    juntas: juntas(0.25, 0.35, 0.35),
  },
  {
    nombre: "escalon-viga",
    descripcion: "dos macizas de 25 cm, B 25 cm más baja (sin solape), viga descolgada de 30 × 60 en el escalón",
    fisico: base([losaA, losaB], vigaEscalon, { b: 0.3, h: 0.6 }),
    dz: { B: -0.25 },
    medio: { A: 0.125, B: 0.125 },
    juntas0: juntas(0.25, 0.25, 0.6),
    juntas: juntas(0.25, 0.5, 0.6),
    viga: { id: "VE", h: 0.6 },
  },
  {
    nombre: "enrase",
    descripcion: "reticular 25+5 (30 cm) con ábacos y maciza de 20 cm enrasada por abajo (B 10 cm más baja), sin viga",
    fisico: base([reticularA, { ...losaB, espesor: 0.2 }], undefined),
    dz: { B: -0.1 },
    medio: { A: centroideT, "A*": 0.15, B: 0.1 },
    juntas0: juntas(0.3, 0.2, 0.3),
    juntas: juntas(0.3, 0.3, 0.3),
  },
];

/** La zona rígida de la cabeza de cada pilar, hasta la cara inferior más baja que lo toca. */
function conJuntas(m: ModeloAnalitico, juntas: Record<string, number>): ModeloAnalitico {
  return {
    ...m,
    barras: m.barras!.map((b) => {
      const p = /^(P\d+):N1$/.exec(b.id)?.[1];
      return p ? { ...b, offsets: { ...b.offsets, j: [0, 0, -juntas[p]!] } } : b;
    }),
    // el peso del pilar, recortado al tramo flexible nuevo (lo de la zona rígida se pierde: igual en todos)
    casos: m.casos.map((c) => ({
      ...c,
      barras: c.barras?.map((cb) => {
        const b = m.barras![cb.barra]!;
        const p = /^(P\d+):N1$/.exec(b.id)?.[1];
        if (!p || cb.tipo !== "distribuida") return cb;
        const zi = m.nudos[b.nudos[0]]!.z + (b.offsets?.i?.[2] ?? 0);
        const len = m.nudos[b.nudos[1]]!.z - 0.5 - zi; // el mismo peso con todas las juntas (≤ 0,5)
        return { ...cb, b: Math.min(cb.b ?? len, len) };
      }),
    })),
  };
}

/** El modelo excéntrico: cada zona de losa en su plano medio (con su desnivel) y cada viga en su eje. */
function excentrico(m: ModeloAnalitico, r: Valido, dzZona: (zona: string) => number, cantos: Record<string, number>): ModeloAnalitico {
  const nudos: NudoAnalitico[] = m.nudos.map((n) => ({ ...n }));
  const enBarra = new Set<number>();
  for (const b of m.barras ?? []) for (const n of b.nudos) enBarra.add(n);
  const maestros = new Set((m.restricciones ?? []).map((x) => x.maestro));
  const apoyados = new Set((m.apoyos ?? []).map((a) => a.nudo));
  const zonaDe = (i: number) => {
    const ml = r.mapeo.laminas?.[i];
    return `${ml?.losa ?? ""}${ml?.abaco ? "*" : ""}`;
  };
  const zonasDe = new Map<number, Set<string>>();
  m.laminas!.forEach((l, i) => {
    for (const n of l.nudos) (zonasDe.get(n) ?? zonasDe.set(n, new Set()).get(n)!).add(zonaDe(i));
  });
  const restricciones: Restriccion[] = [...(m.restricciones ?? [])];
  const movidos = new Set<number>();
  const duplicado = new Map<string, number>();
  const laminas = m.laminas!.map((l, i) => {
    const zona = zonaDe(i);
    const d = dzZona(zona);
    if (d === 0) return l;
    const ns = l.nudos.map((n) => {
      const solo = !enBarra.has(n) && !maestros.has(n) && !apoyados.has(n) && zonasDe.get(n)!.size === 1;
      if (solo) {
        if (!movidos.has(n)) {
          nudos[n]!.z += d;
          movidos.add(n);
        }
        return n;
      }
      const k = `${n}|${zona}`;
      let nn = duplicado.get(k);
      if (nn === undefined) {
        nn = nudos.length;
        nudos.push({ ...m.nudos[n]!, id: `${m.nudos[n]!.id}~${zona}`, z: m.nudos[n]!.z + d });
        restricciones.push({ tipo: "enlace-rigido", id: `escalon-${nn}`, maestro: n, esclavos: [nn] });
        duplicado.set(k, nn);
      }
      return nn;
    }) as unknown as typeof l.nudos;
    return { ...l, nudos: ns };
  });
  // las vigas, con el eje h/2 bajo su cara superior (en la cota)
  const barras = m.barras!.map((b, i) => {
    const mb = r.mapeo.barras[i]!;
    const h = mb.tipo === "viga" ? cantos[mb.pieza] : undefined;
    if (h === undefined) return b;
    const o = (v?: readonly number[]) => [v?.[0] ?? 0, v?.[1] ?? 0, (v?.[2] ?? 0) - h / 2] as const;
    return { ...b, offsets: { i: o(b.offsets?.i), j: o(b.offsets?.j) } };
  });
  return { ...m, nudos, laminas, barras, restricciones };
}

interface Medida {
  flecha: Record<string, number>;
  /** Pilar → [N, |M|] en la cara inferior del forjado (j'), G+CM. */
  pilares: Record<string, [number, number]>;
  /** Viga del escalón: máximos de My+, My−, |Vz| y |T| a lo largo de ella (G+CM). */
  viga?: { My: number; Mneg: number; Vz: number; T: number };
  /** ux del nudo de P5 con Vx. */
  deriva: number;
  /** |M| de los pilares en su cabeza, con Vx. */
  pilaresVx: Record<string, number>;
  /** Mayor |Mx|, |My| y |N| de cada losa (G+CM, en el centroide de las láminas). */
  losas: Record<string, { Mx: number; My: number; N: number }>;
}

function medir(m: ModeloAnalitico, r: Valido, viga?: string): Medida {
  const casosR = casosValidos(calcular(m));
  const comb = (f: (c: ResultadoCaso) => Float64Array, i: number) => f(casosR[0]!)[i]! + f(casosR[1]!)[i]!;
  const losaDe = m.laminas!.map((_, i) => r.mapeo.laminas?.[i]?.losa ?? "");
  const flecha: Record<string, number> = {};
  const losas: Medida["losas"] = {};
  m.laminas!.forEach((l, i) => {
    const s = losaDe[i]!;
    for (const n of l.nudos) flecha[s] = Math.max(flecha[s] ?? 0, -comb((c) => c.u, 6 * n + 2));
    const o = (losas[s] ??= { Mx: 0, My: 0, N: 0 });
    o.Mx = Math.max(o.Mx, Math.abs(comb((c) => c.esfuerzosLaminas, 8 * i + 3)));
    o.My = Math.max(o.My, Math.abs(comb((c) => c.esfuerzosLaminas, 8 * i + 4)));
    o.N = Math.max(o.N, Math.abs(comb((c) => c.esfuerzosLaminas, 8 * i)), Math.abs(comb((c) => c.esfuerzosLaminas, 8 * i + 1)));
  });
  const pilares: Medida["pilares"] = {};
  const pilaresVx: Medida["pilaresVx"] = {};
  m.barras!.forEach((b, i) => {
    const p = /^(P\d+):N1$/.exec(b.id)?.[1];
    if (!p) return;
    pilares[p] = [comb((c) => c.esfuerzosBarras, 12 * i + 6), Math.hypot(comb((c) => c.esfuerzosBarras, 12 * i + 10), comb((c) => c.esfuerzosBarras, 12 * i + 11))];
    const vx = casosR[2]!.esfuerzosBarras;
    pilaresVx[p] = Math.hypot(vx[12 * i + 10]!, vx[12 * i + 11]!);
  });
  let mv: Medida["viga"];
  if (viga) {
    const ep = new EsfuerzosPiezas(m, r.mapeo, casosR);
    mv = { My: 0, Mneg: 0, Vz: 0, T: 0 };
    for (let s = 0; s <= 2 * L + 1e-9; s += 0.01) {
      const a = ep.en(viga, 0, s);
      const b = ep.en(viga, 1, s);
      if (!a || !b) continue;
      const My = a[4]! + b[4]!;
      mv.My = Math.max(mv.My, My);
      mv.Mneg = Math.min(mv.Mneg, My);
      mv.Vz = Math.max(mv.Vz, Math.abs(a[2]! + b[2]!));
      mv.T = Math.max(mv.T, Math.abs(a[3]! + b[3]!));
    }
  }
  const n5 = r.mapeo.nudosPilar["P5@N1"]!;
  return { flecha, pilares, viga: mv, deriva: casosR[2]!.u[6 * n5]!, pilaresVx, losas };
}

const pct = (a: number, b: number) => (Math.abs(b) < 1e-9 ? "      —" : `${(100 * (a / b - 1)).toFixed(1).padStart(6)} %`);
const f2 = (v: number) => v.toFixed(2).padStart(8);

const lineas: string[] = [];
const out = (s = "") => lineas.push(s);
out("DN-a: el error de la opción (a) (nudos en la cota de la planta con desnivel) frente al de RV-b sin desnivel");
out("Retícula de 2 × 2 vanos de 6 m, pilares de 30 × 30 empotrados a 3 m, losa A en x ∈ [0, 6] y B en x ∈ [6, 12], sin diafragma.");
out("Casos: G (peso propio) + CM (3 kN/m²), y Vx (100 kN en (3, 6)).");
out("E: excéntrico (losas en su plano medio, vigas en su eje); P: plano (RV-b); 0: sin desnivel; Δ: con él. PΔ es la opción (a).");
out("err0 = P0/E0 − 1 (lo que RV-b ya acepta); errΔ = PΔ/EΔ − 1 (lo de (a)); «PΔ rig.», PΔ con el diafragma rígido.");
for (const h of [0.5, 0.25]) {
  out();
  out(`════════ h = ${h} ════════`);
  for (const c of casos) {
    const op: OpcionesCompilacion = { tamanoMalla: h };
    const r = valido(compilar(c.fisico, op));
    const rRig = valido(compilar({ ...c.fisico, plantas: c.fisico.plantas.map((p) => ({ ...p, diafragma: undefined })) }, op));
    const cantos = c.viga ? { [c.viga.id]: c.viga.h } : {};
    const sinDz = (z: string) => -c.medio[z]!;
    const conDz = (z: string) => -c.medio[z]! + (c.dz[z.replace("*", "")] ?? 0);
    const m0 = conJuntas(r.modelo, c.juntas0);
    const mD = conJuntas(r.modelo, c.juntas);
    const M = {
      E0: medir(excentrico(m0, r, sinDz, cantos), r, c.viga?.id),
      P0: medir(m0, r, c.viga?.id),
      ED: medir(excentrico(mD, r, conDz, cantos), r, c.viga?.id),
      PD: medir(mD, r, c.viga?.id),
      PR: medir(conJuntas(rRig.modelo, c.juntas), rRig, c.viga?.id),
    };
    out();
    out(`── ${c.nombre}: ${c.descripcion}`);
    out("                          E0        P0      err0         EΔ        PΔ      errΔ    PΔ rig.");
    const fila = (nombre: string, f: (x: Medida) => number, k = 1) =>
      out(`   ${nombre.padEnd(20)}${f2(k * f(M.E0))}  ${f2(k * f(M.P0))}  ${pct(f(M.P0), f(M.E0))}   ${f2(k * f(M.ED))}  ${f2(k * f(M.PD))}  ${pct(f(M.PD), f(M.ED))}   ${f2(k * f(M.PR))}`);
    for (const l of ["A", "B"]) {
      fila(`flecha ${l} (mm)`, (x) => x.flecha[l]!, 1000);
      fila(`${l} máx |Mx|`, (x) => x.losas[l]!.Mx);
      fila(`${l} máx |My|`, (x) => x.losas[l]!.My);
      fila(`${l} máx |N| (kN/m)`, (x) => x.losas[l]!.N);
    }
    for (const p of ["P4", "P5", "P6", "P2"]) {
      fila(`${p} N (kN)`, (x) => x.pilares[p]![0]);
      fila(`${p} |M| cabeza`, (x) => x.pilares[p]![1]);
    }
    if (c.viga) {
      fila(`${c.viga.id} My+ (kN·m)`, (x) => x.viga!.My);
      fila(`${c.viga.id} My− (kN·m)`, (x) => x.viga!.Mneg);
      fila(`${c.viga.id} |Vz| (kN)`, (x) => x.viga!.Vz);
      fila(`${c.viga.id} |T| (kN·m)`, (x) => x.viga!.T);
    }
    fila("deriva P5 Vx (mm)", (x) => x.deriva, 1000);
    for (const p of ["P4", "P5", "P6"]) fila(`${p} |M| Vx`, (x) => x.pilaresVx[p]!);
  }
}
console.log(lineas.join("\n"));
