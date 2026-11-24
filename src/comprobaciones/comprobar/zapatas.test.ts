/**
 * Fase CO5 (`docs/fem3d/comprobaciones.md` §8.9, criterios 7 a 9): comprobar una zapata con el módulo
 * de zapatas de Concreta.
 *
 * Con demandas escritas a mano (sin modelo):
 * - **Identidad:** cada fila es la peor de llamar al módulo combinación a combinación con la entrada
 *   escrita aquí campo a campo, en cada orientación (centrada, las cuatro medianeras y dos esquinas):
 *   la carga característica para el terreno (sin H, y con H sólo para el deslizamiento) y la de cálculo
 *   para el armado.
 * - **Metamórficas:** la medianera de «+x» es la de «−x» con las cargas reflejadas; la de «+y», la de
 *   «+x» girada 90°, con x e y cambiados en las filas.
 * - **Las ternas pésimas del sismo:** reducir las que no cuentan por simetría da las mismas filas.
 * - Lo pendiente: el pilar que tira de la zapata, sin la tensión admisible, una sección que no es
 *   rectangular ni circular, una viga centradora que no va perpendicular al lindero.
 */
import { describe, expect, it } from "vitest";
import { isolatedFootingDefaults, type IsolatedFootingInputs } from "../concreta/data/defaults.ts";
import { calcIsolatedFooting } from "../concreta/lib/calculations/isolatedFooting.ts";
import type { Lindero } from "../armado.ts";
import { sintetica } from "../../../validacion/co/modelosZapatas.ts";
import type { CargaZapata } from "../demandas/zapatas.ts";
import { comprobarZapata, datosZapata, ternasDe, orientacion, type ZapataCompleta } from "./zapatas.ts";

const carga = (comb: string, situacion: CargaZapata["situacion"], N: number, Mx: number, My: number, Hx = 0, Hy = 0, pesimos = false): CargaZapata => ({ comb, situacion, N, Mx, My, Hx, Hy, ...(pesimos ? { pesimos: true as const } : {}) });

const GEO = [carga("GEO-1", "GEO", 600, 30, -45, 12, 5), carga("GEO-2", "GEO", 420, -60, 20, -18, 9), carga("GEO-3", "GEO", 800, 5, 80, 25, 0)];
const ELU = [carga("ELU-1", "ELU-PT", 850, 45, -70, 18, 8), carga("ELU-2", "ELU-PT", 600, -90, 30, -27, 14), carga("ELU-3", "ELU-PT", 1100, 8, 120, 38, 0)];

const ZAPATA: ZapataCompleta = { B: 2.4, L: 2.0, h: 0.6, inferior: { x: { diametro: 16, separacion: 200 }, y: { diametro: 12, separacion: 150 } } };
const DATOS = datosZapata(25, { fyk: 500, recubrimiento: 30, recubrimientoZapatas: 50 }, { tensionAdmisible: 250, pesoEspecifico: 18, rozamiento: 0.5, tierras: 0.5 });

/** La entrada del módulo para una orientación, escrita aquí a mano: su tipo, si x e y se cambian y los signos de u y v. */
interface Manual {
  tipo: IsolatedFootingInputs["tipo"];
  cambia: boolean;
  /** u = su·(x o y), v = sv·(y o x). */
  su: 1 | -1;
  sv: 1 | -1;
}

const MANUAL: Record<string, { linderos: Lindero[]; m: Manual }> = {
  centrada: { linderos: [], m: { tipo: "centrada", cambia: false, su: 1, sv: 1 } },
  "medianera -x": { linderos: ["-x"], m: { tipo: "medianera", cambia: false, su: 1, sv: 1 } },
  "medianera +x": { linderos: ["+x"], m: { tipo: "medianera", cambia: false, su: -1, sv: 1 } },
  "medianera -y": { linderos: ["-y"], m: { tipo: "medianera", cambia: true, su: 1, sv: 1 } },
  "medianera +y": { linderos: ["+y"], m: { tipo: "medianera", cambia: true, su: -1, sv: 1 } },
  "esquina -x -y": { linderos: ["-x", "-y"], m: { tipo: "esquina", cambia: false, su: 1, sv: 1 } },
  "esquina +x -y": { linderos: ["+x", "-y"], m: { tipo: "esquina", cambia: false, su: -1, sv: 1 } },
  "esquina +y +x": { linderos: ["+y", "+x"], m: { tipo: "esquina", cambia: false, su: -1, sv: -1 } },
};

/** Las filas esperadas: la peor de cada id de llamar al módulo a mano, en los ejes de la zapata. */
function esperado(z: ZapataCompleta, m: Manual, geo: CargaZapata[], elu: CargaZapata[], cx = 0.4, cy = 0.4): Map<string, { u: number; estado: string; comb: string }> {
  const r = new Map<string, { u: number; estado: string; comb: string }>();
  const swap = (id: string) => (m.cambia ? id.replace(/-([xy])$/, (_, e: string) => `-${e === "x" ? "y" : "x"}`) : id);
  const inf = m.cambia ? { x: z.inferior.y, y: z.inferior.x } : z.inferior;
  const base: IsolatedFootingInputs = {
    ...isolatedFootingDefaults,
    title: "",
    B: m.cambia ? z.L : z.B,
    L: m.cambia ? z.B : z.L,
    h: z.h,
    bc: m.cambia ? cy : cx,
    hc: m.cambia ? cx : cy,
    Df: z.h + 0.5,
    cover: 50,
    sigma_adm: 250,
    loadFactor: 1,
    fck: 25,
    fyk: 500,
    phi_x: inf.x.diametro,
    s_x: inf.x.separacion,
    phi_y: inf.y.diametro,
    s_y: inf.y.separacion,
    gamma_soil_kN_m3: 18,
    mu_friction: 0.5,
    tipo: m.tipo,
    vigaX: false,
    vigaY: false,
    supLleva: false,
  };
  // La excentricidad de la resultante en los ejes de la zapata: ex = My/N, ey = −Mx/N
  const mod = (c: CargaZapata) => {
    const [ex, ey] = [c.My, -c.Mx];
    const [eu, ev] = m.cambia ? [m.su * ey, m.sv * ex] : [m.su * ex, m.sv * ey];
    return { N: c.N, My: eu, Mx: ev, H: Math.sqrt(c.Hx * c.Hx + c.Hy * c.Hy) };
  };
  const tomar = (rows: ReturnType<typeof calcIsolatedFooting>["checks"], ids: (id: string) => boolean, comb: string) => {
    for (const x of rows) {
      if (x.status === "neutral" || !ids(x.id)) continue;
      const id = swap(x.id);
      const u = Number.isFinite(x.utilization) ? x.utilization : Infinity;
      const p = r.get(id);
      const peso = (e: string) => (e === "fail" ? 1 : 0);
      if (!p || peso(x.status) > peso(p.estado) || (peso(x.status) === peso(p.estado) && u > p.u)) r.set(id, { u, estado: x.status, comb });
    }
  };
  const terreno = new Set(["bearing", "excentricidad-x", "excentricidad-y", "overturn-x", "overturn-y"]);
  for (const c of geo) {
    const x = mod(c);
    const a = calcIsolatedFooting({ ...base, loadsAreFactored: false, N: x.N, Mx: x.Mx, My: x.My, H: 0 });
    expect(a.error).toBeUndefined();
    tomar(a.checks, (id) => terreno.has(id), c.comb);
    const b = calcIsolatedFooting({ ...base, loadsAreFactored: false, N: x.N, Mx: x.Mx, My: x.My, H: x.H });
    tomar(b.checks, (id) => id === "sliding", c.comb);
  }
  for (const c of elu) {
    const x = mod(c);
    const a = calcIsolatedFooting({ ...base, loadsAreFactored: true, N: x.N, Mx: x.Mx, My: x.My, H: 0 });
    expect(a.error).toBeUndefined();
    tomar(a.checks, (id) => !terreno.has(id) && id !== "sliding", c.comb);
  }
  return r;
}

const igualQue = (filas: ReturnType<typeof comprobarZapata>["filas"], e: ReturnType<typeof esperado>, que: string) => {
  expect(new Set(filas.map((f) => f.id)), que).toEqual(new Set(e.keys()));
  for (const f of filas) {
    const x = e.get(f.id)!;
    expect(f.estado, `${que}: ${f.id}`).toBe(x.estado);
    if (Number.isFinite(x.u)) expect(Math.abs(f.aprovechamiento - x.u), `${que}: ${f.id}`).toBeLessThanOrEqual(1e-12 * Math.max(1, x.u));
    else expect(f.aprovechamiento).toBe(Infinity);
  }
};

describe("CO5: comprobar una zapata con el módulo de zapatas", () => {
  for (const [nombre, { linderos, m }] of Object.entries(MANUAL)) {
    it(`identidad con el módulo llamado a mano: ${nombre}`, () => {
      const z: ZapataCompleta = { ...ZAPATA, ...(linderos.length ? { linderos } : {}) };
      const o = orientacion(z);
      expect({ tipo: o.tipo, cambia: o.cambia, su: o.su, sv: o.sv }).toEqual(m);
      const c = comprobarZapata(sintetica(GEO, ELU, { cx: 0.5, cy: 0.3 }), z, DATOS);
      expect(c.pendientes).toEqual([]);
      igualQue(c.filas, esperado(z, m, GEO, ELU, 0.5, 0.3), nombre);
      // Tres llamadas por combinación con H (terreno, deslizamiento y armado)
      expect(c.llamadas).toBe(2 * GEO.length + ELU.length);
      expect(c.filas.some((f) => f.id === "sliding")).toBe(true);
    });
  }

  it("la medianera de «+x» es la de «−x» con las cargas reflejadas", () => {
    // Reflejar x: Hx y My cambian de signo (My es un pseudovector), Hy y Mx no
    const refl = (l: CargaZapata[]) => l.map((c) => ({ ...c, Hx: -c.Hx, My: -c.My }));
    const a = comprobarZapata(sintetica(GEO, ELU), { ...ZAPATA, linderos: ["+x"] }, DATOS);
    const b = comprobarZapata(sintetica(refl(GEO), refl(ELU)), { ...ZAPATA, linderos: ["-x"] }, DATOS);
    expect(a.filas.map((f) => [f.id, f.estado, f.aprovechamiento])).toEqual(b.filas.map((f) => [f.id, f.estado, f.aprovechamiento]));
  });

  it("la medianera de «+y» es la de «+x» girada 90°, con x e y cambiados", () => {
    // Girar −90°: lo que estaba según y pasa a x (x' = −y… o como se mire: Hx' = −Hy, Hy' = Hx, Mx' = −My, My' = Mx)
    const giro = (l: CargaZapata[]) => l.map((c) => ({ ...c, Hx: c.Hy, Hy: -c.Hx, Mx: c.My, My: -c.Mx }));
    const zy: ZapataCompleta = { ...ZAPATA, linderos: ["+y"] };
    const zx: ZapataCompleta = { B: ZAPATA.L, L: ZAPATA.B, h: ZAPATA.h, inferior: { x: ZAPATA.inferior.y, y: ZAPATA.inferior.x }, linderos: ["+x"] };
    const a = comprobarZapata(sintetica(GEO, ELU, { cx: 0.5, cy: 0.3 }), zy, DATOS);
    const b = comprobarZapata(sintetica(giro(GEO), giro(ELU), { cx: 0.3, cy: 0.5 }), zx, DATOS);
    const cambia = (id: string) => id.replace(/-([xy])$/, (_, e: string) => `-${e === "x" ? "y" : "x"}`);
    const fa = new Map(a.filas.map((f) => [f.id, f]));
    expect(b.filas.length).toBe(a.filas.length);
    for (const f of b.filas) {
      const g = fa.get(cambia(f.id))!;
      expect(g, f.id).toBeDefined();
      expect(g.estado, f.id).toBe(f.estado);
      expect(Math.abs(g.aprovechamiento - f.aprovechamiento), f.id).toBeLessThanOrEqual(1e-12 * Math.max(1, f.aprovechamiento));
    }
  });

  it("con el sismo, quitar las ternas especulares da las mismas filas que todas", () => {
    // Las 8 ternas de signos pésimos de una combinación: N, Mx y My con sus dos signos, H aumentado.
    // Con la parte estática de los momentos nula, las de signo contrario son imágenes especulares
    for (const S of [{ N: 700, Mx: 25, My: -40 }, { N: 700, Mx: 0, My: 0 }]) {
      const A = { N: 120, Mx: 60, My: 55 };
      const ternas: CargaZapata[] = [];
      for (const sn of [1, -1]) for (const sx of [1, -1]) for (const sy of [1, -1]) ternas.push(carga("SIS-1", "ELU-SIS", S.N + sn * A.N, S.Mx + sx * A.Mx, S.My + sy * A.My, 24, -10, true));
      const geo = ternas.map((t) => ({ ...t, comb: "GSIS-1", situacion: "GEO-SIS" as const, N: t.N * 0.75, Mx: t.Mx * 0.7, My: t.My * 0.7 }));
      const nulo = S.Mx === 0;
      for (const [nombre, linderos, cuantas] of [["centrada", [], nulo ? 2 : 8], ["medianera -x", ["-x"], nulo ? 4 : 8], ["esquina -x -y", ["-x", "-y"], 8]] as const) {
        const z: ZapataCompleta = { ...ZAPATA, ...(linderos.length ? { linderos: [...linderos] } : {}) };
        const o = orientacion(z);
        expect(ternasDe({ geo, elu: ternas }, o).elu.length, nombre).toBe(cuantas);
        const c = comprobarZapata(sintetica(geo, ternas), z, DATOS);
        igualQue(c.filas, esperado(z, MANUAL[nombre]!.m, geo, ternas), `${nombre}${nulo ? ", momentos estáticos nulos" : ""}`);
      }
    }
  });

  it("lo del terreno, guardado para otra parrilla de la misma zapata: da lo mismo que llamar al módulo", () => {
    // Al proponer se prueban zapatas que sólo cambian de parrilla: lo del terreno (presión, vuelco y
    // deslizamiento) no depende de ella y no se vuelve a pedir al módulo
    const otra: ZapataCompleta = { ...ZAPATA, inferior: { x: { diametro: 20, separacion: 150 }, y: { diametro: 16, separacion: 200 } }, superior: { x: { diametro: 12, separacion: 250 }, y: { diametro: 12, separacion: 250 } } };
    for (const linderos of [[], ["+y"], ["-x", "-y"]] as Lindero[][]) {
      const z = (x: ZapataCompleta): ZapataCompleta => ({ ...x, ...(linderos.length ? { linderos } : {}) });
      const D = sintetica(GEO, ELU);
      const a = comprobarZapata(D, z(ZAPATA), DATOS);
      const b = comprobarZapata(D, z(otra), DATOS);
      const nueva = comprobarZapata(sintetica(GEO, ELU), z(otra), DATOS);
      const { llamadas: lb, ...sb } = b;
      const { llamadas: ln, ...sn } = nueva;
      expect(sb, linderos.join(" ")).toEqual(sn);
      // Las del terreno (3 + 3 con H) ya estaban: sólo las del armado
      expect(a.llamadas).toBe(9);
      expect(ln).toBe(9);
      expect(lb).toBe(3);
      // Otro canto ya no es la misma zapata
      expect(comprobarZapata(D, z({ ...otra, h: 0.65 }), DATOS).llamadas).toBe(9);
    }
  });

  it("el pilar que tira de la zapata: el arranque, pendiente; lo demás se comprueba", () => {
    const c = comprobarZapata(sintetica([...GEO, carga("GEO-4", "GEO", -30, 0, 0)], [...ELU, carga("ELU-4", "ELU-PT", -45, 0, 0)]), ZAPATA, DATOS);
    expect(c.cumple).toBe(false);
    expect(c.pendientes).toEqual([{ motivo: expect.stringContaining("tira de la zapata (N = -45,0 kN)"), comb: "ELU-4", arranque: true }]);
    igualQue(c.filas, esperado(ZAPATA, MANUAL.centrada!.m, GEO, ELU), "sin las de tracción");
  });

  it("sin la tensión admisible, el terreno queda pendiente y el armado se comprueba", () => {
    const sin = datosZapata(25, { recubrimientoZapatas: 50 }, { tierras: 0.5 });
    const c = comprobarZapata(sintetica(GEO, ELU), ZAPATA, sin);
    expect(c.cumple).toBe(false);
    expect(c.pendientes.map((p) => p.motivo)).toEqual([expect.stringContaining("tensión admisible")]);
    expect(c.filas.some((f) => f.grupo === "planta")).toBe(false);
    expect(c.filas.some((f) => f.id === "punzonamiento")).toBe(true);
  });

  it("un pilar circular de diámetro D, como un cuadrado de lado π·D/4", () => {
    const D = 0.45;
    const c = comprobarZapata(sintetica(GEO, ELU, { cx: D, circular: true }), ZAPATA, DATOS);
    igualQue(c.filas, esperado(ZAPATA, MANUAL.centrada!.m, GEO, ELU, (Math.PI * D) / 4, (Math.PI * D) / 4), "circular");
  });

  it("una sección que no es rectangular ni circular, pendiente", () => {
    const D = { ...sintetica(GEO, ELU), cx: 0, cy: 0, seccion: { id: "I", material: "S", forma: "general" as const, A: 0.01, Iy: 1e-4, Iz: 1e-5, J: 1e-6 } };
    const c = comprobarZapata(D, ZAPATA, DATOS);
    expect(c.cumple).toBe(false);
    expect(c.pendientes[0]!.motivo).toContain("no es rectangular ni circular");
  });

  it("las vigas centradoras: la luz proyectada, su dirección y el ángulo con el lindero", () => {
    const D = sintetica(GEO, ELU);
    const z: ZapataCompleta = { ...ZAPATA, linderos: ["-x"], centradoras: ["P2"] };
    // Hacia +x (el interior de la medianera de «−x»), a 5 m y 0,2 m de lado
    const c = comprobarZapata(D, z, DATOS, [{ id: "P2", punto: [5, 0.2] }]);
    expect(c.pendientes).toEqual([]);
    expect(c.centradoras).toHaveLength(1);
    expect(c.centradoras[0]).toMatchObject({ pilar: "P2", direccion: "x", luz: 5 });
    expect(c.centradoras[0]!.angulo).toBeCloseTo((Math.atan2(0.2, 5) * 180) / Math.PI, 12);
    expect(c.centradoras[0]!.Vd).toBeGreaterThan(0);
    // El módulo, con la viga en x a 5 m: la identidad con la llamada a mano
    const r = calcIsolatedFooting({ ...isolatedFootingDefaults, title: "", B: 2.4, L: 2, h: 0.6, bc: 0.4, hc: 0.4, Df: 1.1, cover: 50, sigma_adm: 250, loadsAreFactored: true, loadFactor: 1, N: ELU[0]!.N, Mx: -ELU[0]!.Mx, My: ELU[0]!.My, H: 0, fck: 25, fyk: 500, phi_x: 16, s_x: 200, phi_y: 12, s_y: 150, gamma_soil_kN_m3: 18, mu_friction: 0.5, tipo: "medianera", vigaX: true, luzX: 5, vigaY: false, supLleva: false });
    expect(r.vigaX).not.toBeNull();
    // Hacia el lindero, o a más de 15°: pendiente
    expect(comprobarZapata(D, { ...z, linderos: ["+x"] }, DATOS, [{ id: "P2", punto: [5, 0] }]).pendientes[0]!.motivo).toContain("no va hacia el interior");
    expect(comprobarZapata(D, z, DATOS, [{ id: "P2", punto: [5, 2] }]).pendientes[0]!.motivo).toContain("se separa 22°");
    // En una esquina, la de y va a la viga del módulo en v
    const e = comprobarZapata(D, { ...ZAPATA, linderos: ["-x", "-y"], centradoras: ["P2", "P3"] }, DATOS, [{ id: "P2", punto: [5, 0] }, { id: "P3", punto: [0, 4] }]);
    expect(e.pendientes).toEqual([]);
    expect(e.centradoras.map((x) => [x.pilar, x.direccion, x.luz])).toEqual([["P2", "x", 5], ["P3", "y", 4]]);
  });
});
