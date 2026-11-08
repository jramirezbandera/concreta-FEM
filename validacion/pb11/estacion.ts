/**
 * PB-11 (`docs/fem3d/pilares-borde.md` §12): el metro de la franja en las caras de los pilares de esquina
 * del 2 × 2 de la fase PB con pilares de 30 × 50 (el lado largo según X, a lo largo de la viga de borde
 * según X), por el camino de siempre (`caraDirecta`: la recta de la cara si sigue la malla; si no, el
 * escalón) y forzando el escalón (`caraDirecta: false`), con mx, my y mxy del caso Q y Wood–Armer superior.
 *
 *   bun validacion/pb11/estacion.ts <h>[/<eps>] [pilar] [interiores]
 */
import { prepararNucleo } from "../a3/revisar.ts";
import { recuadros } from "../pb/modelos.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { EsfuerzosFranjas } from "../../src/compilador/esfuerzosFranjas.ts";
import { resolverOpciones, type OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { validar } from "../../src/compilador/validar.ts";
import { woodArmer } from "../../src/dimensionado/woodArmer.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes } from "../../src/motor/cortes.ts";
import { Diagnosticos } from "../../src/motor/diagnosticos.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";

await prepararNucleo();
const [hA, pA, intA] = process.argv.slice(2);
const [th, te] = hA!.split("/");
const fisico = recuadros(2, 2, { pilar: JSON.parse(pA ?? "[0.3,0.5]"), interiores: intA === "interiores" });
const op: OpcionesCompilacion = { tamanoMalla: Number(th), ...(te ? { epsSnap: Number(te) } : {}) };
const r = compilar(fisico, op);
if (!r.valido) throw new Error(JSON.stringify(r.diagnosticos.filter((d) => d.severidad === "error")));
const casos = casosValidos(calcular(r.modelo));
const ctx = validar(fisico, resolverOpciones(op), new Diagnosticos())!;
const cortes = new Cortes(r.modelo);
const variantes = { defecto: new EsfuerzosFranjas(ctx, r, casos, { cortes }), escalon: new EsfuerzosFranjas(ctx, r, casos, { cortes, caraDirecta: false }) };
const ESQUINAS = new Set(["P0-0", "P2-0", "P0-2", "P2-2"]);
const filas = new Map<string, string[]>();
for (const [nombre, ef] of Object.entries(variantes))
  for (const fr of ef.franjas()) {
    for (const e of ef.estaciones(fr.id)!.estaciones) {
      if (e.tipo !== "cara" || !e.piezas.some((p) => ESQUINAS.has(p)) || !e.valido) continue;
      const k = `${fr.id} s=${e.s.toFixed(3)} ${e.lado} ${e.piezas.join(",")}`;
      const [mx, my, mxy] = [e.medios[3]!, e.medios[4]!, e.medios[5]!];
      const wa = woodArmer(mx, my, mxy);
      const f = filas.get(k) ?? [];
      f.push(`${nombre}: mx ${mx.toFixed(2)} my ${my.toFixed(2)} mxy ${mxy.toFixed(2)} WAsup ${wa.superiorX.toFixed(2)}`);
      filas.set(k, f);
    }
  }
for (const [k, f] of [...filas].sort()) console.log(`${hA} ${k} | ${f.join(" | ")}`);
