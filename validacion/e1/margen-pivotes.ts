/**
 * Margen del umbral de mecanismo (11 cifras perdidas): cifras perdidas, log₁₀(Kⱼⱼ/dⱼ), del peor
 * pivote de modelos válidos (edificio objetivo, contrastes de rigidez) y de mecanismos reales.
 * Uso: bun validacion/e1/margen-pivotes.ts  → out_margen_pivotes.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { elementosDelModelo, geometria } from "../../src/motor/elementos.ts";
import { ensamblarRigidez, patronSistema } from "../../src/motor/ensamblado.ts";
import { numerar } from "../../src/motor/gdl.ts";
import type { ModeloAnalitico } from "../../src/motor/modelo.ts";
import { FactorLdlt, iniciarNucleo } from "../../src/nucleo/index.ts";
import { ARTICULADO, carga, Constructor, seccionRectangular } from "../../src/pruebas/constructor.ts";
import { edificio } from "../../src/pruebas/edificio.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));

function peorPivote(m: ModeloAnalitico): string {
  const diag = new Diagnosticos();
  const geo = geometria(m);
  const el = elementosDelModelo(m, geo, diag);
  const num = numerar(m, el, geo, diag)!;
  const ps = patronSistema(num, el);
  const K = ensamblarRigidez(m, num, el, ps);
  const f = new FactorLdlt(ps.patron);
  try {
    f.factorizar(K.valores);
  } catch (e) {
    return `pivote exactamente nulo (${(e as Error).message})`;
  }
  const d = f.diagonal();
  f.liberar();
  let peor = 0;
  let negativos = 0;
  for (let j = 0; j < d.length; j++) {
    if (d[j]! <= 0) negativos++;
    else peor = Math.max(peor, Math.log10(Math.abs(K.diagonal[j]!) / d[j]!));
  }
  return `${peor.toFixed(1)} cifras${negativos ? `, ${negativos} pivotes ≤ 0` : ""}`;
}

const S = seccionRectangular(0.3, 0.4);
const casos: [string, ModeloAnalitico][] = [];
for (const diafragma of [true, false]) {
  const e = edificio({ vanosX: 9, vanosY: 7, luzX: 6, luzY: 6, plantas: 7, altura: 3, malla: 0.75, huella: 0.75, vigas: true, muro: true, diafragma });
  casos.push([`válido: edificio objetivo ${diafragma ? "con diafragma" : "semirrígido"}`, e.modelo]);
}
const losa = edificio({ vanosX: 1, vanosY: 1, luzX: 8, luzY: 8, plantas: 1, altura: 3, malla: 0.25, espesor: 0.02 });
casos.push(["válido: losa de 2 cm con malla de 0,25 m", losa.modelo]);
for (const f of [1e4, 1e6, 1e8]) {
  const m = new Constructor();
  const n = [m.nudo(0, 0, 0), m.nudo(3, 0, 0), m.nudo(3.5, 0, 0), m.nudo(6.5, 0, 0)];
  m.barra(n[0]!, n[1]!, S, [0, 0, 1]);
  m.barra(n[1]!, n[2]!, { ...S, E: S.E * f, G: S.G * f }, [0, 0, 1]);
  m.barra(n[2]!, n[3]!, S, [0, 0, 1]);
  m.apoyo(n[0]!);
  m.apoyo(n[3]!, ARTICULADO);
  m.caso("P", [carga(n[2]!, { fz: -1 })]);
  casos.push([`${f < 1e6 ? "válido" : "mal condicionado"}: barra ${f.toExponential(0)} veces más rígida`, m.modelo()]);
}
{
  const m = new Constructor();
  const a = m.nudo(0, 0, 0);
  const b = m.nudo(3, 0, 0);
  m.barra(a, b, S, [0, 0, 1]);
  m.apoyo(a, ARTICULADO);
  m.apoyo(b, ARTICULADO);
  m.caso("P", []);
  casos.push(["mecanismo: barra biarticulada (giro rx)", m.modelo()]);
}
{
  const m = new Constructor();
  const a = m.nudo(0, 0, 0);
  const b = m.nudo(3, 0, 0);
  m.barra(a, b, S, [0, 0, 1]);
  m.apoyo(a, ARTICULADO);
  m.caso("P", []);
  casos.push(["mecanismo: barra con un extremo articulado", m.modelo()]);
}
{
  const e = edificio({ vanosX: 2, vanosY: 2, luzX: 5, luzY: 4, plantas: 2, altura: 3, malla: 1, diafragma: true });
  // no es un mecanismo: la losa empotra las cabezas de los pilares
  const m = { ...e.modelo, apoyos: e.modelo.apoyos!.map((a) => ({ ...a, coartados: [true, true, true, false, false, false] as const })) };
  casos.push(["válido: edificio con diafragma sobre pilares articulados en la base (la losa empotra las cabezas)", m]);
}
for (const diafragma of [true, false]) {
  // mecanismo diluido en el edificio objetivo: una ménsula colgada de un nudo de losa con un
  // muelle de longitud nula sin rigidez a torsión (rx) gira libremente alrededor de su eje
  const e = edificio({ vanosX: 9, vanosY: 7, luzX: 6, luzY: 6, plantas: 7, altura: 3, malla: 0.75, huella: 0.75, vigas: true, muro: true, diafragma });
  const base = e.modelo;
  const ancla = 500; // un nudo de losa de la planta 1
  const p = base.nudos[ancla]!;
  const nudos = [...base.nudos, { id: "A", x: p.x, y: p.y, z: p.z }, { id: "B", x: p.x + 2, y: p.y, z: p.z }];
  const nA = base.nudos.length;
  const modelo: ModeloAnalitico = {
    ...base,
    nudos,
    barras: [...base.barras!, { id: "MENSULA", nudos: [nA, nA + 1], seccion: S, vz: [0, 0, 1] }],
    muelles: [...(base.muelles ?? []), { id: "ROTULA", nudos: [ancla, nA], k: [1e9, 1e9, 1e9, 0, 1e9, 1e9] }],
  };
  casos.push([`mecanismo: ménsula con rótula a torsión en el edificio objetivo ${diafragma ? "con diafragma" : "semirrígido"}`, modelo]);
}
for (const diafragma of [true, false]) {
  // la misma ménsula girada 30° en planta y su rótula en ejes locales: el cero ya no es exacto
  const e = edificio({ vanosX: 9, vanosY: 7, luzX: 6, luzY: 6, plantas: 7, altura: 3, malla: 0.75, huella: 0.75, vigas: true, muro: true, diafragma });
  const base = e.modelo;
  const ancla = 500;
  const p = base.nudos[ancla]!;
  const c = Math.cos(Math.PI / 6);
  const sn = Math.sin(Math.PI / 6);
  const nA = base.nudos.length;
  const modelo: ModeloAnalitico = {
    ...base,
    nudos: [...base.nudos, { id: "A", x: p.x, y: p.y, z: p.z }, { id: "B", x: p.x + 2 * c, y: p.y + 2 * sn, z: p.z }],
    barras: [...base.barras!, { id: "MENSULA", nudos: [nA, nA + 1], seccion: S, vz: [0, 0, 1] }],
    muelles: [...(base.muelles ?? []), { id: "ROTULA", nudos: [ancla, nA], k: [1e9, 1e9, 1e9, 0, 1e9, 1e9], ejes: [c, sn, 0, -sn, c, 0, 0, 0, 1] }],
  };
  casos.push([`mecanismo: la misma ménsula girada 30° (rótula en ejes locales), ${diafragma ? "con diafragma" : "semirrígido"}`, modelo]);
}
for (const [nombre, m] of casos) console.log(`${nombre}: ${peorPivote(m)}`);
