/**
 * El desbordamiento de pila de Resultados · Diagramas: cuántos argumentos recibía `Math.max(0, ...)`
 * con los puntos de las envolventes de todas las piezas de una planta, y si se desborda con ellos.
 *
 *   node --experimental-strip-types validacion/diag/pila.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../../src/compilador/huella.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { envolventePieza } from "../../src/agente/render/resultados.ts";
import { Sesion } from "../../src/visor/sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(WASM);
const a = Sesion.abrir(readFileSync(join(RAIZ, "ejemplos", "app", "edificio.json"), "utf8"), sha256(new Uint8Array(WASM)));
if (!a.valido) throw new Error("no abre");
const s = a.sesion;
if (!(await s.calcular({})).ok) throw new Error("no calcula");
const conj = s.conjunto({ tipo: "defecto" }, "esfuerzos");
if (!conj.valido) throw new Error("sin combinaciones");
const f = s.proyecto.modelo;
for (const planta of [f.plantas[0]!.id]) {
  const vigas = f.vigas!.filter((v) => v.planta === planta).map((v) => v.id);
  const valores = vigas.flatMap((id) => envolventePieza(s.rr!, id, conj.valor, 4).map((e) => Math.max(Math.abs(e.max), Math.abs(e.min))));
  let desborda = false;
  try {
    Math.max(0, ...valores);
  } catch {
    desborda = true;
  }
  console.log(`${planta}: ${vigas.length} vigas, ${valores.length} puntos de envolvente como argumentos de Math.max: ${desborda ? "se desborda la pila" : "no se desborda en este hilo"}`);
}
