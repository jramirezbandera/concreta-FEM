/**
 * CO6 (`docs/fem3d/comprobaciones.md` §8.12): la zona de un refuerzo o de unos cercos, editada en la
 * planta: sus asas, estirar un lado, mover la zona entera y añadir un elemento entre dos puntos.
 */
import { describe, expect, it } from "vitest";
import type { Vec2 } from "../compilador/fisico.ts";
import type { ArmadoForjado } from "../comprobaciones/armado.ts";
import { refuerzosDibujados } from "../comprobaciones/dibujoArmado.ts";
import { asaEn, asasZona, conElemento, conZona, esquinasZona, LADO_MINIMO_ZONA, mismaZona, zonaElemento, zonaEntre, zonaMovida } from "./refuerzosPlanta.ts";

const base = { "x-inf": { diametro: 12, separacion: 200 }, "x-sup": { diametro: 12, separacion: 200 }, "y-inf": { diametro: 12, separacion: 200 }, "y-sup": { diametro: 12, separacion: 200 } };
const ARMADO: ArmadoForjado = {
  base,
  refuerzos: [
    { armadura: "x-sup", s: [2, 5], t: [1, 2], barras: { diametro: 12, separacion: 200 } },
    { armadura: "y-inf", s: [1, 3], t: [4, 6], barras: { diametro: 16, separacion: 150 } },
  ],
  cercos: [{ direccion: "y", s: [0, 2], t: [1, 1.8], cercos: { diametro: 6, separacion: 150 } }],
};
const cerca = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;

describe("CO6: la zona de un refuerzo, editada en la planta", () => {
  it("la zona de un elemento es la que se dibuja, y sus asas son el medio de cada lado y el centro", () => {
    for (const eje1 of [0, 30, 90]) {
      const z = zonaElemento(eje1, ARMADO, { lista: "refuerzos", indice: 0 })!;
      const dibujado = refuerzosDibujados(eje1, ARMADO)[0]!;
      esquinasZona(z).forEach((p, i) => expect(cerca(p, dibujado.zona[i]!)).toBe(true));
      const asas = new Map(asasZona(z).map((a) => [a.asa, a.p]));
      // Las de s, las puntas de la barra; las de t, las de la línea de reparto
      expect(cerca(asas.get("s0")!, dibujado.barra[0]) && cerca(asas.get("s1")!, dibujado.barra[1])).toBe(true);
      expect(cerca(asas.get("t0")!, dibujado.reparto[0]) && cerca(asas.get("t1")!, dibujado.reparto[1])).toBe(true);
      expect(cerca(asas.get("centro")!, dibujado.centro)).toBe(true);
      expect(asaEn(z, dibujado.barra[1], 0.1)).toBe("s1");
      expect(asaEn(z, [dibujado.centro[0] + 0.05, dibujado.centro[1]], 0.1)).toBe("centro");
      expect(asaEn(z, [100, 100], 0.1)).toBeNull();
    }
    // Y: s es y, t es x. Unos cercos, por su dirección
    expect(zonaElemento(0, ARMADO, { lista: "refuerzos", indice: 1 })).toMatchObject({ d: [0, 1], n: [1, 0], s: [1, 3], t: [4, 6] });
    expect(zonaElemento(0, ARMADO, { lista: "cercos", indice: 0 })).toMatchObject({ d: [0, 1], s: [0, 2], t: [1, 1.8] });
    expect(zonaElemento(0, ARMADO, { lista: "refuerzos", indice: 7 })).toBeNull();
    expect(zonaElemento(0, { refuerzos: [{ armadura: "x-inf", s: [3, 3], t: [0, 1], barras: { diametro: 12, separacion: 200 } }] }, { lista: "refuerzos", indice: 0 })).toBeNull();
  });

  it("el asa de un lado lo estira hasta el punto, a 5 cm, sin pasar del lado de enfrente", () => {
    const z = zonaElemento(0, ARMADO, { lista: "refuerzos", indice: 0 })!;
    expect(zonaMovida(z, "s1", [5, 1.5], [6.23, 9])).toEqual({ s: [2, 6.25], t: [1, 2] });
    expect(zonaMovida(z, "s0", [2, 1.5], [1.01, -3])).toEqual({ s: [1, 5], t: [1, 2] });
    expect(zonaMovida(z, "t1", [3.5, 2], [0, 2.74])).toEqual({ s: [2, 5], t: [1, 2.75] });
    expect(zonaMovida(z, "t0", [3.5, 1], [0, 0.42])).toEqual({ s: [2, 5], t: [0.4, 2] });
    // Más allá del lado de enfrente: se queda al lado mínimo
    expect(zonaMovida(z, "s1", [5, 1.5], [0, 0]).s).toEqual([2, 2 + LADO_MINIMO_ZONA]);
    expect(zonaMovida(z, "t0", [3.5, 1], [0, 8]).t).toEqual([2 - LADO_MINIMO_ZONA, 2]);
    // Girada 30°: el punto se proyecta en los ejes de la armadura
    const g = zonaElemento(30, ARMADO, { lista: "refuerzos", indice: 0 })!;
    const p: Vec2 = [6 * g.d[0] + 7 * g.n[0], 6 * g.d[1] + 7 * g.n[1]];
    expect(zonaMovida(g, "s1", [0, 0], p)).toEqual({ s: [2, 6], t: [1, 2] });
  });

  it("el asa del centro mueve la zona entera lo que va de un punto a otro, a 5 cm, sin cambiar su tamaño", () => {
    const z = zonaElemento(0, ARMADO, { lista: "refuerzos", indice: 0 })!;
    const m = zonaMovida(z, "centro", [3.5, 1.5], [4.02, 1.26]);
    expect(m).toEqual({ s: [2.5, 5.5], t: [0.75, 1.75] });
    expect(mismaZona(zonaMovida(z, "centro", [3.5, 1.5], [3.51, 1.52]), z)).toBe(true);
    expect(mismaZona(m, z)).toBe(false);
  });

  it("el armado con la zona cambiada sólo cambia esa zona, y no toca el de partida", () => {
    const antes = JSON.stringify(ARMADO);
    const a = conZona(ARMADO, { lista: "refuerzos", indice: 1 }, { s: [0, 4], t: [4, 7] });
    expect(JSON.stringify(ARMADO)).toBe(antes);
    expect(a.refuerzos![1]).toEqual({ ...ARMADO.refuerzos![1]!, s: [0, 4], t: [4, 7] });
    expect(a.refuerzos![0]).toEqual(ARMADO.refuerzos![0]);
    expect(a.cercos).toEqual(ARMADO.cercos);
    const c = conZona(ARMADO, { lista: "cercos", indice: 0 }, { s: [0, 3], t: [1, 2] });
    expect(c.cercos![0]).toEqual({ ...ARMADO.cercos![0]!, s: [0, 3], t: [1, 2] });
  });

  it("uno nuevo entre dos puntos: sus esquinas, en los ejes de su armadura y a 5 cm; al final de su lista", () => {
    expect(zonaEntre(0, "x-sup", [5.02, 2.21], [2.01, 0.98])).toEqual({ s: [2, 5], t: [1, 2.2] });
    // Y: s es y
    expect(zonaEntre(0, "y-inf", [5.02, 2.21], [2.01, 0.98])).toEqual({ s: [1, 2.2], t: [2, 5] });
    expect(zonaEntre(0, "x", [0, 0], [0.04, 3])).toBeNull();
    const zona = zonaEntre(0, "x-inf", [0, 0], [3, 1.5])!;
    const r = conElemento(ARMADO, { armadura: "x-inf", ...zona, barras: { diametro: 12, separacion: 200 } });
    expect(r.elemento).toEqual({ lista: "refuerzos", indice: 2 });
    expect(r.armado.refuerzos).toHaveLength(3);
    expect(zonaElemento(0, r.armado, r.elemento)).toMatchObject({ s: [0, 3], t: [0, 1.5] });
    const c = conElemento({ base } as ArmadoForjado, { direccion: "x", ...zona, cercos: { diametro: 6, separacion: 150 } });
    expect(c.elemento).toEqual({ lista: "cercos", indice: 0 });
    expect(ARMADO.refuerzos).toHaveLength(2);
  });
});
