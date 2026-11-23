/**
 * Fase CO3 (`docs/fem3d/comprobaciones.md` §7, criterios 7 a 13): las losas macizas y reticulares.
 *
 * - Demandas: en una losa en flexión cilíndrica, las de una viga biapoyada de 1 m; junto a los
 *   pilares el cortante no cuenta (es del punzonamiento); con el sismo, nunca menos; girar 90° no
 *   cambia nada.
 * - Comprobar: cada fila es la peor de las del módulo de forjados llamado estación a estación con la
 *   entrada escrita a mano; el cortante, además, el de la fórmula del Código escrita aquí.
 * - Proponer: lo propuesto cumple, y con la base o con un refuerzo un puesto más abajo, no.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { losaEnDosApoyos, losaPlana, PESO_HORMIGON, type VarianteLosaPlana } from "../../validacion/co/modelosLosas.ts";
import { aceroLosa, conLosaCimentacion } from "../../validacion/co/medirMinimaReducida.ts";
import { asMinRectangular } from "./concreta/lib/calculations/cuantiaMinima.ts";
import { getConcrete, getFyd } from "./concreta/data/materials.ts";
import { cuantiaGeometrica, FACTOR_MINIMA_REDUCIDA } from "./armado.ts";
import { comprobarArmado } from "../agente/armaduraBase.ts";
import { conjuntoCombinaciones } from "../agente/combinaciones.ts";
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { ARMADURAS_FORJADO, areaBarra, areaBarrasForjado, erroresArmadoForjado, type ArmadoForjado, type BarrasForjado } from "./armado.ts";
import { LARGO_MINIMO, LARGO_MINIMO_CERCOS, MODULO_LARGO, proponerLosa, tablaCercosNervio, tablaNervios, tablaParrillas } from "./armar/losas.ts";
import { armadoLosa, comprobarLosa, cubre, entradasLosa, estacionesQueFallan, type ComprobacionLosa } from "./comprobar/losas.ts";
import { forjadosDefaults } from "./concreta/data/defaults.ts";
import { calcForjados } from "./concreta/lib/calculations/rcSlabs.ts";
import { demandasLosa, direccionArmadura, type DemandasLosa } from "./demandas/losas.ts";
import { armadoPropuestoLosas, comprobarLosas } from "./losas.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function consultas(f: ModeloFisico, op: OpcionesCompilacion = {}): Consultas {
  const c = compilar(f, op);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return new Consultas(f, c, r.casos, op, r.modal);
}

function demandas(q: Consultas, id = "L"): DemandasLosa {
  const d = demandasLosa(q, id);
  if (!d.valido) throw new Error(d.diagnosticos.map((x) => x.mensaje).join("\n"));
  return d.valor;
}

// Los modelos, calculados una vez
const hechos = new Map<string, { q: Consultas; d: DemandasLosa }>();
function plana(v: VarianteLosaPlana = {}) {
  const clave = JSON.stringify(v);
  let r = hechos.get(clave);
  if (!r) {
    const q = consultas(losaPlana(v));
    hechos.set(clave, (r = { q, d: demandas(q) }));
  }
  return r;
}

const cuatro = (b: BarrasForjado): ArmadoForjado["base"] => ({ "x-inf": b, "x-sup": b, "y-inf": b, "y-sup": b });
const D12A200: BarrasForjado = { diametro: 12, separacion: 200 };
const peor = (c: ComprobacionLosa, id: string) => c.filas.filter((f) => f.id === id).reduce((m, f) => Math.max(m, f.aprovechamiento), 0);

describe("CO3: las demandas de una losa", () => {
  it("en flexión cilíndrica son las de una viga biapoyada de 1 m: p·L²/8 y p·(L/2 − s)", () => {
    const [L, h, cm, q] = [5, 0.2, 2, 3];
    // Con la malla de 0,25: el cortante de las estaciones de paso sale de los campos (Q por equilibrio)
    const d = demandas(consultas(losaEnDosApoyos({ L, h, cm, q }), { tamanoMalla: 0.25 }));
    const g = PESO_HORMIGON * h + cm;
    const elu = 1.35 * g + 1.5 * q;
    // ψ₂ del uso A: 0,3
    const cp = g + 0.3 * q;
    expect(d.reticular).toBeNull();
    expect(d.sinELS).toBe(false);
    const x = d.direcciones[0];
    expect(x.estaciones.length).toBeGreaterThan(40);
    for (const e of x.estaciones) {
      expect(e.seccion).toBe("maciza");
      expect(e.ancho).toBe(1);
      // Sin pilares, el cortante cuenta en todas
      expect(e.cortante).not.toBeNull();
      if (e.s < 0.5 || e.s > L - 0.5) continue;
      const M = (elu * e.s * (L - e.s)) / 2;
      expect(Math.abs(e.inferior - M)).toBeLessThanOrEqual(0.01 * ((elu * L * L) / 8));
      expect(e.superior).toBeLessThanOrEqual(1e-3 * ((elu * L * L) / 8));
      expect(Math.abs(e.cpInferior - (cp * e.s * (L - e.s)) / 2)).toBeLessThanOrEqual(0.01 * ((cp * L * L) / 8));
      expect(Math.abs(e.cortante! - elu * Math.abs(L / 2 - e.s))).toBeLessThanOrEqual(0.02 * ((elu * L) / 2));
      expect(e.combInferior).toMatch(/^ELU-PT/);
    }
    // En la otra dirección no hay flexión (ν = 0): nada que armar más que el mínimo
    for (const e of d.direcciones[1].estaciones) expect(e.inferior + e.superior).toBeLessThanOrEqual(0.02 * ((elu * L * L) / 8));
  });

  it("son las de las franjas de las consultas, y junto a los pilares el cortante no cuenta", () => {
    const { q, d } = plana();
    const elu = conjuntoCombinaciones(q, { tipo: "situaciones", situaciones: ["ELU-PT", "ELU-ACC", "ELU-SIS"] });
    if (!elu.valido) throw new Error("sin ELU");
    expect(d.combinaciones).toBe(elu.valor.factores.length);
    for (const dir of d.direcciones) {
      const f = dir.franjas[Math.floor(dir.franjas.length / 2)]!;
      const w = q.armadoFranja(f.id, elu.valor.factores);
      const v = q.cortanteFranja(f.id, elu.valor.factores);
      const g = q.franja(f.id);
      if (!w.valido || !v.valido || !g.valido) throw new Error("franja");
      const suyas = dir.estaciones.filter((e) => e.franja === f.id);
      expect(suyas.length).toBeGreaterThan(10);
      for (const e of suyas) {
        expect(e.inferior).toBe(w.valor[e.indice]!.inferior);
        expect(e.superior).toBe(w.valor[e.indice]!.superior);
        expect(e.s).toBe(g.valor.estaciones[e.indice]!.s);
        if (e.cortante !== null) expect(e.cortante).toBe(v.valor[e.indice]!.v);
        // El metro de un pilar (su ventana) es del punzonamiento
        if (g.valor.estaciones[e.indice]!.ventana) expect(e.cortante).toBeNull();
      }
      // Los pilares están en 0, 5 y 10: a menos de 2 cantos de su cara (0,2 + 0,5 m del eje) no cuenta; lejos, sí
      const tc = (f.t0 + f.t1) / 2;
      const cercaDeLinea = [0, 5, 10].some((x) => Math.abs(tc - x) < 0.7);
      for (const e of suyas) {
        const ds = Math.min(...[0, 5, 10].map((x) => Math.abs(e.s - x)));
        if (cercaDeLinea && ds < 0.6) expect(e.cortante).toBeNull();
        if (ds > 1.2) expect(e.cortante).not.toBeNull();
      }
    }
    expect(d.direcciones.some((x) => x.estaciones.some((e) => e.cortante === null))).toBe(true);
  });

  it("en una astilla de losa (menos de un canto en el ancho de la franja), el cortante no cuenta y se avisa (CO4-7)", () => {
    const [L, h] = [5, 0.2];
    const una = losaEnDosApoyos({ L, h, cm: 2, q: 3 });
    // Una losa en L: para x > 2,5, la franja de arriba (t de 2 a 3) sólo tiene 10 cm de losa
    const f: ModeloFisico = {
      ...una,
      losas: una.losas!.map((l) => ({ ...l, contorno: [[0, 0], [L, 0], [L, 2.1], [2.5, 2.1], [2.5, 3], [0, 3]] as [number, number][] })),
      apoyosLineales: [una.apoyosLineales![0]!, { ...una.apoyosLineales![1]!, puntos: [[L, 0], [L, 2.1]] }],
    };
    const r = demandasLosa(consultas(f, { tamanoMalla: 0.25 }), "L");
    if (!r.valido) throw new Error("demandas");
    const x = r.valor.direcciones[0];
    let astillas = 0;
    for (const e of x.estaciones) {
      const g = x.franjas.find((y) => y.id === e.franja)!;
      // La franja de arriba, más allá del escalón, es la astilla; las demás estaciones llevan su cortante
      const enAstilla = g.t0 > 1.9 && e.s > 2.5 + 1e-6;
      if (enAstilla) {
        astillas++;
        expect(e.sinCortante).toBe("astilla");
        expect(e.cortante).toBeNull();
      } else if (e.s < 2.5 - 1e-6 || g.t0 < 1.9) {
        expect(e.sinCortante).toBeNull();
        expect(e.cortante).not.toBeNull();
      }
    }
    expect(astillas).toBeGreaterThan(5);
    expect(r.diagnosticos.some((d) => d.codigo === "comprobacion/cortante-astilla")).toBe(true);
    // Sin astillas, ni el aviso
    const sin = demandasLosa(consultas(una, { tamanoMalla: 0.25 }), "L");
    if (!sin.valido) throw new Error("demandas");
    expect(sin.diagnosticos.some((d) => d.codigo === "comprobacion/cortante-astilla")).toBe(false);
  });

  it("con el sismo del programa, ninguna demanda baja (criterio 9)", () => {
    const [a, b] = [plana().d, plana({ sismo: true }).d];
    expect(b.combinaciones).toBeGreaterThan(a.combinaciones);
    for (const k of [0, 1] as const) {
      const [ea, eb] = [a.direcciones[k].estaciones, b.direcciones[k].estaciones];
      expect(eb.length).toBe(ea.length);
      ea.forEach((e, i) => {
        const s = eb[i]!;
        expect(s.franja).toBe(e.franja);
        expect(s.inferior).toBeGreaterThanOrEqual(e.inferior - 1e-9);
        expect(s.superior).toBeGreaterThanOrEqual(e.superior - 1e-9);
        if (e.cortante !== null) expect(s.cortante!).toBeGreaterThanOrEqual(e.cortante - 1e-9);
      });
    }
  });

  it("girar la planta 90° da las mismas demandas (criterio 8)", () => {
    // Sin la imperfección global, a la precisión del cálculo. Con ella, las combinaciones de ELU no son
    // del todo simétricas frente al giro (3e-4 de la mayor demanda; las de ELS, 1e-12): CO3-5
    for (const [a, b, tol] of [[plana({ sinImperfeccion: true }).d, plana({ sinImperfeccion: true, girada: true }).d, 1e-9], [plana().d, plana({ girada: true }).d, 1e-3]] as const)
    for (const k of [0, 1] as const) {
      const lista = (d: DemandasLosa, de: (e: DemandasLosa["direcciones"][0]["estaciones"][0]) => number) => d.direcciones[k].estaciones.map(de).sort((x, y) => x - y);
      for (const de of [(e: { inferior: number }) => e.inferior, (e: { superior: number }) => e.superior, (e: { cortante: number | null }) => e.cortante ?? -1, (e: { cpSuperior: number }) => e.cpSuperior]) {
        const [xa, xb] = [lista(a, de as never), lista(b, de as never)];
        expect(xb.length).toBe(xa.length);
        const escala = Math.max(...xa);
        xa.forEach((x, i) => expect(Math.abs(xb[i]! - x)).toBeLessThanOrEqual(tol * escala));
      }
    }
  });

  it("en un reticular, las estaciones son de nervio o de ábaco, y el nervio lleva el ancho de su franja", () => {
    const { d } = plana({ reticular: true });
    expect(d.reticular).toEqual({ intereje: 0.8, nervio: 0.12, capa: 0.05 });
    for (const dir of d.direcciones) {
      const clases = new Set(dir.estaciones.map((e) => e.seccion));
      expect([...clases].sort()).toEqual(["abaco", "nervio"]);
      for (const e of dir.estaciones) {
        if (e.seccion === "abaco") expect(e.ancho).toBe(1);
        // (las dos franjas de los extremos van de medio intereje a intereje y medio)
        else expect(e.ancho).toBeGreaterThanOrEqual(0.4 - 1e-9);
        expect(e.luz).toBeGreaterThan(4);
        expect(e.luz).toBeLessThanOrEqual(6 + 1e-9);
      }
      // Las caras de los pilares caen en sus ábacos
      expect(dir.estaciones.filter((e) => e.tipo === "cara" && e.cortante === null).every((e) => e.seccion === "abaco")).toBe(true);
    }
  });
});

describe("CO3: comprobar una losa", () => {
  /** La entrada del módulo de una estación de una maciza, campo a campo. */
  const aMano = (h: number, cover: number, inf: BarrasForjado, sup: BarrasForjado, refSup: BarrasForjado | null, e: { inferior: number; superior: number; cortante: number | null; cpInferior: number; cpSuperior: number; luz: number }) =>
    calcForjados({
      ...forjadosDefaults,
      title: "",
      variant: "maciza",
      h,
      cover,
      fck: 25,
      fyk: 500,
      exposureClass: "XC2",
      spanLength: 1000 * e.luz,
      tipoVano: "continuo-interior",
      base_inf_phi_mac: inf.diametro,
      base_inf_s_mac: inf.separacion!,
      base_sup_phi_mac: sup.diametro,
      base_sup_s_mac: sup.separacion!,
      refuerzo_vano_inf_phi_mac: 0,
      refuerzo_vano_inf_s_mac: 0,
      refuerzo_apoyo_sup_phi_mac: refSup?.diametro ?? 0,
      refuerzo_apoyo_sup_s_mac: refSup?.separacion ?? 0,
      stirrupsEnabled: false,
      vano_Md: e.inferior,
      apoyo_Md: e.superior,
      VEd: e.cortante ?? 0,
      vano_M_G: e.cpInferior,
      vano_M_Q: 0,
      apoyo_M_G: e.cpSuperior,
      apoyo_M_Q: 0,
      loadType: "custom",
      psi2Custom: 0,
    });

  it("cada fila es la peor de las del módulo llamado estación a estación con la entrada escrita a mano (criterio 7)", () => {
    const { d } = plana();
    const ref: BarrasForjado = { diametro: 16, separacion: 150 };
    // Un refuerzo superior en X sobre el pilar central (s y t de 4 a 6 m) y otro en Y
    const a: ArmadoForjado = { base: cuatro(D12A200), refuerzos: [{ armadura: "x-sup", s: [4, 6], t: [4, 6], barras: ref }, { armadura: "y-sup", s: [4, 6], t: [4, 6], barras: ref }] };
    const c = comprobarLosa(d, armadoLosa(a));
    expect(c.pendientes).toEqual([]);
    expect(c.sinEstaciones).toEqual([]);
    const gs = entradasLosa(d, armadoLosa(a));
    // Dos grupos por dirección: la base sola y la base con el refuerzo
    expect(gs.map((g) => `${g.direccion}|${g.sup.join()}`).sort()).toEqual(["1|", "1|0", "2|", "2|1"]);
    expect(c.llamadas).toBe(4);
    for (const g of gs) {
      const eje = g.direccion === 1 ? "x" : "y";
      // La dirección Y va por dentro: 30 + 12 mm de recubrimiento
      const cover = g.direccion === 1 ? 30 : 42;
      const filas = c.filas.filter((f) => f.direccion === g.direccion && f.refuerzos.join() === (f.armadura?.endsWith("inf") ? "" : g.sup.join()) && (f.armadura !== undefined || f.refuerzos.join() === g.sup.join()));
      const una = g.estaciones.map((e) => ({ e, r: aMano(250, cover, D12A200, D12A200, g.sup.length ? ref : null, e) }));
      for (const x of una) expect(x.r.valid).toBe(true);
      const peorDe = (lista: (r: (typeof una)[number]["r"]) => { id: string; utilization: number }[], id: string, solo: (e: (typeof una)[number]["e"]) => boolean = () => true) => Math.max(...una.filter((x) => solo(x.e)).map((x) => lista(x.r).find((f) => f.id === id)?.utilization ?? 0));
      const fila = (id: string) => filas.filter((f) => f.id === id);
      for (const id of ["bending", "as-min", "bar-spacing-maciza", "cracking", "as-max"]) {
        const [fi, fs] = [fila(`${eje}-inf/${id}`), fila(`${eje}-sup/${id}`)];
        // La cara inferior de un grupo va en las filas sin refuerzos; las dos existen en esta losa
        const inf = fi[0];
        expect(fs.length, `${eje}-sup/${id}`).toBe(1);
        expect(fs[0]!.aprovechamiento).toBeCloseTo(peorDe((r) => r.apoyo.checks, id), 12);
        if (g.sup.length === 0 && inf) expect(peor(c, `${eje}-inf/${id}`)).toBeGreaterThanOrEqual(peorDe((r) => r.vano.checks, id) - 1e-12);
      }
      const corte = filas.filter((f) => f.id === `${eje}/shear`);
      expect(corte.length).toBe(1);
      expect(corte[0]!.aprovechamiento).toBeCloseTo(peorDe((r) => r.shearChecks, "shear", (e) => e.cortante !== null), 12);
      // La fila del momento dice su estación y su combinación, y son las del máximo
      const m = filas.find((f) => f.id === `${eje}-sup/bending`)!;
      const est = g.estaciones.find((e) => e.franja === m.franja && e.s === m.s)!;
      expect(est.superior).toBe(Math.max(...g.estaciones.map((e) => e.superior)));
      expect(m.comb).toBe(est.combSuperior);
    }
    // La cara inferior, entera: sus filas (sin refuerzos en ella) son las de todas las estaciones de la dirección
    for (const k of [1, 2] as const) {
      const eje = k === 1 ? "x" : "y";
      const todas = d.direcciones[k - 1]!.estaciones.map((e) => aMano(250, k === 1 ? 30 : 42, D12A200, D12A200, null, e));
      for (const id of ["bending", "cracking"]) expect(peor(c, `${eje}-inf/${id}`)).toBeCloseTo(Math.max(...todas.map((r) => r.vano.checks.find((f) => f.id === id)?.utilization ?? 0)), 12);
    }
  });

  it("una cara que no tracciona no lleva las filas de la flexión, y el cortante es el de la fórmula del Código", () => {
    const d = demandas(consultas(losaEnDosApoyos()));
    const [inf, sup]: BarrasForjado[] = [{ diametro: 12, separacion: 150 }, { diametro: 8, separacion: 300 }];
    const c = comprobarLosa(d, armadoLosa({ base: { "x-inf": inf, "x-sup": sup, "y-inf": inf, "y-sup": D12A200 } }));
    expect(c.cumple).toBe(true);
    const ids = c.filas.filter((f) => f.direccion === 1).map((f) => f.id);
    expect(ids).toContain("x-inf/bending");
    expect(ids).toContain("x-inf/as-min");
    expect(ids).toContain("x-inf/cracking");
    expect(ids).not.toContain("x-sup/bending");
    expect(ids).not.toContain("x-sup/as-min");
    expect(ids).not.toContain("x-sup/cracking");
    expect(ids).toContain("x-sup/bar-spacing-maciza");
    // VRd,c (CE Anejo 19 §6.2.2), con el menor canto útil y la menor armadura de las dos caras
    const corte = c.filas.find((f) => f.id === "x/shear")!;
    const dd = Math.min(200 - 30 - 6, 200 - 30 - 4);
    const As = Math.min(areaBarrasForjado(inf), areaBarrasForjado(sup));
    const k = Math.min(1 + Math.sqrt(200 / dd), 2);
    const rho = Math.min(As / (1000 * dd), 0.02);
    const VRdc = (Math.max((0.18 / 1.5) * k * Math.cbrt(100 * rho * 25), (0.051 / 1.5) * k ** 1.5 * Math.sqrt(25)) * 1000 * dd) / 1000;
    expect(Math.abs(corte.fila.limitNum! / VRdc - 1)).toBeLessThanOrEqual(1e-9);
    const V = Math.max(...d.direcciones[0].estaciones.map((e) => e.cortante!));
    expect(corte.aprovechamiento).toBeCloseTo(V / VRdc, 9);
    expect(corte.grupo).toBe("cortante");
  });

  it("un refuerzo sólo cuenta en las estaciones que cubre, y el que no cubre ninguna se dice", () => {
    const { d } = plana();
    const base: ArmadoForjado = { base: cuatro(D12A200) };
    const con: ArmadoForjado = { ...base, refuerzos: [{ armadura: "x-sup", s: [4, 6], t: [4, 6], barras: { diametro: 16, separacion: 100 } }, { armadura: "x-sup", s: [40, 42], t: [0, 1], barras: D12A200 }] };
    const [c0, c1] = [comprobarLosa(d, armadoLosa(base)), comprobarLosa(d, armadoLosa(con))];
    expect(c1.sinEstaciones).toEqual([1]);
    // Sobre el pilar central la flexión superior en X falla con la base y cumple con el refuerzo
    const sobre = (c: ComprobacionLosa) => c.filas.filter((f) => f.id === "x-sup/bending" && f.franja !== undefined && d.direcciones[0].estaciones.some((e) => e.franja === f.franja && e.s === f.s && e.s >= 4 && e.s <= 6 && (e.t0 + e.t1) / 2 >= 4 && (e.t0 + e.t1) / 2 <= 6));
    expect(sobre(c0)[0]!.estado).toBe("fail");
    const r = c1.filas.find((f) => f.id === "x-sup/bending" && f.refuerzos.includes(0))!;
    expect(r.estado).not.toBe("fail");
    expect(r.grupo).toBe("refuerzo:0");
    expect(r.resistente!).toBeGreaterThan(c0.filas.find((f) => f.id === "x-sup/bending")!.resistente!);
    // La dirección Y no cambia
    expect(c1.filas.filter((f) => f.direccion === 2).map((f) => f.aprovechamiento)).toEqual(c0.filas.filter((f) => f.direccion === 2).map((f) => f.aprovechamiento));
  });

  it("las estaciones que piden refuerzo son las que hacen fallar la fila de su grupo", () => {
    const { d } = plana();
    for (const [b, falla] of [[{ diametro: 8, separacion: 300 }, true], [{ diametro: 20, separacion: 100 }, false]] as const) {
      const a = armadoLosa({ base: cuatro(b) });
      const c = comprobarLosa(d, a);
      for (const arm of ARMADURAS_FORJADO) {
        const es = estacionesQueFallan(d, a, arm);
        const filaFalla = c.filas.some((f) => f.armadura === arm && (f.id.endsWith("/bending") || f.id.endsWith("/cracking")) && f.estado === "fail");
        expect(es.length > 0).toBe(filaFalla);
        if (arm.endsWith("sup")) expect(filaFalla).toBe(falla);
        // La de mayor momento de las que fallan es la de la fila
        if (es.length) {
          const k = direccionArmadura(arm);
          const todas = d.direcciones[k - 1]!.estaciones;
          const de = (e: (typeof todas)[number]) => (arm.endsWith("inf") ? e.inferior : e.superior);
          expect(Math.max(...es.map(de))).toBe(Math.max(...todas.map(de)));
        }
      }
    }
  });

  it("girar la planta 90° da las mismas filas (criterio 8)", () => {
    const a = armadoLosa({ base: cuatro(D12A200) });
    const [c0, c1] = [comprobarLosa(plana().d, a), comprobarLosa(plana({ girada: true }).d, a)];
    expect(c1.filas.map((f) => f.id)).toEqual(c0.filas.map((f) => f.id));
    c0.filas.forEach((f, i) => expect(Math.abs(c1.filas[i]!.aprovechamiento - f.aprovechamiento)).toBeLessThanOrEqual(1e-6 * Math.max(1, f.aprovechamiento)));
  });

  it("un reticular sin la parrilla de los ábacos queda pendiente y no cumple; con ella, el ábaco es una maciza del canto total", () => {
    const { d } = plana({ reticular: true });
    const base = cuatro({ diametro: 12, n: 2 });
    const sin = comprobarLosa(d, armadoLosa({ base }));
    expect(sin.cumple).toBe(false);
    expect(sin.pendientes[0]!.motivo).toMatch(/ábacos/);
    const con = comprobarLosa(d, armadoLosa({ base, abacos: cuatro({ diametro: 16, separacion: 150 }) }));
    expect(con.pendientes).toEqual([]);
    const gs = entradasLosa(d, armadoLosa({ base, abacos: cuatro({ diametro: 16, separacion: 150 }) }));
    const abaco = gs.find((g) => g.seccion === "abaco" && g.direccion === 1)!.entrada!;
    expect([abaco.variant, abaco.h, abaco.base_sup_phi_mac, abaco.base_sup_s_mac, abaco.cover]).toEqual(["maciza", 300, 16, 150, 30]);
    const nervio = gs.find((g) => g.seccion === "nervio" && g.direccion === 1)!.entrada!;
    expect([nervio.variant, nervio.h, nervio.hFlange, nervio.bWeb, nervio.intereje, nervio.base_inf_nBars, nervio.base_inf_barDiam, nervio.stirrupsEnabled]).toEqual(["reticular", 300, 50, 120, 800, 2, 12, false]);
    // El nervio de la dirección Y pierde en el canto el diámetro de la base X; el ábaco, en el recubrimiento
    const nervioY = gs.find((g) => g.seccion === "nervio" && g.direccion === 2)!.entrada!;
    expect([nervioY.h, nervioY.cover]).toEqual([288, 30]);
    expect(gs.find((g) => g.seccion === "abaco" && g.direccion === 2)!.entrada!.cover).toBe(46);
    // Los esfuerzos del nervio son los de su franja: por metro, por su ancho
    const g = gs.find((x) => x.seccion === "nervio" && x.direccion === 1)!;
    expect(g.entrada!.vano_Md).toBe(Math.max(...g.estaciones.map((e) => e.inferior * e.ancho)));
    expect(g.entrada!.spanLength).toBe(1000 * Math.min(...g.estaciones.map((e) => e.luz)));
    // Con cercos en una zona, sus nervios se comprueban con ellos
    const cercos = comprobarLosa(d, armadoLosa({ base, abacos: cuatro({ diametro: 16, separacion: 150 }), cercos: [{ direccion: "x", s: [-1, 13], t: [-1, 13], cercos: { diametro: 6, separacion: 150 } }] }));
    const filaCercos = cercos.filas.filter((f) => f.id === "x/shear" && f.seccion === "nervio");
    expect(filaCercos.length).toBeGreaterThan(0);
    for (const f of filaCercos) expect(f.grupo).toBe("cercos:0");
    expect(cercos.filas.some((f) => f.id === "x/stirrup-spacing-max")).toBe(true);
    expect(cercos.filas.some((f) => f.id === "y/stirrup-spacing-max")).toBe(false);
  });
});

describe("CO3: proponer el armado de una losa", () => {
  it("las tablas van de menos a más acero", () => {
    for (const t of [tablaParrillas(), tablaNervios()]) {
      expect(t.length).toBe(new Set(t.map((b) => JSON.stringify(b))).size);
      for (let i = 1; i < t.length; i++) expect(areaBarrasForjado(t[i]!)).toBeGreaterThanOrEqual(areaBarrasForjado(t[i - 1]!));
    }
    const c = tablaCercosNervio();
    for (let i = 1; i < c.length; i++) expect(areaBarra(c[i]!.diametro) / c[i]!.separacion).toBeGreaterThanOrEqual(areaBarra(c[i - 1]!.diametro) / c[i - 1]!.separacion);
  });

  it("en una maciza: lo propuesto cumple, es determinista, y con la base o con un refuerzo un puesto más abajo, no (criterios 12 y 13)", () => {
    const { d } = plana();
    const p = proponerLosa(d);
    expect(p.armado).not.toBeNull();
    const a = p.armado!;
    expect(p.comprobacion!.cumple).toBe(true);
    expect(p.sinRefuerzo).toEqual([]);
    expect(erroresArmadoForjado(a, false)).toEqual([]);
    expect(JSON.stringify(proponerLosa(d).armado)).toBe(JSON.stringify(a));
    expect(a.refuerzos!.length).toBeGreaterThan(0);
    expect(a.cercos).toBeUndefined();
    const tabla = tablaParrillas();
    const puesto = (b: BarrasForjado) => tabla.findIndex((x) => x.diametro === b.diametro && x.separacion === b.separacion);
    // La base: con un puesto menos falla una regla de armado de esa armadura
    let bajadas = 0;
    for (const arm of ARMADURAS_FORJADO) {
      const i = puesto(a.base[arm]);
      expect(i).toBeGreaterThanOrEqual(0);
      if (i === 0) continue;
      bajadas++;
      const c = comprobarLosa(d, armadoLosa({ base: { ...a.base, [arm]: tabla[i - 1]! } }));
      expect(c.filas.some((f) => f.armadura === arm && f.estado === "fail" && !/\/(bending|cracking)$/.test(f.id))).toBe(true);
    }
    expect(bajadas).toBeGreaterThan(0);
    // Cada refuerzo: con un puesto menos (o sin él), falla una fila de su armadura
    a.refuerzos!.forEach((r, j) => {
      const i = puesto(r.barras);
      const menos = a.refuerzos!.flatMap((x, m) => (m !== j ? [x] : i > 0 ? [{ ...x, barras: tabla[i - 1]! }] : []));
      const c = comprobarLosa(d, armadoLosa({ ...a, refuerzos: menos }));
      expect(c.filas.some((f) => f.armadura === r.armadura && f.estado === "fail"), `refuerzo ${j + 1}`).toBe(true);
    });
  });

  it("con un momento que tiene que cubrir la base (la de AB), la base propuesta lo resiste", () => {
    const { d } = plana();
    const libre = proponerLosa(d).armado!;
    const p = proponerLosa(d, undefined, { momentoBase: { "x-sup": 80 } });
    expect(areaBarrasForjado(p.armado!.base["x-sup"])).toBeGreaterThan(areaBarrasForjado(libre.base["x-sup"]));
    expect(p.armado!.base["x-inf"]).toEqual(libre.base["x-inf"]);
    const c = comprobarLosa(d, armadoLosa({ base: p.armado!.base }));
    for (const f of c.filas.filter((x) => x.id === "x-sup/bending")) expect(f.resistente!).toBeGreaterThanOrEqual(80);
    expect(p.comprobacion!.cumple).toBe(true);
    // Con más base, menos refuerzos en esa armadura
    const n = (a: ArmadoForjado) => (a.refuerzos ?? []).filter((r) => r.armadura === "x-sup").length;
    expect(n(p.armado!)).toBeLessThanOrEqual(n(libre));
  });

  it("en un reticular: la base por nervio, la parrilla de los ábacos, refuerzos de cada clase y cercos en los nervios; y cumple", () => {
    const { d } = plana({ reticular: true });
    const p = proponerLosa(d);
    const a = p.armado!;
    expect(p.comprobacion!.cumple).toBe(true);
    expect(p.sinRefuerzo).toEqual([]);
    expect(erroresArmadoForjado(a, true)).toEqual([]);
    for (const arm of ARMADURAS_FORJADO) {
      expect(a.base[arm].n).toBeGreaterThanOrEqual(1);
      expect(a.abacos![arm].separacion).toBeGreaterThan(0);
    }
    expect(new Set(a.refuerzos!.map((r) => r.en))).toEqual(new Set(["abacos", "nervios"]));
    for (const r of a.refuerzos!) expect(r.en === "nervios" ? r.barras.n !== undefined : r.barras.separacion !== undefined).toBe(true);
    // Sin los cercos, el cortante de algún nervio no cumple
    expect(a.cercos!.length).toBeGreaterThan(0);
    const { cercos: _c, ...sinCercos } = a;
    expect(comprobarLosa(d, armadoLosa(sinCercos)).filas.some((f) => f.id.endsWith("/shear") && f.seccion === "nervio" && f.estado === "fail")).toBe(true);
    expect(JSON.stringify(proponerLosa(d).armado)).toBe(JSON.stringify(a));
  });

  it("el despiece (CO6-g): ningún refuerzo corto, ninguno pisa a otro de su armadura, las puntas a 5 cm y, en los ábacos, uno por ábaco", () => {
    for (const v of [{}, { reticular: true }] as VarianteLosaPlana[]) {
      const { d } = plana(v);
      const a = proponerLosa(d).armado!;
      const rs = a.refuerzos!;
      const enModulo = (x: number) => Math.abs(x / MODULO_LARGO - Math.round(x / MODULO_LARGO)) < 1e-6;
      for (const [i, r] of rs.entries()) {
        const dir = d.direcciones[direccionArmadura(r.armadura) - 1]!;
        const [l0, l1] = [Math.min(...dir.franjas.map((f) => f.s0)), Math.max(...dir.franjas.map((f) => f.s1))];
        // Dentro de la losa y de al menos el largo mínimo
        expect(r.s[0]).toBeGreaterThanOrEqual(l0 - 1e-6);
        expect(r.s[1]).toBeLessThanOrEqual(l1 + 1e-6);
        expect(r.s[1] - r.s[0], `refuerzo ${i + 1}`).toBeGreaterThanOrEqual(LARGO_MINIMO - 1e-6);
        // En los nervios y en la maciza, las puntas al módulo (o en el borde de la losa o en el corte con un vecino)
        if (r.en !== "abacos")
          for (const x of r.s) expect(enModulo(x) || Math.abs(x - l0) < 1e-6 || Math.abs(x - l1) < 1e-6 || rs.some((o) => o !== r && o.armadura === r.armadura && (Math.abs(o.s[0] - x) < 1e-6 || Math.abs(o.s[1] - x) < 1e-6)), `refuerzo ${i + 1}: ${x}`).toBe(true);
        for (const o of rs.slice(i + 1)) {
          if (o.armadura !== r.armadura || o.en !== r.en) continue;
          expect(Math.min(r.s[1], o.s[1]) - Math.max(r.s[0], o.s[0]) > 1e-6 && Math.min(r.t[1], o.t[1]) - Math.max(r.t[0], o.t[0]) > 1e-6, `${i + 1} pisa a otro`).toBe(false);
        }
      }
      // En los ábacos: cada refuerzo cubre su ábaco entero (lo que cae en la losa) y hay uno por ábaco y armadura
      const deAbaco = rs.filter((r) => r.en === "abacos");
      if (v.reticular) expect(deAbaco.length).toBeGreaterThan(0);
      for (const r of deAbaco) {
        const dir = d.direcciones[direccionArmadura(r.armadura) - 1]!;
        const cajas = d.abacos.map((p) => {
          const [ss, ts] = [p.map((q) => q[0] * dir.d[0] + q[1] * dir.d[1]), p.map((q) => q[0] * dir.n[0] + q[1] * dir.n[1])];
          return { s: [Math.min(...ss), Math.max(...ss)], t: [Math.min(...ts), Math.max(...ts)] };
        });
        const suyo = cajas.filter((c) => c.s[0] < r.s[1] - 1e-6 && c.s[1] > r.s[0] + 1e-6 && c.t[0] < r.t[1] - 1e-6 && c.t[1] > r.t[0] + 1e-6);
        expect(suyo).toHaveLength(1);
        // Sus estaciones de ábaco, todas cubiertas
        const enEl = dir.estaciones.filter((e) => e.seccion === "abaco" && e.s > suyo[0]!.s[0] + 1e-6 && e.s < suyo[0]!.s[1] - 1e-6 && (e.t0 + e.t1) / 2 > suyo[0]!.t[0] + 1e-6 && (e.t0 + e.t1) / 2 < suyo[0]!.t[1] - 1e-6);
        expect(enEl.length).toBeGreaterThan(0);
        expect(enEl.every((e) => cubre(r, e))).toBe(true);
        expect(deAbaco.filter((o) => o.armadura === r.armadura && o.s[0] < r.s[1] - 1e-6 && o.s[1] > r.s[0] + 1e-6 && o.t[0] < r.t[1] - 1e-6 && o.t[1] > r.t[0] + 1e-6)).toHaveLength(1);
      }
      // Las zonas de cercos, igual: de su largo mínimo y sin pisarse en su dirección
      for (const [i, c] of (a.cercos ?? []).entries()) {
        expect(c.s[1] - c.s[0]).toBeGreaterThanOrEqual(LARGO_MINIMO_CERCOS - 1e-6);
        for (const o of a.cercos!.slice(i + 1)) if (o.direccion === c.direccion) expect(Math.min(c.s[1], o.s[1]) - Math.max(c.s[0], o.s[0]) > 1e-6 && Math.min(c.t[1], o.t[1]) - Math.max(c.t[0], o.t[0]) > 1e-6).toBe(false);
      }
    }
  });
});

describe("CO3: las losas de un proyecto", () => {
  it("sin armado no cumplen; con el propuesto, sí, y lo propuesto es un dato válido del proyecto", () => {
    const { q } = plana();
    const sin = comprobarLosas(q, undefined, undefined);
    if (!sin.valido) throw new Error("no vale");
    expect(sin.valor.resumen).toMatchObject({ losas: 1, cumplen: 0, sinArmado: 1 });
    expect(sin.valor.losas[0]!.pendientes[0]!.motivo).toMatch(/no tiene armado/);
    expect(sin.diagnosticos.map((x) => x.codigo)).toContain("comprobacion/sin-armado");
    const prop = comprobarLosas(q, undefined, undefined, { proponer: true });
    if (!prop.valido) throw new Error("no vale");
    const l = prop.valor.losas[0]!;
    expect([l.origen, l.cumple, l.tipo]).toEqual(["propuesto", true, "maciza"]);
    expect(l.manda!.aprovechamiento).toBeLessThan(1);
    expect(prop.diagnosticos.map((x) => x.codigo)).toEqual(expect.arrayContaining(["comprobacion/losas-por-defecto", "comprobacion/punzonamiento-aparte"]));
    const forjados = armadoPropuestoLosas(prop.valor, undefined);
    expect(comprobarArmado({ forjados }, q.fisico)).toEqual([]);
    // Con el armado guardado, lo mismo que al proponerlo; y con sus filas, si se piden
    const con = comprobarLosas(q, forjados, undefined, { filas: true });
    if (!con.valido) throw new Error("no vale");
    expect([con.valor.losas[0]!.origen, con.valor.losas[0]!.cumple]).toEqual(["proyecto", true]);
    expect(con.valor.losas[0]!.aprovechamiento).toBe(l.aprovechamiento);
    expect(con.valor.losas[0]!.filas!.length).toBeGreaterThan(10);
    // La armadura base de AB (kN·m/m) manda en la base propuesta
    const conAB = comprobarLosas(q, undefined, undefined, { proponer: true, bases: { base: { "y-inf": 90 } } });
    if (!conAB.valido) throw new Error("no vale");
    expect(areaBarrasForjado(conAB.valor.losas[0]!.armado!.base["y-inf"])).toBeGreaterThan(areaBarrasForjado(l.armado!.base["y-inf"]));
  });

  it("lo que no vale del armado de una losa se dice", () => {
    const f = losaPlana({ reticular: true });
    const base = cuatro({ diametro: 12, n: 2 });
    const codigos = (forjados: Record<string, ArmadoForjado>) => comprobarArmado({ forjados }, f).map((x) => x.codigo);
    expect(codigos({ L: { base, abacos: cuatro(D12A200) } })).toEqual([]);
    expect(codigos({ X: { base } })).toEqual(["armado/losa"]);
    // En un reticular, la base va por nervio y los refuerzos dicen de qué son
    expect(codigos({ L: { base: cuatro(D12A200) } }).length).toBe(8);
    expect(codigos({ L: { base, refuerzos: [{ armadura: "x-sup", s: [0, 1], t: [0, 1], barras: D12A200 }] } })).toEqual(["armado/barras"]);
    expect(codigos({ L: { base, refuerzos: [{ armadura: "x-sup", s: [1, 0], t: [0, 1], barras: D12A200, en: "abacos" }] } })).toEqual(["armado/barras"]);
    expect(codigos({ L: { base, cercos: [{ direccion: "x", s: [0, 1], t: [0, 1], cercos: { diametro: 7, separacion: 100 } }] } })).toEqual(["armado/barras"]);
    // En una maciza, separación; ni ábacos ni cercos
    const m = losaPlana();
    expect(comprobarArmado({ forjados: { L: { base: cuatro(D12A200) } } }, m)).toEqual([]);
    expect(comprobarArmado({ forjados: { L: { base: cuatro(D12A200), abacos: cuatro(D12A200), cercos: [] } } }, m).length).toBe(2);
    expect(comprobarArmado({ forjados: { L: { base: cuatro({ diametro: 12, n: 2 }) } } }, m).length).toBe(8);
  });
});

describe("CO3-k: la armadura mínima reducida de las losas de cimentación", () => {
  const REDUCIDA = { minimaReducidaCimentacion: true };
  const montar = (o: Parameters<typeof conLosaCimentacion>[0] = {}) => {
    const q = consultas(conLosaCimentacion(o));
    return { q, d: demandas(q, "LC"), arriba: demandas(q, "L") };
  };

  it("sólo actúa en una losa de cimentación y donde no se llega a la mínima del módulo; sin la opción, nada cambia", () => {
    const { d, arriba } = montar();
    expect(d.cimentacion).toBe(true);
    expect(arriba.cimentacion).toBe(false);
    // La losa de arriba no es de cimentación: con la opción, lo mismo
    expect(proponerLosa(arriba, REDUCIDA)).toEqual(proponerLosa(arriba, undefined));
    // Un armado que ya llega a la mínima de (9.1): con la opción, las mismas filas
    const sin = proponerLosa(d, undefined);
    expect(sin.armado).not.toBeNull();
    expect(comprobarLosa(d, armadoLosa(sin.armado!, REDUCIDA)).filas).toEqual(comprobarLosa(d, armadoLosa(sin.armado!, undefined)).filas);
    expect(sin.comprobacion!.filas.some((f) => f.id.endsWith("/as-min-elu"))).toBe(false);
  });

  it("con la opción, la base baja hasta el suelo geométrico y lo que falta hasta 1,2 veces lo necesario en ELU va en refuerzos", () => {
    const { d } = montar();
    if (d.material.tipo !== "hormigon") throw new Error("sin hormigón");
    const h = 1000 * d.espesor;
    const minima = asMinRectangular(1000, h, getConcrete(d.material.fck).fctm, getFyd(500));
    const suelo = cuantiaGeometrica(500) * 1000 * h;
    expect(suelo).toBeCloseTo(540, 9);
    expect(suelo).toBeLessThan(minima);
    const [sin, con] = [proponerLosa(d, undefined), proponerLosa(d, REDUCIDA)];
    for (const k of ARMADURAS_FORJADO) {
      // Sin la opción, la base llega a la mínima del módulo; con ella, al suelo, y es la primera de la tabla que llega
      expect(areaBarrasForjado(sin.armado!.base[k])).toBeGreaterThanOrEqual(minima);
      const As = areaBarrasForjado(con.armado!.base[k]);
      expect(As).toBeGreaterThanOrEqual(suelo);
      expect(As).toBeLessThan(minima);
      const anterior = tablaParrillas()[tablaParrillas().findIndex((b) => b.diametro === con.armado!.base[k].diametro && b.separacion === con.armado!.base[k].separacion) - 1]!;
      expect(areaBarrasForjado(anterior)).toBeLessThan(suelo);
    }
    expect(con.comprobacion!.cumple).toBe(true);
    expect(con.sinRefuerzo).toEqual([]);
    expect((con.armado!.refuerzos ?? []).length).toBeGreaterThan(sin.armado!.refuerzos?.length ?? 0);
    const area = 13 * 13;
    const kg = (a: typeof con) => aceroLosa(a.armado!, area).base + aceroLosa(a.armado!, area).refuerzos;
    expect(kg(con)).toBeLessThan(0.85 * kg(sin));
    // Las filas: donde no llega a la mínima del módulo, el suelo y 1,2 veces la flexión de su mismo grupo
    const filas = con.comprobacion!.filas;
    const elu = filas.filter((f) => f.id.endsWith("/as-min-elu"));
    expect(elu.length).toBeGreaterThan(0);
    for (const f of elu) {
      const flexion = filas.find((x) => x.id === `${f.armadura}/bending` && x.seccion === f.seccion && JSON.stringify(x.refuerzos) === JSON.stringify(f.refuerzos))!;
      expect(f.aprovechamiento).toBeCloseTo(FACTOR_MINIMA_REDUCIDA * flexion.aprovechamiento, 12);
      expect(f.aprovechamiento).toBeLessThanOrEqual(1 + 1e-9);
      expect([f.franja, f.s, f.comb]).toEqual([flexion.franja, flexion.s, flexion.comb]);
      const geo = filas.find((x) => x.id === `${f.armadura}/as-min` && x.seccion === f.seccion && JSON.stringify(x.refuerzos) === JSON.stringify(f.refuerzos))!;
      expect(geo.descripcion).toContain("suelo geométrico");
      expect(geo.aprovechamiento).toBeLessThanOrEqual(1 + 1e-9);
    }
    // El suelo, contra el acero de la base escrito aparte
    const base = filas.find((f) => f.id === "x-inf/as-min" && f.refuerzos.length === 0 && f.descripcion.includes("suelo geométrico"))!;
    // (el módulo redondea el área de cada barra: 113 mm² el Ø12, CO4-1)
    expect(base.aprovechamiento).toBeCloseTo(suelo / areaBarrasForjado(con.armado!.base["x-inf"]), 3);
    // Lo propuesto con la opción, comprobado sin ella, no cumple: le falta la mínima del módulo
    const estricta = comprobarLosa(d, armadoLosa(con.armado!, undefined));
    expect(estricta.cumple).toBe(false);
    expect(estricta.filas.filter((f) => f.estado === "fail").every((f) => f.id.endsWith("/as-min"))).toBe(true);
  });

  it("una base bajo el suelo no vale, y donde 1,2·MEd pasa de MRd falla la fila de ELU aunque la flexión cumpla", () => {
    const { d } = montar({ cm: 12, q: 20 });
    const base = (b: BarrasForjado) => ({ "x-inf": b, "x-sup": b, "y-inf": b, "y-sup": b });
    // Ø12/250 (452 mm²/m) no llega al suelo de 540
    const corta = comprobarLosa(d, armadoLosa({ base: base({ diametro: 12, separacion: 250 }) }, REDUCIDA));
    expect(corta.filas.some((f) => f.id.endsWith("/as-min") && f.estado === "fail" && f.descripcion.includes("suelo geométrico"))).toBe(true);
    // Ø12/200 llega al suelo; con esta carga, bajo los pilares 1,2·MEd pasa de MRd
    const justa = comprobarLosa(d, armadoLosa({ base: base({ diametro: 12, separacion: 200 }) }, REDUCIDA));
    expect(justa.filas.filter((f) => f.id.endsWith("/as-min")).every((f) => f.estado !== "fail")).toBe(true);
    const fallan = justa.filas.filter((f) => f.id.endsWith("/as-min-elu") && f.estado === "fail");
    expect(fallan.length).toBeGreaterThan(0);
    for (const f of fallan) expect(f.aprovechamiento).toBeGreaterThan(1);
    // Las estaciones que piden refuerzo son las de 1,2·MEd > MRd: más que las de la flexión sola
    const armado = armadoLosa({ base: base({ diametro: 12, separacion: 200 }) }, REDUCIDA);
    const [conOpcion, soloFlexion] = [estacionesQueFallan(d, armado, "x-inf"), estacionesQueFallan(d, { ...armado, minimaReducida: false }, "x-inf")];
    expect(conOpcion.length).toBeGreaterThan(soloFlexion.length);
    for (const e of soloFlexion) expect(conOpcion).toContain(e);
  });
});
