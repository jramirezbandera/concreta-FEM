/**
 * Los apoyos en todas las vistas (a raíz del muestrario: su apoyo lineal AL1 va por el eje E, y el
 * eje, dibujado encima, lo tapaba; en el alzado y en el 3D no salía). Se dibujan encima de los ejes,
 * nunca atenuados, con lo que coaccionan, y bajo la losa en el alzado y en el 3D.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prepararNucleo, proyectoDe } from "../../../validacion/a3/revisar.ts";
import { compilar } from "../../compilador/compilar.ts";
import { Consultas } from "../../compilador/consultas.ts";
import type { ModeloFisico } from "../../compilador/fisico.ts";
import { calcular } from "../../motor/calcular.ts";
import { alambrico } from "../../visor/alambrico.ts";
import { cuna, LADO_APOYO_3D, piezasSolido, volumen } from "../../visor/solido.ts";
import { resumen } from "../consultas.ts";
import { planoDeEje, vistaAlzado } from "./alzado.ts";
import { conjuntoPorDefecto, ResultadosRender, vistaCampo, vistaCargas, vistaModelo } from "./index.ts";
import { LADO_APOYO, PASO_APOYO, textoCoartados, triangulosApoyo } from "./modelo.ts";
import { area, type Escena, type Primitiva, type Vec2 } from "./escena.ts";

const RAIZ = join(import.meta.dirname, "../../..");
const muestrario = (): ModeloFisico => JSON.parse(readFileSync(join(RAIZ, "ejemplos/muestrario/proyecto.json"), "utf8")).modelo;
const d = { huella: "0123456789abcdef" };

/** Índice de la primera primitiva de un objeto con un estilo (−1 si no hay). */
const indice = (e: Escena, objeto: string, estilo: string) => e.primitivas.findIndex((p) => p.tipo !== "texto" && p.objeto === objeto && "estilo" in p && p.estilo === estilo);
const ultimoEje = (e: Escena) => e.primitivas.reduce((m, p, i) => (p.tipo !== "texto" && "estilo" in p && p.estilo === "eje" ? i : m), -1);
const triangulos = (e: Escena, objeto: string) => e.primitivas.filter((p): p is Extract<Primitiva, { tipo: "poligono" }> => p.tipo === "poligono" && p.objeto === objeto && p.estilo === "apoyo");

describe("apoyos: rótulo y triángulos", () => {
  it("lo que coacciona", () => {
    expect(textoCoartados([false, false, true, false, false, false])).toBe("uz");
    expect(textoCoartados([true, true, true, false, false, false])).toBe("articulado");
    expect(textoCoartados([true, true, true, true, true, true])).toBe("empotrado");
    expect(textoCoartados([false, false, true, true, false, true])).toBe("uz rx rz");
  });

  it("los triángulos de un apoyo lineal: a la derecha, con el vértice en la línea, cada metro como mucho", () => {
    const linea: Vec2[] = [[0, 0], [2.5, 0], [2.5, 1]];
    const ts = triangulosApoyo(linea);
    expect(ts).toHaveLength(Math.ceil(3.5 / PASO_APOYO));
    for (const [v, a, b] of ts as [Vec2, Vec2, Vec2][]) {
      // El vértice en la polilínea
      expect(Math.min(Math.abs(v[1]) + (v[0] <= 2.5 ? 0 : 1), Math.abs(v[0] - 2.5))).toBeLessThan(1e-12);
      expect(Math.abs(area([v, a, b]))).toBeCloseTo((LADO_APOYO * LADO_APOYO) / 2, 12);
      // A la derecha: vértice, base derecha e izquierda de la línea, en sentido horario
      expect(area([v, a, b])).toBeLessThan(0);
    }
    // En el primer tramo (hacia +X), la derecha es −Y
    expect(ts[0]![1]![1]).toBeLessThan(0);
  });
});

describe("apoyos en planta: el muestrario", () => {
  const f = muestrario();

  it("AL1 va por el eje E y se dibuja encima de él, con triángulos y lo que coacciona", () => {
    const al = f.apoyosLineales!.find((a) => a.id === "AL1")!;
    const e = f.ejes!.find((x) => x.id === "E")!;
    expect(al.puntos[0]![0]).toBe(e.desde[0]);
    const v = vistaModelo(f, "PB", d);
    const i = indice(v, "AL1", "apoyo-lineal");
    expect(i).toBeGreaterThan(ultimoEje(v));
    expect(triangulos(v, "AL1")).toHaveLength(11);
    expect(v.primitivas.some((p) => p.tipo === "texto" && p.texto === "AL1 · uz")).toBe(true);
    expect(v.leyenda.some((x) => x.estilo === "apoyo-lineal")).toBe(true);
  });

  it("en las cargas, de fondo, sin atenuar", () => {
    const caso = f.casos[0]!.id;
    const v = vistaCargas(f, "PB", caso, d);
    expect(indice(v, "AL1", "apoyo-lineal")).toBeGreaterThan(ultimoEje(v));
    expect(v.primitivas.some((p) => p.tipo !== "texto" && p.objeto === "AL1" && "estilo" in p && p.estilo.startsWith("atenuado"))).toBe(false);
  });

  it("en el alzado del eje 2, AL1 cruza el plano: un triángulo bajo la losa; en uno a lo largo de él, la línea con sus triángulos", () => {
    const z = 0 - f.losas!.find((l) => l.id === "L1")!.espesor;
    const cruza = vistaAlzado(f, planoDeEje(f, "2")!, d);
    const m = cruza.primitivas.find((p) => p.tipo === "marca" && p.objeto === "AL1");
    expect(m && m.tipo === "marca" && m.p[1]).toBeCloseTo(z, 12);
    expect(m && m.tipo === "marca" && m.p[0]).toBeCloseTo(21 + 1.5, 9);
    // El plano de E sin su eje (el propio eje no se dibuja cruzándose consigo), por los puntos de AL1
    const largo = vistaAlzado(f, { desde: [21, -1.5], hasta: [21, 12.5] }, d);
    const l = largo.primitivas.find((p) => p.tipo === "linea" && p.objeto === "AL1");
    expect(l && l.tipo === "linea" ? l.puntos : null).toEqual([[1.5, z], [12.5, z]]);
    expect(triangulos(largo, "AL1")).toHaveLength(11);
    expect(largo.primitivas.some((p) => p.tipo === "texto" && p.texto === "AL1 · uz")).toBe(true);
    // De fondo de las cargas, sin atenuar
    const fondo = vistaAlzado(f, { desde: [21, -1.5], hasta: [21, 12.5] }, d, { atenuado: true });
    const lf = fondo.primitivas.find((p) => p.tipo === "linea" && p.objeto === "AL1");
    expect(lf?.tipo === "linea" ? lf.estilo : null).toBe("apoyo-lineal");
  });

  it("en el 3D: una cuña cerrada bajo la losa, de volumen w·h·L, y sus aristas en el alámbrico", () => {
    const { piezas } = piezasSolido(f);
    const p = piezas.find((x) => x.id === "AL1")!;
    expect(p.tipo).toBe("apoyo");
    const [w, h, L] = [LADO_APOYO_3D / 2, LADO_APOYO_3D, 11];
    expect(volumen(p.caras)).toBeCloseTo(w * h * L, 12);
    expect(Math.abs(volumen(p.caras) - volumen(p.caras, [12.3, -4.5, 6.7]))).toBeLessThan(1e-12);
    const zs = p.caras.flatMap((c) => c.p.map((q) => q[2]));
    expect(Math.max(...zs)).toBeCloseTo(-0.25, 12);
    expect(Math.min(...zs)).toBeCloseTo(-0.25 - h, 12);
    const a = alambrico(f);
    const k = a.objetos.findIndex((o) => o.id === "AL1");
    expect(a.objetos[k]!.tipo).toBe("apoyo");
    // La arista, dos líneas de base y 3 lados de 12 triángulos
    expect([...a.objeto].filter((o) => o === k)).toHaveLength(3 + 3 * 12);
  });

  it("una cuña es cerrada con la normal hacia fuera en cualquier dirección", () => {
    for (const [A, B] of [[[0, 0], [3, 0]], [[1, 2], [-2, 5]], [[0, 0], [0, -4]]] as [Vec2, Vec2][]) {
      const c = cuna(A, B, 1, 0.1, 0.2);
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      expect(volumen(c)).toBeCloseTo(0.1 * 0.2 * L, 12);
      expect(volumen(c, [5, 5, 5])).toBeCloseTo(0.1 * 0.2 * L, 12);
    }
  });
});

describe("apoyos sobre un mapa de resultados", () => {
  const f = muestrario();
  let mapa: Escena;
  beforeAll(async () => {
    await prepararNucleo();
    const c = compilar(f);
    if (!c.valido) throw new Error(c.diagnosticos[0]?.mensaje);
    const k = calcular(c.modelo);
    if (!k.valido) throw new Error("no calcula");
    const q = new Consultas(f, c, k.casos);
    const res = resumen(proyectoDe(f), c);
    if (!res.valido) throw new Error("resumen");
    mapa = vistaCampo(new ResultadosRender(q, c), "PB", "uz", conjuntoPorDefecto(q, res.valor, "desplazamientos"), d);
  }, 120_000);

  it("encima de los ejes, sin rótulo y en la leyenda", () => {
    expect(indice(mapa, "AL1", "apoyo-lineal")).toBeGreaterThan(ultimoEje(mapa));
    expect(triangulos(mapa, "AL1")).toHaveLength(11);
    expect(mapa.primitivas.some((p) => p.tipo === "texto" && p.objeto === "AL1")).toBe(false);
    expect(mapa.leyenda.some((x) => x.estilo === "apoyo-lineal")).toBe(true);
  });
});
