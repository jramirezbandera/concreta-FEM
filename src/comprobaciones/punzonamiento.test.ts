/**
 * Fase CO4 (`docs/fem3d/comprobaciones.md` §8.7): el punzonamiento.
 *
 *  - el módulo, tal como lo llama el adaptador, frente a un oráculo que no es de Concreta
 *    (`validacion/co/oraculo_punzonamiento.py`: las fórmulas del Anejo 19 §6.4 escritas aparte);
 *  - la geometría: los rayos, la posición, el pilar retranqueado, los huecos y lo que queda fuera;
 *  - lo que la losa pasa a los pilares: en equilibrio con la carga de la losa, a 1e-9;
 *  - la identidad con las combinaciones una a una, el giro de 90°, el sismo, la propuesta y el
 *    armado como dato del proyecto.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { losaPlana } from "../../validacion/co/modelosLosas.ts";
import { losaBordes } from "../../validacion/co/modelosPunzonamiento.ts";
import { comprobarArmado, seguirPilares, type ArmadoProyecto } from "../agente/armaduraBase.ts";
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { ejesArmado } from "../compilador/franjas.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import type { ArmadoForjado, ArmaduraPunzonamiento, BarrasForjado } from "./armado.ts";
import { proponerPunzonamiento, tablaPunzonamiento } from "./armar/punzonamiento.ts";
import { armadoPunzonamiento, comprobarPunzonamiento, geometria, kExcentricidad } from "./comprobar/punzonamiento.ts";
import { areaCargada, demandasPunzonamiento, salida, type DemandaPunzonamiento, type FormaArea } from "./demandas/punzonamiento.ts";
import { armadoPropuestoLosas, comprobarLosas } from "./losas.ts";
import { armadoPropuestoPunzonamiento, comprobarPunzonamientos } from "./punzonamiento.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const cerca = (a: number, b: number, tol: number, que: string) => expect(Math.abs(a - b) / Math.max(1e-12, Math.abs(b)), `${que}: ${a} frente a ${b}`).toBeLessThanOrEqual(tol);

/** Una demanda hecha a mano: un pilar en c, en una losa maciza de contorno dado, con sus combinaciones. */
function demanda(o: { contorno: Vec2[]; huecos?: Vec2[][]; c: Vec2; forma: FormaArea; giro?: number; espesor: number; fck?: number; combos: { Fz: number; Mx?: number; My?: number; aFz?: number; aMx?: number; aMy?: number }[]; tramo?: "inferior" | "superior" }): DemandaPunzonamiento {
  const tramo = o.tramo ?? "inferior";
  return {
    pilar: "P",
    planta: "F",
    losa: "L",
    espesor: o.espesor,
    material: { id: "H", tipo: "hormigon", fck: o.fck ?? 25 },
    reticular: false,
    cimentacion: false,
    ejes: ejesArmado({ eje1: 0 }),
    punto: o.c,
    areas: { [tramo]: areaCargada(o.c, o.giro ?? 0, o.forma, "S", tramo, [o.contorno], null) },
    contornos: [o.contorno],
    huecos: o.huecos ?? [],
    vigasPlanas: [],
    vigas: [],
    combos: o.combos.map((c, i) => ({ nombre: `C${i + 1}`, Fz: c.Fz, Mx: c.Mx ?? 0, My: c.My ?? 0, aFz: c.aFz ?? 0, aMx: c.aMx ?? 0, aMy: c.aMy ?? 0, FzVigasPlanas: 0 })),
  };
}

const parrilla = (x: BarrasForjado, y: BarrasForjado = x): ArmadoForjado => ({ base: { "x-inf": x, "x-sup": x, "y-inf": y, "y-sup": y } });
const P12 = parrilla({ diametro: 12, separacion: 150 });

interface Caso {
  id: string;
  posicion: "interior" | "borde" | "esquina";
  circular?: boolean;
  h: number;
  recubrimiento: number;
  fck: number;
  fyk: number;
  c1: number;
  c2: number;
  a?: number;
  a2?: number;
  x: [number, number];
  y: [number, number];
  V: number;
  e1?: number;
  e2?: number;
  cercos?: [number, number, number];
  d: number;
  u1: number;
  u0: number;
  beta: number;
  vEd: number;
  vEd0: number;
  vRdc: number;
  vRdmax: number;
  vRdcs?: number;
  uout: number;
}

describe("CO4: el módulo de punzonamiento, como lo llama el adaptador, frente al oráculo independiente", () => {
  const { casos } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "validacion", "co", "oraculo-punzonamiento.json"), "utf8")) as { casos: Caso[] };
  for (const c of casos) {
    it(c.id, () => {
      // El pilar en el origen, con c1 según X (su canto h): el borde libre, en +X; el segundo, en +Y
      const [h, b] = [c.c1 / 1000, c.c2 / 1000];
      const x1 = c.posicion === "interior" ? 20 : h / 2 + (c.a ?? 0) / 1000;
      const y1 = c.posicion === "esquina" ? b / 2 + (c.a2 ?? 0) / 1000 : 20;
      // e1 va hacia dentro (−X) en borde y esquina; la losa cuelga del pilar: Fz = −V, e = (−My/Fz, Mx/Fz)
      const ex = ((c.posicion === "interior" ? 1 : -1) * (c.e1 ?? 0)) / 1000;
      const ey = (c.e2 ?? 0) / 1000;
      const D = demanda({
        contorno: rect(-20, -20, x1, y1),
        c: [0, 0],
        forma: c.circular ? { tipo: "circulo", D: h } : { tipo: "rectangulo", h, b },
        espesor: c.h / 1000,
        fck: c.fck,
        combos: [{ Fz: -c.V, Mx: -c.V * ey, My: c.V * ex }],
      });
      const cercos: ArmaduraPunzonamiento | undefined = c.cercos ? { diametro: c.cercos[0], ramas: c.cercos[1], separacion: c.cercos[2] } : undefined;
      const a = armadoPunzonamiento(parrilla({ diametro: c.x[0], separacion: c.x[1] }, { diametro: c.y[0], separacion: c.y[1] }), cercos, { fyk: c.fyk, recubrimiento: c.recubrimiento });
      const r = comprobarPunzonamiento(D, a);
      expect(r.pendientes).toEqual([]);
      expect(r.casos.length).toBe(1);
      const k = r.casos[0]!;
      expect(k.cara).toBe("superior");
      expect(k.posicion).toBe(c.posicion);
      cerca(k.d, c.d, 1e-12, "d");
      cerca(k.u1, c.u1, 1e-9, "u1");
      cerca(k.u1Eficaz, c.u1, 1e-9, "u1 eficaz");
      cerca(k.beta, c.beta, 1e-9, "β");
      cerca(k.VEd, c.V, 1e-12, "VEd");
      cerca(k.resultado.u0, c.u0, 1e-9, "u0");
      cerca(k.resultado.vEd, c.vEd, 1e-9, "vEd");
      cerca(k.resultado.vEd0, c.vEd0, 1e-9, "vEd en u0");
      cerca(k.resultado.vRdc, c.vRdc, 1e-9, "vRd,c");
      // (CO4-1: el módulo toma el fcd tabulado, redondeado a 0,1 MPa: 16,7 en vez de 16,667 con HA-25)
      cerca(k.resultado.vRdmax, c.vRdmax, 2.5e-3, "vRd,max");
      cerca(k.resultado.uout, c.uout, 1e-9, "uout");
      // (el área de las ramas, la tabulada del módulo: 50,3 mm² el Ø8, en vez de 50,27)
      if (c.vRdcs !== undefined) cerca(k.resultado.vRdcs!, c.vRdcs, 1e-3, "vRd,cs");
      // Las filas: el cociente de cada una es el de sus tensiones
      const fila = (id: string) => r.filas.find((f) => f.id === `superior/${id}`);
      cerca(fila("punz-ved-max")!.aprovechamiento, c.vEd0 / c.vRdmax, 2.5e-3, "fila vRd,max");
      cerca(fila("punz-ved-vrdc")!.aprovechamiento, c.vEd / c.vRdc, 1e-6, "fila vRd,c");
      if (c.vRdcs !== undefined) {
        cerca(fila("punz-ved-vrdcs")!.aprovechamiento, c.vEd / c.vRdcs, 1e-3, "fila vRd,cs");
        expect(fila("punz-ved-vrdc")!.informativa).toBe(true);
        cerca(r.aprovechamiento, Math.max(c.vEd / c.vRdcs, c.vEd0 / c.vRdmax), 2.5e-3, "aprovechamiento");
      } else cerca(r.aprovechamiento, Math.max(c.vEd / c.vRdc, c.vEd0 / c.vRdmax), 2.5e-3, "aprovechamiento");
      cerca(r.sinArmadura, c.vEd / c.vRdc, 1e-9, "vEd/vRd,c");
    });
  }
});

describe("CO4: la geometría del perímetro", () => {
  const CUADRADO: FormaArea = { tipo: "rectangulo", h: 0.4, b: 0.4 };
  const d = 0.2;

  it("los rayos: la salida del forjado, con dos losas que comparten un lado", () => {
    expect(salida([0, 0], [1, 0], [rect(-5, -5, 5, 5)])).toBeCloseTo(5, 12);
    // Dos losas contiguas: el lado común no es un borde
    expect(salida([0, 0], [1, 0], [rect(-5, -5, 5, 5), rect(5, -5, 9, 5)])).toBeCloseTo(9, 12);
    // Con un hueco entre las dos, sí
    expect(salida([0, 0], [1, 0], [rect(-5, -5, 5, 5), rect(6, -5, 9, 5)])).toBeCloseTo(5, 12);
    expect(salida([7, 0], [1, 0], [rect(-5, -5, 5, 5)])).toBe(0);
  });

  it("k de la tabla A19.6.1, interpolada", () => {
    expect(kExcentricidad(0.3)).toBe(0.45);
    expect(kExcentricidad(1)).toBeCloseTo(0.6, 12);
    expect(kExcentricidad(1.5)).toBeCloseTo(0.65, 12);
    expect(kExcentricidad(5)).toBe(0.8);
  });

  const geo = (contorno: Vec2[], c: Vec2, huecos: Vec2[][] = [], forma: FormaArea = CUADRADO, giro = 0) => geometria({ contornos: [contorno], huecos }, areaCargada(c, giro, forma, "S", "inferior", [contorno], null), d);

  it("interior, borde y esquina, con el pilar enrasado", () => {
    const g0 = geo(rect(-10, -10, 10, 10), [0, 0]);
    if ("motivo" in g0) throw new Error(g0.motivo);
    expect(g0.posicion).toBe("interior");
    cerca(g0.u1, 2 * (400 + 400) + 4 * Math.PI * 200, 1e-12, "u1 interior");
    expect(g0.u1Eficaz).toBeCloseTo(g0.u1, 6);
    const g1 = geo(rect(-10, -10, 0.2, 10), [0, 0]);
    if ("motivo" in g1) throw new Error(g1.motivo);
    expect(g1.posicion).toBe("borde");
    cerca(g1.u1, 400 + 2 * 400 + 2 * Math.PI * 200, 1e-12, "u1 borde");
    expect(g1.u1Eficaz).toBeCloseTo(g1.u1, 6);
    const g2 = geo(rect(-10, -10, 0.2, 0.2), [0, 0]);
    if ("motivo" in g2) throw new Error(g2.motivo);
    expect(g2.posicion).toBe("esquina");
    cerca(g2.u1, 400 + 400 + Math.PI * 200, 1e-12, "u1 esquina");
    expect(g2.u1Eficaz).toBeCloseTo(g2.u1, 6);
  });

  it("el pilar retranqueado: el área se prolonga hasta el borde, y deja de ser de borde donde el perímetro cerrado es más corto", () => {
    // Libre mientras a < c∥/2 + π·d = 0,2 + 0,628
    const g = geo(rect(-10, -10, 0.2 + 0.5, 10), [0, 0]);
    if ("motivo" in g) throw new Error(g.motivo);
    expect(g.posicion).toBe("borde");
    cerca(g.cy, 900, 1e-9, "c⊥ prolongada");
    cerca(g.u1, 400 + 2 * 900 + 2 * Math.PI * 200, 1e-12, "u1");
    // El perímetro que muere en el borde no es mayor que el cerrado
    expect(g.u1).toBeLessThanOrEqual(2 * 800 + 4 * Math.PI * 200);
    const lejos = geo(rect(-10, -10, 0.2 + 0.83, 10), [0, 0]);
    if ("motivo" in lejos) throw new Error(lejos.motivo);
    expect(lejos.posicion).toBe("interior");
    // Con la cara fuera de la losa (el contorno, por el eje del pilar), sólo cuenta lo de dentro
    const eje = geo(rect(-10, -10, 0, 10), [0, 0]);
    if ("motivo" in eje) throw new Error(eje.motivo);
    expect(eje.posicion).toBe("borde");
    cerca(eje.cy, 200, 1e-9, "c⊥ con el contorno por el eje");
    // Y en la esquina del contorno, de esquina, con un cuarto del pilar
    const esquina = geo(rect(-10, -10, 0, 0), [0, 0]);
    if ("motivo" in esquina) throw new Error(esquina.motivo);
    expect(esquina.posicion).toBe("esquina");
    cerca(esquina.cx, 200, 1e-9, "esquina: cx");
    cerca(esquina.cy, 200, 1e-9, "esquina: cy");
    const casi = geo(rect(-10, -10, 0.05, 10), [0, 0]);
    if ("motivo" in casi) throw new Error(casi.motivo);
    cerca(casi.cy, 250, 1e-9, "c⊥ dentro de la losa");
  });

  it("un pilar girado 90° cambia sus ejes, no el perímetro; girado 30° junto a un borde, el perímetro más corto", () => {
    const R: FormaArea = { tipo: "rectangulo", h: 0.6, b: 0.3 };
    const g = geo(rect(-10, -10, 0.15, 10), [0, 0], [], R, 90);
    if ("motivo" in g) throw new Error(g.motivo);
    expect(g.posicion).toBe("borde");
    // El borde es paralelo al canto: c∥ = 600, c⊥ = 300
    cerca(g.cx, 600, 1e-9, "c∥");
    cerca(g.cy, 300, 1e-9, "c⊥");
    const o = geo(rect(-10, -10, 0.4, 10), [0, 0], [], R, 30);
    if ("motivo" in o) return;
    expect(o.u1Eficaz).toBeLessThanOrEqual(o.u1 + 1e-9);
  });

  it("dos caras opuestas libres, un circular de borde y un centro fuera de la losa quedan pendientes", () => {
    expect(geo(rect(-0.2, -10, 0.2, 10), [0, 0])).toHaveProperty("motivo");
    expect(geo(rect(-10, -10, 0.225, 10), [0, 0], [], { tipo: "circulo", D: 0.45 })).toHaveProperty("motivo");
    expect(geo(rect(-10, -10, -1, 10), [0, 0])).toHaveProperty("motivo");
  });

  /** La longitud del perímetro a 2·d de un cuadrado de lado c (centrado) entre dos ángulos, por integración en polares (aparte de la del adaptador). */
  function tramo(c: number, r: number, t0: number, t1: number): number {
    const radio = (t: number): number => {
      // El contorno desplazado: lados a c/2 + r y cuartos de círculo de radio r en las esquinas
      const [ux, uy] = [Math.abs(Math.cos(t)), Math.abs(Math.sin(t))];
      const [a, b] = ux >= uy ? [ux, uy] : [uy, ux];
      const lado = (c / 2 + r) / a;
      if (lado * b <= c / 2) return lado;
      // El arco: |ρ·(a, b) − (c/2, c/2)| = r
      const p = (c / 2) * (a + b);
      return p + Math.sqrt(p * p - (c * c) / 2 + r * r);
    };
    const N = 200_000;
    let L = 0;
    let [px, py] = [radio(t0) * Math.cos(t0), radio(t0) * Math.sin(t0)];
    for (let i = 1; i <= N; i++) {
      const t = t0 + ((t1 - t0) * i) / N;
      const [x, y] = [radio(t) * Math.cos(t), radio(t) * Math.sin(t)];
      L += Math.hypot(x - px, y - py);
      [px, py] = [x, y];
    }
    return L;
  }

  it("un hueco a menos de 6·d quita lo que queda entre sus tangentes desde el centro; más lejos, nada", () => {
    // Un hueco de 0,5 × 0,6 con su esquina en (0,5; 0,1): visto desde el centro, de atan2(0,1; 1) a atan2(0,7; 0,5)
    const hueco = rect(0.5, 0.1, 1.0, 0.7);
    const g = geo(rect(-10, -10, 10, 10), [0, 0], [hueco]);
    if ("motivo" in g) throw new Error(g.motivo);
    expect(g.posicion).toBe("interior");
    const quita = 1000 * tramo(0.4, 2 * d, Math.atan2(0.1, 1.0), Math.atan2(0.7, 0.5));
    // (el adaptador mide el perímetro por puntos: 48 por tramo)
    cerca(g.u1 - g.u1Eficaz, quita, 0.03, "lo que quita el hueco");
    expect(g.u1Eficaz).toBeLessThan(g.u1);
    // A más de 6·d = 1,2 m de la cara
    const lejos = geo(rect(-10, -10, 10, 10), [0, 0], [rect(1.5, -0.3, 2.5, 0.3)]);
    if ("motivo" in lejos) throw new Error(lejos.motivo);
    expect(lejos.u1Eficaz).toBeCloseTo(lejos.u1, 6);
    // El centro en un hueco, pendiente
    expect(geo(rect(-10, -10, 10, 10), [0, 0], [rect(-1, -1, 1, 1)])).toHaveProperty("motivo");
  });

  it("lo que el perímetro tiene fuera del forjado no cuenta: un pilar en una esquina entrante", () => {
    // Una L: falta el cuadrante de x > 0,2 e y > 0,2
    const L: Vec2[] = [[-10, -10], [10, -10], [10, 0.2], [0.2, 0.2], [0.2, 10], [-10, 10]];
    const g = geo(L, [0, 0]);
    if ("motivo" in g) throw new Error(g.motivo);
    expect(g.posicion).toBe("interior");
    // Falta el cuarto de círculo de esa esquina
    cerca(g.u1 - g.u1Eficaz, (Math.PI / 2) * 400, 0.03, "el cuarto de círculo");
  });
});

describe("CO4: la demanda que manda y las dos caras", () => {
  const base = { contorno: rect(-10, -10, 10, 10), c: [0, 0] as Vec2, forma: { tipo: "rectangulo", h: 0.4, b: 0.4 } as FormaArea, espesor: 0.25 };
  const a = armadoPunzonamiento(P12, undefined);

  it("manda el mayor β·VEd, no el mayor VEd: la identidad con las combinaciones una a una", () => {
    const combos = [
      { Fz: -400, Mx: 0, My: 0 },
      { Fz: -380, Mx: 60, My: -20 },
      { Fz: -300, Mx: 10, My: 90 },
    ];
    const todas = comprobarPunzonamiento(demanda({ ...base, combos }), a);
    const una = combos.map((c) => comprobarPunzonamiento(demanda({ ...base, combos: [c] }), a));
    const vEd = una.map((r) => r.casos[0]!.resultado.vEd);
    expect(todas.casos[0]!.resultado.vEd).toBe(Math.max(...vEd));
    // La que manda no es la de mayor VEd
    expect(todas.casos[0]!.comb).toBe("C2");
    expect(todas.casos[0]!.VEd).toBe(380);
    for (const f of todas.filas) expect(f.aprovechamiento).toBe(Math.max(...una.map((r) => r.filas.find((x) => x.id === f.id)!.aprovechamiento)));
  });

  it("con el sismo, cada componente con su peor signo: nunca menos que sin él", () => {
    const sin = comprobarPunzonamiento(demanda({ ...base, combos: [{ Fz: -300, Mx: 20, My: -30 }] }), a);
    const con = comprobarPunzonamiento(demanda({ ...base, combos: [{ Fz: -300, Mx: 20, My: -30, aFz: 25, aMx: 40, aMy: 15 }] }), a);
    // Lo mismo que la estática con los valores absolutos aumentados
    const igual = comprobarPunzonamiento(demanda({ ...base, combos: [{ Fz: -325, Mx: 60, My: -45 }] }), a);
    expect(con.casos[0]!.resultado.vEd).toBeGreaterThan(sin.casos[0]!.resultado.vEd);
    cerca(con.casos[0]!.resultado.vEd, igual.casos[0]!.resultado.vEd, 1e-12, "vEd");
  });

  it("si el pilar carga sobre la losa (apeo, cimentación), tracciona la cara inferior, con el tramo de encima", () => {
    const D = demanda({ ...base, tramo: "superior", combos: [{ Fz: 350 }] });
    const inf: ArmadoForjado = { base: { "x-inf": { diametro: 16, separacion: 150 }, "y-inf": { diametro: 16, separacion: 150 }, "x-sup": { diametro: 8, separacion: 300 }, "y-sup": { diametro: 8, separacion: 300 } } };
    const r = comprobarPunzonamiento(D, armadoPunzonamiento(inf, undefined));
    expect(r.casos.map((c) => `${c.cara}/${c.tramo}`)).toEqual(["inferior/superior"]);
    expect(r.casos[0]!.entrada.mode).toBe("carga-puntual");
    // d, con las barras de abajo (Ø16): 250 − 30 − 0,75·16 − 0,25·16
    expect(r.casos[0]!.d).toBe(250 - 30 - 16);
    // Con las dos cargas en combinaciones distintas, las dos caras
    const dos = comprobarPunzonamiento({ ...D, combos: [...D.combos, { ...D.combos[0]!, nombre: "C2", Fz: -200 }] }, armadoPunzonamiento(inf, undefined));
    expect(dos.casos.map((c) => c.cara)).toEqual(["superior", "inferior"]);
  });

  it("sin carga, nada que comprobar; sin armadura en la cara, sin hormigón o con una sección en I, pendiente", () => {
    expect(comprobarPunzonamiento(demanda({ ...base, combos: [{ Fz: -0.5 }] }), a)).toMatchObject({ casos: [], filas: [], pendientes: [], cumple: true });
    const acero = { ...demanda({ ...base, combos: [{ Fz: -300 }] }), material: { id: "S", tipo: "acero" as const, fy: 275 } };
    expect(comprobarPunzonamiento(acero as DemandaPunzonamiento, a).cumple).toBe(false);
    const D = demanda({ ...base, combos: [{ Fz: -300 }] });
    const perfil = { ...D, areas: { inferior: { ...D.areas.inferior!, forma: null } } };
    const r = comprobarPunzonamiento(perfil, a);
    expect(r.cumple).toBe(false);
    expect(r.pendientes[0]!.motivo).toMatch(/rectangular ni circular/);
  });

  it("los refuerzos que cubren al pilar suben la cuantía; los que no, no", () => {
    const D = demanda({ ...base, combos: [{ Fz: -500 }] });
    const con = (refuerzos: ArmadoForjado["refuerzos"]) => comprobarPunzonamiento(D, armadoPunzonamiento({ ...P12, refuerzos }, undefined)).casos[0]!;
    const sin = con([]);
    const cubre = con([
      { armadura: "x-sup", s: [-1, 1], t: [-1, 1], barras: { diametro: 16, separacion: 150 } },
      { armadura: "y-sup", s: [-1, 1], t: [-1, 1], barras: { diametro: 16, separacion: 150 } },
    ]);
    const lejos = con([{ armadura: "x-sup", s: [2, 4], t: [-1, 1], barras: { diametro: 16, separacion: 150 } }]);
    const abajo = con([{ armadura: "x-inf", s: [-1, 1], t: [-1, 1], barras: { diametro: 16, separacion: 150 } }]);
    // CO4-f: uno estrecho cuenta por la parte que cubre de la banda (el pilar más 3·d a cada lado)
    const estrecho = con([
      { armadura: "x-sup", s: [-1, 1], t: [-0.3, 0.3], barras: { diametro: 16, separacion: 150 } },
      { armadura: "y-sup", s: [-1, 1], t: [-0.3, 0.3], barras: { diametro: 16, separacion: 150 } },
    ]);
    const banda = 0.4 + 6 * (250 - 30 - 12) / 1000;
    cerca(estrecho.as[0], sin.as[0] + ((Math.PI * 64 * 1000) / 150) * (0.6 / banda), 1e-12, "as con un refuerzo estrecho");
    expect(estrecho.resultado.vRdc).toBeLessThan(cubre.resultado.vRdc);
    expect(cubre.resultado.vRdc).toBeGreaterThan(sin.resultado.vRdc);
    expect(lejos.resultado.vRdc).toBe(sin.resultado.vRdc);
    expect(abajo.resultado.vRdc).toBe(sin.resultado.vRdc);
    cerca(cubre.as[0], sin.as[0] + (Math.PI * 64 * 1000) / 150, 1e-12, "as");
  });
});

describe("CO4: proponer la armadura de punzonamiento", () => {
  const base = { contorno: rect(-10, -10, 10, 10), c: [0, 0] as Vec2, forma: { tipo: "rectangulo", h: 0.4, b: 0.4 } as FormaArea, espesor: 0.25 };
  const a = armadoPunzonamiento(P12, undefined);

  it("la tabla va de menos a más acero", () => {
    const t = tablaPunzonamiento();
    const acero = (x: ArmaduraPunzonamiento) => (x.ramas * x.diametro * x.diametro) / x.separacion;
    for (let i = 1; i < t.length; i++) expect(acero(t[i]!)).toBeGreaterThanOrEqual(acero(t[i - 1]!) - 1e-12);
  });

  it("si basta sin armadura, no propone ninguna", () => {
    const p = proponerPunzonamiento(demanda({ ...base, combos: [{ Fz: -300 }] }), a);
    expect(p).toMatchObject({ armadura: null, probados: 0 });
    expect(p.comprobacion.cumple).toBe(true);
  });

  it("la propuesta cumple y las anteriores de la tabla no", () => {
    const D = demanda({ ...base, combos: [{ Fz: -520, Mx: 20 }] });
    const p = proponerPunzonamiento(D, a);
    expect(p.armadura).not.toBeNull();
    expect(p.comprobacion.cumple).toBe(true);
    expect(p.comprobacion.sinArmadura).toBeGreaterThan(1);
    const t = tablaPunzonamiento();
    const i = t.findIndex((x) => x.diametro === p.armadura!.diametro && x.ramas === p.armadura!.ramas && x.separacion === p.armadura!.separacion);
    expect(p.probados).toBe(i + 1);
    for (const x of t.slice(0, i)) expect(comprobarPunzonamiento(D, { ...a, cercos: x }).cumple).toBe(false);
    // Los perímetros: el primero a d/2 y hasta 1,5·d de uout
    const k = p.comprobacion.casos[0]!;
    expect(k.perimetros).toBeGreaterThanOrEqual(2);
    // Determinista
    expect(proponerPunzonamiento(D, a).armadura).toEqual(p.armadura);
  });

  it("si los cercos no lo arreglan (más de 1,5·vRd,c, o vRd,max), no hay propuesta y se dice", () => {
    const p = proponerPunzonamiento(demanda({ ...base, combos: [{ Fz: -900 }] }), a);
    expect(p.armadura).toBeNull();
    expect(p.motivo).toMatch(/canto/);
    expect(p.comprobacion.cumple).toBe(false);
    const q = proponerPunzonamiento(demanda({ ...base, forma: { tipo: "rectangulo", h: 0.2, b: 0.2 }, combos: [{ Fz: -1500 }] }), a);
    expect(q.armadura).toBeNull();
    expect(q.probados).toBe(0);
  });
});

function consultas(f: ModeloFisico): Consultas {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return new Consultas(f, c, r.casos, {}, r.modal);
}

describe("CO4: lo que la losa pasa a los pilares, en un modelo", () => {
  it("está en equilibrio con la carga de la losa: fuerza y momentos, caso a caso", () => {
    const f = losaBordes();
    const q = consultas(f);
    const [x0, x1] = [-0.2, 10.2];
    const A = (x1 - x0) * (x1 - x0);
    const casos = q.fisico.casos.map((c) => c.id);
    const uno = (id: string) => casos.map((c) => (c === id ? 1 : 0));
    for (const [caso, carga] of [["CM", 2], ["Q", 3]] as const) {
      let [Fz, Mx, My] = [0, 0, 0];
      for (const p of f.pilares!) {
        const t = q.transmitidoPilar(p.id, "P1");
        if (!t.valido || !t.valor) throw new Error("sin unión");
        expect(t.valor.losa).toBe("L");
        const r = q.punzonamiento(p.id, "P1", [uno(caso)]);
        if (!r.valido || !r.valor) throw new Error("sin punzonamiento");
        const e = r.valor[0]!.estatica;
        // Sin vigas, todo llega por la losa
        expect([e[3], e[4], e[5]]).toEqual([0, 0, 0]);
        Fz += e[0]!;
        // Respecto al origen: M + r × F, con F = (0, 0, Fz)
        Mx += e[1]! + p.y * e[0]!;
        My += e[2]! - p.x * e[0]!;
      }
      // La carga: −q·A en el centro de la planta (5, 5)
      cerca(Fz, -carga * A, 1e-9, `${caso}: ΣFz`);
      cerca(Mx, -carga * A * 5, 1e-9, `${caso}: ΣMx`);
      cerca(My, carga * A * 5, 1e-9, `${caso}: ΣMy`);
    }
    // El peso propio: el de la losa (25 kN/m³ por defecto)
    const g = f.pilares!.reduce((s, p) => s + (q.punzonamiento(p.id, "P1", [uno("G")]) as { valor: { estatica: Float64Array }[] }).valor[0]!.estatica[0]!, 0);
    cerca(g, -25 * 0.25 * A, 1e-9, "G: ΣFz");
  });

  it("es, salvo el peso del pilar en su zona rígida, la diferencia de axiles del pilar", () => {
    const q = consultas(losaBordes());
    const casos = q.fisico.casos.map((c) => c.id);
    const f = casos.map((c) => (c === "Q" ? 1 : 0));
    for (const id of ["P00", "P01", "P11"]) {
      const r = q.punzonamiento(id, "P1", [f]);
      const t = q.pilar(id);
      if (!r.valido || !r.valor || !t.valido) throw new Error("sin datos");
      const N = q.combinar(t.valor[0]!.cabeza.esfuerzos, 6, f)[0]!;
      cerca(r.valor[0]!.estatica[0]!, N, 1e-9, `${id}: Fz y N`);
    }
  });

  it("las posiciones salen de la geometría: esquinas, bordes e interior; y girar la planta 90° no cambia nada", () => {
    const comprobar = (f: ModeloFisico) => {
      const q = consultas(f);
      const l = comprobarLosas(q, undefined, undefined, { proponer: true });
      if (!l.valido) throw new Error("losas");
      const p = comprobarPunzonamientos(q, armadoPropuestoLosas(l.valor, undefined), undefined, undefined, { proponer: true, filas: true });
      if (!p.valido) throw new Error("punzonamiento");
      return p.valor;
    };
    const v = comprobar(losaBordes({ sinImperfeccion: true }));
    expect(v.pilares.length).toBe(9);
    const pos = Object.fromEntries(v.pilares.map((p) => [p.pilar, p.posicion]));
    expect(pos).toMatchObject({ P00: "esquina", P02: "esquina", P20: "esquina", P22: "esquina", P01: "borde", P10: "borde", P12: "borde", P21: "borde", P11: "interior" });
    expect(v.resumen).toMatchObject({ uniones: 9, pendientes: 0, sinArmadoLosa: 0 });
    // El central, simétrico: β = 1; los de borde, por encima de u1/u1*
    const de = (id: string) => v.pilares.find((p) => p.pilar === id)!;
    expect(de("P11").beta!).toBeLessThan(1.01);
    expect(de("P01").beta!).toBeGreaterThan(1.1);
    expect(de("P00").beta!).toBeGreaterThan(1.3);
    // Girada: las mismas demandas y los mismos resultados (la malla no es la misma: a 1e-6)
    const g = comprobar(losaBordes({ sinImperfeccion: true, girada: true }));
    for (const p of v.pilares) {
      const o = g.pilares.find((x) => x.pilar === p.pilar)!;
      expect(o.posicion).toBe(p.posicion);
      expect(o.armadura).toEqual(p.armadura);
      cerca(o.VEd!, p.VEd!, 1e-6, `${p.pilar}: VEd`);
      cerca(o.beta!, p.beta!, 1e-6, `${p.pilar}: β`);
      cerca(o.aprovechamiento!, p.aprovechamiento!, 1e-6, `${p.pilar}: aprovechamiento`);
    }
  }, 120_000);

  it("la demanda de un modelo, combinación a combinación: manda la de mayor β·VEd", () => {
    const q = consultas(losaBordes());
    const d = demandasPunzonamiento(q, ["P01"]);
    if (!d.valido) throw new Error("demandas");
    const D = d.valor.demandas[0]!;
    expect(D.combos.length).toBe(d.valor.combinaciones);
    expect(D.combos.length).toBeGreaterThan(1);
    const a = armadoPunzonamiento(P12, undefined);
    const todas = comprobarPunzonamiento(D, a);
    const una = D.combos.map((c) => comprobarPunzonamiento({ ...D, combos: [c] }, a).casos[0]?.resultado.vEd ?? 0);
    expect(todas.casos[0]!.resultado.vEd).toBe(Math.max(...una));
    expect(todas.casos[0]!.comb).toBe(D.combos[una.indexOf(Math.max(...una))]!.nombre);
  });

  it("con el sismo del programa, nunca menos que sin él", () => {
    const con = consultas(losaPlana({ sismo: true }));
    const sin = consultas(losaPlana());
    const a = armadoPunzonamiento(P12, undefined);
    const de = (q: Consultas) => {
      const d = demandasPunzonamiento(q);
      if (!d.valido) throw new Error("demandas");
      return d.valor.demandas.map((D) => ({ pilar: D.pilar, v: comprobarPunzonamiento(D, a).casos[0]!.resultado.vEd }));
    };
    const [c, s] = [de(con), de(sin)];
    expect(c.length).toBe(9);
    for (const x of c) expect(x.v).toBeGreaterThanOrEqual(s.find((y) => y.pilar === x.pilar)!.v * (1 - 1e-9));
  }, 120_000);

  it("en un reticular, el perímetro en el ábaco: con la parrilla de los ábacos y sus filas propias", () => {
    const q = consultas(losaBordes({ luz: 6, reticular: true }));
    const l = comprobarLosas(q, undefined, undefined, { proponer: true });
    if (!l.valido) throw new Error("losas");
    const forjados = armadoPropuestoLosas(l.valor, undefined);
    const p = comprobarPunzonamientos(q, forjados, undefined, undefined, { filas: true, ids: ["P11", "P00"] });
    if (!p.valido) throw new Error("punzonamiento");
    expect(p.valor.pilares.map((x) => x.pilar)).toEqual(["P00", "P11"]);
    for (const x of p.valor.pilares) {
      const abaco = x.filas!.find((f) => f.id === "superior/abaco-u1")!;
      expect(abaco.estado).toBe("ok");
      // El ábaco de 2,8 m: de la cara del pilar (0,2) a su borde, 1,2 m; el perímetro, a 2·d
      cerca(abaco.aprovechamiento!, (2 * x.d!) / 1200, 1e-9, "2·d/ábaco");
    }
    // Sin la parrilla de los ábacos, pendiente
    const { abacos: _a, ...sin } = forjados.L!;
    const r = comprobarPunzonamientos(q, { L: sin }, undefined, undefined, { ids: ["P11"] });
    if (!r.valido) throw new Error("punzonamiento");
    expect(r.valor.pilares[0]!.cumple).toBe(false);
    expect(r.valor.pilares[0]!.pendientes[0]!.motivo).toMatch(/parrilla de los ábacos/);
  }, 120_000);

  it("sin armado de la losa no se da por comprobado; lo propuesto se guarda por pilar y planta", () => {
    const q = consultas(losaBordes({ luz: 7, h: 0.3 }));
    const sin = comprobarPunzonamientos(q, undefined, undefined, undefined);
    if (!sin.valido) throw new Error("punzonamiento");
    expect(sin.valor.resumen).toMatchObject({ uniones: 9, cumplen: 0, sinArmadoLosa: 9 });
    expect(sin.diagnosticos.some((d) => d.codigo === "comprobacion/sin-armado")).toBe(true);
    const l = comprobarLosas(q, undefined, undefined, { proponer: true });
    if (!l.valido) throw new Error("losas");
    const forjados = armadoPropuestoLosas(l.valor, undefined);
    const p = comprobarPunzonamientos(q, forjados, undefined, undefined, { proponer: true });
    if (!p.valido) throw new Error("punzonamiento");
    expect(p.valor.resumen.conArmadura).toBeGreaterThan(0);
    const armado = armadoPropuestoPunzonamiento(p.valor, { P11: { P1: { diametro: 12, ramas: 4, separacion: 75 } }, P00: { OTRA: { diametro: 8, ramas: 2, separacion: 150 } } });
    for (const x of p.valor.pilares) expect(armado[x.pilar]?.P1).toEqual(x.armadura);
    // Lo de otra planta se queda
    expect(armado.P00!.OTRA).toBeDefined();
    // Con lo propuesto en el proyecto, cumple lo mismo
    const c = comprobarPunzonamientos(q, forjados, armado, undefined);
    if (!c.valido) throw new Error("punzonamiento");
    expect(c.valor.pilares.map((x) => [x.pilar, x.cumple, x.origen === "proyecto"])).toEqual(p.valor.pilares.map((x) => [x.pilar, x.cumple, x.armadura !== undefined]));
    // Y sin ella, donde hacía falta, no
    const nada = comprobarPunzonamientos(q, forjados, undefined, undefined);
    if (!nada.valido) throw new Error("punzonamiento");
    for (const x of nada.valor.pilares) expect(x.cumple).toBe(p.valor.pilares.find((y) => y.pilar === x.pilar)!.armadura === undefined);
  }, 120_000);
});

describe("CO4: la armadura de punzonamiento, en el proyecto", () => {
  const modelo = losaBordes();
  const bien: ArmadoProyecto = { punzonamiento: { P11: { P1: { diametro: 8, ramas: 2, separacion: 150 } } } };

  it("se valida: el pilar, la planta y las barras", () => {
    expect(comprobarArmado(bien, modelo)).toEqual([]);
    expect(comprobarArmado({ punzonamiento: { NADIE: { P1: { diametro: 8, ramas: 2, separacion: 150 } } } }, modelo).map((d) => d.codigo)).toEqual(["armado/pilar"]);
    expect(comprobarArmado({ punzonamiento: { P11: { NADA: { diametro: 8, ramas: 2, separacion: 150 } } } }, modelo).map((d) => d.codigo)).toEqual(["armado/planta"]);
    expect(comprobarArmado({ punzonamiento: { P11: { P1: { diametro: 9, ramas: 0, separacion: -1 } } } }, modelo).map((d) => d.codigo)).toEqual(["armado/barras", "armado/barras", "armado/barras"]);
  });

  it("sigue a su pilar y a su planta al renombrarlos, y se va con ellos", () => {
    const despues: ModeloFisico = { ...modelo, pilares: modelo.pilares!.map((p) => (p.id === "P11" ? { ...p, id: "C" } : p)) };
    expect(seguirPilares(bien, new Map([["P11", "C"]]), modelo, despues)).toEqual({ punzonamiento: { C: { P1: bien.punzonamiento!.P11!.P1 } } });
    const sin: ModeloFisico = { ...modelo, pilares: modelo.pilares!.filter((p) => p.id !== "P11") };
    expect(seguirPilares(bien, new Map(), modelo, sin)).toBeUndefined();
  });
});
