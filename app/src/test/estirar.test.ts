/**
 * Estirar desde la cadena de cotas en la app (CT2, `docs/fem3d/cotas.md` §2.2), con el controlador
 * de dibujo y sin las vistas (lo que se pinta lo prueba `validacion/ct/chrome.ts`): con Elegir, un
 * clic en el número de una cota la elige; un clic en una flecha elige el lado y abre el campo con el
 * valor; ← y → cambian de lado; Intro aplica un paso de deshacer y Esc anula.
 */
import { describe, expect, it } from "vitest";
import { cadenasDe, cotasCadena, type CotaCadena } from "../../../src/agente/render/ejes.ts";
import { VERSION_ESQUEMA, type Proyecto } from "../../../src/agente/proyecto.ts";
import type { ModeloFisico, Vec2 } from "../../../src/compilador/fisico.ts";
import { aplicar } from "../../../src/editor/operaciones.ts";
import { ControladorDibujo } from "../dibujo/controlador.ts";

/** Una retícula de 2 × 1 vanos (6 y 5,4 por 5) con sus ejes guardados. */
function modelo(): ModeloFisico {
  const xs = [0, 6, 11.4];
  const ys = [0, 5];
  return {
    plantas: [{ id: "N1", altura: null }, { id: "C", tipo: "sotano", altura: 3 }],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "p40", material: "HA", forma: "rectangular", b: 0.4, h: 0.4 },
      { id: "v30", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares: xs.flatMap((x, i) => ys.map((y, j) => ({ id: `P${i}${j}`, x, y, desde: "C", hasta: "N1", seccion: "p40" }))),
    vigas: ys.map((y, j) => ({ id: `V${j}`, planta: "N1", puntos: [[0, y], [11.4, y]] as Vec2[], seccion: "v30" })),
    losas: [{ id: "L", planta: "N1", contorno: [[0, 0], [11.4, 0], [11.4, 5], [0, 5]], espesor: 0.25, material: "HA" }],
    casos: [{ id: "G", pesoPropio: true }],
    ejes: [...xs.map((x, i) => ({ id: String(i + 1), desde: [x, -2] as Vec2, hasta: [x, 7] as Vec2 })), ...ys.map((y, j) => ({ id: "AB"[j]!, desde: [-2, y] as Vec2, hasta: [13.4, y] as Vec2 }))],
  };
}

/** 50 px/m: el radio de enganche (10 px) es 0,2 m y un px, 0,02 m. */
const RADIO = 0.2;
const PX = 0.02;

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
  const cota = (texto: string): CotaCadena => cadenasDe(p.modelo).flatMap(cotasCadena).find((k) => k.texto === texto)!;
  /** El centro de la flecha de un extremo (0, el de t menor). */
  const flecha = (k: CotaCadena, lado: 0 | 1): Vec2 => {
    const [e, s] = lado ? [k.b, 1] : [k.a, -1];
    return [e[0] + s * k.cadena.n[0] * 16 * PX, e[1] + s * k.cadena.n[1] * 16 * PX];
  };
  return { ctrl, vista, clic, cota, flecha, hechos, proyecto: () => p };
}

describe("estirar desde una cota (CT2)", () => {
  it("clic en el número, clic en la flecha, el valor e Intro: un paso, con los pilares en su sitio", () => {
    const { ctrl, clic, cota, flecha, hechos, proyecto } = preparar();
    const k = cota("6,00");
    // Al pasar por el número, la barra lo ofrece
    expect(clic([k.p[0] + 5 * PX, k.p[1]])).toBe(true);
    expect(ctrl.instantanea().estirado).toMatch(/^Cota 1–2 \(6,00 m\): elija la flecha/);
    // Los ejes paralelos a Y miden t = −x: el extremo de t mayor es el eje 1
    const lado = k.cadena.n[0] < 0 ? 0 : 1;
    expect(clic(flecha(k, lado))).toBe(true);
    const campo = ctrl.instantanea().campo!;
    expect(campo).toMatchObject({ texto: "6,00", seleccionar: true, cota: "1–2, se mueve el 2" });
    expect(ctrl.teclear("6,35")).toBe(true);
    expect(hechos).toEqual(["Estirar 1–2 a 6,35 m"]);
    const m = proyecto().modelo;
    expect(m.pilares!.map((x) => x.x)).toEqual([0, 0, 6.35, 6.35, 11.75, 11.75]);
    expect(m.vigas![0]!.puntos).toEqual([
      [0, 0],
      [11.75, 0],
    ]);
    expect(m.ejes!.find((e) => e.id === "2")!.desde).toEqual([6.35, -2]);
    expect(ctrl.instantanea()).toMatchObject({ estirado: null, campo: null, hecho: "Estirar 1–2 a 6,35 m" });
  });

  it("← y → cambian de lado; un valor que no vale deja el campo con su error; Esc anula", () => {
    const { ctrl, clic, cota, flecha, hechos, proyecto } = preparar();
    const k = cota("5,40");
    clic(k.p);
    const lado = k.cadena.n[0] < 0 ? 0 : 1;
    clic(flecha(k, lado));
    expect(ctrl.instantanea().campo!.cota).toBe("2–3, se mueve el 3");
    expect(ctrl.cambiarLado()).toBe(true);
    expect(ctrl.instantanea().campo!.cota).toBe("2–3, se mueve el 2");
    expect(ctrl.teclear("abc")).toBe(false);
    expect(ctrl.instantanea().campo!.error).toMatch(/Escriba la distancia/);
    expect(ctrl.teclear("5,4")).toBe(false);
    expect(ctrl.instantanea().campo!.error).toBe("La cota ya mide 5,40 m.");
    expect(hechos).toEqual([]);
    ctrl.escCampo();
    expect(ctrl.instantanea()).toMatchObject({ estirado: null, campo: null });
    // Moviendo el 2 hacia la izquierda (se queda el 3): el 1 y lo de antes se desplazan
    clic(k.p);
    clic(flecha(k, lado ? 0 : 1));
    expect(ctrl.teclear("5")).toBe(true);
    expect(proyecto().modelo.pilares!.map((x) => x.x)).toEqual([0.4, 0.4, 6.4, 6.4, 11.4, 11.4]);
  });

  it("un clic fuera de las cotas deja la cota y no es suyo; sin cadena en la vista, no hay cotas", () => {
    const { ctrl, vista, clic, cota } = preparar();
    clic(cota("6,00").p);
    expect(ctrl.instantanea().estirado).not.toBeNull();
    expect(clic([3, 2.5])).toBe(false);
    expect(ctrl.instantanea().estirado).toBeNull();
    const otra = ctrl.adaptador("N1", { cotas: false });
    expect(otra).not.toBe(vista);
    otra.pasar(cota("6,00").p, RADIO, false, [0, 0]);
    expect(otra.clic(cota("6,00").p, RADIO, false, false)).toBe(false);
  });
});
