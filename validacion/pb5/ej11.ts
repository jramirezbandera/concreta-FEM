// Avisos de la malla junto a los pilares en los modelos del ejemplo 11 (VS5), con el código de una carpeta
//   bun validacion/pb5/ej11.ts [<raíz>]
import { join, resolve } from "node:path";
import { modelo } from "../sombra/ejemplo11/modelo.ts";
const raiz = resolve(process.argv[2] ?? join(import.meta.dirname, "../.."));
const { compilar } = (await import(join(raiz, "src/compilador/compilar.ts"))) as typeof import("../../src/compilador/compilar.ts");
for (const v of ["cype", "pf"] as const) {
  const m = structuredClone(modelo(v).modelo);
  const c = compilar(m);
  const av = c.diagnosticos.filter((d) => d.codigo.startsWith("malla/")).map((d) => `${d.codigo} [${(d.ids ?? []).join(",")}]`);
  console.log(v, c.valido, c.valido ? c.modelo.nudos.length : "-", av.join(" | "));
}
