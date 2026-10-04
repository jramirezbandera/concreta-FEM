/**
 * Efecto de las decisiones por defecto pendientes (C1-a y D4) sobre las barras del edificio
 * objetivo de `banco.ts` (7 plantas, 80 pilares), con el núcleo:
 * - factor de zona rígida 0, 0,5 y 1;
 * - D4: axil de pilares ×2, torsión de vigas ×0,1 y los dos a la vez (con factor 1).
 * Mide la deriva de cabeza en Vx, los momentos de una viga interior (X5-N3: cara del pilar en
 * x = 5,8 y vano en x = 3) y de una secundaria que acomete en T a la viga de borde (S0-0-N3:
 * arranque y vano) con G, la torsión máxima de las vigas con G y el axil de un pilar interior y
 * de esquina en la base.
 *
 *   bun validacion/c1/decisiones.ts > validacion/c1/out_decisiones.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { EsfuerzosPiezas } from "../../src/compilador/resultados.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { edificioObjetivo } from "./banco.ts";

await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const f = edificioObjetivo();
const [G, Vx] = [0, 2];

function medir(nombre: string, op: OpcionesCompilacion) {
  const r = valido(compilar(f, op));
  const casos = casosValidos(calcular(r.modelo));
  const e = new EsfuerzosPiezas(r.modelo, r.mapeo, casos);
  const deriva = casos[Vx]!.u[6 * r.mapeo.nudosPilar["P0-0@N7"]!]! * 1000;
  let T = 0;
  r.mapeo.barras.forEach((b, k) => {
    if (b.tipo === "viga") for (const i of [3, 9]) T = Math.max(T, Math.abs(casos[G]!.esfuerzosBarras[12 * k + i]!));
  });
  const M = (pieza: string, s: number, lado: -1 | 1) => e.en(pieza, G, s, lado)![4]!.toFixed(1);
  const N = (pieza: string) => e.en(pieza, G, 0.1)![0]!.toFixed(0);
  console.log(
    `${nombre.padEnd(30)} deriva Vx ${deriva.toFixed(2)} mm | X5-N3: cara ${M("X5-N3", 5.8, -1)}, vano ${M("X5-N3", 3, 1)} | S0-0-N3: arranque ${M("S0-0-N3", 0.15, 1)}, vano ${M("S0-0-N3", 2.5, 1)} | T máx ${T.toFixed(1)} | N int/esq ${N("P24-20")}/${N("P0-0")}`,
  );
}

console.log("Momentos en kN·m, axiles en kN (G); deriva de la esquina en cubierta con Vx (3 kN/m en la fachada x = 0)");
for (const z of [0, 0.5, 1]) medir(`zona rígida ${z}`, { factorZonaRigida: z });
medir("D4: axil de pilares ×2", { modificadores: { pilares: { A: 2 } } });
medir("D4: torsión de vigas ×0,1", { modificadores: { vigas: { J: 0.1 } } });
medir("D4: los dos", { modificadores: { pilares: { A: 2 }, vigas: { J: 0.1 } } });
