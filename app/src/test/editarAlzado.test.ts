/**
 * Mover y Copiar en un alzado (V2c-3 en el alzado, `src/editor/dibujo/editar.ts`), con el controlador de
 * dibujo y sin las vistas: lo horizontal va a lo largo del plano y lo vertical, de planta en planta;
 * Girar y Simetría dicen que van en planta.
 */
import { describe, expect, it } from "vitest";
import { VERSION_ESQUEMA, type Proyecto } from "../../../src/agente/proyecto.ts";
import type { Vec2 } from "../../../src/compilador/fisico.ts";
import { aplicar } from "../../../src/editor/operaciones.ts";
import { porticoArriostrado } from "../../../src/pruebas/barras.ts";
import { ControladorDibujo } from "../dibujo/controlador.ts";

/** 50 px/m: el radio de enganche (10 px) es 0,2 m. */
const RADIO = 0.2;

function preparar() {
  const f = porticoArriostrado();
  let p: Proyecto = { esquema: VERSION_ESQUEMA, modelo: { ...f, barras: [], cargas: [] } };
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
  ctrl.ponerPlantillas({ pilar: {}, viga: {} });
  // El alzado de y = 0 (eje A propuesto, desde x = −2: u = x + 2); niveles C 0, P1 3, P2 6
  const a = ctrl.adaptadorAlzado("eje-A");
  const clic = (q: Vec2) => {
    a.pasar(q, RADIO, false, [100, 100]);
    return a.clic(q, RADIO, false, false);
  };
  return { ctrl, a, clic, hechos, proyecto: () => p };
}

describe("Mover y Copiar en un alzado", () => {
  it("Copiar un pilar a lo largo del plano: del nudo de A a 2,5 m en la línea de nivel", () => {
    const { ctrl, a, clic, proyecto } = preparar();
    ctrl.ponerElegidos(["A"]);
    ctrl.ponerHerramienta("copiar");
    expect(clic([2.02, 0.01])).toBe(true);
    expect(ctrl.instantanea().alzado).toBe(true);
    expect(ctrl.instantanea().ayuda).toMatch(/^Copiar A: el destino .*de planta en planta/);
    a.pasar([4.5, 0.05], RADIO, false, [100, 100]);
    expect(a.cursor()?.texto).toContain("Δ 2,50 m a lo largo");
    expect(clic([4.5, 0.05])).toBe(true);
    expect(ctrl.instantanea().error).toBeNull();
    const nuevos = proyecto().modelo.pilares!.filter((x) => !["A", "B", "C1", "D"].includes(x.id));
    expect(nuevos).toEqual([{ id: nuevos[0]!.id, x: 2.5, y: 0, desde: "C", hasta: "P2", seccion: "p" }]);
    // Copiar sigue: otra copia en el clic siguiente
    expect(clic([6, 0])).toBe(true);
    expect(proyecto().modelo.pilares).toHaveLength(6);
  });

  it("Mover una viga una planta abajo: cambia de planta y no de sitio", () => {
    const { ctrl, clic, hechos, proyecto } = preparar();
    ctrl.ponerElegidos(["V-P1-0"]);
    ctrl.ponerHerramienta("mover");
    clic([2, 3]);
    clic([2, 0.1]);
    expect(ctrl.instantanea().error).toBeNull();
    expect(proyecto().modelo.vigas!.find((v) => v.id === "V-P1-0")).toEqual({ id: "V-P1-0", planta: "C", puntos: [[0, 0], [5, 0]], seccion: "v" });
    expect(hechos.at(-1)).toBe("Mover V-P1-0 (0; 0 m), 1 planta abajo");
  });

  it("un pilar que se saldría del edificio no se mueve", () => {
    const { ctrl, clic, proyecto } = preparar();
    ctrl.ponerElegidos(["A"]);
    ctrl.ponerHerramienta("mover");
    clic([2, 3]);
    clic([2, 6]);
    expect(ctrl.instantanea().error).toMatch(/se saldría del edificio/);
    expect(proyecto().modelo.pilares!.find((x) => x.id === "A")).toMatchObject({ desde: "C", hasta: "P2" });
  });

  it("Girar y Simetría van en planta", () => {
    const { ctrl, a, clic } = preparar();
    ctrl.ponerElegidos(["A"]);
    ctrl.ponerHerramienta("girar");
    a.pasar([2, 0], RADIO, false, [100, 100]);
    expect(ctrl.instantanea().ayuda).toMatch(/^Girar va en planta/);
    clic([2, 0]);
    expect(ctrl.instantanea().error).toMatch(/^Girar va en planta/);
  });

  it("sin nada elegido, el clic del alzado elige (no lo coge la herramienta)", () => {
    const { ctrl, clic } = preparar();
    ctrl.ponerHerramienta("copiar");
    expect(clic([2, 1.5])).toBe(false);
  });
});
