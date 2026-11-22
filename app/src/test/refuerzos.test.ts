/**
 * CO6 (`docs/fem3d/comprobaciones.md` §8.12): los refuerzos de las losas con el ratón, en la planta.
 * El adaptador que recibe la vista (`EditorRefuerzos`): coger un asa y dejarla, arrastrarla, añadir uno
 * nuevo con dos clics o con una ventana, y soltar lo que se tiene a medias.
 */
import { describe, expect, it } from "vitest";
import type { ArmadoForjado } from "../../../src/comprobaciones/armado.ts";
import type { ElementoLosa, Rango } from "../../../src/editor/refuerzosPlanta.ts";
import { EditorRefuerzos, type NuevoElemento } from "../dibujo/refuerzos.ts";

const base = { "x-inf": { diametro: 12, separacion: 200 }, "x-sup": { diametro: 12, separacion: 200 }, "y-inf": { diametro: 12, separacion: 200 }, "y-sup": { diametro: 12, separacion: 200 } };
const ARMADO: ArmadoForjado = { base, refuerzos: [{ armadura: "x-sup", s: [2, 5], t: [1, 2], barras: { diametro: 12, separacion: 200 } }] };
const RADIO = 0.1;

function editor() {
  const e = new EditorRefuerzos();
  e.losas = [
    { id: "L1", planta: "P1", contorno: [[0, 0], [10, 0], [10, 8], [0, 8]], armado: ARMADO },
    { id: "L2", planta: "P1", contorno: [[12, 0], [20, 0], [20, 8], [12, 8]] },
    { id: "L3", planta: "P2", contorno: [[0, 0], [10, 0], [10, 8], [0, 8]], armado: ARMADO },
  ];
  const movidos: { losa: string; e: ElementoLosa; zona: Rango }[] = [];
  const anadidos: { losa: string; n: NuevoElemento; zona: Rango }[] = [];
  const avisos: (string | null)[] = [];
  e.alMover = (losa, el, zona) => movidos.push({ losa, e: el, zona });
  e.alAnadir = (losa, n, zona) => anadidos.push({ losa, n, zona });
  e.alAvisar = (t) => avisos.push(t);
  return { e, a: e.adaptador("P1"), movidos, anadidos, avisos };
}

describe("CO6: los refuerzos de las losas, con el ratón", () => {
  it("sin nada elegido, los clics no son suyos (eligen en la vista)", () => {
    const { e, a } = editor();
    expect(a.clic([5, 1.5], RADIO, false, false)).toBe(false);
    expect(a.agarrar!([5, 1.5], RADIO)).toBe(false);
    expect(a.ventana([0, 0, 3, 3])).toBe(false);
    expect(e.ocupado).toBe(false);
    expect(a.cursor()).toBeNull();
  });

  it("con uno elegido: un clic en un asa la coge y el siguiente la deja; lo que cambia, a 5 cm", () => {
    const { e, a, movidos } = editor();
    e.elegido = { losa: "L1", elemento: { lista: "refuerzos", indice: 0 } };
    // Fuera de las asas, el clic sigue siendo de la vista
    expect(a.clic([3, 1.7], RADIO, false, false)).toBe(false);
    // El asa del lado s1 está en (5, 1,5)
    expect(a.clic([5.03, 1.52], RADIO, false, false)).toBe(true);
    expect(e.ocupado).toBe(true);
    a.pasar([6.21, 3], RADIO, false, [0, 0]);
    expect(a.cursor()!.texto).toMatch(/^4,20 × 1,00 m/);
    expect(a.clic([6.21, 3], RADIO, false, false)).toBe(true);
    expect(movidos).toEqual([{ losa: "L1", e: { lista: "refuerzos", indice: 0 }, zona: { s: [2, 6.2], t: [1, 2] } }]);
    expect(e.ocupado).toBe(false);
    // Dejarla donde estaba no cambia nada
    a.clic([5, 1.5], RADIO, false, false);
    a.clic([5.01, 1.5], RADIO, false, false);
    expect(movidos).toHaveLength(1);
    // El del centro mueve la zona entera
    a.clic([3.5, 1.5], RADIO, false, false);
    a.clic([4.5, 2.5], RADIO, false, false);
    expect(movidos[1]!.zona).toEqual({ s: [3, 6], t: [2, 3] });
  });

  it("arrastrar: al pulsar en un asa la coge; el clic derecho o Esc la sueltan sin cambiar nada", () => {
    const { e, a, movidos } = editor();
    e.elegido = { losa: "L1", elemento: { lista: "refuerzos", indice: 0 } };
    expect(a.agarrar!([8, 8], RADIO)).toBe(false);
    expect(a.agarrar!([3.5, 2], RADIO)).toBe(true);
    // La vista, al soltar tras moverse, manda un clic
    expect(a.clic([3.5, 2.74], RADIO, false, false)).toBe(true);
    expect(movidos[0]!.zona).toEqual({ s: [2, 5], t: [1, 2.75] });
    a.agarrar!([2, 1.5], RADIO);
    expect(a.derecho!()).toBe(true);
    expect(e.ocupado).toBe(false);
    a.agarrar!([2, 1.5], RADIO);
    expect(e.cancelar()).toBe(true);
    expect(e.cancelar()).toBe(false);
    expect(movidos).toHaveLength(1);
    // En otra planta, lo elegido no tiene asas
    expect(e.adaptador("P2").agarrar!([2, 1.5], RADIO)).toBe(false);
  });

  it("añadir: dos clics dan las esquinas opuestas, en la losa del primero; una ventana, también", () => {
    const { e, a, anadidos, avisos } = editor();
    e.nuevo = { lista: "refuerzos", armadura: "y-inf" };
    // Fuera de las losas y en una sin armado: se dice y no empieza
    expect(a.clic([11, 4], RADIO, false, false)).toBe(true);
    expect(a.clic([14, 4], RADIO, false, false)).toBe(true);
    expect(avisos.filter(Boolean)).toHaveLength(2);
    expect(avisos[1]).toMatch(/L2 no tiene armado/);
    expect(e.ocupado).toBe(false);
    a.clic([1.02, 1], RADIO, false, false);
    expect(e.ocupado).toBe(true);
    a.pasar([4, 3.48], RADIO, false, [0, 0]);
    // Y: a lo largo va y
    expect(a.cursor()!.texto).toMatch(/^2,50 × 3,00 m/);
    a.clic([4, 3.48], RADIO, false, false);
    expect(anadidos).toEqual([{ losa: "L1", n: { lista: "refuerzos", armadura: "y-inf" }, zona: { s: [1, 3.5], t: [1, 4] } }]);
    expect(e.ocupado).toBe(false);
    // Una zona sin lado: se avisa
    a.clic([1, 1], RADIO, false, false);
    a.clic([1.01, 5], RADIO, false, false);
    expect(anadidos).toHaveLength(1);
    expect(avisos.at(-1)).toMatch(/demasiado pequeña/);
    // Con una ventana
    e.nuevo = { lista: "cercos", direccion: "x" };
    expect(a.ventana([6, 5, 8.02, 6.5])).toBe(true);
    expect(anadidos[1]).toEqual({ losa: "L1", n: { lista: "cercos", direccion: "x" }, zona: { s: [6, 8], t: [5, 6.5] } });
    // Con la herramienta puesta, las asas de lo elegido no se cogen
    e.elegido = { losa: "L1", elemento: { lista: "refuerzos", indice: 0 } };
    expect(a.agarrar!([5, 1.5], RADIO)).toBe(false);
  });
});
