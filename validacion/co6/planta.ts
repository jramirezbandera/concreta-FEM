/**
 * CO6: la planta con el armado dibujado de un proyecto, a PNG (para mirarla sin la app).
 *
 *   bun validacion/co6/planta.ts <proyecto.json> <planta> [pilares|vigas|losas|punzonamiento] [salida.png] [--sin-reticula]
 *
 * Abre el proyecto en el atendedor del worker, lo calcula, propone el armado que falta y saca la
 * escena de la vista `comprobacion` con `dibujo: "armado"` por el SVG de A4.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { svgAPng } from "../../cli/png.ts";
import type { Escena } from "../../src/agente/render/escena.ts";
import { escenaASvg } from "../../src/agente/render/svg.ts";
import { sha256 } from "../../src/compilador/huella.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { Atendedor } from "../../src/visor/atender.ts";
import { TIPOS_COMPROBACION, type DatosArmar, type TipoComprobacion } from "../../src/visor/comprobaciones.ts";
import type { Pedido } from "../../src/visor/protocolo.ts";

const [fichero, planta, de = "losas", salida = "planta.png"] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
if (!fichero || !planta) throw new Error("uso: bun validacion/co6/planta.ts <proyecto.json> <planta> [tipo] [salida.png] [--sin-reticula]");
const wasm = readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(wasm);
const at = new Atendedor(sha256(new Uint8Array(wasm)));
const pedir = async <T>(p: Pedido): Promise<T> => {
  const r = await at.atender(p);
  if (!r.ok) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return r.valor as T;
};
const texto = readFileSync(fichero, "utf8");
await pedir({ tipo: "abrir", texto });
await pedir({ tipo: "calcular" });
const escrito = (JSON.parse(texto) as { armado?: object }).armado;
const armado = (await pedir<DatosArmar>({ tipo: "armar", tipos: TIPOS_COMPROBACION, ...(escrito ? { armado: escrito } : {}) } as Pedido)).armado;
const sesion = (at as unknown as { sesion: { escenaA4: (p: string, v: unknown) => { valido: true; valor: Escena } } }).sesion;
const e = sesion.escenaA4(planta, { vista: "comprobacion", de: de as TipoComprobacion, armado, dibujo: "armado", ...(process.argv.includes("--sin-reticula") ? { reticula: false } : {}) }).valor;
writeFileSync(salida, await svgAPng(escenaASvg(e).svg));
console.log(`${salida}: ${e.primitivas.length} primitivas`);
