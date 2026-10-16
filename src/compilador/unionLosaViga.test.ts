/**
 * Fase LV (`docs/fem3d/union-losa-viga.md`): la losa se une a las vigas de hormigón rectangulares por
 * sus caras, como en CYPECAD (CY-g).
 * - Criterio 3: no hay láminas en el ancho de las vigas; cada nudo de la losa en él es esclavo de un
 *   enlace con maestro en el eje de la viga o de la huella de un pilar; láminas y piezas del ancho
 *   suman el área de la losa (el validador del mallador, a 1e-9).
 * - Criterio 4: lo que cae en el ancho (pp, superficie, lineales y puntuales) llega a la viga sin
 *   pérdidas (1e-9), y el equilibrio cuadra.
 * - Criterio 5: reordenar las listas da el mismo modelo bit a bit; una traslación y dos giros, la
 *   misma malla y los resultados transformados.
 * - Con `unionLosaViga: "eje"`, la unión de antes: la losa sobre todo el ancho y sin enlaces de cara.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioReticular } from "../../validacion/c4/modelos.ts";
import { conAcciones } from "../../validacion/c5/modelos.ts";
import { calcular } from "../motor/calcular.ts";
import { Cortes } from "../motor/cortes.ts";
import type { ResultadoCaso } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { azar } from "../pruebas/fisicoAleatorio.ts";
import { barajar, planos, relacionPlanoC2, valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico, OpcionesCompilacion, Vec2 } from "./fisico.ts";
import { areaConSigno, distanciaABorde, distanciaASegmento, puntoEnPoligono } from "./poligonos.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

const X = [0, 5, 10];
const Y = [0, 4, 8];

/** 2 × 2 vanos de 5 × 4 m, vigas de 30×50 por todos los ejes, losa de 20 cm hasta los ejes. */
function modelo(): ModeloFisico {
  const pilares = X.flatMap((x, i) => Y.map((y, j) => ({ id: `P${i}${j}`, x, y, desde: "P0", hasta: "P1", seccion: "P30" })));
  const vigas = [...Y.map((y, j) => ({ id: `VX${j}`, planta: "P1", puntos: [[0, y], [10, y]] as Vec2[], seccion: "V30" })), ...X.map((x, i) => ({ id: `VY${i}`, planta: "P1", puntos: [[x, 0], [x, 8]] as Vec2[], seccion: "V30" }))];
  return {
    plantas: [
      { id: "P1", altura: null },
      { id: "P0", altura: 3 },
    ],
    materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "P30", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "V30", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares,
    vigas,
    losas: [{ id: "L", planta: "P1", contorno: [[0, 0], [10, 0], [10, 8], [0, 8]], espesor: 0.2, material: "H" }],
    casos: [{ id: "G", pesoPropio: true }, { id: "Q" }],
    cargas: [
      { tipo: "superficie", id: "CM", caso: "G", planta: "P1", losa: "L", q: [0, 0, -2] },
      // Una zona que cruza la viga VY1 y acaba dentro del ancho de VX1
      { tipo: "superficie", id: "Z", caso: "Q", planta: "P1", zona: [[3, 1], [7.3, 1], [7.3, 4.07], [3, 4.07]], q: [0, 0, -3] },
      // Un tabique por el eje de VX1, y otro que cruza VY1 de través
      { tipo: "lineal", id: "T1", caso: "G", planta: "P1", puntos: [[1, 4], [9, 4]], q: [0, 0, -7] },
      { tipo: "lineal", id: "T2", caso: "G", planta: "P1", puntos: [[3.5, 6], [6.5, 6]], q: [0, 0, -5] },
      // Una puntual dentro del ancho de VY1, a 10 cm de su eje, y otra en la losa
      { tipo: "puntual", id: "F1", caso: "Q", planta: "P1", x: 5.1, y: 2, F: [0, 0, -20] },
      { tipo: "puntual", id: "F2", caso: "Q", planta: "P1", x: 2.5, y: 6, F: [0, 0, -10], M: [1, 0, 0] },
    ],
  };
}

const compilado = (f: ModeloFisico, op: OpcionesCompilacion = {}) => valido(compilar(f, op));

describe("fase LV: la losa unida a las vigas por sus caras", () => {
  it("compila sin errores, sin pérdidas y con equilibrio", () => {
    const r = compilado(modelo());
    expect(r.diagnosticos.filter((d) => d.severidad === "error")).toEqual([]);
    expect(r.estadisticas.sinPerdidas.fuerzas).toBeLessThan(1e-9);
    expect(r.estadisticas.sinPerdidas.momentos).toBeLessThan(1e-9);
    expect(r.estadisticas.enlacesVigas.enlaces).toBeGreaterThan(0);
    expect(casosValidos(calcular(r.modelo))).toHaveLength(2);
    expect(r.hipotesis.some((h) => h.includes("Unión losa–viga como CYPECAD"))).toBe(true);
  });

  it("no hay láminas en el ancho de las vigas, y sus nudos en él van con un enlace", () => {
    const r = compilado(modelo());
    const anchos = r.mapeo.anchos!;
    expect(anchos).toHaveLength(6);
    const { nudos, laminas, restricciones } = r.modelo;
    const xy = (n: number): Vec2 => [nudos[n]!.x, nudos[n]!.y];
    for (const l of laminas!) {
      const c = l.nudos.map(xy).reduce((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4] as Vec2, [0, 0] as Vec2);
      expect(anchos.some((a) => puntoEnPoligono(c, a.poligono))).toBe(false);
    }
    const esclavo = new Map<number, string>();
    for (const x of restricciones ?? []) if (x.tipo === "enlace-rigido") for (const n of x.esclavos) esclavo.set(n, x.id);
    const enLamina = new Set(laminas!.flatMap((l) => [...l.nudos]));
    let enCara = 0;
    for (const n of enLamina) {
      if (!anchos.some((a) => distanciaABorde(xy(n), a.poligono) < 1e-6)) continue;
      enCara++;
      expect(esclavo.has(n), `nudo ${nudos[n]!.id}`).toBe(true);
    }
    expect(enCara).toBeGreaterThan(50);
    // Los maestros de las caras, en el eje de su viga
    const vigas = new Map(modelo().vigas!.map((v) => [v.id, v.puntos] as const));
    for (const [i, x] of (restricciones ?? []).entries()) {
      if (!x.id.includes(":cara")) continue;
      const p = vigas.get(r.mapeo.restricciones[i]!.viga!)!;
      expect(distanciaASegmento(xy(x.maestro), p[0]!, p[1]!)).toBeLessThan(1e-9);
    }
  });

  it("la losa de cada recuadro va de cara a cara, y las piezas del ancho completan su área", () => {
    const r = compilado(modelo());
    const { nudos, laminas } = r.modelo;
    let area = 0;
    for (const l of laminas!) area += areaConSigno(l.nudos.map((n) => [nudos[n]!.x, nudos[n]!.y] as Vec2));
    // 4 recuadros de (5 − 0,3) × (4 − 0,3) y medio ancho por fuera en el contorno, que no es losa
    expect(Math.abs(area - 4 * 4.7 * 3.7) / area).toBeLessThan(1e-9);
  });

  it("con unionLosaViga «eje», la unión de antes", () => {
    const r = compilado(modelo(), { unionLosaViga: "eje" });
    const { nudos, laminas, restricciones } = r.modelo;
    let area = 0;
    for (const l of laminas!) area += areaConSigno(l.nudos.map((n) => [nudos[n]!.x, nudos[n]!.y] as Vec2));
    expect(Math.abs(area - 80) / area).toBeLessThan(1e-9);
    expect((restricciones ?? []).some((x) => x.id.includes(":cara"))).toBe(false);
    expect(r.mapeo.anchos).toBeUndefined();
  });

  it("un apoyo dentro del ancho de una viga y fuera de su eje va a su eje (`apoyosViga.test.ts`)", () => {
    const f = modelo();
    const r = compilado({ ...f, apoyos: [{ id: "A", planta: "P1", x: 5.1, y: 6, coartados: [false, false, true, false, false, false] }] });
    expect(r.diagnosticos.some((d) => d.codigo === "apoyo/a-viga")).toBe(true);
    const n = r.modelo.nudos[r.mapeo.apoyos.A!]!;
    expect([n.x, n.y]).toEqual([5, 6]);
  });

  it("un borde de losa dentro del ancho de una viga ya no es un error (C2-c)", () => {
    const f = modelo();
    // La losa hasta la cara exterior de las vigas de borde
    const g: ModeloFisico = { ...f, losas: [{ ...f.losas![0]!, contorno: [[-0.15, -0.15], [10.15, -0.15], [10.15, 8.15], [-0.15, 8.15]] }] };
    expect(compilar(g).valido).toBe(true);
    expect(compilar(g, { unionLosaViga: "eje" }).diagnosticos.some((d) => d.codigo === "losa/borde-en-viga")).toBe(true);
  });

  it("criterio 5: reordenar las listas da el mismo modelo, bit a bit", () => {
    const f = modelo();
    const r = azar(77);
    const g: ModeloFisico = { ...f, pilares: barajar(f.pilares!, r), vigas: barajar(f.vigas!, r), cargas: barajar(f.cargas!, r), secciones: barajar(f.secciones, r) };
    const [a, b] = [compilado(f), compilado(g)];
    expect(JSON.stringify(b.modelo) === JSON.stringify(a.modelo)).toBe(true);
    expect(JSON.stringify(b.mapeo) === JSON.stringify(a.mapeo)).toBe(true);
  });

  for (const { nombre, t } of planos())
    it(`criterio 5, ${nombre}: la misma malla y los resultados transformados`, () => {
      const e = relacionPlanoC2(modelo(), t);
      expect(e.mismaMalla).toBe(true);
      expect(e.u).toBeLessThan(1e-9);
      expect(e.reacciones).toBeLessThan(1e-9);
    });
});

describe("fase LV, criterio 7: las franjas en la cara de una viga", () => {
  // La retícula de 4 × 4 pilares de 40 × 40 con vigas por todos los ejes, con h = 0,75
  const fisico = conAcciones(edificioReticular(1, 3, 3));
  let c: Extract<ReturnType<typeof compilar>, { valido: true }>;
  let q: Consultas;
  let casos: ResultadoCaso[];
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
    c = valido(compilar(fisico));
    casos = casosValidos(calcular(c.modelo));
    q = new Consultas(fisico, c, casos, {});
  }, 120_000);

  it("en cada cara de la viga de y = 5, la suma de las franjas es el corte de la losa por la cara (lo que pasa a la viga)", () => {
    const v = fisico.vigas!.find((x) => x.planta === "N1" && x.puntos.every((p) => Math.abs(p[1] - 5) < 1e-9))!;
    const sc = fisico.secciones.find((s) => s.id === v.seccion)!;
    const b = sc.forma === "rectangular" ? sc.b : NaN;
    const z = c.modelo.nudos[c.modelo.laminas![0]!.nudos[0]]!.z;
    const fs = q.franjas("L-N1");
    if (!fs.valido) throw new Error("L-N1");
    const cortes = new Cortes(c.modelo);
    for (const lado of [-1, 1] as const) {
      const yf = 5 + (lado * b) / 2;
      // Σ mx·b de las franjas de la dirección 2 en su estación de apoyo de esa cara, por caso
      const suma = casos.map(() => 0);
      let n = 0;
      for (const f of fs.valor) {
        if (f.direccion !== 2) continue;
        const e = q.franja(f.id);
        if (!e.valido) throw new Error(f.id);
        const x = e.valor.estaciones.find((s) => s.tipo === "apoyo" && s.lado === lado && Math.abs(s.punto[1] - yf) < 1e-6);
        expect(x, `${f.id}, cara ${lado}`).toBeDefined();
        n++;
        casos.forEach((_, k) => (suma[k]! += x!.medios[3 * k]! * x!.anchoEnLosa));
      }
      expect(n).toBeGreaterThan(15);
      // El corte por la cara, del lado de la losa: x = +y si la losa está en y < yf (lado −1)
      const r = cortes.cortar({ origen: [0, yf, z], x: [0, -lado, 0], vz: [0, 0, 1], y: [-1000, 1000], metodo: "fuerzas-nodales", soloLaminas: true }, casos);
      expect(r.valido).toBe(true);
      casos.forEach((_, k) => {
        const total = r.esfuerzos[6 * k + 4]!;
        expect(Math.abs(suma[k]! - total) / Math.max(1, Math.abs(total)), `cara ${lado}, caso ${k}: ${suma[k]} frente a ${total}`).toBeLessThan(1e-9);
      });
    }
  });
});
