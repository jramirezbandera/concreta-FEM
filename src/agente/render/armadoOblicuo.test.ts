/**
 * El mapa de armado de una planta no ortogonal no se sale de la losa: una franja va de borde a borde
 * con el s de la losa en toda su banda, así que, con un borde oblicuo, el rectángulo de sus tramos
 * extremos se salía (de la prueba de uso, 2026-11-07). El dibujo se recorta con la losa (contorno
 * menos huecos) en la planta y en el 3D, y un clic fuera de la losa no da valor; los valores no
 * cambian. Sobre el rombo de G con un hueco.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compilar } from "../../compilador/compilar.ts";
import { Consultas } from "../../compilador/consultas.ts";
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { areaConSigno, distanciaABorde, momentosRegion, puntoEnRegion, type Region } from "../../compilador/poligonos.ts";
import { calcular } from "../../motor/calcular.ts";
import { iniciarNucleo } from "../../nucleo/index.ts";
import { edificioGeometria } from "../../pruebas/geometrias.ts";
import { armado3D, valorArmado } from "../../visor/armado.ts";
import { ARMADURAS } from "../armaduraBase.ts";
import { conjuntoCombinaciones, seleccionPorDefecto, type ConjuntoCombinaciones } from "../combinaciones.ts";
import { franjasTramos, losasDe } from "../refuerzos.ts";
import { recorteTramos, regionesLosas, vistaArmado } from "./armado.ts";
import { ResultadosRender } from "./resultados.ts";

let f: ModeloFisico;
let q: Consultas;
let rr: ResultadosRender;
let conj: ConjuntoCombinaciones;
let regiones: Map<string, Region>;
let planta: string;

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "nucleo", "pkg", "nucleo_bg.wasm")));
  f = edificioGeometria("rombo", { plantas: 1, hueco: true });
  const c = compilar(f);
  if (!c.valido) throw new Error("no compila");
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error("no calcula");
  q = new Consultas(f, c, r.casos);
  rr = new ResultadosRender(q, c);
  const s = conjuntoCombinaciones(q, seleccionPorDefecto(f.casos, "esfuerzos"));
  if (!s.valido) throw new Error("sin combinaciones");
  conj = s.valor;
  regiones = regionesLosas(f.losas);
  planta = f.losas![0]!.planta;
}, 120_000);

/** ¿Está p en la región o a 1e-9 de su borde? */
const enLosa = (p: Vec2, r: Region) => puntoEnRegion(p, r) || [r.contorno, ...r.huecos].some((a) => distanciaABorde(p, a) <= 1e-9);
/** Número de vueltas de un anillo alrededor de p. */
const vueltas = (p: Vec2, a: readonly Vec2[]) => {
  let w = 0;
  for (let i = 0, n = a.length; i < n; i++) {
    const [u, v] = [a[i]!, a[(i + 1) % n]!];
    const lado = (v[0] - u[0]) * (p[1] - u[1]) - (p[0] - u[0]) * (v[1] - u[1]);
    if (u[1] <= p[1] && v[1] > p[1] && lado > 0) w++;
    else if (u[1] > p[1] && v[1] <= p[1] && lado < 0) w--;
  }
  return w;
};
const losaUnica = () => {
  expect(regiones.size).toBe(1);
  return [...regiones.values()][0]!;
};

describe("armado en una planta no ortogonal", () => {
  it("la losa es oblicua a sus franjas y tiene un hueco: hay tramos que se salen", () => {
    const r = losaUnica();
    expect(r.huecos.length).toBeGreaterThan(0);
    const fs = franjasTramos(q, losasDe(q, { planta }), "x-sup", conj);
    if (!fs.valido) throw new Error();
    const fuera = fs.valor.flatMap((x) => x.tramos).filter((t) => t.rectangulo.some((p) => !enLosa(p, r)));
    expect(fuera.length).toBeGreaterThan(10);
  });

  for (const a of ARMADURAS)
    it(`${a}: lo dibujado en planta está en la losa y su área es la de los tramos recortados`, () => {
      const r = losaUnica();
      const e = vistaArmado(rr, planta, a, conj, { nombre: "rombo", huella: "0".repeat(64) });
      let area = 0;
      const anillos: Vec2[][] = [];
      for (const p of e.primitivas) {
        if (!(p.tipo === "region" || (p.tipo === "poligono" && p.estilo === "armado-cubierto"))) continue;
        for (const anillo of p.anillos) {
          anillos.push(anillo);
          area += areaConSigno(anillo);
        }
      }
      expect(anillos.length).toBeGreaterThan(0);
      // Lo que se pinta (nonzero; los anillos de los huecos van al revés): nada fuera de la losa ni en su
      // hueco, en una retícula de puntos (las esquinas de un rectángulo pueden caer en el hueco: su
      // anillo las resta)
      const [x0, y0, x1, y1] = [-1, -1, 33, 15.5];
      let fuera = 0;
      let dentro = 0;
      for (let i = 0; i <= 340; i++)
        for (let j = 0; j <= 165; j++) {
          const p: Vec2 = [x0 + ((x1 - x0) * i) / 340, y0 + ((y1 - y0) * j) / 165];
          if ([r.contorno, ...r.huecos].some((x) => distanciaABorde(p, x) <= 1e-6)) continue;
          const w = anillos.reduce((s, a) => s + vueltas(p, a), 0);
          expect(w === 0 || w === 1, `${p}: ${w}`).toBe(true);
          if (puntoEnRegion(p, r)) dentro += w;
          else fuera += w;
        }
      expect(fuera).toBe(0);
      expect(dentro).toBeGreaterThan(1000);
      // Los tramos de la planta, recortados uno a uno, y la losa
      const fs = franjasTramos(q, losasDe(q, { planta }), a, conj);
      if (!fs.valido) throw new Error();
      const recortada = fs.valor.flatMap((x) => x.tramos).reduce((s, t) => s + recorteTramos(r, t.rectangulo).reduce((u, p) => u + areaConSigno(p), 0), 0);
      expect(Math.abs(area - recortada)).toBeLessThan(1e-9 * momentosRegion(r).A);
      expect(area).toBeLessThanOrEqual(momentosRegion(r).A * (1 + 1e-12));
      for (const l of e.primitivas) if (l.tipo === "linea" && l.estilo === "zona-refuerzo") for (const v of l.puntos) expect(enLosa(v, r)).toBe(true);
    });

  it("el 3D, igual: triángulos en la losa con el área de lo dibujado en planta", () => {
    const r = losaUnica();
    const d = armado3D(rr, [0, 0, 0], "x-sup", conj, { planta });
    if (!d.valido) throw new Error();
    const T = d.valor.triangulos;
    expect(d.valor.banda.length * 9).toBe(T.length);
    let area = 0;
    for (let i = 0; i < T.length; i += 9) {
      const tri: Vec2[] = [
        [T[i]!, T[i + 1]!],
        [T[i + 3]!, T[i + 4]!],
        [T[i + 6]!, T[i + 7]!],
      ];
      area += Math.abs(areaConSigno(tri));
      // Float32: a 1e-5 m del borde
      for (const v of tri) expect(puntoEnRegion(v, r) || [r.contorno, ...r.huecos].some((x) => distanciaABorde(v, x) <= 1e-5)).toBe(true);
    }
    const fs = franjasTramos(q, losasDe(q, { planta }), "x-sup", conj);
    if (!fs.valido) throw new Error();
    const recortada = fs.valor.flatMap((x) => x.tramos).reduce((s, t) => s + recorteTramos(r, t.rectangulo).reduce((u, p) => u + areaConSigno(p), 0), 0);
    expect(Math.abs(area - recortada) / recortada).toBeLessThan(1e-5);
  });

  it("un clic dentro del rectángulo de un tramo pero fuera de la losa no da valor", () => {
    const r = losaUnica();
    const fs = franjasTramos(q, losasDe(q, { planta }), "x-sup", conj);
    if (!fs.valido) throw new Error();
    let probados = 0;
    for (const t of fs.valor.flatMap((x) => x.tramos)) {
      const [A, B, C, D] = t.rectangulo as [Vec2, Vec2, Vec2, Vec2];
      for (const [u, v] of [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.9, 0.9],
        [0.1, 0.9],
      ] as const) {
        const p: Vec2 = [A[0] + u * (B[0] - A[0]) + v * (D[0] - A[0]), A[1] + u * (B[1] - A[1]) + v * (D[1] - A[1])];
        void C;
        if (enLosa(p, r)) continue;
        const w = valorArmado(q, planta, "x-sup", conj, p[0], p[1]);
        if (!w.valido) throw new Error();
        expect(w.valor).toBeNull();
        probados++;
      }
    }
    expect(probados).toBeGreaterThan(5);
  });
});
