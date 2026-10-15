/**
 * Criterio 6 de CY (`docs/fem3d/hipotesis-cype.md`): el reticular «uniforme» (CY3) frente al
 * emparrillado de CYPECAD como barras (memoria de cálculo, p. 13): barras a b = s/3 en las dos
 * direcciones, «con inercia a flexión (tanto en la zona maciza como en la aligerada) la mitad de la
 * zona maciza, y la inercia a torsión el doble de la de flexión»: I = ½·b·h³/12 y J = 2·I, con el G
 * del hormigón. El área de cortante de cada barra es la de la lámina (en la zona aligerada, la de
 * las almas: κ·h·bw·b/s; en los ábacos, κ·b·h), para comparar sólo flexión y torsión. Las barras
 * van en b/2 + i·b, así que su ancho tributario cubre la losa entera, y la carga va a los cruces por
 * áreas tributarias (b²).
 *
 * Dos recuadros de 25+5 con intereje 0,72 (la vivienda), de 8s × 8s: apoyado en su contorno (uz), y
 * con un pilar puntual en un cruce junto al centro y su ábaco de 9b × 9b. Flecha en un cruce y
 * momento por metro (M11 de la lámina frente al de la barra / b) en el centro de una barra.
 *
 *   bun validacion/cy/reticular.ts > validacion/cy/out_reticular.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion, Vec2 } from "../../src/compilador/fisico.ts";
import { KAPPA } from "../../src/elementos/dkmq.ts";
import { DiagramasBarras } from "../../src/motor/barras.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { CamposLaminas } from "../../src/motor/campos.ts";
import type { CargaNodal } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { Constructor } from "../../src/pruebas/constructor.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { hormigon } from "../../src/secciones/seccion3D.ts";

export const RET = { h: 0.3, hf: 0.05, bw: 0.12, s: 0.72 };
const HA = hormigon(25);

export interface ComparacionCype {
  caso: string;
  lamina: { w: number; m: number };
  barras: { w: number; m: number };
  errorW: number;
  errorM: number;
}

/** El recuadro de N·s apoyado en su contorno; con `pilar`, un pilar puntual en el cruce junto al centro y su ábaco de 9b × 9b. */
export function recuadroCype(N: number, pilar: boolean, opciones: OpcionesCompilacion = {}): ComparacionCype {
  const { h, hf, bw, s } = RET;
  const b = s / 3;
  const L = N * s;
  const c = L / 2 + b / 2;
  const q = -10;
  const sop = [true, true, true, false, false, false] as const;
  const ab: Vec2[][] = pilar
    ? [
        [
          [c - 4.5 * b, c - 4.5 * b],
          [c + 4.5 * b, c - 4.5 * b],
          [c + 4.5 * b, c + 4.5 * b],
          [c - 4.5 * b, c + 4.5 * b],
        ],
      ]
    : [];
  const f: ModeloFisico = {
    plantas: [{ id: "P0", altura: null }],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25, peso: 0 }],
    secciones: [],
    losas: [{ id: "L", planta: "P0", contorno: [[0, 0], [L, 0], [L, L], [0, L]], espesor: h, material: "H", reticular: { intereje: s, nervio: bw, capa: hf, caseton: "recuperable", abacos: ab } }],
    apoyosLineales: [
      { id: "a", planta: "P0", puntos: [[0, 0], [L, 0]], coartados: sop },
      { id: "b", planta: "P0", puntos: [[L, 0], [L, L]], coartados: sop },
      { id: "c", planta: "P0", puntos: [[L, L], [0, L]], coartados: sop },
      { id: "d", planta: "P0", puntos: [[0, L], [0, 0]], coartados: sop },
    ],
    ...(pilar ? { apoyos: [{ id: "P", planta: "P0", x: c, y: c, coartados: [false, false, true, false, false, false] as const }] } : {}),
    casos: [{ id: "q" }],
    cargas: [
      {
        tipo: "superficie",
        id: "Q",
        caso: "q",
        planta: "P0",
        losa: "L",
        q: [0, 0, q],
      },
    ],
  };
  // Puntos de medida: un cruce a 2s del borde y el centro de la barra según X que sale de él
  const [xw, yw] = [2 * s + b / 2, 2 * s + b / 2];
  const xm = 2 * s + b;
  const r = valido(compilar(f, { tamanoMalla: b / 2, ...opciones }));
  const [cl] = casosValidos(calcular(r.modelo));
  const nd = (x: number, y: number) => r.modelo.nudos.findIndex((n) => Math.abs(n.x - x) < 1e-6 && Math.abs(n.y - y) < 1e-6);
  const nw = nd(xw, yw);
  const nm = nd(xm, yw);
  if (nw < 0 || nm < 0) throw new Error("la malla no tiene nudo en los puntos de medida");
  const campos = new CamposLaminas(r.modelo);
  const l = r.modelo.laminas!.findIndex((x) => x.nudos.includes(nm));
  const M11 = campos.enNudos(l, cl!.u)[8 * r.modelo.laminas![l]!.nudos.indexOf(nm) + 3]!;
  const lamina = { w: cl!.u[6 * nw + 2]!, m: M11 };

  // Emparrillado de CYPECAD: barras en b/2 + i·b, i = 0 … 3N − 1
  const enAbaco = (x: number, y: number) => ab.some(([P0, , P2]) => x > P0![0] && x < P2![0] && y > P0![1] && y < P2![1]);
  const barra = (maciza: boolean) => {
    const Iy = (0.5 * b * h ** 3) / 12;
    return { E: HA.E, G: HA.G, A: b * h, Iy, Iz: (h * b ** 3) / 12, J: 2 * Iy, Avy: KAPPA * b * h, Avz: KAPPA * h * b * (maciza ? 1 : bw / s) };
  };
  const m = new Constructor();
  const pos = Array.from({ length: 3 * N }, (_, i) => b / 2 + i * b);
  const nudos = new Map<string, number>();
  const nudo = (x: number, y: number) => {
    const k = `${x.toFixed(9)},${y.toFixed(9)}`;
    let n = nudos.get(k);
    if (n === undefined) nudos.set(k, (n = m.nudo(x, y, 0)));
    return n;
  };
  const F: CargaNodal[] = [];
  for (const x of pos) for (const y of pos) F.push({ nudo: nudo(x, y), f: [0, 0, q * b * b, 0, 0, 0] });
  if (pilar) m.apoyo(nudo(c, c), [false, false, true, false, false, false]);
  const cortes = [0, ...pos, L].sort((p, t) => p - t);
  let barraM = -1;
  for (const dir of [0, 1])
    for (const y of pos) {
      const P = (a: number) => (dir === 0 ? nudo(a, y) : nudo(y, a));
      m.apoyo(P(0), sop);
      m.apoyo(P(L), sop);
      for (let k = 0; k + 1 < cortes.length; k++) {
        const [a, t] = [cortes[k]!, cortes[k + 1]!];
        const xc = (a + t) / 2;
        const br = m.barra(P(a), P(t), barra(enAbaco(dir === 0 ? xc : y, dir === 0 ? y : xc)), [0, 0, 1]);
        if (dir === 0 && Math.abs(y - yw) < 1e-9 && Math.abs(a - xw) < 1e-9) barraM = br;
      }
    }
  m.caso("q", F);
  const mod = m.modelo();
  const [cb] = casosValidos(calcular(mod));
  const w = cb!.u[6 * nudo(xw, yw) + 2]!;
  const M = new DiagramasBarras(mod).diagrama(barraM, 0, cb!).esfuerzosEn(b / 2, 1)[4]! / b;
  return { caso: pilar ? "pilar central con ábaco" : "apoyado en el contorno", lamina, barras: { w, m: M }, errorW: lamina.w / w - 1, errorM: lamina.m / M - 1 };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  let peor = 0;
  for (const pilar of [false, true]) {
    const x = recuadroCype(8, pilar);
    peor = Math.max(peor, Math.abs(x.errorW), Math.abs(x.errorM));
    const pc = (v: number) => `${(v * 100).toFixed(2)} %`;
    console.log(`${x.caso}: w lámina ${(x.lamina.w * 1e3).toFixed(4)} mm, barras ${(x.barras.w * 1e3).toFixed(4)} mm (${pc(x.errorW)}); m lámina ${x.lamina.m.toFixed(3)} kN·m/m, barras ${x.barras.m.toFixed(3)} (${pc(x.errorM)})`);
  }
  // Contraste: la rigidez «bruta» (C4-h) frente al mismo emparrillado de CYPECAD
  for (const pilar of [false, true]) {
    const x = recuadroCype(8, pilar, { rigidezReticular: "bruta" });
    console.log(`  con «bruta» (contraste), ${x.caso}: w ${(x.errorW * 100).toFixed(1)} %, m ${(x.errorM * 100).toFixed(1)} %`);
  }
  console.log(`\nPeor: ${(peor * 100).toFixed(2)} % (criterio ≤ 3 %)`);
  console.log(peor <= 0.03 ? "Criterio 6: PASA" : "Criterio 6: NO PASA");
}
