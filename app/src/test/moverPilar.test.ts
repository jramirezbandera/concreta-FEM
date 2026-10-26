/**
 * Las cotas de un pilar elegido en la app (CT3, `docs/fem3d/cotas.md` §2.3), con el controlador de
 * dibujo y sin las vistas: con Elegir y un solo pilar elegido, un clic en el número de una de sus
 * cotas (o Tab) la elige y abre el campo con su valor; Intro mueve el pilar con las vigas que acaban
 * en su punto fijo, en todas sus plantas, y Ctrl+Intro lo mueve solo.
 */
import { describe, expect, it } from "vitest";
import { VERSION_ESQUEMA, type Proyecto } from "../../../src/agente/proyecto.ts";
import type { ModeloFisico, Vec2 } from "../../../src/compilador/fisico.ts";
import { aplicar } from "../../../src/editor/operaciones.ts";
import { ControladorDibujo } from "../dibujo/controlador.ts";

/** 2 × 1 vanos (6 y 5,4 por 5) en dos plantas, con vigas de pilar a pilar y los ejes guardados. */
function modelo(): ModeloFisico {
  const xs = [0, 6, 11.4];
  const ys = [0, 5];
  return {
    plantas: [{ id: "N2", altura: null }, { id: "N1", altura: 3 }, { id: "C", tipo: "sotano", altura: 3 }],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
      { id: "v30", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares: xs.flatMap((x, i) => ys.map((y, j) => ({ id: `P${i}${j}`, x, y, desde: "C", hasta: "N2", seccion: "p40" }))),
    vigas: ["N2", "N1"].flatMap((p) => [
      { id: `VB1-${p}`, planta: p, puntos: [[0, 5], [6, 5]] as Vec2[], seccion: "v30" },
      { id: `VB2-${p}`, planta: p, puntos: [[6, 5], [11.4, 5]] as Vec2[], seccion: "v30" },
      { id: `V1-${p}`, planta: p, puntos: [[6, 0], [6, 5]] as Vec2[], seccion: "v30" },
    ]),
    losas: ["N2", "N1"].map((p) => ({ id: `L-${p}`, planta: p, contorno: [[0, 0], [11.4, 0], [11.4, 5], [0, 5]] as Vec2[], espesor: 0.25, material: "HA" })),
    casos: [{ id: "G", pesoPropio: true }],
    ejes: [...xs.map((x, i) => ({ id: String(i + 1), desde: [x, -2] as Vec2, hasta: [x, 7] as Vec2 })), ...ys.map((y, j) => ({ id: "AB"[j]!, desde: [-2, y] as Vec2, hasta: [13.4, y] as Vec2 }))],
  };
}

/** 50 px/m: el radio de enganche (10 px) es 0,2 m. */
const RADIO = 0.2;

function preparar() {
  let p: Proyecto = { esquema: VERSION_ESQUEMA, modelo: modelo() };
  const ctrl = new ControladorDibujo();
  const hechos: string[] = [];
  ctrl.aplicar = (h) => {
    const a = aplicar(p, h.operacion);
    if (!a.ok) return a.errores.map((x) => x.mensaje).join(" ");
    p = a.proyecto;
    hechos.push(h.etiqueta);
    ctrl.ponerModelo(p.modelo);
    return null;
  };
  ctrl.ponerModelo(p.modelo);
  const vista = ctrl.adaptador("N1", { cotas: true });
  const clic = (q: Vec2) => {
    vista.pasar(q, RADIO, false, [100, 100]);
    return vista.clic(q, RADIO, false, false);
  };
  return { ctrl, vista, clic, hechos, proyecto: () => p };
}

describe("mover un pilar desde sus cotas (CT3)", () => {
  it("clic en el número de la cota, el valor e Intro: el pilar y sus vigas, en un paso", () => {
    const { ctrl, vista, clic, hechos, proyecto } = preparar();
    // Sin nada elegido, no hay cotas del pilar: el clic es de la vista
    expect(clic([3, 5])).toBe(false);
    ctrl.ponerElegidos(["P11"]);
    expect(ctrl.instantanea().pilar).toBe("P11: un clic en el número de una cota (o Tab) para moverlo.");
    // La cota de la izquierda (al eje 1) tiene su número a media cota, en (3; 5)
    vista.pasar([3, 5], RADIO, false, [0, 0]);
    expect(vista.cursor()!.texto).toBe("Cota izquierda, desde eje 1: 6,00 m · clic para cambiarla");
    expect(clic([3, 5])).toBe(true);
    expect(ctrl.instantanea().campo).toMatchObject({ texto: "6,00", seleccionar: true, cota: "izquierda, desde eje 1 · P11" });
    expect(ctrl.teclear("6,4")).toBe(true);
    expect(hechos).toEqual(["Mover P11 a 6,40 m de eje 1"]);
    const m = proyecto().modelo;
    expect(m.pilares!.find((x) => x.id === "P11")).toMatchObject({ x: 6.4, y: 5 });
    for (const pl of ["N1", "N2"]) {
      expect(m.vigas!.find((x) => x.id === `VB1-${pl}`)!.puntos).toEqual([[0, 5], [6.4, 5]]);
      expect(m.vigas!.find((x) => x.id === `V1-${pl}`)!.puntos).toEqual([[6, 0], [6.4, 5]]);
    }
    expect(ctrl.instantanea()).toMatchObject({ campo: null, hecho: "Mover P11 a 6,40 m de eje 1", aviso: null });
  });

  it("Tab elige la cota; Ctrl+Intro lo mueve solo y avisa de las vigas que se quedan", () => {
    const { ctrl, vista, hechos, proyecto } = preparar();
    ctrl.ponerElegidos(["P11"]);
    vista.pasar([8, 2], RADIO, false, [0, 0]);
    expect(ctrl.tab()).toBe(true);
    expect(ctrl.tab()).toBe(true);
    // izquierda, derecha: la segunda es la del eje 3
    expect(ctrl.instantanea().pilar).toMatch(/^P11, cota derecha, desde eje 3 \(5,40 m\)/);
    ctrl.abrirCampo("5");
    expect(ctrl.instantanea().campo).toMatchObject({ texto: "5", cota: "derecha, desde eje 3 · P11" });
    expect(ctrl.teclear("-1")).toBe(false);
    expect(ctrl.instantanea().campo!.error).toMatch(/Escriba la distancia a eje 3/);
    expect(ctrl.teclear("5", true)).toBe(true);
    expect(hechos).toEqual(["Mover P11 a 5,00 m de eje 3, sin sus vigas"]);
    expect(proyecto().modelo.pilares!.find((x) => x.id === "P11")!.x).toBe(6.4);
    expect(proyecto().modelo.vigas).toEqual(modelo().vigas);
    expect(ctrl.instantanea().aviso).toMatch(/^Las vigas V1-N2, VB1-N2, VB2-N2, V1-N1, VB1-N1, VB2-N1 acaban en P11 y se quedan/);
  });

  it("Esc deja la cota; con dos elegidos o con otra herramienta no hay cotas del pilar", () => {
    const { ctrl, clic, hechos } = preparar();
    ctrl.ponerElegidos(["P11"]);
    clic([3, 5]);
    ctrl.escCampo();
    expect(ctrl.instantanea()).toMatchObject({ campo: null, pilar: "P11: un clic en el número de una cota (o Tab) para moverlo." });
    ctrl.ponerElegidos(["P11", "P10"]);
    expect(ctrl.instantanea().pilar).toBeNull();
    expect(clic([3, 5])).toBe(false);
    ctrl.ponerElegidos(["P11"]);
    ctrl.ponerHerramienta("viga");
    expect(ctrl.instantanea().pilar).toBeNull();
    expect(hechos).toEqual([]);
  });
});
