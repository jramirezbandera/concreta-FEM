/**
 * Fase CO2, criterio 11 (`docs/fem3d/comprobaciones.md` §7): el módulo de vigas frente a cuentas que
 * no son de Concreta (`validacion/co/oraculo_viga.py`: el integrador de la sección en Python para el
 * momento resistente, y las fórmulas del Código Estructural escritas aparte para el cortante con
 * cercos y la abertura de fisura).
 *
 * El JSON congelado lo escribe ese script; aquí no hace falta Python. Las tolerancias cubren lo que
 * el módulo redondea y el oráculo no: las áreas de barra tabuladas a la décima de mm², fcd (16,7 con
 * fck = 25), y Ecm y fctm de la tabla.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { armadoViga } from "./armado.ts";
import { entradaModuloViga } from "./comprobar/vigas.ts";
import { calcRCBeam } from "./concreta/lib/calculations/rcBeams.ts";

interface Caso {
  id: string;
  b: number;
  h: number;
  fck: number;
  fyk: number;
  recubrimiento: number;
  cercos: [number, number, number];
  inferior: [number, number];
  superior: [number, number];
  Ms: [number, number];
  /** Con el acero traccionado limitado al 10 ‰ (el pivote A del módulo) y sin límite. */
  MRdPositivo: number;
  MRdNegativo: number;
  MRdPositivoSinLimite: number;
  MRdNegativoSinLimite: number;
  cortantePositivo: { VRds: number; VRdmax: number };
  cortanteNegativo: { VRds: number; VRdmax: number };
  fisuraPositivo: { wk: number };
  fisuraNegativo: { wk: number };
}

const { casos } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "validacion", "co", "oraculo-viga.json"), "utf8")) as { casos: Caso[] };

const cerca = (a: number, b: number, tol: number, que: string) => expect(Math.abs(a - b) / Math.abs(b), `${que}: ${a} frente a ${b}`).toBeLessThanOrEqual(tol);

describe("CO2: el módulo de vigas frente al oráculo independiente", () => {
  for (const c of casos) {
    it(c.id, () => {
      const a = armadoViga(
        { inferior: { n: c.inferior[0], diametro: c.inferior[1] }, superior: { n: c.superior[0], diametro: c.superior[1] }, cercos: { diametro: c.cercos[0], separacion: c.cercos[1], ramas: c.cercos[2] } },
        { fyk: c.fyk, recubrimiento: c.recubrimiento },
      );
      const r = calcRCBeam(entradaModuloViga({ b: c.b, h: c.h, fck: c.fck }, a, "centro", { positivo: 1, negativo: 1, cortante: 1, cpPositivo: c.Ms[0], cpNegativo: c.Ms[1] }));
      expect(r.valid && r.vano.valid && r.apoyo.valid).toBe(true);
      // Flexión: el integrador de la sección con el mismo límite del acero, a menos del 1 %
      cerca(r.vano.MRd, c.MRdPositivo, 0.01, "MRd+");
      cerca(r.apoyo.MRd, c.MRdNegativo, 0.01, "MRd−");
      // Sin ese límite (la otra rama que admite el CE), la sección resiste lo mismo o hasta un 4 % más:
      // el módulo queda del lado seguro (CO2-1)
      for (const [m, o] of [[r.vano.MRd, c.MRdPositivoSinLimite], [r.apoyo.MRd, c.MRdNegativoSinLimite]] as const) {
        // (hasta un 1 % por encima, lo de la comparación de arriba: el oráculo descuenta el hormigón que desplazan las barras comprimidas)
        expect(m / o).toBeLessThanOrEqual(1.01);
        expect(m / o).toBeGreaterThanOrEqual(0.96);
      }
      // Cortante con cercos: las fórmulas del CE (lo que redondea fcd y el área del cerco)
      cerca(r.vano.VRds, c.cortantePositivo.VRds, 0.003, "VRd,s (tracción abajo)");
      cerca(r.vano.VRdmax, c.cortantePositivo.VRdmax, 0.003, "VRd,máx (tracción abajo)");
      cerca(r.apoyo.VRds, c.cortanteNegativo.VRds, 0.003, "VRd,s (tracción arriba)");
      cerca(r.apoyo.VRdmax, c.cortanteNegativo.VRdmax, 0.003, "VRd,máx (tracción arriba)");
      // Fisuración: Ecm y fctm tabulados frente a los de su fórmula
      cerca(r.vano.wk, c.fisuraPositivo.wk, 0.015, "wk (cara inferior)");
      cerca(r.apoyo.wk, c.fisuraNegativo.wk, 0.015, "wk (cara superior)");
    });
  }
});
