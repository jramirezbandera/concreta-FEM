/**
 * Criterio 1 de C1: SAP2000 1-022 (ETABS ej. 7, pórtico plano de 7 plantas con diafragma)
 * descrito como modelo físico (plantas con sus alturas, pilares con su sección por tramo, una viga
 * por planta que atraviesa el pilar central y cargas puntuales) da los valores publicados del caso
 * LAT, y el mismo resultado que el modelo analítico hecho a mano de E6 (`validacion/e6/csi.ts`).
 */
import { describe, expect, it } from "vitest";
import { fisico1022 } from "../../validacion/c1/modelos.ts";
import { dentroDelRedondeo, IN, KIP, sap1022, type Publicado } from "../../validacion/e6/csi.ts";
import { calcular } from "../motor/calcular.ts";
import { compararModelos } from "../pruebas/compilador.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { compilar } from "./compilar.ts";

describe("criterio 1 de C1: SAP2000 1-022 como modelo físico", () => {
  const r = compilar(fisico1022());
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  const { modelo, mapeo } = r;

  it("compila sin avisos: 24 nudos, 35 barras (la viga se parte en el pilar central) y 7 diafragmas", () => {
    expect(r.diagnosticos).toEqual([]);
    expect(modelo.barras!.length).toBe(35);
    expect(modelo.restricciones!.length).toBe(7);
    expect(modelo.nudos.length).toBe(24 + 7);
  });

  it("da los valores publicados del caso LAT dentro de su redondeo", () => {
    const [lat] = casosValidos(calcular(modelo, { solver: "perfil" }));
    const n22 = mapeo.nudosPilar["izquierda@N7"]!;
    const b1 = mapeo.piezas.izquierda![0]!;
    const fuente = "SAP2000 1-022, p. 6";
    const publicados: Publicado[] = [
      { nombre: "Ux nudo 22 (in)", valor: 1.45076, decimales: 5, motor: lat!.u[6 * n22]! / IN, fuente },
      { nombre: "axil pilar 1 (kip)", valor: 69.99, decimales: 2, motor: lat!.esfuerzosBarras[12 * b1]! / KIP, fuente },
      { nombre: "momento pilar 1 en el nudo 1 (k·in)", valor: 2324.68, decimales: 2, motor: lat!.esfuerzosBarras[12 * b1 + 4]! / (KIP * IN), fuente },
    ];
    for (const p of publicados) expect(dentroDelRedondeo(p), `${p.nombre}: ${p.motor} frente a ${p.valor}`).toBe(true);
  });

  it("coincide con el modelo hecho a mano de E6 a ≤ 1e-10", () => {
    const c = compararModelos(modelo, sap1022().modelo);
    expect(c.nBarras).toBe(35);
    expect(c.u, c.porCaso.join("; ")).toBeLessThan(1e-10);
    expect(c.barras, c.porCaso.join("; ")).toBeLessThan(1e-10);
  });
});
