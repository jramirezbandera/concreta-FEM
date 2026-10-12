/**
 * Criterios 1–3 de A4 (`docs/fem3d/agente.md` §10): lo dibujado es lo de las consultas, el SVG y el
 * PNG no dependen del orden del JSON ni de la máquina, y el tamaño de las imágenes y del texto está
 * acotado.
 */
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { svgAPng } from "../../../cli/png.ts";
import { edificioObjetivoLosas } from "../../../validacion/c2/modelos.ts";
import { reticulaConNucleo } from "../../../validacion/c3/modelos.ts";
import { edificioUnidireccional } from "../../../validacion/c4/modelos.ts";
import { prepararNucleo, proyectoDe } from "../../../validacion/a3/revisar.ts";
import { compilar, type ResultadoCompilacion } from "../../compilador/compilar.ts";
import { ejesDe } from "../../compilador/ejes.ts";
import { Consultas } from "../../compilador/consultas.ts";
import type { CasoFisico, ModeloFisico } from "../../compilador/fisico.ts";
import { CamposLaminas } from "../../motor/campos.ts";
import { calcular } from "../../motor/calcular.ts";
import type { ConjuntoCombinaciones } from "../combinaciones.ts";
import { pieza, resumen, type VanoEnvolvente } from "../consultas.ts";
import { area, dentro, type Escena, type Primitiva, type Vec2 } from "./escena.ts";
import { bandaDe, bandas, limitesRedondos, trozosTriangulo, type Triangulo } from "./isovalores.ts";
import { envolventePieza } from "./resultados.ts";
import {
  conjuntoPorDefecto,
  escenaASvg,
  LADO_MAXIMO,
  ResultadosRender,
  vistaAxiles,
  vistaCampo,
  vistaCargas,
  vistaDiagnosticos,
  vistaDiagramas,
  vistaMalla,
  vistaModelo,
  type Campo,
} from "./index.ts";

type Compilado = Extract<ResultadoCompilacion, { valido: true }>;

/** Los casos con su acción (para las combinaciones del generador). */
function conAcciones(f: ModeloFisico): ModeloFisico {
  const accion = (c: CasoFisico): CasoFisico["accion"] => {
    if (c.id.startsWith("Q")) return { tipo: "Q", psi: { psi0: 0.7, psi1: 0.5, psi2: 0.3 } };
    if (c.id.startsWith("V") || c.id.startsWith("W")) return { tipo: "W", direccion: c.id.endsWith("y") || c.id.endsWith("Y") ? "Y" : "X", signo: 1, psi: { psi0: 0.6, psi1: 0.5, psi2: 0 } };
    return { tipo: "G" };
  };
  return { ...f, casos: f.casos.map((c) => ({ ...c, accion: accion(c) })) };
}

const MODELOS: [string, ModeloFisico][] = [
  ["retícula con núcleo", reticulaConNucleo()],
  ["edificio con losas (2 plantas, con acciones)", conAcciones(edificioObjetivoLosas(2, 3, 2))],
  ["edificio unidireccional (2 plantas)", edificioUnidireccional(2, 3, 2)],
];

interface Calculado {
  f: ModeloFisico;
  c: Compilado;
  q: Consultas;
  r: ResultadosRender;
  cj: { desplazamientos: ConjuntoCombinaciones; esfuerzos: ConjuntoCombinaciones };
}

const calculados = new Map<string, Calculado>();
const d = { huella: "0123456789abcdef" };

beforeAll(async () => {
  await prepararNucleo();
  for (const [nombre, f] of MODELOS) {
    const c = compilar(f);
    if (!c.valido) throw new Error(`${nombre}: ${c.diagnosticos[0]?.mensaje}`);
    const k = calcular(c.modelo);
    if (!k.valido) throw new Error(`${nombre}: no calcula`);
    const q = new Consultas(f, c, k.casos);
    const res = resumen(proyectoDe(f), c);
    if (!res.valido) throw new Error(nombre);
    calculados.set(nombre, { f, c, q, r: new ResultadosRender(q, c), cj: { desplazamientos: conjuntoPorDefecto(q, res.valor, "desplazamientos"), esfuerzos: conjuntoPorDefecto(q, res.valor, "esfuerzos") } });
  }
}, 120_000);

const objetos = (e: Escena, pred: (p: Primitiva) => boolean = () => true) => new Set(e.primitivas.filter((p) => p.tipo !== "texto" && pred(p)).map((p) => ("objeto" in p ? p.objeto : undefined)).filter((x): x is string => !!x));

/** Número de vueltas de unos anillos alrededor de un punto (la regla «nonzero»). */
function vueltas(q: Vec2, anillos: readonly (readonly Vec2[])[]): number {
  let w = 0;
  for (const r of anillos)
    for (let i = 0; i < r.length; i++) {
      const [a, b] = [r[i]!, r[(i + 1) % r.length]!];
      const cruz = (b[0] - a[0]) * (q[1] - a[1]) - (q[0] - a[0]) * (b[1] - a[1]);
      if (a[1] <= q[1] && b[1] > q[1] && cruz > 0) w++;
      else if (a[1] > q[1] && b[1] <= q[1] && cruz < 0) w--;
    }
  return w;
}

describe("A4, criterio 1: lo dibujado es lo del modelo y de las consultas", () => {
  it("modelo: los objetos de cada planta, y sólo ellos, con la geometría exacta de sus losas", () => {
    for (const [nombre, f] of MODELOS) {
      const { c } = calculados.get(nombre)!;
      for (const pl of f.plantas) {
        const e = vistaModelo(f, pl.id, d);
        // Los pilares de la planta, por el mapeo (independiente de la escena): los que tienen nudo en ella
        const pilares = (f.pilares ?? []).filter((p) => c.mapeo.nudosPilar[`${p.id}@${pl.id}`] !== undefined).map((p) => p.id);
        const enPlanta = <T extends { planta: string; id: string }>(xs?: readonly T[]) => (xs ?? []).filter((x) => x.planta === pl.id).map((x) => x.id);
        const idx = new Map(f.plantas.map((p, i) => [p.id, i]));
        const k = idx.get(pl.id)!;
        const muros = (f.muros ?? []).filter((m) => idx.get(m.hasta)! <= k && k <= idx.get(m.desde)! && idx.get(m.hasta)! < idx.get(m.desde)!).map((m) => m.id);
        // Y los ejes de replanteo (I2): los propuestos, que estos modelos no tienen, en todas las plantas
        const ejes = ejesDe(f).ejes;
        const esperados = new Set([...enPlanta(f.losas), ...enPlanta(f.panos), ...enPlanta(f.vigas), ...enPlanta(f.apoyos), ...enPlanta(f.apoyosLineales), ...enPlanta(f.bandas), ...pilares, ...muros, ...ejes.map((x) => x.id)]);
        expect(objetos(e), `${nombre}, ${pl.id}`).toEqual(esperados);
        for (const x of ejes) {
          const p = e.primitivas.find((q) => q.tipo === "linea" && q.objeto === x.id && q.estilo === "eje");
          expect(p && p.tipo === "linea" ? p.puntos : null).toEqual([x.desde, x.hasta]);
        }
        for (const l of (f.losas ?? []).filter((x) => x.planta === pl.id)) {
          const p = e.primitivas.find((x) => x.tipo === "poligono" && x.objeto === l.id && x.estilo.startsWith("losa"));
          expect(p && p.tipo === "poligono" ? p.anillos : null).toEqual([l.contorno, ...(l.huecos ?? [])]);
        }
      }
    }
  });

  it("cargas: las del caso que caen en la planta, y sólo ellas", () => {
    for (const [nombre, f] of MODELOS) {
      const { c } = calculados.get(nombre)!;
      for (const pl of f.plantas)
        for (const caso of f.casos) {
          const e = vistaCargas(f, pl.id, caso.id, d);
          const vigas = new Map((f.vigas ?? []).map((v) => [v.id, v.planta]));
          const llega = (p: string) => (f.pilares ?? []).some((x) => x.id === p && x.desde !== pl.id && c.mapeo.nudosPilar[`${p}@${pl.id}`] !== undefined);
          const esperadas = (f.cargas ?? [])
            .filter((g) => g.caso === caso.id)
            .filter((g) => {
              if (g.tipo === "superficie" || g.tipo === "lineal" || g.tipo === "puntual") return g.planta === pl.id;
              if (g.tipo === "viga") return vigas.get(g.viga) === pl.id;
              if (g.tipo === "pilar") return llega(g.pilar);
              return false;
            })
            .map((g) => g.id);
          const dibujadas = objetos(e, (p) => p.tipo !== "texto" && p.estilo.startsWith("carga"));
          expect(dibujadas, `${nombre}, ${pl.id}, ${caso.id}`).toEqual(new Set(esperadas));
        }
    }
  });

  it("isovalores: las bandas cubren sin huecos ni solapes, y cada punto cae en la de su valor", () => {
    // Malla de 12 × 9 cuadrados partidos en dos, con valores al azar (semilla fija)
    let semilla = 12345;
    const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
    const [nx, ny] = [12, 9];
    const v = Array.from({ length: (nx + 1) * (ny + 1) }, () => azar() * 30 - 8);
    const P = (i: number, j: number): Vec2 => [i * 0.7 + 0.13 * j, j * 0.55];
    const V = (i: number, j: number) => v[j * (nx + 1) + i]!;
    const tris: Triangulo[] = [];
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        tris.push({ p: [P(i, j), P(i + 1, j), P(i + 1, j + 1)], v: [V(i, j), V(i + 1, j), V(i + 1, j + 1)] });
        tris.push({ p: [P(i, j), P(i + 1, j + 1), P(i, j + 1)], v: [V(i, j), V(i + 1, j + 1), V(i, j + 1)] });
      }
    const L = limitesRedondos(Math.min(...v), Math.max(...v));
    expect(L.length - 1).toBeLessThanOrEqual(10);
    expect(L).toContain(0);
    const bs = bandas(tris, L);
    const total = tris.reduce((s, t) => s + Math.abs(area(t.p)), 0);
    // Sin huecos ni solapes: la suma de los trozos y la de los anillos fundidos son el área total
    expect(Math.abs(bs.reduce((s, b) => s + b.area, 0) - total) / total).toBeLessThan(1e-9);
    expect(Math.abs(bs.reduce((s, b) => s + b.anillos.reduce((x, r) => x + area(r), 0), 0) - total) / total).toBeLessThan(1e-9);
    for (const b of bs) expect(Math.abs(b.anillos.reduce((x, r) => x + area(r), 0) - b.area) / total).toBeLessThan(1e-9);
    // Puntos al azar: el valor interpolado da la banda, y el punto está dentro de ella (y de ninguna otra)
    let probados = 0;
    for (let n = 0; n < 2000; n++) {
      const t = tris[Math.floor(azar() * tris.length)]!;
      let [a, b] = [azar(), azar()];
      if (a + b > 1) [a, b] = [1 - a, 1 - b];
      const q: Vec2 = [t.p[0][0] + a * (t.p[1][0] - t.p[0][0]) + b * (t.p[2][0] - t.p[0][0]), t.p[0][1] + a * (t.p[1][1] - t.p[0][1]) + b * (t.p[2][1] - t.p[0][1])];
      const x = t.v[0] + a * (t.v[1] - t.v[0]) + b * (t.v[2] - t.v[0]);
      if (L.some((l) => Math.abs(x - l) < 1e-6)) continue;
      const k = bandaDe(x, L);
      for (const bb of bs) expect(vueltas(q, bb.anillos), `banda ${bb.banda}, valor ${x}`).toBe(bb.banda === k ? 1 : 0);
      probados++;
    }
    expect(probados).toBeGreaterThan(1900);
    // Un trozo de un triángulo con un vértice justo en un límite no se duplica
    expect([...trozosTriangulo({ p: [[0, 0], [1, 0], [0, 1]], v: [0, 5, 10] }, [0, 5, 10]).keys()]).toEqual([0, 1]);
  });

  it("uz: el mínimo de cada planta es la flecha máxima de sus losas (Consultas.flechas) en la combinación que gobierna", () => {
    for (const [nombre, f] of MODELOS) {
      const { q, r, cj } = calculados.get(nombre)!;
      for (const pl of f.plantas) {
        const losas = (f.losas ?? []).filter((l) => l.planta === pl.id);
        if (!losas.length) continue;
        const e = vistaCampo(r, pl.id, "uz", cj.desplazamientos, d);
        const min = e.extremos.find((x) => x.que === "uz mínimo")!;
        const fs = cj.desplazamientos.factores[cj.desplazamientos.nombres.indexOf(min.comb!)]!;
        const flecha = Math.max(...losas.map((l) => (q.flechas(l.id, fs) as { valido: true; valor: { maxima: { flecha: number } } }).valor.maxima.flecha));
        expect(min.valor, `${nombre}, ${pl.id}`).toBeCloseTo(-flecha * 1000, 9);
        // Y ninguna otra combinación da más
        for (const g of cj.desplazamientos.factores) for (const l of losas) expect((q.flechas(l.id, g) as { valido: true; valor: { maxima: { flecha: number } } }).valor.maxima.flecha * 1000).toBeLessThanOrEqual(Math.max(Math.abs(min.valor), Math.abs(e.extremos[0]!.valor)) + 1e-9);
      }
    }
  });

  it("m11, m22 y v13: los extremos son los de los campos SPR en los nudos de las láminas de la planta", () => {
    for (const [nombre, f] of MODELOS) {
      const { c, q, r, cj } = calculados.get(nombre)!;
      const campos = new CamposLaminas(c.modelo);
      for (const pl of f.plantas) {
        const losas = new Set((f.losas ?? []).filter((l) => l.planta === pl.id).map((l) => l.id));
        if (!losas.size) continue;
        for (const [campo, comp] of [["m11", 3], ["m22", 4], ["v13", 6]] as [Campo, number][]) {
          const e = vistaCampo(r, pl.id, campo, cj.esfuerzos, d);
          const max = e.extremos.find((x) => x.que.endsWith("máximo"))!;
          const fs = cj.esfuerzos.factores[cj.esfuerzos.nombres.indexOf(max.comb!)]!;
          const u = new Float64Array(q.casos[0]!.u.length);
          q.casos.forEach((k, i) => {
            if (fs[i]) for (let j = 0; j < u.length; j++) u[j]! += fs[i]! * k.u[j]!;
          });
          let [vmax, vmin] = [-Infinity, Infinity];
          (c.mapeo.laminas ?? []).forEach((m, l) => {
            if (!m.losa || !losas.has(m.losa) || campos.region(l) < 0) return;
            const x = campos.enNudos(l, u);
            for (let a = 0; a < 4; a++) [vmax, vmin] = [Math.max(vmax, x[8 * a + comp]!), Math.min(vmin, x[8 * a + comp]!)];
          });
          expect(max.valor, `${nombre}, ${pl.id}, ${campo}`).toBeCloseTo(vmax, 9);
          expect(e.extremos.find((x) => x.que.endsWith("mínimo"))!.valor).toBeCloseTo(vmin, 9);
        }
      }
    }
  });

  it("diagramas: los extremos rotulados de My son los de «pieza», y las envolventes llegan a ellos", () => {
    for (const [nombre, f] of MODELOS) {
      const { q, r, cj } = calculados.get(nombre)!;
      for (const pl of f.plantas) {
        const e = vistaDiagramas(r, pl.id, "My", cj.esfuerzos, d);
        const ids = [...new Set(e.extremos.map((x) => x.objeto!))];
        expect(ids.length > 0).toBe((f.vigas ?? []).some((v) => v.planta === pl.id) || (f.panos ?? []).some((p) => p.planta === pl.id));
        for (const id of ids) {
          const p = pieza(q, cj.esfuerzos, id);
          if (!p.valido) throw new Error(id);
          const vanos = (p.valor as { vanos: VanoEnvolvente[] }).vanos;
          vanos.forEach((v, i) => {
            const mx = e.extremos.find((x) => x.objeto === id && x.que === `My máximo del vano ${i + 1}`);
            const mn = e.extremos.find((x) => x.objeto === id && x.que === `My mínimo del vano ${i + 1}`);
            if (v.extremos["My+"]!.v > 0) expect(mx?.valor, `${id} vano ${i + 1}`).toBe(v.extremos["My+"]!.v);
            if (v.extremos["My-"]!.v < 0) expect(mn?.valor, `${id} vano ${i + 1}`).toBe(v.extremos["My-"]!.v);
          });
        }
        // La ordenada más larga de la planta es la del mayor |My| rotulado (la escala sale de ella)
        const mayor = Math.max(0, ...e.extremos.map((x) => Math.abs(x.valor)));
        const nota = e.notas.find((x) => x.startsWith("Escala:"));
        if (mayor > 0) expect(nota).toBeDefined();
      }
    }
  });

  it("diagramas: con una combinación, las ordenadas en las estaciones son las de Consultas.diagrama", () => {
    for (const [nombre, f] of MODELOS) {
      const { q, r, cj } = calculados.get(nombre)!;
      const una: ConjuntoCombinaciones = { descripcion: "una", nombres: [cj.esfuerzos.nombres[0]!], etiquetas: [cj.esfuerzos.etiquetas[0]!], factores: [cj.esfuerzos.factores[0]!] };
      const piezas = [...(f.vigas ?? []).map((v) => v.id), ...Object.values(r.c.mapeo.panos ?? {}).flat()];
      expect(piezas.length).toBeGreaterThan(0);
      for (const id of piezas)
        for (const [comp, nombreComp] of [[4, "My"], [2, "Vz"]] as const) {
          const curva = envolventePieza(r, id, una, comp);
          const dg = q.diagrama(id, una.factores[0]!);
          if (!dg.valido) throw new Error(id);
          for (const e of dg.valor) {
            const aqui = curva.filter((x) => x.s === e.s);
            expect(aqui.length, `${nombre}, ${id}, ${nombreComp}, s = ${e.s}`).toBeGreaterThan(0);
            for (const x of aqui) expect(x.max).toBe(x.min);
            const valores = aqui.map((x) => x.max);
            for (const v of [e.izquierda[comp]!, e.derecha[comp]!]) expect(valores, `${nombre}, ${id}, ${nombreComp}, s = ${e.s}`).toContain(v);
          }
        }
    }
  });

  it("axiles: los rotulados son los de Consultas.pilar combinados", () => {
    for (const [nombre, f] of MODELOS) {
      const { q, r, cj } = calculados.get(nombre)!;
      for (const pl of f.plantas) {
        const e = vistaAxiles(r, pl.id, cj.esfuerzos, d);
        for (const x of e.extremos) {
          const t = (q.pilar(x.objeto!) as { valido: true; valor: { planta: string; base: { esfuerzos: Float64Array }; cabeza: { esfuerzos: Float64Array } }[] }).valor.find((y) => y.planta === pl.id)!;
          const ns = cj.esfuerzos.factores.flatMap((g) => [t.base.esfuerzos, t.cabeza.esfuerzos].map((es) => g.reduce((s, fk, k) => s + fk * es[6 * k]!, 0)));
          expect(x.valor).toBe(x.que.startsWith("N mínimo") ? Math.min(...ns) : Math.max(...ns));
        }
      }
    }
  });
});

/** El modelo con todas sus listas al revés (salvo plantas y casos, cuyo orden significa algo). */
function alReves(f: ModeloFisico): ModeloFisico {
  const r: Record<string, unknown> = { ...f };
  for (const k of ["materiales", "secciones", "pilares", "vigas", "apoyos", "losas", "apoyosLineales", "bandas", "muros", "panos", "cargas"]) if (Array.isArray(r[k])) r[k] = [...(r[k] as unknown[])].reverse();
  return r as unknown as ModeloFisico;
}

describe("A4, criterio 2: determinismo", () => {
  it("el SVG no depende del orden de las listas del modelo", () => {
    for (const [nombre, f] of MODELOS) {
      const g = alReves(f);
      const c2 = compilar(g);
      if (!c2.valido) throw new Error(nombre);
      const { c, cj } = calculados.get(nombre)!;
      expect(c2.huella).toBe(c.huella);
      const k2 = calcular(c2.modelo);
      if (!k2.valido) throw new Error(nombre);
      const r2 = new ResultadosRender(new Consultas(g, c2, k2.casos), c2);
      const { r } = calculados.get(nombre)!;
      const diags = [...c.diagnosticos];
      for (const pl of f.plantas) {
        const pares: [Escena, Escena][] = [
          [vistaModelo(f, pl.id, d), vistaModelo(g, pl.id, d)],
          [vistaDiagnosticos(f, pl.id, diags, d), vistaDiagnosticos(g, pl.id, [...diags].reverse(), d)],
          [vistaMalla(r, pl.id, d), vistaMalla(r2, pl.id, d)],
          [vistaCampo(r, pl.id, "uz", cj.desplazamientos, d), vistaCampo(r2, pl.id, "uz", cj.desplazamientos, d)],
          [vistaDiagramas(r, pl.id, "My", cj.esfuerzos, d), vistaDiagramas(r2, pl.id, "My", cj.esfuerzos, d)],
          [vistaAxiles(r, pl.id, cj.esfuerzos, d), vistaAxiles(r2, pl.id, cj.esfuerzos, d)],
          ...f.casos.map((x) => [vistaCargas(f, pl.id, x.id, d), vistaCargas(g, pl.id, x.id, d)] as [Escena, Escena]),
        ];
        for (const [a, b] of pares) expect(escenaASvg(b).svg, `${nombre}, ${pl.id}, ${a.cabecera[1]}`).toBe(escenaASvg(a).svg);
      }
    }
  }, 120_000);

  it("el PNG es el congelado (resvg-wasm y Roboto versionados, sin fuentes del sistema)", async () => {
    const f = reticulaConNucleo();
    const svg = escenaASvg(vistaModelo(f, "N1", { nombre: "Retícula con núcleo", huella: "0123456789abcdef" })).svg;
    const png = await svgAPng(svg);
    expect(createHash("sha256").update(svg).digest("hex")).toBe(SVG_CONGELADO);
    expect(createHash("sha256").update(png).digest("hex")).toBe(PNG_CONGELADO);
  });
});

const SVG_CONGELADO = "dc5b1b84081fe90e2e3de2fce1655af1277db27623959204249c492e305e61f3";
const PNG_CONGELADO = "3fe954bbf7091efff8e93d1c988c5b0069c28befd1eb5730d97d82d90ec85f74";

describe("A4, criterio 3: tamaño de la imagen y del texto", () => {
  it(`el lado mayor no pasa de ${LADO_MAXIMO} px y ningún texto baja de 11 px, en todas las vistas`, () => {
    for (const [nombre, f] of MODELOS) {
      const { c, r, cj } = calculados.get(nombre)!;
      for (const pl of f.plantas) {
        const escenas = [
          vistaModelo(f, pl.id, d),
          vistaDiagnosticos(f, pl.id, c.diagnosticos, d),
          vistaMalla(r, pl.id, d),
          ...(["uz", "m11", "m22", "m12", "v13", "v23"] as Campo[]).map((x) => vistaCampo(r, pl.id, x, x === "uz" ? cj.desplazamientos : cj.esfuerzos, d)),
          vistaDiagramas(r, pl.id, "My", cj.esfuerzos, d),
          vistaDiagramas(r, pl.id, "Vz", cj.esfuerzos, d),
          vistaAxiles(r, pl.id, cj.esfuerzos, d),
          ...f.casos.map((x) => vistaCargas(f, pl.id, x.id, d)),
        ];
        for (const e of escenas) {
          const s = escenaASvg(e);
          expect(Math.max(s.encuadre.ancho, s.encuadre.alto)).toBeLessThanOrEqual(LADO_MAXIMO);
          const tamanos = [...s.svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
          expect(tamanos.length).toBeGreaterThan(0);
          expect(Math.min(...tamanos), `${nombre}, ${pl.id}, ${e.cabecera[1]}`).toBeGreaterThanOrEqual(11);
        }
      }
    }
  }, 120_000);

  it("dentro() y area() de la escena: un cuadrado", () => {
    const q: Vec2[] = [[0, 0], [2, 0], [2, 2], [0, 2]];
    expect(area(q)).toBe(4);
    expect(dentro([1, 1], q)).toBe(true);
    expect(dentro([3, 1], q)).toBe(false);
  });
});
