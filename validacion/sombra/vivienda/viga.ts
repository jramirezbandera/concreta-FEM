/**
 * Prueba en sombra de la vivienda (fase LV): el diagrama de una viga de la réplica en 1,35·PP +
 * 1,35·CM + 1,5·Q, para compararlo con la captura de CYPE (CY-10: la P22–P23, Z-CUB-1, da −5,45 /
 * +7,40 / −4,96 kN·m y 20,8 kN en las caras, envolvente persistente).
 *
 *   bun validacion/sombra/vivienda/viga.ts <carpeta de la variante> [<viga>]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../../src/compilador/compilar.ts";
import { Consultas } from "../../../src/compilador/consultas.ts";
import { calcular } from "../../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { casosValidos } from "../../../src/pruebas/comparar.ts";
import { valido } from "../../../src/pruebas/metamorficasFisicas.ts";

const RAIZ = join(import.meta.dirname, "..", "..", "..");
await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
const dir = process.argv[2]!;
const id = process.argv[3] ?? "Z-CUB-1";
const p = JSON.parse(readFileSync(join(dir, "proyecto.json"), "utf8"));
const r = valido(compilar(p.modelo, p.opciones ?? {}));
const casos = casosValidos(calcular(r.modelo));
const c = new Consultas(p.modelo, r, casos, p.opciones ?? {});
const F = [1.35, 1.35, 1.5]; // PP, CM, Q
const dg = c.diagrama(id, F);
if (!dg.valido) throw new Error(JSON.stringify(dg.diagnosticos));
const est = dg.valor;
const L = est[est.length - 1]!.s;
const en = (s: number) => {
  for (let i = 0; i + 1 < est.length; i++) {
    const [a, b] = [est[i]!, est[i + 1]!];
    if (s >= a.s - 1e-9 && s <= b.s + 1e-9 && b.s > a.s) {
      const w = (s - a.s) / (b.s - a.s);
      return a.derecha.map((v, k) => v * (1 - w) + b.derecha[k]! * w);
    }
  }
  return est[est.length - 1]!.izquierda;
};
const max = Math.max(...est.map((x) => Math.max(x.izquierda[4]!, x.derecha[4]!)));
const [ci, cf] = [en(0.15), en(L - 0.15)];
console.log(`${id} (${dir.split(/[\\/]/).pop()}): L = ${L.toFixed(2)} m; M en las caras ${ci[4]!.toFixed(2)} / ${cf[4]!.toFixed(2)} kN·m, M máximo ${max.toFixed(2)} kN·m; V en las caras ${ci[2]!.toFixed(1)} / ${cf[2]!.toFixed(1)} kN`);
