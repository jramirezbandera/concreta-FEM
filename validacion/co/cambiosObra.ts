/**
 * CO1-b y CO1-e (docs/fem3d/comprobaciones.md §8.4): lo que cambia en la referencia congelada de los
 * pilares con el cortante del pilar circular y las reglas de obra (continuidad en altura y agrupar).
 *
 *   bun validacion/co/cambiosObra.ts > validacion/co/out_cambiosObra.txt
 *
 * Compara el fixture de antes (src/comprobaciones/__fixtures__/congelado-co1.json, sin regenerar)
 * con lo de ahora, tramo a tramo, y da el área de acero de los dos.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { MODELOS_CONGELADOS_CO1, referenciaCO1, type ReferenciaCO1 } from "./congelar.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const antes = JSON.parse(readFileSync(join(RAIZ, "src", "comprobaciones", "__fixtures__", "congelado-co1.json"), "utf8")) as Record<string, ReferenciaCO1>;

/** Área de un texto «4Ø25 + 6Ø25 (caras h) · cØ8/100», mm². */
function area(texto: string | null): number {
  if (!texto) return 0;
  let a = 0;
  for (const m of texto.split("·")[0]!.matchAll(/(\d+)Ø(\d+)/g)) a += Number(m[1]) * (Math.PI * Number(m[2]) ** 2) / 4;
  return a;
}

for (const [nombre, f] of Object.entries(MODELOS_CONGELADOS_CO1)) {
  const ahora = referenciaCO1(f());
  const a = antes[nombre]!;
  let cambian = 0;
  let sumaAntes = 0;
  let sumaAhora = 0;
  const lineas: string[] = [];
  ahora.tramos.forEach((t, i) => {
    const o = a.tramos[i]!;
    sumaAntes += area(o.texto);
    sumaAhora += area(t.texto);
    if (o.texto === t.texto && o.cumple === t.cumple) return;
    cambian++;
    lineas.push(`  ${t.pilar} en ${t.planta}${t.ajuste ? ` [${t.ajuste}]` : ""}: ${o.texto ?? "—"} → ${t.texto ?? "—"} (${(area(t.texto) / Math.max(1, area(o.texto)) - 1) * 100 > 0 ? "+" : ""}${((area(t.texto) / Math.max(1, area(o.texto)) - 1) * 100).toFixed(0)} %)${o.cumple !== t.cumple ? ` · cumple ${o.cumple} → ${t.cumple}` : ""}`);
  });
  console.log(`${nombre}: ${cambian} de ${ahora.tramos.length} tramos cambian; acero total ${(sumaAntes / 100).toFixed(0)} → ${(sumaAhora / 100).toFixed(0)} cm² (${((sumaAhora / sumaAntes - 1) * 100).toFixed(1)} %)`);
  for (const l of lineas) console.log(l);
}
