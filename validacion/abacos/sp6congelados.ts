/**
 * SP-6: en los modelos de la referencia congelada de F, las estaciones de los pilares sin cara de franja
 * que pasan al corte directo por su cara (la recta sigue la malla en su ventana) frente al escalón, que
 * era lo que daban antes (`caraDirecta: false`). Diferencia en mx (la suma de los casos), relativa.
 * Uso: bun validacion/abacos/sp6congelados.ts > validacion/abacos/out_sp6congelados.txt
 */
import { prepararNucleo } from "../a3/revisar.ts";
import { MODELOS_CONGELADOS_F } from "../f/congelar.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosFranjas } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones } from "../../src/compilador/fisico.ts";
import { validar } from "../../src/compilador/validar.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";

await prepararNucleo();
console.log("modelo | estaciones | cambian | nuevas | directas | escalón − directo en mx: media |·|, mín, máx | la mayor");
for (const [nombre, fm] of Object.entries(MODELOS_CONGELADOS_F)) {
  const { fisico, opciones } = fm();
  const r = compilar(fisico, opciones ?? {});
  if (!r.valido) throw new Error(nombre);
  const casos = casosValidos(calcular(r.modelo));
  const ctx = validar(fisico, resolverOpciones(opciones ?? {}), new Diagnosticos())!;
  const cortes = new Cortes(r.modelo);
  const nuevo = new EsfuerzosFranjas(ctx, r, casos, { cortes });
  const antes = new EsfuerzosFranjas(ctx, r, casos, { cortes, caraDirecta: false });
  const nc = casos.length;
  const mx = (m: Float64Array) => [...Array(nc).keys()].reduce((a, k) => a + m[3 * k]!, 0);
  let total = 0;
  let cambian = 0;
  let nuevas = 0;
  const ds: { d: number; t: string }[] = [];
  // Las franjas con estaciones nuevas: su mayor |mx| antes y ahora
  const maximos: { d: number; t: string }[] = [];
  const mayor = (es: readonly { medios: Float64Array; valido: boolean }[]) => Math.max(...es.filter((e) => e.valido).map((e) => Math.abs(mx(e.medios))));
  for (const fr of nuevo.franjas()) {
    const a = nuevo.estaciones(fr.id)!.estaciones;
    const b = antes.estaciones(fr.id)!.estaciones;
    total += a.length;
    if (a.some((e) => !b.some((x) => x.s === e.s && x.lado === e.lado && x.tipo === e.tipo))) {
      const [ma, mb] = [mayor(a), mayor(b)];
      maximos.push({ d: (ma - mb) / mb, t: `${fr.id}: ${mb.toFixed(1)} → ${ma.toFixed(1)}` });
    }
    for (const e of a) {
      const o = b.find((x) => x.s === e.s && x.lado === e.lado && x.tipo === e.tipo && x.piezas.join() === e.piezas.join());
      if (!o) {
        nuevas++;
        continue;
      }
      if (e.medios.every((v, q) => Object.is(v, o.medios[q])) && e.anchoEnLosa === o.anchoEnLosa) continue;
      cambian++;
      const d = (mx(o.medios) - mx(e.medios)) / Math.abs(mx(e.medios));
      ds.push({ d, t: `${fr.id} s = ${e.s.toFixed(3)} (${e.piezas.join(", ")}): ${mx(o.medios).toFixed(2)} → ${mx(e.medios).toFixed(2)}` });
    }
  }
  const p = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)} %`;
  const peor = ds.reduce((a, x) => (Math.abs(x.d) > Math.abs(a?.d ?? 0) ? x : a), ds[0]);
  if (maximos.length) {
    maximos.sort((x, y) => y.d - x.d);
    console.log(`  ${nombre}: el mayor |mx| de las ${maximos.length} franjas con estaciones nuevas, antes → ahora: ${maximos.slice(0, 4).map((x) => `${x.t} (${p(x.d)})`).join("; ")}; sin cambio: ${maximos.filter((x) => x.d === 0).length}`);
  }
  console.log(`${nombre} | ${total} | ${cambian} | ${nuevas} | ${cambian + nuevas} | ${ds.length ? `${p(ds.reduce((a, x) => a + Math.abs(x.d), 0) / ds.length)}, ${p(Math.min(...ds.map((x) => x.d)))}, ${p(Math.max(...ds.map((x) => x.d)))}` : "—"} | ${peor?.t ?? "—"}`);
}
