/**
 * SP-6: el metro de los pilares de borde de la losa plana de H25 (y de su reticular), que ahora van por
 * el corte directo por su cara (antes no tenían estación: aviso `franja/pilar-sin-cara`). Convergencia
 * con h, por estación de cara de un pilar sin cara de franja: mx (un solo caso), kN·m/m.
 * Uso: bun validacion/abacos/h25borde.ts > validacion/abacos/out_h25borde.txt
 */
import { prepararNucleo } from "../a3/revisar.ts";
import { losaPlanaFisica, OPCIONES_LOSA_PLANA } from "../c2/losaPlana.ts";
import { reticularH25 } from "../c5/modelos.ts";
import { pilaresEnLosa } from "../../src/compilador/bandas.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosFranjas } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { carasFranjas } from "../../src/compilador/franjas.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";

await prepararNucleo();

/** Por estación de cara de un pilar sin cara de franja (clave franja|pilar|s|lado), su mx; y el mayor |mx| de las caras de los pilares con cara. */
function medir(f: ModeloFisico, op: OpcionesCompilacion): { borde: Map<string, number>; interior: number; nudos: number; avisos: number } {
  const r = compilar(f, op);
  if (!r.valido) throw new Error(r.diagnosticos[0]!.mensaje);
  const casos = casosValidos(calcular(r.modelo));
  const ctx = validar(f, resolverOpciones(op), new Diagnosticos())!;
  const e = new EsfuerzosFranjas(ctx, r, casos);
  const borde = new Map<string, number>();
  let interior = 0;
  let avisos = 0;
  for (const l of ctx.losas) {
    const conCara = new Set(carasFranjas(ctx, l).flatMap((c) => c.pilares.map((p) => p.id)));
    const sin = new Set(pilaresEnLosa(ctx, l).filter((p) => !conCara.has(p.id)).map((p) => p.id));
    for (const fr of e.franjas(l.losa.id)) {
      const res = e.estaciones(fr.id)!;
      if (res.diagnosticos.some((d) => d.codigo === "franja/pilar-sin-cara")) avisos++;
      for (const x of res.estaciones) {
        if (x.tipo !== "cara" || !x.valido) continue;
        if (x.piezas.length === 1 && sin.has(x.piezas[0]!)) borde.set(`${fr.id}|${x.piezas[0]}|${x.s.toFixed(3)}|${x.lado}`, x.medios[0]!);
        else if (x.piezas.length) interior = Math.max(interior, Math.abs(x.medios[0]!));
      }
    }
  }
  return { borde, interior, nudos: r.modelo.nudos.length, avisos };
}

const MALLAS: [string, OpcionesCompilacion][] = [
  ["0,75", { tamanoMalla: 0.75 }],
  ["0,5", { tamanoMalla: 0.5 }],
  ["0,375", { tamanoMalla: 0.375 }],
  ["0,25 ε.01", { tamanoMalla: 0.25, epsSnap: 0.01 }],
  ["0,15 ε.01", { tamanoMalla: 0.15, epsSnap: 0.01 }],
];
for (const [nombre, f] of [
  ["Losa plana de H25", { ...losaPlanaFisica(), bandas: undefined }],
  ["Reticular de H25", reticularH25()],
] as const) {
  console.log(`\n${nombre}: mx en las caras de los pilares de borde (por el corte directo), kN·m/m`);
  const res = MALLAS.map(([n, o]) => [n, medir(f, { ...OPCIONES_LOSA_PLANA, ...o })] as const);
  console.log(`  ${"malla".padEnd(10)} ${"nudos".padStart(7)}  caras de borde  avisos de pilar sin cara  mayor |mx| de las caras interiores`);
  for (const [n, m] of res) console.log(`  ${n.padEnd(10)} ${String(m.nudos).padStart(7)}  ${String(m.borde.size).padStart(14)}  ${String(m.avisos).padStart(24)}  ${m.interior.toFixed(1).padStart(10)}`);
  const ref = res[res.length - 1]![1].borde;
  console.log(`  ${"franja | pilar | s | lado".padEnd(30)} ${MALLAS.map(([n]) => n.padStart(10)).join("")}   0,75 frente a la última`);
  for (const [clave, vr] of [...ref].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const vs = res.map(([, m]) => m.borde.get(clave));
    const v0 = vs[0];
    console.log(`  ${clave.padEnd(30)} ${vs.map((v) => (v === undefined ? "—" : v.toFixed(1)).padStart(10)).join("")}   ${v0 === undefined ? "—" : `${(((v0 - vr) / Math.abs(vr)) * 100).toFixed(1)} %`}`);
  }
}
