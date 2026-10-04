/**
 * Criterio 1 de C1: SAP2000 1-022 (ETABS ej. 7, pórtico plano de 7 plantas con diafragma)
 * descrito como modelo físico (plantas con sus alturas, pilares con su sección por tramo, una viga
 * por planta que atraviesa el pilar central y cargas puntuales) da los valores publicados del caso
 * LAT, y el mismo resultado que el modelo analítico hecho a mano de E6 (`validacion/e6/csi.ts`).
 */
import { describe, expect, it } from "vitest";
import { dentroDelRedondeo, IN, KIP, sap1022, type Publicado } from "../../validacion/e6/csi.ts";
import { calcular } from "../motor/calcular.ts";
import { compararModelos } from "../pruebas/compilador.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { compilar } from "./compilar.ts";
import type { ModeloFisico, Seccion } from "./fisico.ts";

const KSI = KIP / IN ** 2;

/** Perfiles W del PDF (p. 3): A en in² e I en in⁴. Fuera del plano: Iz = I/3 y J = 10 in⁴, como en E6. */
const W: Record<string, { A: number; I: number }> = {
  W14X176: { A: 51.7, I: 2150 },
  W14X211: { A: 62.1, I: 2670 },
  W14X246: { A: 72.3, I: 3230 },
  W14X287: { A: 84.4, I: 3910 },
  W24X110: { A: 2.5, I: 3330 },
  W24X130: { A: 38.3, I: 4020 },
  W24X160: { A: 47.1, I: 5120 },
};

export function fisico1022(): ModeloFisico {
  const niveles = ["N7", "N6", "N5", "N4", "N3", "N2", "N1", "B"];
  // Alturas de forjado a forjado hasta el de encima: 13'6" las dos primeras plantas y 13' las demás
  const alturas: (number | null)[] = [null, 156, 156, 156, 156, 156, 162, 162];
  const extremos = ["W14X246", "W14X246", "W14X246", "W14X211", "W14X211", "W14X176", "W14X176"];
  const centro = ["W14X287", "W14X287", "W14X287", "W14X246", "W14X246", "W14X211", "W14X211"];
  const vigas = ["W24X160", "W24X160", "W24X130", "W24X130", "W24X110", "W24X110", "W24X110"];
  const secciones: Seccion[] = Object.entries(W).map(([id, { A, I }]) => ({
    id,
    material: "acero",
    forma: "general",
    A: A * IN ** 2,
    Iy: I * IN ** 4,
    Iz: (I / 3) * IN ** 4,
    J: 10 * IN ** 4,
  }));
  // Tramo k (de abajo arriba, 0…6): cabeza en el nivel N(k+1)
  const tramos = (lista: string[]) => lista.map((s, k) => ({ planta: `N${k + 1}`, seccion: s }));
  const pilar = (id: string, x: number, lista: string[]) => ({ id, x: x * IN, y: 0, desde: "B", hasta: "N7", seccion: lista[0]!, tramos: tramos(lista) });
  const lat = [2.5, 5, 7.5, 10, 12.5, 15, 20];
  return {
    plantas: niveles.map((id, i) => ({ id, altura: alturas[i] === null ? null : alturas[i]! * IN })),
    materiales: [{ id: "acero", tipo: "general", E: 29500 * KSI, G: (29500 * KSI) / 2.6, peso: 0 }],
    secciones,
    pilares: [pilar("izquierda", 0, extremos), pilar("centro", 360, centro), pilar("derecha", 720, extremos)],
    vigas: vigas.map((s, k) => ({ id: `V${k + 1}`, planta: `N${k + 1}`, puntos: [[0, 0], [720 * IN, 0]], seccion: s })),
    casos: [{ id: "LAT" }],
    cargas: lat.map((f, k) => ({ tipo: "puntual", id: `F${k + 1}`, caso: "LAT", planta: `N${k + 1}`, x: 0, y: 0, F: [f * KIP, 0, 0] })),
  };
}

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
