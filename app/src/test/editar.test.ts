/**
 * Editar con el ratón en la app (V2c-3, `docs/fem3d/dibujo.md` §9), con el controlador de dibujo y
 * sin las vistas:
 * - Mover, Copiar, Girar y Simetría sin nada elegido dejan elegir con los clics de la vista; un clic
 *   sin Ctrl confirma, con Ctrl se suma e Intro confirma; con algo elegido al activarlas, empiezan ya;
 * - los pinzamientos: con Elegir, un clic en un vértice de lo elegido lo coge y el siguiente lo deja
 *   (o se arrastra, o se teclea); el de un pilar lo mueve con sus vigas y, con Ctrl, solo.
 */
import { describe, expect, it } from "vitest";
import { VERSION_ESQUEMA, type Proyecto } from "../../../src/agente/proyecto.ts";
import type { ModeloFisico, Vec2 } from "../../../src/compilador/fisico.ts";
import { aplicar } from "../../../src/editor/operaciones.ts";
import { ControladorDibujo } from "../dibujo/controlador.ts";

/** 2 × 1 vanos (6 y 5,4 por 5) en dos plantas, con vigas de pilar a pilar. */
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
    casos: [{ id: "G", pesoPropio: true }],
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
  ctrl.alSalir = () => ctrl.ponerHerramienta("elegir");
  ctrl.ponerModelo(p.modelo);
  const vista = ctrl.adaptador("N1", { cotas: true });
  const clic = (q: Vec2, ctrlKey = false) => {
    vista.pasar(q, RADIO, false, [100, 100]);
    return vista.clic(q, RADIO, ctrlKey, false);
  };
  return { ctrl, vista, clic, hechos, proyecto: () => p };
}

const viga = (p: Proyecto, id: string) => p.modelo.vigas!.find((x) => x.id === id)!.puntos;

describe("Mover, Copiar, Girar y Simetría", () => {
  it("sin nada elegido, el clic elige; sin Ctrl, lo confirma; después, punto base y destino tecleado", () => {
    const { ctrl, clic, hechos, proyecto } = preparar();
    ctrl.ponerHerramienta("mover");
    expect(ctrl.instantanea().ayuda).toBe("Mover: elija lo que quiere transformar (clic o ventana; con Ctrl+clic, varios e Intro). Esc vuelve a Elegir.");
    // El clic va a la vista, que elige
    expect(clic([6, 2.5])).toBe(false);
    ctrl.ponerElegidos(["V1-N1"]);
    expect(ctrl.instantanea().transformando).toEqual(["V1-N1"]);
    expect(clic([6, 0])).toBe(true);
    ctrl.abrirCampo("@");
    expect(ctrl.teclear("@0,3; 0")).toBe(true);
    expect(hechos).toEqual(["Mover V1-N1 (0,3; 0 m)"]);
    expect(viga(proyecto(), "V1-N1")).toEqual([[6.3, 0], [6.3, 5]]);
    // Sigue con lo mismo elegido, esperando otro punto base; Esc sale a Elegir
    expect(ctrl.instantanea().ayuda).toBe("Mover V1-N1: el punto base. Esc vuelve a Elegir.");
    ctrl.anular();
    expect(ctrl.activa).toBe("elegir");
  });

  it("con Ctrl se suma (sin confirmar) e Intro confirma; con algo elegido al activarla, empieza ya", () => {
    const { ctrl, clic } = preparar();
    ctrl.ponerHerramienta("copiar");
    expect(clic([3, 5], true)).toBe(false);
    ctrl.ponerElegidos(["VB1-N1"]);
    expect(clic([8, 5], true)).toBe(false);
    ctrl.ponerElegidos(["VB1-N1", "VB2-N1"]);
    expect(ctrl.instantanea().transformando).toBeNull();
    ctrl.intro();
    expect(ctrl.instantanea().transformando).toEqual(["VB1-N1", "VB2-N1"]);
    const otro = preparar();
    otro.ctrl.ponerElegidos(["P11"]);
    otro.ctrl.ponerHerramienta("girar");
    expect(otro.ctrl.instantanea().transformando).toEqual(["P11"]);
  });

  it("girar con los grados tecleados; copiar pone una copia por clic", () => {
    const { ctrl, clic, hechos, proyecto } = preparar();
    ctrl.ponerElegidos(["V1-N1"]);
    ctrl.ponerHerramienta("girar");
    clic([6, 0]);
    ctrl.abrirCampo("9");
    expect(ctrl.teclear("90")).toBe(true);
    expect(viga(proyecto(), "V1-N1")).toEqual([[6, 0], [1, 0]]);
    ctrl.ponerHerramienta("copiar");
    ctrl.ponerElegidos(["VB2-N1"]);
    clic([6, 5]);
    ctrl.abrirCampo("@");
    ctrl.teclear("@0; -1");
    ctrl.abrirCampo("@");
    ctrl.teclear("@0; -2");
    expect(hechos.slice(1)).toEqual(["Copiar VB2-N1 (0; -1 m)", "Copiar VB2-N1 (0; -2 m)"]);
    expect(proyecto().modelo.vigas!.length).toBe(8);
  });

  it("los avisos de lo hecho salen en la barra", () => {
    const { ctrl, clic } = preparar();
    ctrl.ponerElegidos(["P11"]);
    ctrl.ponerHerramienta("mover");
    clic([6, 5]);
    vistaCtrlClic(ctrl, [6.4, 5.2]);
    expect(ctrl.instantanea().aviso).toBe("Las vigas V1-N2, VB1-N2, VB2-N2, V1-N1 y 2 más acaban en un pilar que se mueve y se quedan donde estaban.");
  });
});

/** Un clic con Ctrl en q (el pilar sin sus vigas). */
function vistaCtrlClic(ctrl: ControladorDibujo, q: Vec2) {
  const v = ctrl.adaptador("N1", { cotas: true });
  v.pasar(q, 0.01, false, [0, 0]);
  v.clic(q, 0.01, true, false);
}

describe("pinzamientos", () => {
  it("un clic en un vértice de lo elegido lo coge y el siguiente lo deja; Esc lo suelta", () => {
    const { ctrl, vista, clic, hechos, proyecto } = preparar();
    ctrl.ponerElegidos(["V1-N1"]);
    vista.pasar([6.05, 0.05], RADIO, false, [0, 0]);
    expect(vista.cursor()!.texto).toContain("Vértice de V1-N1 · clic para moverlo");
    expect(vista.agarrar!([6.05, 0.05], RADIO)).toBe(true);
    expect(ctrl.instantanea().asa).toBe("un vértice de V1-N1: el punto nuevo (clic, o «x; y», «@dx; dy» e Intro). Esc lo suelta.");
    // Otro clic en el asa no la vuelve a coger: va a dejarla
    expect(vista.agarrar!([6.05, 0.05], RADIO)).toBe(false);
    expect(clic([7, -1])).toBe(true);
    expect(hechos).toEqual(["Mover un vértice de V1-N1"]);
    expect(viga(proyecto(), "V1-N1")).toEqual([[7, -1], [6, 5]]);
    expect(ctrl.instantanea().asa).toBeNull();
    // Esc antes de dejarlo
    vista.agarrar!([7, -1], RADIO);
    ctrl.soltarAsa();
    expect(ctrl.instantanea().asa).toBeNull();
    expect(hechos.length).toBe(1);
  });

  it("tecleado, desde donde estaba", () => {
    const { ctrl, vista, proyecto } = preparar();
    ctrl.ponerElegidos(["VB2-N1"]);
    vista.pasar([11.4, 5], RADIO, false, [0, 0]);
    vista.agarrar!([11.4, 5], RADIO);
    ctrl.abrirCampo("@");
    expect(ctrl.instantanea().campo).toMatchObject({ cota: "vértice de VB2-N1" });
    expect(ctrl.teclear("@0,6; 0")).toBe(true);
    expect(viga(proyecto(), "VB2-N1")).toEqual([[6, 5], [12, 5]]);
  });

  it("el de un pilar lo mueve con sus vigas en todas sus plantas; con Ctrl, solo", () => {
    const { ctrl, vista, clic, hechos, proyecto } = preparar();
    ctrl.ponerElegidos(["P11"]);
    vista.pasar([6, 5], RADIO, false, [0, 0]);
    vista.agarrar!([6, 5], RADIO);
    clic([6.5, 4]);
    expect(hechos).toEqual(["Mover P11"]);
    for (const pl of ["N1", "N2"]) expect(viga(proyecto(), `V1-${pl}`)).toEqual([[6, 0], [6.5, 4]]);
    vista.pasar([6.5, 4], RADIO, false, [0, 0]);
    vista.agarrar!([6.5, 4], RADIO);
    clic([6, 5], true);
    expect(hechos.at(-1)).toBe("Mover P11, sin sus vigas");
    expect(viga(proyecto(), "V1-N1")).toEqual([[6, 0], [6.5, 4]]);
    expect(proyecto().modelo.pilares!.find((x) => x.id === "P11")).toMatchObject({ x: 6, y: 5 });
  });
});
