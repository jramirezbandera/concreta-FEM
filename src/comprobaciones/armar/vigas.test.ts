/**
 * Fase CO2 (`docs/fem3d/comprobaciones.md` §7, criterios 12 y 13): proponer el armado de las vigas.
 *
 * - Las tablas van de menos a más acero, sin repetidos, y son las mismas cada vez.
 * - El armado propuesto no tiene ninguna fila que falle, y con cualquiera de sus armaduras un puesto
 *   más abajo en su tabla, alguna falla.
 * - Lo propuesto, guardado como armado del proyecto, da al comprobarlo lo mismo.
 * - Un vano sin armado no cumple, y se dice.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { porticoVigas, type VariantePortico } from "../../../validacion/co/modelosVigas.ts";
import { compilar } from "../../compilador/compilar.ts";
import { Consultas } from "../../compilador/consultas.ts";
import { calcular } from "../../motor/calcular.ts";
import { iniciarNucleo } from "../../nucleo/index.ts";
import { armadoViga, erroresArmadoViga, ramasDe, textoArmadoViga } from "../armado.ts";
import { comprobarVano } from "../comprobar/vigas.ts";
import { demandasViga, type DemandasVano, type DemandasViga, type DemandasZona, type ExtremoViga } from "../demandas/vigas.ts";
import { armadoPropuestoVigas, comprobarVigas } from "../vigas.ts";
import { armadoDe, proponerVano, tablaBarras, tablaCercos, type PosicionesVano } from "./vigas.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function consultas(v: VariantePortico = {}): Consultas {
  const f = porticoVigas(v);
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return new Consultas(f, c, r.casos, {}, r.modal);
}

function demandas(q: Consultas, id: string): DemandasViga {
  const d = demandasViga(q, id);
  if (!d.valido) throw new Error(d.diagnosticos.map((x) => x.mensaje).join("\n"));
  return d.valor;
}

const area = (b: { n: number; diametro: number }) => (b.n * Math.PI * b.diametro ** 2) / 4;

describe("CO2: las tablas de armado de las vigas", () => {
  it("las barras van de menos a más acero, sin repetidos, y caben en el ancho", () => {
    const t = tablaBarras(300, 30);
    expect(t[0]).toEqual({ n: 2, diametro: 12 });
    for (let i = 1; i < t.length; i++) expect(area(t[i]!)).toBeGreaterThanOrEqual(area(t[i - 1]!) - 1e-9);
    expect(new Set(t.map((b) => `${b.n}Ø${b.diametro}`)).size).toBe(t.length);
    // En 300 − 2·30 − 2·6 = 228 mm, con 25 mm libres, caben 6Ø12 (6·12 + 5·25 = 197) y no 7 (234); de Ø25, 5 (125 + 100 = 225)
    expect(Math.max(...t.filter((b) => b.diametro === 12).map((b) => b.n))).toBe(6);
    expect(Math.max(...t.filter((b) => b.diametro === 25).map((b) => b.n))).toBe(5);
    expect(tablaBarras(300, 30)).toEqual(t);
    // Una viga plana ancha admite más barras; una muy estrecha, ninguna
    expect(tablaBarras(600, 30).length).toBeGreaterThan(t.length);
    expect(tablaBarras(90, 30)).toEqual([]);
  });

  it("los cercos van de menos a más ramas y, con las mismas, de menos a más acero por metro", () => {
    const t = tablaCercos(300, 30);
    const acero = (c: { diametro: number; separacion: number; ramas?: number }) => (ramasDe(c) * Math.PI * c.diametro ** 2) / 4 / c.separacion;
    expect(t[0]).toEqual({ diametro: 6, separacion: 300 });
    for (let i = 1; i < t.length; i++) {
      expect(ramasDe(t[i]!)).toBeGreaterThanOrEqual(ramasDe(t[i - 1]!));
      if (ramasDe(t[i]!) === ramasDe(t[i - 1]!)) expect(acero(t[i]!)).toBeGreaterThanOrEqual(acero(t[i - 1]!) - 1e-12);
    }
    // En 30 cm caben 2, 3 y 4 ramas a 60 mm o más; 6, desde 54 cm
    expect([...new Set(t.map(ramasDe))].sort()).toEqual([2, 3, 4]);
    expect([...new Set(tablaCercos(600, 30).map(ramasDe))].sort()).toEqual([2, 3, 4, 6]);
    expect(t.length).toBe(3 * 3 * 8);
    expect(new Set(t.map((c) => `${c.diametro}/${c.separacion}/${ramasDe(c)}`)).size).toBe(t.length);
  });
});

describe("CO2: proponer el armado de un vano", () => {
  it("el propuesto no falla en nada y, con cualquier armadura un puesto más abajo, algo falla (criterio 12)", () => {
    const q = consultas({ cm: 40, q: 25, sismo: true });
    let conApoyos = 0;
    for (const id of ["F1-X0", "F2-X1", "F1-Y1"]) {
      const d = demandas(q, id);
      for (const v of d.vanos) {
        const p = proponerVano(d, v);
        expect(p.armado, `${id} vano ${v.indice}`).not.toBeNull();
        expect(erroresArmadoViga(p.armado!)).toEqual([]);
        expect(p.comprobacion!.cumple).toBe(true);
        expect(p.comprobacion!.filas.every((f) => f.estado !== "fail")).toBe(true);
        const pos = p.posiciones!;
        const barras = tablaBarras(300, 30);
        const cercos = tablaCercos(300, 30);
        expect(armadoDe(pos, barras, cercos)).toEqual(p.armado);
        // Lo de los apoyos no baja de lo corrido
        expect(Math.min(pos.superiorInicio, pos.superiorFin)).toBeGreaterThanOrEqual(pos.superior);
        expect(Math.min(pos.cercosInicio, pos.cercosFin)).toBeGreaterThanOrEqual(pos.cercos);
        if (p.armado!.superiorInicio || p.armado!.superiorFin) conApoyos++;
        for (const grupo of Object.keys(pos) as (keyof PosicionesVano)[]) {
          if (pos[grupo] === 0) continue;
          if ((grupo === "superiorInicio" || grupo === "superiorFin") && pos[grupo] === pos.superior) continue;
          if ((grupo === "cercosInicio" || grupo === "cercosFin") && pos[grupo] === pos.cercos) continue;
          const menos = armadoDe({ ...pos, [grupo]: pos[grupo] - 1 }, barras, cercos);
          const c = comprobarVano(d, v, armadoViga(menos));
          expect(c.filas.some((f) => f.estado === "fail") || c.pendientes.length > 0, `${id} vano ${v.indice}: ${grupo} un puesto más abajo`).toBe(true);
        }
        // Determinista
        expect(proponerVano(d, v)).toEqual(p);
      }
    }
    expect(conApoyos).toBeGreaterThan(0);
  });

  it("si la sección no basta, no hay propuesta y se dice por qué", () => {
    const q = consultas({ cm: 400, q: 200 });
    const d = demandas(q, "F1-X0");
    const p = proponerVano(d, d.vanos[0]!);
    expect(p.armado).toBeNull();
    expect(p.motivo).toContain("la sección no basta");
    expect(p.comprobacion!.filas.some((f) => f.estado === "fail")).toBe(true);
  });

  it("una viga plana de 30 × 30 pide cercos de más de dos ramas (la separación transversal de 0,75·d)", () => {
    const q = consultas({ b: 0.3, h: 0.3, cm: 5, q: 3 });
    const d = demandas(q, "F1-Y1");
    const p = proponerVano(d, d.vanos[0]!);
    expect(p.armado).not.toBeNull();
    expect(ramasDe(p.armado!.cercos)).toBe(3);
    expect(textoArmadoViga(p.armado!)).toContain("(3R)");
  });

  it("con torsión de equilibrio, propone también las barras de piel", () => {
    const e = (valor: number, esfuerzos: number[]): ExtremoViga => ({ valor, s: 1, comb: "ELU-1", esfuerzos });
    const zona = (nombre: DemandasZona["zona"]): DemandasZona => ({
      zona: nombre,
      desde: 0,
      hasta: 1,
      positivo: e(50, [0, 0, 60, 15, 50, 0]),
      negativo: e(-50, [0, 0, 60, 15, -50, 0]),
      cortante: e(60, [0, 0, 60, 15, -50, 0]),
      torsion: e(15, [0, 0, 60, 15, -50, 0]),
      cpPositivo: e(25, [0, 0, 30, 7, 25, 0]),
      cpNegativo: e(-25, [0, 0, 30, 7, -25, 0]),
    });
    const v: DemandasVano = { indice: 0, desde: 0, hasta: 5, apoyos: ["P1", "P2"], torsionEquilibrio: true, zonas: [zona("inicio"), zona("centro"), zona("fin")], empotramiento: [null, null], flecha: null };
    const d: DemandasViga = { viga: "V", seccion: { id: "v", material: "H", forma: "rectangular", b: 0.3, h: 0.5 }, material: { id: "H", tipo: "hormigon", fck: 25 }, axilSinValor: true, situaciones: ["ELU-PT"], combinaciones: 1, vanos: [v] };
    const p = proponerVano(d, v);
    expect(p.armado).not.toBeNull();
    expect(p.armado!.piel).toEqual({ n: 1, diametro: 12 });
    expect(p.comprobacion!.filas.filter((f) => f.id.includes("torsion")).length).toBe(15);
    expect(p.comprobacion!.cumple).toBe(true);
    // Sin la torsión de equilibrio, con las mismas demandas, ni piel ni tantos cercos
    const sin = proponerVano({ ...d, vanos: [{ ...v, torsionEquilibrio: false }] }, { ...v, torsionEquilibrio: false });
    expect(sin.armado!.piel).toBeUndefined();
    expect(sin.posiciones!.cercos).toBeLessThan(p.posiciones!.cercos);
  });
});

describe("CO2-k: la misma armadura superior a los dos lados de cada apoyo (§8.28)", () => {
  const zona = (a: { superior: { n: number; diametro: number }; superiorInicio?: { n: number; diametro: number }; superiorFin?: { n: number; diametro: number } }, campo: "superiorInicio" | "superiorFin") => a[campo] ?? a.superior;
  const igual = (a: { n: number; diametro: number }, b: { n: number; diametro: number }) => a.n === b.n && a.diametro === b.diametro;

  it("con una zona fijada, se propone lo demás con ella: la zona no se mueve y, si con ella no basta lo de antes, sube otra armadura", () => {
    // P3 del pórtico con viento: el vano 1 de F1-X0 pide 5Ø12 junto a P3 y el vano 0, 4Ø16. Con 4Ø16
    // en el vano 1, el canto útil baja 2 mm y su cortante pasa de 1 con los cercos de antes
    const q = consultas();
    const d = demandas(q, "F1-X0");
    const v = d.vanos[1]!;
    const libre = proponerVano(d, v);
    expect(libre.armado!.superiorInicio).toEqual({ n: 5, diametro: 12 });
    const T = { n: 4, diametro: 16 };
    const solo = comprobarVano(d, v, armadoViga({ ...libre.armado!, superiorInicio: T }));
    expect(solo.filas.find((f) => f.estado === "fail")?.id).toBe("inicio/shear");
    const fija = proponerVano(d, v, undefined, { fijas: { superiorInicio: T } });
    expect(fija.armado!.superiorInicio).toEqual(T);
    expect(fija.comprobacion!.cumple).toBe(true);
    // Sube los cercos de esa zona (lo que pedía el cortante) y nada baja de lo de antes
    const [cl, cf] = [libre.posiciones!, fija.posiciones!];
    expect(cf.cercosInicio).toBeGreaterThan(cl.cercosInicio);
    for (const g of ["inferior", "superior", "superiorFin", "cercos", "cercosFin", "piel"] as const) expect(cf[g], g).toBeGreaterThanOrEqual(cl[g]);
    // Determinista, y una zona que no cabe en el ancho no da propuesta
    expect(proponerVano(d, v, undefined, { fijas: { superiorInicio: T } })).toEqual(fija);
    expect(proponerVano(d, v, undefined, { fijas: { superiorInicio: { n: 9, diametro: 25 } } }).armado).toBeNull();
  });

  it("al proponer un proyecto: en cada apoyo interior de cada pórtico, la misma superior a los dos lados, la mayor de las dos (o más); todo cumple", () => {
    for (const variante of [{}, { cm: 40, q: 25, sismo: true }] as VariantePortico[]) {
      const q = consultas(variante);
      const prop = comprobarVigas(q, undefined, undefined, { proponer: true });
      if (!prop.valido) throw new Error("no válido");
      expect(prop.valor.resumen).toMatchObject({ vanos: 18, cumplen: 18, noCumplen: 0 });
      const armado = new Map(prop.valor.vigas.flatMap((g) => g.vanos.map((v) => [`${g.viga}/${v.vano}`, v.armado!] as const)));
      let apoyos = 0;
      for (const g of prop.valor.vigas) {
        const d = demandas(q, g.viga);
        for (let i = 0; i + 1 < g.vanos.length; i++) {
          const [a, b] = [armado.get(`${g.viga}/${i}`)!, armado.get(`${g.viga}/${i + 1}`)!];
          // Entre el último vano y el voladizo también: los dos son de la viga y comparten apoyo
          const [za, zb] = [zona(a, "superiorFin"), zona(b, "superiorInicio")];
          expect(igual(za, zb), `${g.viga}: apoyo entre los vanos ${i} y ${i + 1}`).toBe(true);
          // No menos que lo que pedía cada uno por su cuenta
          const [pa, pb] = [proponerVano(d, d.vanos[i]!).armado!, proponerVano(d, d.vanos[i + 1]!).armado!];
          expect(area(za)).toBeGreaterThanOrEqual(Math.max(area(zona(pa, "superiorFin")), area(zona(pb, "superiorInicio"))) - 1e-9);
          apoyos++;
        }
      }
      expect(apoyos).toBe(8);
      // Guardado y comprobado, lo mismo
      const con = comprobarVigas(q, armadoPropuestoVigas(prop.valor, undefined), undefined);
      expect(con.valido && con.valor.resumen.cumplen).toBe(18);
    }
  });

  it("con el vano de un lado escrito en el proyecto, no se toca: el que se propone sube hasta su armadura si es mayor; si es menor, se queda con la suya", () => {
    const q = consultas();
    const prop = comprobarVigas(q, undefined, undefined, { proponer: true });
    if (!prop.valido) throw new Error("no válido");
    const base = armadoPropuestoVigas(prop.valor, undefined)["F1-X0"]!;
    const libre = proponerVano(demandas(q, "F1-X0"), demandas(q, "F1-X0").vanos[1]!).armado!;
    // El vano 0 escrito con 5Ø16 junto a P3 (más que lo que pide el 1): el 1, propuesto, sube a 5Ø16
    const mucho = { ...base[0]!, superiorFin: { n: 5, diametro: 16 } };
    const r1 = comprobarVigas(q, { "F1-X0": [mucho, null, base[2]!] }, undefined, { ids: ["F1-X0"], proponer: true, soloSinArmado: true });
    if (!r1.valido) throw new Error("no válido");
    const [v0, v1] = r1.valor.vigas[0]!.vanos;
    expect(v0!.origen).toBe("proyecto");
    expect(v0!.armado).toEqual(mucho);
    expect(v1!.origen).toBe("propuesto");
    expect(zona(v1!.armado!, "superiorInicio")).toEqual({ n: 5, diametro: 16 });
    expect(v1!.cumple).toBe(true);
    // Escrito con 2Ø12 (la corrida, menos que lo que pide el 1): el 1 se queda con lo suyo
    const poco = { ...base[0]!, superiorFin: undefined };
    const r2 = comprobarVigas(q, { "F1-X0": [poco, null, base[2]!] }, undefined, { ids: ["F1-X0"], proponer: true, soloSinArmado: true });
    if (!r2.valido) throw new Error("no válido");
    expect(zona(r2.valor.vigas[0]!.vanos[1]!.armado!, "superiorInicio")).toEqual(zona(libre, "superiorInicio"));
    expect(r2.valor.vigas[0]!.vanos[0]!.armado).toEqual(poco);
  });
});

describe("CO2: las vigas de un proyecto", () => {
  it("lo propuesto, como armado del proyecto, da al comprobarlo lo mismo; sin armado, no cumple", () => {
    const q = consultas();
    const sin = comprobarVigas(q, undefined, undefined);
    if (!sin.valido) throw new Error("no válido");
    expect(sin.valor.resumen).toMatchObject({ vigas: 10, vanos: 18, cumplen: 0, sinArmado: 18 });
    expect(sin.diagnosticos.some((x) => x.codigo === "comprobacion/sin-armado")).toBe(true);
    // Lo que decide un veredicto y no está escrito en la obra, se dice; escrito, no
    expect(sin.diagnosticos.find((x) => x.codigo === "comprobacion/vigas-por-defecto")!.mensaje).toContain("XC2");
    const escrito = comprobarVigas(q, undefined, { exposicion: "XC1", flechaActiva: 500 });
    expect(escrito.valido && escrito.diagnosticos.some((x) => x.codigo === "comprobacion/vigas-por-defecto")).toBe(false);

    const prop = comprobarVigas(q, undefined, undefined, { proponer: true });
    if (!prop.valido) throw new Error("no válido");
    expect(prop.valor.resumen).toMatchObject({ vanos: 18, cumplen: 18, noCumplen: 0, sinArmado: 0 });
    const armado = armadoPropuestoVigas(prop.valor, undefined);
    expect(Object.keys(armado).length).toBe(10);
    expect(armado["F1-X0"]!.length).toBe(3);
    const con = comprobarVigas(q, armado, undefined, { filas: true });
    if (!con.valido) throw new Error("no válido");
    expect(con.valor.resumen).toMatchObject({ cumplen: 18, sinArmado: 0 });
    con.valor.vigas.forEach((g, i) =>
      g.vanos.forEach((v, j) => {
        const o = prop.valor.vigas[i]!.vanos[j]!;
        expect(v.origen).toBe("proyecto");
        expect(v.texto).toBe(o.texto);
        expect(v.aprovechamiento).toBe(o.aprovechamiento);
        expect(v.manda).toEqual(o.manda);
        expect(v.filas!.length).toBeGreaterThan(20);
      }),
    );
    // Sólo unas vigas, y sólo lo que falta: el vano 1 de F1-X0 no tiene armado
    const parcial = { "F1-X0": [armado["F1-X0"]![0]!, null, armado["F1-X0"]![2]!] };
    const uno = comprobarVigas(q, parcial, undefined, { ids: ["F1-X0", "F1-Y0"], proponer: true, soloSinArmado: true });
    if (!uno.valido) throw new Error("no válido");
    expect(uno.valor.vigas.map((g) => g.vanos.map((v) => v.origen))).toEqual([["proyecto", "propuesto", "proyecto"], ["propuesto"]]);
    const junto = armadoPropuestoVigas(uno.valor, parcial);
    expect(junto["F1-X0"]).toEqual(armado["F1-X0"]);
    const medio = comprobarVigas(q, parcial, undefined, { ids: ["F1-X0"] });
    if (!medio.valido) throw new Error("no válido");
    expect(medio.valor.vigas[0]!.vanos.map((v) => [v.origen, v.cumple])).toEqual([["proyecto", true], ["sin-armado", false], ["proyecto", true]]);
    expect(comprobarVigas(q, undefined, undefined, { ids: ["V99"] }).valido).toBe(false);
    // Un armado con más vanos que la viga: se avisa
    const sobra = comprobarVigas(q, { "F1-Y0": [armado["F1-Y0"]![0]!, armado["F1-Y0"]![0]!] }, undefined, { ids: ["F1-Y0"] });
    expect(sobra.valido && sobra.diagnosticos.some((x) => x.codigo === "armado/vano")).toBe(true);
  });
});
