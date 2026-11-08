// Avisos de la malla junto a los pilares en los recuadros de PB con pilares mayores que sus vigas,
// con el código de una carpeta (la de ahora o un árbol de trabajo en el commit de antes, HR-8).
//   bun validacion/pb5/avisos.ts [<raíz>]
import { join, resolve } from "node:path";
import { recuadros, type OpcionesRecuadros } from "../pb/modelos.ts";
const raiz = resolve(process.argv[2] ?? join(import.meta.dirname, "../.."));
const { compilar } = (await import(join(raiz, "src/compilador/compilar.ts"))) as typeof import("../../src/compilador/compilar.ts");
const MALLA = ["malla/esquina-sin-refinar", "malla/pilar-tapado-sin-refinar", "malla/cara-sin-refinar", "malla/calidad", "malla/pilar-asoma-sin-plantilla", "malla/astillas-junto-a-pilar"];
const V: [string, OpcionesRecuadros][] = [];
for (const p of [0.3, 0.35, 0.4, 0.45, 0.5, [0.3, 0.5], [0.5, 0.3], [0.4, 0.6]] as const)
  for (const extra of [{}, { reticular: true }, { interiores: true }, { continuas: true }, { vuelo: 0.2 }] as OpcionesRecuadros[])
    V.push([`${JSON.stringify(p)} ${JSON.stringify(extra)}`, { pilar: p as any, ...extra }]);
for (const [n, op] of V) {
  const c = compilar(recuadros(2, 2, op));
  const av = c.diagnosticos.filter((d) => MALLA.includes(d.codigo)).map((d) => `${d.codigo.replace("malla/", "")} [${(d.ids ?? []).slice(1).join(",")}]`);
  console.log(n.padEnd(40), c.valido, String(c.modelo?.nudos.length).padStart(6), av.join(" | "));
}
