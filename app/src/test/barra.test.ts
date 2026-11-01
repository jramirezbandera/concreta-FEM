/**
 * La herramienta Barra en la app (BN3, `docs/fem3d/barras.md` §6), con el controlador de dibujo y sin
 * las vistas (jsdom no tiene WebGL; lo de las vistas lo prueba `validacion/bn3/chrome.ts`): el alzado
 * dibuja sólo con Barra; un clic en el nudo de un pilar o en una línea de nivel es un extremo; lo
 * tecleado en un alzado es «u; z»; el primer extremo sigue al pasar a una planta y se pinta en ella.
 */
import { describe, expect, it } from "vitest";
import { VERSION_ESQUEMA, type Proyecto } from "../../../src/agente/proyecto.ts";
import type { Vec2 } from "../../../src/compilador/fisico.ts";
import { aplicar } from "../../../src/editor/operaciones.ts";
import { porticoArriostrado } from "../../../src/pruebas/barras.ts";
import { ControladorDibujo } from "../dibujo/controlador.ts";
import type { Colores } from "../vistas/motor.ts";

/** 50 px/m: el radio de enganche (10 px) es 0,2 m. */
const RADIO = 0.2;

function preparar() {
  const f = porticoArriostrado();
  let p: Proyecto = { esquema: VERSION_ESQUEMA, modelo: { ...f, barras: [], cargas: f.cargas!.filter((c) => c.tipo !== "barra") } };
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
  ctrl.ponerPlantillas({ pilar: {}, viga: {}, barraNiveles: { seccion: "t" } });
  // El alzado de y = 0 (eje A propuesto, desde x = −2: u = x + 2) y el de y = 4, y la planta P1
  const [a, b, p1] = [ctrl.adaptadorAlzado("eje-A"), ctrl.adaptadorAlzado("eje-B"), ctrl.adaptador("P1")];
  const clic = (v: typeof a, q: Vec2) => {
    v.pasar(q, RADIO, false, [100, 100]);
    return v.clic(q, RADIO, false, false);
  };
  return { ctrl, a, b, p1, clic, hechos, proyecto: () => p };
}

describe("Barra en la app (BN3)", () => {
  it("con Elegir, el alzado no dibuja; con Barra, dos clics en los nudos son una barra", () => {
    const { ctrl, a, clic, hechos, proyecto } = preparar();
    expect(clic(a, [2, 0])).toBe(false);
    ctrl.ponerHerramienta("barraNiveles");
    expect(ctrl.instantanea().alzado).toBe(false);
    // El nudo de A en C: la barra de estado dice dónde queda el extremo
    a.pasar([2.03, 0.02], RADIO, false, [100, 100]);
    expect(ctrl.instantanea().alzado).toBe(true);
    expect(a.cursor()?.texto).toBe("Centro (A) · → C (0; 0)");
    expect(clic(a, [2.03, 0.02])).toBe(true);
    expect(ctrl.instantanea().ayuda).toMatch(/^Barra desde C \(0; 0\): el segundo extremo, en el nivel de una planta/);
    // Fuera de los niveles, no
    clic(a, [4.5, 1.5]);
    expect(ctrl.instantanea().error).toMatch(/de planta a planta/);
    expect(clic(a, [6.98, 3.01])).toBe(true);
    expect(hechos).toEqual(["Barra B1, de C a P1"]);
    expect(proyecto().modelo.barras).toEqual([{ id: "B1", inicio: { planta: "C", x: 0, y: 0 }, fin: { planta: "P1", x: 5, y: 0 }, seccion: "t" }]);
  });

  it("en un alzado se teclea «u; z»: «@1,5; 3» desde el nudo de C1 en P1 es el tornapuntas", () => {
    const { ctrl, b, clic, proyecto } = preparar();
    ctrl.ponerHerramienta("barraNiveles");
    clic(b, [2, 3]);
    ctrl.abrirCampo("@");
    expect(ctrl.instantanea().campo).not.toBeNull();
    expect(ctrl.teclear("@1,5; 3")).toBe(true);
    expect(proyecto().modelo.barras).toEqual([{ id: "B1", inicio: { planta: "P1", x: 0, y: 4 }, fin: { planta: "P2", x: 1.5, y: 4 }, seccion: "t" }]);
  });

  it("el primer extremo, en el alzado; se ve en la planta, y el segundo clic va en ella", () => {
    const { ctrl, a, p1, clic, proyecto } = preparar();
    ctrl.ponerHerramienta("barraNiveles");
    clic(a, [2, 0]);
    // Al pasar a la planta P1 no se pierde: se pinta en su (x, y)
    p1.pasar([3, 2], RADIO, false, [100, 100]);
    expect(ctrl.instantanea().alzado).toBe(false);
    const pintado: number[][] = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, setLineDash() {}, rect() {}, arc() {}, fillRect: (x: number, y: number) => pintado.push([x, y]) } as unknown as CanvasRenderingContext2D;
    a.pintar(ctx, (q) => [q[0] * 50, q[1] * 50], { acento: "#000", fondo: "#fff" } as Colores);
    // En el alzado (no es la vista del cursor), el primer extremo: (u, z) = (2, 0)
    expect(pintado).toEqual([[100 - 3.5, -3.5]]);
    expect(clic(p1, [5.02, 3.97])).toBe(true);
    expect(proyecto().modelo.barras).toEqual([{ id: "B1", inicio: { planta: "C", x: 0, y: 0 }, fin: { planta: "P1", x: 5, y: 4 }, seccion: "t" }]);
  });

  it("otra herramienta deja el alzado: sus clics vuelven a elegir", () => {
    const { ctrl, a, clic } = preparar();
    ctrl.ponerHerramienta("barraNiveles");
    a.pasar([2, 0], RADIO, false, [100, 100]);
    ctrl.ponerHerramienta("pilar");
    expect(ctrl.instantanea().alzado).toBe(false);
    expect(clic(a, [2, 0])).toBe(false);
    expect(a.cursor()).toBeNull();
  });
});
