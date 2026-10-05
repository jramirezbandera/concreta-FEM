/**
 * La rejilla alineada de H52 (decisión C2-a): tamaño y precisión frente a la triangulación sola.
 *
 * 1. Edificio objetivo con losas reducido a 3 plantas (como `decisiones.ts`), con la banda de pilar
 *    en la cara del pilar (24, 15). Referencia: la triangulación sola con h = 0,3 (124 000 nudos).
 *    Deriva de la planta de arriba (Vx), flecha (G + Q) en el centro del recuadro (25,5; 12,5)
 *    interpolada en su lámina, flecha máxima, y My y Vz de la banda en la cara por fuerzas nodales.
 * 2. Retícula con la losa enrasada con los pilares de fachada (1 planta), con todas las huellas en
 *    plantilla. Referencia: la triangulación sola con h = 0,2. Reacciones de los pilares (G + Q),
 *    flecha máxima y deriva.
 * 3. Losa plana de H25 frente a la rejilla de E5 con h = 0,075: triangulación y rejilla.
 * 4. Modelos aleatorios de C2 y C3 (con y sin muros): nudos con y sin rejilla.
 *
 * Uso: bun validacion/c2/rejilla.ts > validacion/c2/out_rejilla.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes, type Corte } from "../../src/motor/cortes.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { conMurosAleatorios } from "../../src/pruebas/murosAleatorios.ts";
import { losaPlanaC2 } from "./losaPlana.ts";
import { edificioObjetivoLosas, reticulaEnrasada } from "./modelos.ts";

const pct = (a: number, b: number) => `${100 * (a / b - 1) >= 0 ? "+" : ""}${(100 * (a / b - 1)).toFixed(2)} %`;
const nombre = (op: OpcionesCompilacion) => `${op.rejilla === false ? "triangulación" : "rejilla"}, h = ${String(op.tamanoMalla ?? 0.75).replace(".", ",")}`;

/** w (G + Q) en (x, y) de la cota z, interpolado (bilineal) en la lámina que lo contiene. */
export function flechaEn(m: ModeloAnalitico, casos: ResultadoCaso[], G: number, Q: number, z: number, px: number, py: number): number {
  const XI = [-1, 1, 1, -1];
  const ET = [-1, -1, 1, 1];
  for (const l of m.laminas ?? []) {
    const N = l.nudos.map((i) => m.nudos[i]!);
    if (N[0]!.z !== z) continue;
    if (px < Math.min(...N.map((n) => n.x)) - 1e-9 || px > Math.max(...N.map((n) => n.x)) + 1e-9 || py < Math.min(...N.map((n) => n.y)) - 1e-9 || py > Math.max(...N.map((n) => n.y)) + 1e-9) continue;
    let [xi, eta] = [0, 0];
    for (let it = 0; it < 30; it++) {
      let [x, y, a, b, c, d] = [0, 0, 0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const Nk = ((1 + XI[k]! * xi) * (1 + ET[k]! * eta)) / 4;
        x += Nk * N[k]!.x;
        y += Nk * N[k]!.y;
        a += ((XI[k]! * (1 + ET[k]! * eta)) / 4) * N[k]!.x;
        b += ((ET[k]! * (1 + XI[k]! * xi)) / 4) * N[k]!.x;
        c += ((XI[k]! * (1 + ET[k]! * eta)) / 4) * N[k]!.y;
        d += ((ET[k]! * (1 + XI[k]! * xi)) / 4) * N[k]!.y;
      }
      const det = a * d - b * c;
      xi += (d * (px - x) - b * (py - y)) / det;
      eta += (-c * (px - x) + a * (py - y)) / det;
    }
    if (Math.abs(xi) > 1 + 1e-6 || Math.abs(eta) > 1 + 1e-6) continue;
    let w = 0;
    for (let k = 0; k < 4; k++) w += (((1 + XI[k]! * xi) * (1 + ET[k]! * eta)) / 4) * (casos[G]!.u[6 * l.nudos[k]! + 2]! + casos[Q]!.u[6 * l.nudos[k]! + 2]!);
    return w;
  }
  return Number.NaN;
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const lineas: string[] = [`# validacion/c2/rejilla.ts — ${new Date().toLocaleDateString("sv-SE")}: la rejilla alineada de H52 (C2-a) frente a la triangulación sola`];

  // 1. Edificio objetivo, 3 plantas
  {
    const f: ModeloFisico = { ...edificioObjetivoLosas(3), bandas: [{ id: "banda", planta: "N3", desde: [24.2, 15], hasta: [29.8, 15], ancho: 2.5 }] };
    const medir = (op: OpcionesCompilacion) => {
      const t0 = performance.now();
      const r = valido(compilar(f, op));
      const tc = performance.now() - t0;
      const m = r.modelo;
      const c = calcular(m);
      const casos = casosValidos(c);
      const k = (id: string) => m.casos.findIndex((x) => x.id === id);
      const [G, Q, Vx] = [k("G"), k("Q"), k("Vx")];
      const z = Math.max(...m.nudos.map((n) => n.z));
      const arriba = Object.entries(r.mapeo.nudosPilar).filter(([clave]) => clave.endsWith("@N3")).map(([, n]) => n);
      const deriva = arriba.reduce((s, n) => s + casos[Vx]!.u[6 * n]!, 0) / arriba.length;
      let fmax = 0;
      m.nudos.forEach((n, i) => n.z === z && (fmax = Math.min(fmax, casos[G]!.u[6 * i + 2]! + casos[Q]!.u[6 * i + 2]!)));
      const corte: Corte = { origen: [24.2, 15, z], x: [1, 0, 0], vz: [0, 0, 1], y: [-1.25, 1.25], metodo: "fuerzas-nodales" };
      const rc = new Cortes(m).cortar(corte, casos);
      if (!rc.valido) throw new Error(rc.diagnosticos.map((d) => d.mensaje).join(" | "));
      const e = r.estadisticas;
      return {
        nudos: e.nudos,
        ecuaciones: c.estadisticas!.ecuaciones,
        rejilla: e.malla.laminasRejilla / e.laminas,
        plantillas: e.malla.plantillas,
        jac: e.malla.jacobianoMin,
        tc,
        deriva,
        flecha: flechaEn(m, casos, G, Q, z, 25.5, 12.5),
        fmax,
        My: rc.esfuerzos[6 * G + 4]! + rc.esfuerzos[6 * Q + 4]!,
        Vz: rc.esfuerzos[6 * G + 2]! + rc.esfuerzos[6 * Q + 2]!,
      };
    };
    const ref = medir({ tamanoMalla: 0.3, rejilla: false });
    lineas.push("", "## 1. Edificio objetivo con losas, 3 plantas (frente a la triangulación con h = 0,3)");
    lineas.push("| malla | nudos | ecuaciones | láminas en rejilla | plantillas | jac. mín. | compilación | deriva (Vx) | flecha del recuadro | flecha máxima | My banda, cara | Vz banda, cara |");
    lineas.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
    const fila = (op: OpcionesCompilacion, x: ReturnType<typeof medir>, r?: ReturnType<typeof medir>) =>
      lineas.push(
        `| ${nombre(op)} | ${x.nudos} | ${x.ecuaciones} | ${(100 * x.rejilla).toFixed(0)} % | ${x.plantillas} | ${x.jac.toFixed(3)} | ${(x.tc / 1000).toFixed(1)} s | ${r ? pct(x.deriva, r.deriva) : `${(1000 * x.deriva).toFixed(4)} mm`} | ${r ? pct(x.flecha, r.flecha) : `${(1000 * x.flecha).toFixed(4)} mm`} | ${r ? pct(x.fmax, r.fmax) : `${(1000 * x.fmax).toFixed(4)} mm`} | ${r ? pct(x.My, r.My) : x.My.toFixed(2)} | ${r ? pct(x.Vz, r.Vz) : x.Vz.toFixed(2)} |`,
      );
    fila({ tamanoMalla: 0.3, rejilla: false }, ref);
    for (const op of [{ tamanoMalla: 0.75, rejilla: false }, { tamanoMalla: 0.5 }, { tamanoMalla: 0.75 }, { tamanoMalla: 1 }]) fila(op, medir(op), ref);
  }

  // 2. Retícula enrasada
  {
    const f = reticulaEnrasada(1);
    const medir = (op: OpcionesCompilacion) => {
      const r = valido(compilar(f, op));
      const casos = casosValidos(calcular(r.modelo));
      const k = (id: string) => r.modelo.casos.findIndex((x) => x.id === id);
      const [G, Q, V] = [k("G"), k("Q"), k("V")];
      const z = Math.max(...r.modelo.nudos.map((n) => n.z));
      const base = Object.entries(r.mapeo.nudosPilar)
        .filter(([c]) => c.endsWith("@C"))
        .sort()
        .map(([, n]) => casos[G]!.reacciones[6 * n + 2]! + casos[Q]!.reacciones[6 * n + 2]!);
      let fmax = 0;
      r.modelo.nudos.forEach((n, i) => n.z === z && (fmax = Math.min(fmax, casos[G]!.u[6 * i + 2]! + casos[Q]!.u[6 * i + 2]!)));
      const arriba = Object.entries(r.mapeo.nudosPilar).filter(([c]) => c.endsWith("@N1")).map(([, n]) => n);
      const deriva = arriba.reduce((s, n) => s + casos[V]!.u[6 * n]!, 0) / arriba.length;
      return { nudos: r.estadisticas.nudos, plantillas: r.estadisticas.malla.plantillas, rejilla: r.estadisticas.malla.laminasRejilla / r.estadisticas.laminas, jac: r.estadisticas.malla.jacobianoMin, base, fmax, deriva };
    };
    const ref = medir({ tamanoMalla: 0.2, rejilla: false });
    lineas.push("", "## 2. Retícula con la losa enrasada con los pilares de fachada, 1 planta (frente a la triangulación con h = 0,2)");
    lineas.push("| malla | nudos | láminas en rejilla | plantillas | jac. mín. | peor reacción de pilar | flecha máxima | deriva (V) |");
    lineas.push("|---|---|---|---|---|---|---|---|");
    lineas.push(`| ${nombre({ tamanoMalla: 0.2, rejilla: false })} | ${ref.nudos} | 0 % | 0 | ${ref.jac.toFixed(3)} | | ${(1000 * ref.fmax).toFixed(4)} mm | ${(1000 * ref.deriva).toFixed(5)} mm |`);
    for (const op of [{ tamanoMalla: 0.75, rejilla: false }, { tamanoMalla: 0.5 }, { tamanoMalla: 0.75 }]) {
      const x = medir(op);
      const peor = Math.max(...x.base.map((b, i) => Math.abs(b / ref.base[i]! - 1)));
      lineas.push(`| ${nombre(op)} | ${x.nudos} | ${(100 * x.rejilla).toFixed(0)} % | ${x.plantillas} | ${x.jac.toFixed(3)} | ${(100 * peor).toFixed(2)} % | ${pct(x.fmax, ref.fmax)} | ${pct(x.deriva, ref.deriva)} |`);
    }
  }

  // 3. Losa plana de H25
  {
    const E5 = { cara: [-205.58, -262.71, -251.51, -263.21], vano: [76.98, 139.0] };
    lineas.push("", "## 3. Losa plana de H25 frente a la rejilla de E5 con h = 0,075 (validacion/e5/out_bandas.txt)");
    lineas.push("| malla | nudos | My banda, cara | My pórtico, cara | Vz banda, cara | Vz pórtico, cara | My banda, vano | My pórtico, vano |");
    lineas.push("|---|---|---|---|---|---|---|---|");
    for (const h of [0.5, 0.3, 0.15, 0.1])
      for (const rejilla of [false, true]) {
        const r = losaPlanaC2(h, rejilla);
        const v = [r.cara[0]![0]!, r.cara[0]![1]!, r.cara[1]![0]!, r.cara[1]![1]!];
        lineas.push(`| ${nombre({ tamanoMalla: h, rejilla })} | ${r.nudos} | ${v.map((x, i) => pct(x, E5.cara[i]!)).join(" | ")} | ${r.vano.map((x, i) => pct(x, E5.vano[i]!)).join(" | ")} |`);
      }
  }

  // 4. Modelos aleatorios
  {
    lineas.push("", "## 4. Modelos aleatorios de C2 y C3: nudos con la triangulación sola y con la rejilla");
    lineas.push("| semilla | muros | h | triangulación | rejilla | diferencia | láminas de losa en rejilla | plantillas |");
    lineas.push("|---|---|---|---|---|---|---|---|");
    let peor = -Infinity;
    for (const s of [1, 2, 3, 4, 6, 8, 9, 11])
      for (const muros of [false, true])
        for (const h of [0.75, 1.25]) {
          let f = conLosasAleatorias(fisicoAleatorio(s), s);
          if (muros) f = conMurosAleatorios(f, s);
          const [a, b] = [valido(compilar(f, { tamanoMalla: h, rejilla: false })), valido(compilar(f, { tamanoMalla: h }))];
          const d = b.estadisticas.nudos / a.estadisticas.nudos - 1;
          peor = Math.max(peor, d);
          const losas = b.estadisticas.laminas - b.estadisticas.laminasMuros;
          lineas.push(`| ${s} | ${muros ? "sí" : "no"} | ${String(h).replace(".", ",")} | ${a.estadisticas.nudos} | ${b.estadisticas.nudos} | ${pct(b.estadisticas.nudos, a.estadisticas.nudos)} | ${((100 * b.estadisticas.malla.laminasRejilla) / losas).toFixed(0)} % | ${b.estadisticas.malla.plantillas} |`);
        }
    lineas.push("", `Peor diferencia: ${(100 * peor).toFixed(2)} % (la rejilla nunca da más nudos: si cubre menos del 75 % de una planta, se queda la malla con menos).`);
  }

  console.log(lineas.join("\n"));
}
