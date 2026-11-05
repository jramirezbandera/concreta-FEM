/**
 * El DWG de un proyecto real frente al DXF que exportó su programa de CAD (fase DW, `dwg.md` §5,
 * criterio 3). Los ficheros del cliente no están en git.
 *
 *   bun validacion/dwg/vivienda.ts [modelo.dwg] [modelo.dxf]      escribe validacion/dwg/out_vivienda.txt
 *
 * Por defecto, `ejemplos/Proyectos/modelo.dwg` y `modelo.dxf` (la vivienda de Alhaurín el Grande).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compararDwgConDxf } from "../../src/dwg/comparar.ts";
import { leerDwg } from "../../src/dwg/lector.ts";
import { aplanarDxf } from "../../src/dxf/aplanar.ts";
import { leerDxf } from "../../src/dxf/lector.ts";

const raiz = join(import.meta.dirname, "..", "..");
const rutaDwg = process.argv[2] ?? join(raiz, "ejemplos", "Proyectos", "modelo.dwg");
const rutaDxf = process.argv[3] ?? join(raiz, "ejemplos", "Proyectos", "modelo.dxf");

const bytes = new Uint8Array(readFileSync(rutaDwg));
let mejor = Infinity;
for (let i = 0; i < 3; i++) {
  const t0 = performance.now();
  leerDwg(bytes);
  mejor = Math.min(mejor, performance.now() - t0);
}
const dwg = leerDwg(bytes);
const dxf = leerDxf(new Uint8Array(readFileSync(rutaDxf)));
const r = compararDwgConDxf(dwg, dxf);
const a = aplanarDxf(dwg);

const l: string[] = [];
l.push(`DWG ${dwg.version} (${(bytes.length / 1024).toFixed(0)} KB), leído en ${mejor.toFixed(0)} ms (el mínimo de 3, en caliente).`);
l.push(`$INSUNITS: DWG ${dwg.insunits}, DXF ${dxf.insunits}. Página de códigos: ${dwg.codificacion}.`);
l.push(`Objetos que no se pudieron leer: ${dwg.fallos.length}${dwg.fallos.length ? ` (${dwg.fallos.map((f) => f.handle).join(", ")})` : ""}.`);
l.push(`Espacio modelo: ${dwg.entidades.length} entidades en el DWG y ${dxf.entidades.length} en el DXF; bloques: ${dwg.bloques.size} y ${dxf.bloques.size}; capas: ${dwg.capas.length} y ${dxf.capas.length}.`);
l.push(`Entidades emparejadas por handle: ${r.emparejadas}. Error máximo de lo aplanado: ${r.errorMaximo.toExponential(2)} (tolerancia ${r.tolerancia.toExponential(2)}), en ${r.donde || "—"}.`);
l.push(`Bloques regenerados por AutoCAD: ${r.regenerados.join(", ") || "ninguno"}. Anónimos huérfanos (sólo en el DWG, sin uso): ${r.huerfanos.join(", ") || "ninguno"}.`);
l.push(`Dibujo: ${a.lineas.length / 4} segmentos, ${a.curvas.length / 4} cuerdas, ${a.puntos.length / 2} puntos para enganchar, ${a.textos.length} textos; no leído: ${JSON.stringify(a.ignoradas)}.`);
l.push("");
l.push(r.fallos.length === 0 ? "Pasa: el DWG dibuja lo mismo que su DXF." : `NO PASA (${r.fallos.length}):\n  ${r.fallos.join("\n  ")}`);
const texto = `${l.join("\n")}\n`;
writeFileSync(join(import.meta.dirname, "out_vivienda.txt"), texto);
console.log(texto);
if (r.fallos.length > 0) process.exitCode = 1;
