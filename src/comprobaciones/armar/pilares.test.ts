/**
 * Fase CO1 (`docs/fem3d/comprobaciones.md` §7, criterios 12 y 13): proponer el armado de los pilares.
 *
 * - La tabla va de menos a más acero y es la misma cada vez.
 * - El armado propuesto no tiene ninguna fila que falle, y ninguno de los anteriores de la tabla
 *   pasa (ni con cercos más fuertes, si lo que le falla es el cortante).
 * - Lo propuesto, guardado como armado del proyecto, da al comprobarlo lo mismo.
 * - Un tramo sin armado no cumple, y se dice.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioSO, type VarianteSO } from "../../../validacion/so/modelos.ts";
import { compilar } from "../../compilador/compilar.ts";
import { Consultas } from "../../compilador/consultas.ts";
import { calcular } from "../../motor/calcular.ts";
import { iniciarNucleo } from "../../nucleo/index.ts";
import { areaDe, armadoPilar, barrasDe, cercosExtremos, erroresArmado, textoArmado, textoCercosPilar } from "../armado.ts";
import { comprobarTramo } from "../comprobar/pilares.ts";
import { demandasPilar } from "../demandas/pilares.ts";
import { armadoPropuesto, comprobarPilares } from "../pilares.ts";
import { aflojarCentro, cercosDe, proponerTramo, SEPARACIONES_CENTRO, solapesPilar, tablaPilares } from "./pilares.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function consultas(v: VarianteSO = {}): Consultas {
  const f = edificioSO(v);
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return new Consultas(f, c, r.casos, {}, r.modal);
}

describe("CO1: la tabla de armados de los pilares", () => {
  it("va de menos a más acero, sin repetidos y con armados admisibles", () => {
    const t = tablaPilares("rectangular", 400, 400);
    expect(t.length).toBe(4 * 16);
    for (let i = 1; i < t.length; i++) expect(areaDe(t[i]!)).toBeGreaterThanOrEqual(areaDe(t[i - 1]!) - 1e-9);
    expect(new Set(t.map(textoArmado)).size).toBe(t.length);
    for (const a of t) expect(erroresArmado(a)).toEqual([]);
    expect(textoArmado(t[0]!)).toBe("4Ø12 · cØ6/100");
    expect(barrasDe(t[0]!)).toBe(4);
    expect(tablaPilares("rectangular", 400, 400)).toEqual(t);
    const c = tablaPilares("circular", 400, 400);
    expect(c.every((a) => a.anillo && !a.esquinas)).toBe(true);
    expect(textoArmado(c[0]!)).toBe("6Ø12 · cØ6/100");
  });

  it("los cercos cumplen la zona densificada: 0,6·mín(15·Ø, lado, 300), al centímetro por abajo", () => {
    expect(cercosDe(12, 400)).toEqual({ diametro: 6, separacion: 100 });
    expect(cercosDe(16, 400)).toEqual({ diametro: 6, separacion: 140 });
    expect(cercosDe(20, 400)).toEqual({ diametro: 6, separacion: 180 });
    expect(cercosDe(25, 250)).toEqual({ diametro: 8, separacion: 150 });
  });
});

describe("CO1: proponer el armado de un tramo", () => {
  it("el propuesto no falla en nada y ninguno de los anteriores de la tabla pasa", () => {
    // Con mucha carga, para que no valga el primero de la tabla
    const q = consultas({ G: 900, Q: 450, W: 120 });
    for (const id of ["P1", "P5"]) {
      const d = demandasPilar(q, id);
      if (!d.valido) throw new Error("sin demandas");
      const t = d.valor.tramos.at(-1)!;
      const p = proponerTramo(t);
      expect(p.armado).not.toBeNull();
      expect(p.comprobacion!.cumple).toBe(true);
      expect(p.comprobacion!.filas.every((f) => f.estado !== "fail")).toBe(true);
      const tabla = tablaPilares("rectangular", 400, 400);
      expect(p.posicion).toBeGreaterThan(0);
      expect(areaDe(tabla[p.posicion]!)).toBe(areaDe(p.armado!));
      for (let i = 0; i < p.posicion; i++) expect(comprobarTramo(t, armadoPilar(tabla[i]!)).filas.some((f) => f.estado === "fail")).toBe(true);
      // Determinista
      expect(proponerTramo(t)).toEqual(p);
    }
  });

  it("si la sección no basta, no hay propuesta y se dice por qué", () => {
    const q = consultas({ G: 4000, Q: 2000 });
    const d = demandasPilar(q, "P5");
    if (!d.valido) throw new Error("sin demandas");
    const p = proponerTramo(d.valor.tramos.at(-1)!);
    expect(p.armado).toBeNull();
    expect(p.motivo).toContain("la sección no basta");
  });

  it("lo propuesto, como armado del proyecto, da al comprobarlo lo mismo; sin armado, no cumple", () => {
    const q = consultas();
    const sin = comprobarPilares(q, undefined, undefined);
    if (!sin.valido) throw new Error("no válido");
    expect(sin.valor.resumen).toMatchObject({ pilares: 9, tramos: 27, cumplen: 0, sinArmado: 27 });
    expect(sin.diagnosticos.some((x) => x.codigo === "comprobacion/sin-armado")).toBe(true);

    const prop = comprobarPilares(q, undefined, undefined, { proponer: true });
    if (!prop.valido) throw new Error("no válido");
    expect(prop.valor.resumen).toMatchObject({ tramos: 27, cumplen: 27, noCumplen: 0, sinArmado: 0 });
    const armado = armadoPropuesto(prop.valor, undefined);
    expect(Object.keys(armado).length).toBe(9);
    const con = comprobarPilares(q, armado, undefined, { filas: true });
    if (!con.valido) throw new Error("no válido");
    expect(con.valor.resumen).toMatchObject({ cumplen: 27, sinArmado: 0 });
    con.valor.pilares.forEach((p, i) =>
      p.tramos.forEach((t, j) => {
        const o = prop.valor.pilares[i]!.tramos[j]!;
        expect(t.origen).toBe("proyecto");
        expect(t.texto).toBe(o.texto);
        expect(t.aprovechamiento).toBe(o.aprovechamiento);
        expect(t.manda).toEqual(o.manda);
        expect(t.filas!.length).toBeGreaterThan(10);
      }),
    );
    // Sólo un pilar, y sólo lo que falta
    const uno = comprobarPilares(q, { P1: armado.P1! }, undefined, { ids: ["P1", "P2"], proponer: true, soloSinArmado: true });
    if (!uno.valido) throw new Error("no válido");
    expect(uno.valor.pilares.map((p) => p.tramos.map((t) => t.origen))).toEqual([Array(3).fill("proyecto"), Array(3).fill("propuesto")]);
    expect(comprobarPilares(q, undefined, undefined, { ids: ["P99"] }).valido).toBe(false);
  });
});

describe("CO1-f: los cercos del centro del tramo, más abiertos", () => {
  it("con lo propuesto, el centro lleva la separación más abierta que cumple y los extremos, la de la tabla; lo demás no cambia", () => {
    const q = consultas();
    const con = comprobarPilares(q, undefined, undefined, { proponer: true, filas: true });
    const sin = comprobarPilares(q, undefined, undefined, { proponer: true, filas: true, zonasCercos: false });
    if (!con.valido || !sin.valido) throw new Error("no comprueba");
    let conZonas = 0;
    con.valor.pilares.forEach((p, i) =>
      p.tramos.forEach((t, k) => {
        const u = sin.valor.pilares[i]!.tramos[k]!;
        const [a, b] = [t.armado!, u.armado!];
        // El mismo armado longitudinal y los mismos cercos en los extremos
        expect({ ...a, cercos: 0, cercosPie: 0, cercosCabeza: 0 }).toEqual({ ...b, cercos: 0, cercosPie: 0, cercosCabeza: 0 });
        expect(cercosExtremos(a)).toEqual(b.cercos);
        expect(t.cumple).toBe(true);
        expect(erroresArmado(a)).toEqual([]);
        if (!a.cercosPie) return expect(a).toEqual(b);
        conZonas++;
        expect(a.cercosPie).toEqual(b.cercos);
        expect(a.cercosCabeza).toEqual(b.cercos);
        expect(a.cercos.diametro).toBe(b.cercos.diametro);
        expect(a.cercos.separacion).toBeGreaterThan(b.cercos.separacion);
        expect(SEPARACIONES_CENTRO as readonly number[]).toContain(a.cercos.separacion);
        // No pasa de mín(15·Ø, lado, 300), y la siguiente más abierta que cabe no cumple
        const d = demandasPilar(q, p.pilar);
        if (!d.valido) throw new Error("sin demandas");
        const dt = d.valor.tramos[k]!;
        const maxima = Math.min(15 * 12, 400, 300);
        expect(a.cercos.separacion).toBeLessThanOrEqual(maxima);
        const masAbierta = SEPARACIONES_CENTRO.filter((s) => s <= maxima && s > a.cercos.separacion).at(-1);
        if (masAbierta) expect(comprobarTramo(dt, armadoPilar({ ...a, cercos: { ...a.cercos, separacion: masAbierta } }, undefined), d.valor.betaUno).cumple).toBe(false);
        // Lo propuesto con zonas, comprobado como armado del proyecto, da lo mismo
        expect(aflojarCentro(dt, b, undefined, d.valor.betaUno)!.armado).toEqual(a);
        expect(aflojarCentro(dt, a, undefined, d.valor.betaUno)).toBeNull();
        expect(textoArmado(a)).toContain(`cØ${a.cercos.diametro}/${a.cercos.separacion} (pie y cabeza, /${b.cercos.separacion})`);
      }),
    );
    expect(conZonas).toBeGreaterThan(0);
    const otra = comprobarPilares(q, armadoPropuesto(con.valor, undefined), undefined, { filas: true });
    if (!otra.valido) throw new Error("no comprueba");
    expect(otra.valor.pilares.map((p) => p.tramos.map((t) => [t.cumple, t.aprovechamiento, t.texto]))).toEqual(con.valor.pilares.map((p) => p.tramos.map((t) => [t.cumple, t.aprovechamiento, t.texto])));
  });

  it("el texto de los cercos y el solape del pie", () => {
    const c = { diametro: 6, separacion: 180 };
    expect(textoCercosPilar({ cercos: c })).toBe("cØ6/180");
    expect(textoCercosPilar({ cercos: c, cercosPie: { diametro: 6, separacion: 100 }, cercosCabeza: { diametro: 6, separacion: 100 } })).toBe("cØ6/180 (pie y cabeza, /100)");
    expect(textoCercosPilar({ cercos: c, cercosPie: { diametro: 8, separacion: 100 } })).toBe("cØ6/180 (pie, cØ8/100)");
    expect(textoCercosPilar({ cercos: c, cercosPie: { diametro: 6, separacion: 100 }, cercosCabeza: { diametro: 6, separacion: 120 } })).toBe("cØ6/180 (pie, /100; cabeza, /120)");
    expect(erroresArmado({ esquinas: 12, cercos: c, cercosPie: { diametro: 7, separacion: 0 } }).length).toBe(2);
    // El solape, 1,5·lb,rqd: crece con el diámetro y baja con el hormigón
    const [s25, s30] = [solapesPilar(25), solapesPilar(30)];
    expect(s25[16]!).toBeGreaterThan(s25[12]!);
    expect(s30[16]!).toBeLessThan(s25[16]!);
    expect(s25[16]! / 0.016).toBeGreaterThan(40);
    expect(s25[16]! / 0.016).toBeLessThan(80);
  });
});
