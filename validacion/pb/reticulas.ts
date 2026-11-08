/**
 * Fase PB (`docs/fem3d/pilares-borde.md`): las 24 retículas al azar de G, sin y con los muros al azar
 * de C3 (las de `src/compilador/geometrias.test.ts`), con el código de una carpeta del repositorio: por
 * retícula, los nudos, el jacobiano escalado mínimo (sin los cuadriláteros enteros en una huella) y
 * los avisos de la malla junto a los pilares. Con dos carpetas, la de antes y la de ahora, una tabla
 * con las dos.
 *
 *   bun validacion/pb/reticulas.ts <raíz antes> <raíz ahora>   → out_reticulas.txt
 */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ModeloFisico } from "../../src/compilador/fisico.ts";

const raices = process.argv.slice(2).map((r) => resolve(r));
if (raices.length !== 2) throw new Error("bun validacion/pb/reticulas.ts <raíz antes> <raíz ahora>");

type Fila = { nudos: number; jmin: number; avisos: string };
async function medir(raiz: string): Promise<Map<string, Fila>> {
  const { compilar } = (await import(join(raiz, "src/compilador/compilar.ts"))) as typeof import("../../src/compilador/compilar.ts");
  const { reticulaAleatoria } = (await import(join(raiz, "src/pruebas/reticulasAleatorias.ts"))) as typeof import("../../src/pruebas/reticulasAleatorias.ts");
  const { conMurosAleatorios } = (await import(join(raiz, "src/pruebas/murosAleatorios.ts"))) as typeof import("../../src/pruebas/murosAleatorios.ts");
  const conMuros = (s: number): ModeloFisico => {
    const f = reticulaAleatoria(s);
    return conMurosAleatorios({ ...f, secciones: [...f.secciones, { id: "vb", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 }], casos: [...f.casos, { id: "V" }] }, s);
  };
  const r = new Map<string, Fila>();
  for (let s = 1; s <= 24; s++)
    for (const [nombre, f] of [
      [`${s}`, reticulaAleatoria(s)],
      [`${s} con muros`, conMuros(s)],
    ] as const) {
      const c = compilar(f, {});
      if (!c.valido) throw new Error(`${nombre}: no compila`);
      const cuenta = new Map<string, number>();
      for (const d of c.diagnosticos)
        if (/^malla\/(esquina-sin-refinar|pilar-tapado-sin-refinar|cara-sin-refinar|pilar-asoma-sin-plantilla|calidad)$/.test(d.codigo))
          for (const id of (d.ids ?? []).filter((x) => x.startsWith("P"))) cuenta.set(d.codigo.slice(6), (cuenta.get(d.codigo.slice(6)) ?? 0) + (id ? 1 : 0));
      r.set(nombre, { nudos: c.modelo.nudos.length, jmin: c.estadisticas.malla.jacobianoMin, avisos: [...cuenta].map(([k, n]) => `${k} ${n}`).join(", ") || "—" });
    }
  return r;
}

const [A, D] = [await medir(raices[0]!), await medir(raices[1]!)];
const out: string[] = [
  "# Fase PB: las 24 retículas al azar, antes y ahora",
  "",
  `Antes: ${raices[0]}; ahora: ${raices[1]}. Avisos: pilares nombrados en cada aviso de la malla (una planta puede repetirlos).`,
  "",
  "Retícula | nudos antes → ahora | jacobiano mínimo antes → ahora | avisos antes | avisos ahora",
  "---|---|---|---|---",
];
let [menos, mas, peorJ] = [0, 0, 0];
for (const [k, a] of A) {
  const d = D.get(k)!;
  if (d.nudos < a.nudos) menos++;
  if (d.nudos > a.nudos) mas++;
  if (d.jmin < a.jmin - 1e-9) peorJ++;
  out.push(`${k} | ${a.nudos} → ${d.nudos} | ${a.jmin.toFixed(3)} → ${d.jmin.toFixed(3)} | ${a.avisos} | ${d.avisos}`);
}
out.push("", `Con menos nudos: ${menos}; con más: ${mas}; con el jacobiano mínimo más bajo: ${peorJ} (de ${A.size}).`);
writeFileSync(join(import.meta.dirname, "out_reticulas.txt"), out.join("\n") + "\n");
console.log(out.slice(-1)[0]);
