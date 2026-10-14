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
import { edificioReticular, edificioUnidireccional } from "../../../validacion/c4/modelos.ts";
import { prepararNucleo, proyectoDe } from "../../../validacion/a3/revisar.ts";
import { compilar, type ResultadoCompilacion } from "../../compilador/compilar.ts";
import { ejesDe } from "../../compilador/ejes.ts";
import { momentosInterseccion } from "../../compilador/poligonos.ts";
import { Consultas } from "../../compilador/consultas.ts";
import type { CasoFisico, ModeloFisico } from "../../compilador/fisico.ts";
import { CamposLaminas } from "../../motor/campos.ts";
import { calcular } from "../../motor/calcular.ts";
import type { ConjuntoCombinaciones } from "../combinaciones.ts";
import { pieza, resumen, type VanoEnvolvente } from "../consultas.ts";
import { anchoTexto, area, dentro, rotulo, type Escena, type Primitiva, type Vec2 } from "./escena.ts";
import { bandaDe, bandas, coloresBandas, escalaDeTexto, isolineas, limitesMapa, limitesRedondos, PRIORIDAD_ISOLINEA, rangoSinPicos, rotulosLineas, SEPARACION_ROTULOS, triangulosCuadrilatero, trozosTriangulo, type LimitesMapa, type Triangulo } from "./isovalores.ts";
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

  /** Malla de cuadriláteros irregulares (nx × ny) con el valor f en cada nudo, subdividida para dibujar. */
  const mallaCampo = (nx: number, ny: number, f: (p: Vec2) => number) => {
    const P = (i: number, j: number): Vec2 => [i * 0.7 + 0.13 * j + 0.05 * Math.sin(3 * i + j), j * 0.55 + 0.04 * Math.cos(i - 2 * j)];
    const tris: Triangulo[] = [];
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
        tris.push(...triangulosCuadrilatero(q, q.map(f)));
      }
    return tris;
  };

  it("subdivisión de una lámina: cubre el cuadrilátero, reproduce un campo lineal y casa con la vecina bit a bit", () => {
    const q: Vec2[] = [[0, 0], [2, 0.3], [2.4, 1.9], [-0.2, 1.5]];
    const lineal = (p: Vec2) => 3 * p[0] - 2 * p[1] + 1;
    for (const niveles of [0, 1, 2]) {
      const ts = triangulosCuadrilatero(q, q.map(lineal), niveles);
      expect(ts).toHaveLength(4 * 4 ** niveles);
      expect(Math.abs(ts.reduce((s, t) => s + Math.abs(area(t.p)), 0) - Math.abs(area(q)))).toBeLessThan(1e-12);
      for (const t of ts) for (let i = 0; i < 3; i++) expect(Math.abs(t.v[i]! - lineal(t.p[i]!))).toBeLessThan(1e-12);
    }
    // El centro, con la media de los cuatro (el bilineal en ξ = η = 0)
    const v = [1, 7, -3, 4];
    const c = triangulosCuadrilatero(q, v, 0);
    expect(c[0]!.v[2]).toBe((1 + 7 - 3 + 4) / 4);
    // Dos láminas con un lado común, recorrido en sentidos opuestos: sus bandas se funden sin costura
    const r: Vec2[] = [[2, 0.3], [4.1, 0.2], [4.3, 2.2], [2.4, 1.9]];
    const valor = (p: Vec2) => Math.sin(p[0]) * 10 + p[1] * p[1] * 4;
    const total = Math.abs(area(q)) + Math.abs(area(r));
    for (const niveles of [0, 1]) {
      const tris = [...triangulosCuadrilatero(q, q.map(valor), niveles), ...triangulosCuadrilatero(r, r.map(valor), niveles)];
      const L = limitesRedondos(Math.min(...tris.flatMap((t) => t.v)), Math.max(...tris.flatMap((t) => t.v)));
      const bs = bandas(tris, L);
      expect(Math.abs(bs.reduce((s, b) => s + b.anillos.reduce((x, a) => x + area(a), 0), 0) - total) / total).toBeLessThan(1e-12);
      // Fundidas, ningún lado de un anillo va por el lado común: sus puntos casan y se cancelan
      const enComun = (x: Vec2) => Math.abs((2.4 - 2) * (x[1] - 0.3) - (1.9 - 0.3) * (x[0] - 2)) < 1e-12;
      for (const b of bs) for (const a of b.anillos) for (let i = 0; i < a.length; i++) expect(enComun(a[i]!) && enComun(a[(i + 1) % a.length]!)).toBe(false);
    }
  });

  it("isolíneas: en su valor, en el borde entre sus dos bandas, rectas con un campo lineal y cerradas alrededor de un pico", () => {
    // Campo lineal: cada isolínea es un solo segmento recto (los puntos alineados se quitan) de borde a borde
    const lineal = (p: Vec2) => 3 * p[0] - 2 * p[1] + 1;
    const tl = mallaCampo(10, 8, lineal);
    const Ll = limitesRedondos(Math.min(...tl.flatMap((t) => t.v)), Math.max(...tl.flatMap((t) => t.v)));
    const il = isolineas(tl, Ll);
    expect(il.map((x) => x.limite)).toEqual(Ll.slice(1, -1).map((_, i) => i + 1));
    for (const x of il) {
      expect(x.lineas, `${x.valor}`).toHaveLength(1);
      expect(x.lineas[0]!).toHaveLength(2);
      for (const p of x.lineas[0]!) expect(Math.abs(lineal(p) - x.valor)).toBeLessThan(1e-9);
    }
    // Un pico: anillos cerrados (el último punto es el primero)
    const pico = (p: Vec2) => 10 - (p[0] - 3.6) ** 2 - (p[1] - 2.3) ** 2;
    const tp = mallaCampo(10, 8, pico);
    const ip = isolineas(tp, [-100, 7, 8.5, 100]);
    expect(ip).toHaveLength(2);
    for (const x of ip) {
      expect(x.lineas).toHaveLength(1);
      const l = x.lineas[0]!;
      expect(l[0]).toEqual(l[l.length - 1]);
    }
    // Campo al azar: a un lado y a otro de cada tramo, las dos bandas de su límite
    let semilla = 777;
    const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
    const vals = new Map<string, number>();
    const tz = mallaCampo(12, 9, (p) => {
      const k = `${p[0]},${p[1]}`;
      if (!vals.has(k)) vals.set(k, azar() * 30 - 8);
      return vals.get(k)!;
    });
    const L = limitesRedondos(Math.min(...tz.flatMap((t) => t.v)), Math.max(...tz.flatMap((t) => t.v)));
    const bs = bandas(tz, L);
    let probados = 0;
    for (const x of isolineas(tz, L))
      for (const l of x.lineas)
        for (let i = 1; i < l.length; i++) {
          const [a, b] = [l[i - 1]!, l[i]!];
          const n = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (n < 1e-6) continue;
          const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const e = 1e-7;
          const lados = [-1, 1].map((sg): Vec2 => [m[0] - (sg * e * (b[1] - a[1])) / n, m[1] + (sg * e * (b[0] - a[0])) / n]);
          const en = lados.map((q) => bs.filter((bb) => vueltas(q, bb.anillos) === 1).map((bb) => bb.banda).sort());
          // Un lado en la banda de debajo del límite y el otro en la de encima (o en el borde de la malla)
          const todas = [...en[0]!, ...en[1]!].sort();
          expect(todas.every((k) => k === x.limite - 1 || k === x.limite), `límite ${x.valor}`).toBe(true);
          expect(new Set(todas).size, `límite ${x.valor}`).toBe(2);
          probados++;
        }
    expect(probados).toBeGreaterThan(200);
    // Donde el campo salta (dos regiones), no hay isolínea: el campo no pasa por el límite
    const salto: Triangulo[] = [
      { p: [[0, 0], [1, 0], [1, 1]], v: [0, 0, 0] },
      { p: [[1, 0], [2, 0], [1, 1]], v: [10, 10, 10] },
    ];
    expect(isolineas(salto, [0, 5, 10])).toEqual([]);
  });

  it("rótulos de las isolíneas: a lo largo de la línea, derechos, y sólo donde es recta y larga", () => {
    const medir = (t: string, tam: number) => anchoTexto(t, tam);
    // Recta horizontal de 100 m a 10 px/m: 1000 px, 4 rótulos, del revés también derechos
    for (const puntos of [[[0, 0], [100, 0]], [[100, 0], [0, 0]]] as Vec2[][]) {
      const r = rotulosLineas([{ puntos, texto: "-10" }], 10, medir);
      expect(r).toHaveLength(Math.floor(1000 / SEPARACION_ROTULOS));
      for (const t of r) {
        expect(t.giro).toBe(0);
        expect(t.p[1]).toBe(0);
        expect(t.prioridad).toBe(PRIORIDAD_ISOLINEA);
      }
    }
    // Vertical, en los dos sentidos: de abajo arriba
    for (const puntos of [[[0, 0], [0, 50]], [[0, 50], [0, 0]]] as Vec2[][]) for (const t of rotulosLineas([{ puntos, texto: "5" }], 10, medir)) expect(t.giro).toBe(90);
    // Corta: nada; en zigzag cerrado: nada; fuera de la ventana: nada
    expect(rotulosLineas([{ puntos: [[0, 0], [1, 0]], texto: "-10" }], 10, medir)).toEqual([]);
    const zigzag: Vec2[] = Array.from({ length: 200 }, (_, i) => [i * 0.1, i % 2 ? 0.5 : 0]);
    expect(rotulosLineas([{ puntos: zigzag, texto: "10" }], 10, medir)).toEqual([]);
    expect(rotulosLineas([{ puntos: [[0, 0], [100, 0]], texto: "10" }], 10, medir, [200, 200, 300, 300])).toEqual([]);
    // En el SVG: las líneas con rótulo de un mapa de momentos los llevan, con su valor de un límite de la leyenda
    const { r: rr, cj } = calculados.get("edificio con losas (2 plantas, con acciones)")!;
    const e = vistaCampo(rr, "N1", "m11", cj.esfuerzos, d);
    const lineas = e.primitivas.filter((p): p is Extract<Primitiva, { tipo: "linea" }> => p.tipo === "linea" && !!p.rotulo);
    expect(lineas.length).toBeGreaterThan(0);
    expect(lineas.some((p) => p.estilo === "isolinea-cero" && p.rotulo === "0")).toBe(true);
    const limites = new Set(e.leyenda.flatMap((x) => (x.relleno ? x.texto.split(" a ") : [])));
    for (const p of lineas) expect(limites.has(p.rotulo!), p.rotulo).toBe(true);
    const svg = escenaASvg(e).svg;
    expect(svg).toMatch(/<text [^>]*rotate\([^>]*>0<\/text>/);
  });

  it("escala de un mapa: completa, sin picos y manual, con lo de fuera en una banda más por cada lado", () => {
    // Completa: los límites redondos de siempre
    const c = limitesMapa(-44.4, 19.2) as LimitesMapa;
    expect(c.L).toEqual(limitesRedondos(-44.4, 19.2, 10, true));
    expect([c.fueraAbajo, c.fueraArriba]).toEqual([false, false]);
    // Sin picos: el rango robusto, redondeado, y los picos fuera
    const sp = limitesMapa(-69, 134, { modo: "sin-picos" }, [-21.6, 22]) as LimitesMapa;
    expect(sp.L[0]).toBe(-69);
    expect(sp.L[sp.L.length - 1]).toBe(134);
    expect(sp.L.slice(1, -1)).toEqual(limitesRedondos(-21.6, 22, 10, true));
    expect([sp.fueraAbajo, sp.fueraArriba]).toEqual([true, true]);
    // Manual: el mínimo y el máximo dados son los bordes; el paso, en sus múltiplos
    const m = limitesMapa(-44.4, 19.2, { min: -37, max: 15, paso: 10 }) as LimitesMapa;
    expect(m.L).toEqual([-44.4, -37, -30, -20, -10, 0, 10, 15, 19.2]);
    expect(m.paso).toBe(10);
    // Sólo el paso: el rango del mapa, con el 0
    expect((limitesMapa(-44.4, 19.2, { paso: 20 }) as LimitesMapa).L).toEqual([-60, -40, -20, 0, 20]);
    // Errores
    expect("error" in limitesMapa(0, 1, { min: 5, max: 1 })).toBe(true);
    expect("error" in limitesMapa(0, 1, { paso: 0 })).toBe(true);
    expect("error" in limitesMapa(0, 100, { paso: 1 })).toBe(true);
    // Texto de la CLI
    expect(escalaDeTexto("sin-picos")).toEqual({ modo: "sin-picos" });
    expect(escalaDeTexto("completa")).toEqual({});
    expect(escalaDeTexto("-40:20:5")).toEqual({ min: -40, max: 20, paso: 5 });
    expect(escalaDeTexto("::2,5")).toEqual({ paso: 2.5 });
    expect(escalaDeTexto(":15:")).toEqual({ max: 15 });
    for (const t of ["5:1:1", "a:b:c", "1:2", "::0"]) expect("error" in escalaDeTexto(t), t).toBe(true);
    // Rango sin picos: con un 1 % del área en un pico, el pico queda fuera
    const v = [...Array.from({ length: 990 }, (_, i) => (i % 21) - 10), ...Array.from({ length: 10 }, () => 500)];
    expect(rangoSinPicos(v, v.map(() => 1))).toEqual([-10, 10]);
    // Colores: las de fuera, el más oscuro de su signo y distinto de todas las de dentro
    const col = coloresBandas(sp.L, { abajo: true, arriba: true });
    expect(new Set(col).size).toBe(col.length);
    expect(col[0]).toBe("#053061");
    expect(col[col.length - 1]).toBe("#67001f");
    expect(coloresBandas(c.L)).toEqual(coloresBandas(c.L, {}));
  });

  it("escala en la vista: la leyenda dice lo de fuera, va rayado, y los extremos rotulados son los reales", () => {
    const { r: rr, cj } = calculados.get("edificio con losas (2 plantas, con acciones)")!;
    const completa = vistaCampo(rr, "N1", "m11", cj.esfuerzos, d);
    const mapa = completa.mapa!;
    expect(mapa.fueraAbajo || mapa.fueraArriba).toBe(false);
    expect(completa.primitivas.some((p) => p.tipo === "linea" && p.estilo === "fuera-escala")).toBe(false);
    // Manual, más estrecha que el mapa
    const [a, b] = [mapa.limites[1]!, mapa.limites[mapa.limites.length - 2]!];
    const e = vistaCampo(rr, "N1", "m11", cj.esfuerzos, d, { min: a, max: b });
    expect(e.mapa!.limites[0]).toBe(a);
    expect(e.mapa!.limites[e.mapa!.limites.length - 1]).toBe(b);
    expect(e.mapa!.fueraAbajo && e.mapa!.fueraArriba).toBe(true);
    expect(e.leyenda[0]!.texto).toMatch(/^más de .* \(fuera de la escala, rayado\)$/);
    expect(e.leyenda.find((x) => x.texto.startsWith("menos de"))).toBeTruthy();
    expect(e.primitivas.some((p) => p.tipo === "linea" && p.estilo === "fuera-escala")).toBe(true);
    expect(e.extremos).toEqual(completa.extremos);
    expect(e.notas.some((n) => n.startsWith(`Escala de ${rotulo(a, 4)} a ${rotulo(b, 4)}`))).toBe(true);
    // El rayado cae dentro de las bandas de fuera
    const fuera = e.primitivas.filter((p): p is Extract<Primitiva, { tipo: "region" }> => p.tipo === "region" && (p.banda === 0 || p.banda === e.leyenda.filter((x) => x.relleno).length - 1));
    for (const p of e.primitivas)
      if (p.tipo === "linea" && p.estilo === "fuera-escala") {
        const m: Vec2 = [(p.puntos[0]![0] + p.puntos[1]![0]) / 2, (p.puntos[0]![1] + p.puntos[1]![1]) / 2];
        expect(fuera.some((f) => vueltas(m, f.anillos) === 1)).toBe(true);
      }
    // Una escala no válida: la completa, y se dice
    const mala = vistaCampo(rr, "N1", "m11", cj.esfuerzos, d, { min: 5, max: 1 });
    expect(mala.mapa).toEqual(completa.mapa);
    expect(mala.notas[0]).toMatch(/^Escala no válida/);
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

describe("A4: los ábacos en planta, sólo en lo que cae en la losa", () => {
  it("el área rellena de cada ábaco es la que cuenta el compilador (un cuarto en una esquina, la mitad en un borde)", () => {
    const f = edificioReticular(1, 3, 3);
    const l = f.losas![0]!;
    const region = { contorno: l.contorno, huecos: l.huecos ?? [] };
    const e = vistaModelo(f, l.planta, d);
    const rellenos = e.primitivas.filter((p) => p.tipo === "poligono" && p.estilo === "abaco-relleno");
    const abacos = l.reticular!.abacos!;
    expect(rellenos.length).toBe(abacos.length);
    const llena = (abacos[0]![2]![0] - abacos[0]![0]![0]) * (abacos[0]![2]![1] - abacos[0]![0]![1]);
    const fracciones = new Set<number>();
    rellenos.forEach((p, i) => {
      if (p.tipo !== "poligono") return;
      const A = p.anillos.reduce((t, q, j) => t + (j ? -1 : 1) * Math.abs(area(q)), 0);
      expect(A).toBeCloseTo(momentosInterseccion(region, abacos[i]!).A, 12);
      fracciones.add(Math.round((4 * A) / llena));
    });
    expect([...fracciones].sort()).toEqual([1, 2, 4]);
    // Ningún trazo del ábaco fuera de la losa (rectangular)
    const xs = l.contorno.map((q) => q[0]);
    const ys = l.contorno.map((q) => q[1]);
    const trazos = e.primitivas.filter((p) => p.tipo === "linea" && p.estilo === "abaco-borde");
    expect(trazos.length).toBeGreaterThan(0);
    for (const p of trazos) {
      if (p.tipo !== "linea") continue;
      const [x, y] = [(p.puntos[0]![0] + p.puntos[1]![0]) / 2, (p.puntos[0]![1] + p.puntos[1]![1]) / 2];
      expect(x >= Math.min(...xs) - 1e-9 && x <= Math.max(...xs) + 1e-9 && y >= Math.min(...ys) - 1e-9 && y <= Math.max(...ys) + 1e-9).toBe(true);
    }
  });
});

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
