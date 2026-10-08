#!/usr/bin/env bun
/**
 * CLI `fem` de Concreta FEM 3D (A0). Uso: `bun cli/fem.ts <orden> …` o `bun run fem <orden> …`;
 * la ayuda, con `fem ayuda`. Escribe un único objeto JSON por la salida estándar y sale con el
 * código de `cli/ordenes.ts`.
 */
import { cifrasDe, CODIGO, ejecutar, textoSalida } from "./ordenes.ts";

const argv = process.argv.slice(2);
let codigo: number = CODIGO.interno;
try {
  const s = await ejecutar(argv);
  process.stdout.write(`${textoSalida(s.json, cifrasDe(argv))}\n`);
  codigo = s.codigo;
} catch (e) {
  const mensaje = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  process.stdout.write(`${JSON.stringify({ orden: argv[0] ?? "", ok: false, diagnosticos: [{ codigo: "cli/error-interno", severidad: "error", mensaje: `Error interno de fem: ${mensaje}. Es un fallo del programa, no del proyecto.` }] })}\n`);
  if (e instanceof Error && e.stack) process.stderr.write(`${e.stack}\n`);
}
process.exitCode = codigo;
