/**
 * AC-e: los ábacos según las luces en el muestrario y la vivienda, frente a los suyos (hechos a mano).
 * Uso: bun validacion/ac/lucesMuestrario.ts
 */
import { readFileSync } from "node:fs";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { resolverAbacos } from "../../src/compilador/abacos.ts";
import { proponerAbacosLuces, unirComoCompilador } from "../../src/editor/abacos.ts";

const f2 = (x: number) => x.toFixed(2).replace(".", ",");
for (const ej of ["muestrario", "vivienda"]) {
  const r = leerProyecto(readFileSync(`ejemplos/${ej}/proyecto.json`, "utf8"));
  if (!r.valido) throw new Error(ej);
  const m = resolverAbacos(r.proyecto.modelo).modelo;
  for (const l of m.losas ?? []) {
    if (!l.reticular) continue;
    const sin = { ...m, losas: m.losas!.map((x) => (x.id === l.id ? { ...x, reticular: { ...x.reticular!, abacos: [] } } : x)) };
    const p = proponerAbacosLuces(sin, l.id);
    if ("error" in p) throw new Error(p.error);
    const g = ((l.eje1 ?? 0) * Math.PI) / 180;
    const lados = (q: [number, number][]) => {
      const s = q.map((v) => v[0] * Math.cos(g) + v[1] * Math.sin(g));
      const t = q.map((v) => -v[0] * Math.sin(g) + v[1] * Math.cos(g));
      return `${f2(Math.max(...s) - Math.min(...s))} × ${f2(Math.max(...t) - Math.min(...t))}`;
    };
    console.log(`${ej} ${l.id} (intereje ${f2(l.reticular.intereje)}): ${l.reticular.abacos?.length ?? 0} ábacos suyos`);
    for (const x of p.nuevos) {
      const suyo = (l.reticular.abacos ?? []).find((a) => {
        const c = x.poligono.reduce((s, v) => [s[0] + v[0] / 4, s[1] + v[1] / 4], [0, 0]);
        return a.some(() => true) && c[0] >= Math.min(...a.map((v) => v[0])) - 1 && c[0] <= Math.max(...a.map((v) => v[0])) + 1 && c[1] >= Math.min(...a.map((v) => v[1])) - 1 && c[1] <= Math.max(...a.map((v) => v[1])) + 1;
      });
      console.log(`  ${x.pilar.padEnd(4)} luces ${lados(x.poligono as [number, number][]).padEnd(13)} suyo ${suyo ? lados(suyo as [number, number][]) : "—"}${p.fuera.includes(x.pilar) ? "  (se sale: cuenta lo de dentro)" : ""}`);
    }
    const u = unirComoCompilador(sin, l, p.nuevos.map((x) => x.poligono));
    const unidos = u.origen.map((o, j) => [o, j] as const).filter(([o]) => o.length > 1);
    console.log(`  tras unir: ${u.abacos.length} ábacos (suyos: ${l.reticular.abacos?.length ?? 0})${unidos.map(([o, j]) => `; ${o.map((k) => p.nuevos[k]!.pilar).join("+")} en uno de ${lados(u.abacos[j] as [number, number][])}`).join("")}`);
  }
}
