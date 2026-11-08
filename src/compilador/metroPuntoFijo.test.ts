/**
 * PB-8 (`docs/fem3d/pilares-borde.md` §11): el metro de la franja en la cara de un pilar de esquina con
 * un punto fijo. El 2 × 2 de PB (`validacion/pb/modelos.ts`) con P0-0 de 40 × 40 y su esquina fija en
 * el cruce de los ejes de las vigas de borde (como P1 en la F1 del ejemplo 11 con punto fijo): el
 * pilar asoma 25 cm dentro de la esquina del paño, sin cara de franja en ninguna dirección (lo cruzan
 * las vigas). Con h = 0,75, la recta de su cara no sigue la malla y el metro va por el escalón desde la
 * cara de la viga, con lo que transmite su enlace. El eje del pilar (el maestro del enlace) queda más
 * allá de esa recta, y el corte sumaba el enlace sobre casi todos sus nudos: casi cero. El metro salía
 * un 43 % bajo con 0,75 y un 53 % con 0,6 (en el ejemplo 11, un 90 %), sin aviso. Ahora del enlace
 * cuentan sus esclavos (`soloEsclavos` del corte).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { recuadros } from "../../validacion/pb/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "./fisico.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function modelo(): ModeloFisico {
  const m = recuadros(2, 2) as unknown as { secciones: unknown[]; pilares: { id: string; seccion: string; fijo?: string }[] };
  m.secciones.push({ id: "P40", material: "HA-25", forma: "rectangular", b: 0.4, h: 0.4 });
  const p = m.pilares.find((x) => x.id === "P0-0")!;
  p.seccion = "P40";
  p.fijo = "esquina-inferior-izquierda";
  return m as unknown as ModeloFisico;
}

/** mx medio del caso Q en la estación de cara de P0-0 (x o y = 0,4) de la franja, y su método. */
function metro(op: OpcionesCompilacion, franja: string): { mx: number; metodo: string } {
  const f = modelo();
  const c = compilar(f, op);
  if (!c.valido) throw new Error(c.diagnosticos[0]!.mensaje);
  const k = calcular(c.modelo);
  if (!k.valido) throw new Error(k.diagnosticos[0]!.mensaje);
  const q = new Consultas(f, c, k.casos, op);
  const r = q.franja(franja);
  if (!r.valido) throw new Error(franja);
  const e = r.valor.estaciones.find((x) => x.tipo === "cara" && x.piezas.includes("P0-0") && Math.abs(x.s - 0.4) < 1e-9);
  if (!e?.valido) throw new Error(`sin estación de cara de P0-0 en ${franja}`);
  const iq = f.casos!.findIndex((x) => x.id === "Q");
  return { mx: e.medios[3 * iq]!, metodo: e.metodo };
}

describe("el metro de un pilar de esquina con la esquina fija (PB-8)", () => {
  for (const franja of ["L-N1:X1", "L-N1:Y1"])
    it(`${franja}: con h = 0,75 y 0,6, a menos del 20 % del de h = 0,125`, () => {
      const fina = metro({ tamanoMalla: 0.125 }, franja).mx;
      expect(fina).toBeLessThan(-5);
      for (const h of [0.75, 0.6]) {
        const { mx, metodo } = metro({ tamanoMalla: h }, franja);
        expect(metodo).toBe("fuerzas-nodales");
        expect(Math.abs(mx / fina - 1)).toBeLessThan(0.2);
      }
    });
});
