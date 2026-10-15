/**
 * Prueba en sombra de la vivienda (CY4): nuestros resultados de la réplica (`replica.py`) donde los
 * da CYPE. Los campos de las losas (uz, m11, m22, m12, v13, v23) por caso (PP, CM y Q) en cada nudo
 * del listado, interpolados como los mapas (`valorEnPunto`), y las reacciones de los pilares por
 * caso (`fem consultar reacciones`). Escribe `nuestro.json` junto al proyecto.
 *
 *   bun validacion/sombra/vivienda/muestrear.ts [<carpeta de la variante>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ejecutar } from "../../../cli/ordenes.ts";
import { sha256 } from "../../../src/compilador/huella.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { valorEnPunto } from "../../../src/visor/datos.ts";
import { Sesion } from "../../../src/visor/sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..", "..");
const dir = process.argv[2] ?? join(import.meta.dirname, ".datos", "defecto");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
await iniciarNucleo(WASM);

const proyecto = join(dir, "proyecto.json");
const rc = await ejecutar(["consultar", proyecto, "reacciones", "--todos", "--exacto"]);
if (rc.codigo !== 0) throw new Error(JSON.stringify(rc.json));
const objetos = (rc.json as { valor: { objetos: { id: string; R: number[][] }[] } }).valor.objetos;
const reacciones = Object.fromEntries(objetos.map((o) => [o.id, o.R]));

const a = Sesion.abrir(readFileSync(proyecto, "utf8"), sha256(new Uint8Array(WASM)));
if (!a.valido) throw new Error(JSON.stringify(a.diagnosticos));
const s = a.sesion;
const c = await s.calcular();
if (!c.ok) throw new Error(JSON.stringify(c.diagnosticos));
const cype = JSON.parse(readFileSync(join(import.meta.dirname, ".datos", "cype.json"), "utf8")) as { esfuerzos: { planta: string; x: number; y: number }[] };
const PL: Record<string, string> = { "Planta 1": "CUB", Cubierta: "CUB-S" };
const CAMPOS = ["uz", "m11", "m22", "m12", "v13", "v23"] as const;
const nudos = cype.esfuerzos.map((n) => ({
  planta: n.planta,
  x: n.x,
  y: n.y,
  v: Object.fromEntries(
    CAMPOS.map((campo) => [
      campo,
      Object.fromEntries(
        ["PP", "CM", "Q"].map((caso) => {
          const r = valorEnPunto(s, PL[n.planta]!, campo, { tipo: "caso", caso }, n.x, n.y);
          return [caso, r.valido && r.valor ? r.valor.valor : null];
        }),
      ),
    ]),
  ),
}));
writeFileSync(join(dir, "nuestro.json"), JSON.stringify({ reacciones, nudos }));
console.log(`${nudos.length} nudos (${nudos.filter((n) => n.v.m11!.PP === null).length} fuera de nuestras losas), ${objetos.length} apoyos; escrito ${join(dir, "nuestro.json")}`);
