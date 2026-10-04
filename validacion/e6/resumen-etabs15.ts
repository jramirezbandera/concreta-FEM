/**
 * Criterio 2 de E6: los muros de ETABS 15 frente a SAP2000 (la referencia del PDF) y a OpenSeesPy
 * ASDShellQ4 (misma malla).
 *
 * Por muro y magnitud:
 * - la geometría del PDF con tres mallas (h, h/2, h/4) y su extrapolación de Richardson;
 * - el «modelado de SAP2000» (E6-2): la malla y las hipótesis con que SAP2000 da sus cifras;
 * - OpenSees con la malla h (src/motor/__fixtures__/opensees-e6.json, de oraculo_opensees.py).
 *
 * Uso: bun validacion/e6/resumen-etabs15.ts → validacion/e6/out_etabs15.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { lecturas, modeloMuro, murosEtabs15, resultadosMuro, richardson, type MuroEtabs } from "./etabs15.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const opensees = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "src", "motor", "__fixtures__", "opensees-e6.json"), "utf8"));

/** Las mismas magnitudes leídas en los desplazamientos de OpenSees (malla h(0)). */
function deOpenSees(m: MuroEtabs): Record<string, number> {
  const res = opensees[`${m.id}@${m.h(0)}`];
  const { maestros } = modeloMuro(m, m.h(0));
  const u = m.direcciones.map((d) => {
    const v = new Float64Array(6 * (Math.max(...maestros) + 1));
    for (const n of maestros) v.set(res[d][String(n)], 6 * n);
    return v;
  });
  return lecturas(m, maestros, u);
}

const pct = (a: number, b: number) => `${(100 * (a / b - 1)).toFixed(2)} %`;
const lineas: string[] = [`# validacion/e6/resumen-etabs15.ts — ${new Date().toISOString().slice(0, 10)}; desplazamientos en in, giros en rad`, ""];
lineas.push("muro | magnitud | SAP2000 | ETABS | motor h, h/2, h/4 (nudos h/4) | Richardson (orden) | Richardson − SAP | modelado de SAP2000 | − SAP | OpenSees h | motor h − OpenSees");
let peorOs = 0;
let peorSap = 0;
let ms = 0;
for (const m of murosEtabs15()) {
  const t = performance.now();
  const r = [0, 1, 2].map((k) => resultadosMuro(m, m.h(k)));
  const sap = resultadosMuro(m, m.modeladoSap.h, m.modeladoSap);
  const os = deOpenSees(m);
  ms += performance.now() - t;
  for (const k of Object.keys(m.sap)) {
    const rich = richardson(r[0]![k]!, r[1]![k]!, r[2]![k]!);
    const dOs = r[0]![k]! / os[k]! - 1;
    peorOs = Math.max(peorOs, Math.abs(dOs));
    peorSap = Math.max(peorSap, Math.abs(sap[k]! / m.sap[k]! - 1));
    const variante = Object.entries(m.modeladoSap)
      .map(([c, v]) => (c === "h" ? `h = ${v}` : c === "soloMembrana" ? "membrana" : "diafragma sin dinteles"))
      .join(", ");
    lineas.push(
      [
        m.id,
        k,
        m.sap[k],
        m.etabs[k],
        `${r.map((x) => x[k]!.toPrecision(5)).join(", ")} (${r[2]!.nudos})`,
        `${rich.valor.toPrecision(5)} (${rich.orden.toFixed(2)})`,
        pct(rich.valor, m.sap[k]!),
        `${sap[k]!.toPrecision(5)} [${variante}]`,
        pct(sap[k]!, m.sap[k]!),
        os[k]!.toPrecision(5),
        `${(100 * dOs).toFixed(3)} %`,
      ].join(" | "),
    );
  }
}
lineas.push("", `Peor diferencia motor − OpenSees (misma malla): ${(100 * peorOs).toFixed(3)} %`);
lineas.push(`Peor diferencia del modelado de SAP2000 frente a SAP2000: ${(100 * peorSap).toFixed(2)} % (en valores de 1 o 2 cifras significativas pesa su redondeo)`);
lineas.push(`Tiempo total del motor: ${(ms / 1000).toFixed(1)} s`);
writeFileSync(join(import.meta.dirname, "out_etabs15.txt"), lineas.join("\n") + "\n");
console.log(lineas.join("\n"));
