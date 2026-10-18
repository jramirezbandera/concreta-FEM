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
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { azar } from "../pruebas/fisicoAleatorio.ts";
import { barajar, planos, relacionPlanoC2, valido } from "../pruebas/metamorficasFisicas.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico, OpcionesCompilacion, Vec2 } from "./fisico.ts";
import { anchoNominal } from "./franjas.ts";
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
  // La retícula de 4 × 4 pilares de 40 × 40 con vigas de 30 por todos los ejes, con h = 0,75, y la
  // misma con pilares de 30 × 30 (ninguno cruza las caras de las vigas)
  const fisico = conAcciones(edificioReticular(1, 3, 3));
  const material = fisico.secciones.find((x) => x.id === fisico.pilares![0]!.seccion)!.material;
  const fisico30: ModeloFisico = { ...fisico, secciones: [...fisico.secciones, { id: "p30t", material, forma: "rectangular", b: 0.3, h: 0.3 }], pilares: fisico.pilares!.map((p) => ({ ...p, seccion: "p30t" })) };
  const preparar = (f: ModeloFisico) => {
    const c = valido(compilar(f));
    const casos = casosValidos(calcular(c.modelo));
    return { c, casos, q: new Consultas(f, c, casos, {}) };
  };
  let m40: ReturnType<typeof preparar>;
  let m30: ReturnType<typeof preparar>;
  beforeAll(async () => {
    await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
    m40 = preparar(fisico);
    m30 = preparar(fisico30);
  }, 120_000);
  const vigaY5 = (f: ModeloFisico) => {
    const v = f.vigas!.find((x) => x.planta === "N1" && x.puntos.every((p) => Math.abs(p[1] - 5) < 1e-9))!;
    const sc = f.secciones.find((s) => s.id === v.seccion)!;
    return sc.forma === "rectangular" ? sc.b : NaN;
  };
  /** Σ mx·b de las franjas de la dirección 2 en su estación de apoyo de la cara yf, por caso, y las franjas sin ella. */
  const sumaApoyos = (m: ReturnType<typeof preparar>, yf: number, lado: -1 | 1) => {
    const fs = m.q.franjas("L-N1");
    if (!fs.valido) throw new Error("L-N1");
    const suma = m.casos.map(() => 0);
    const sin: string[] = [];
    let n = 0;
    for (const f of fs.valor) {
      if (f.direccion !== 2) continue;
      const e = m.q.franja(f.id);
      if (!e.valido) throw new Error(f.id);
      const x = e.valor.estaciones.find((s) => s.tipo === "apoyo" && s.lado === lado && Math.abs(s.punto[1] - yf) < 1e-6);
      if (!x) {
        sin.push(f.id);
        continue;
      }
      n++;
      m.casos.forEach((_, k) => (suma[k]! += x.medios[3 * k]! * x.anchoEnLosa));
    }
    return { suma, n, sin, franjas: fs.valor.filter((f) => f.direccion === 2) };
  };
  /** El corte por la cara yf, del lado de la losa: x = +y si la losa está en y < yf (lado −1). */
  const corteCara = (m: ReturnType<typeof preparar>, yf: number, lado: -1 | 1) => {
    const z = m.c.modelo.nudos[m.c.modelo.laminas![0]!.nudos[0]]!.z;
    const r = new Cortes(m.c.modelo).cortar({ origen: [0, yf, z], x: [0, -lado, 0], vz: [0, 0, 1], y: [-1000, 1000], metodo: "fuerzas-nodales", soloLaminas: true }, m.casos);
    expect(r.valido).toBe(true);
    return m.casos.map((_, k) => r.esfuerzos[6 * k + 4]!);
  };

  it("con pilares que no cruzan las caras (30 × 30 bajo vigas de 30), en cada cara de la viga de y = 5 la suma de las franjas es el corte de la losa por la cara (lo que pasa a la viga)", () => {
    const b = vigaY5(fisico30);
    for (const lado of [-1, 1] as const) {
      const yf = 5 + (lado * b) / 2;
      const { suma, n, sin } = sumaApoyos(m30, yf, lado);
      expect(sin, `cara ${lado}`).toEqual([]);
      expect(n).toBeGreaterThan(15);
      const total = corteCara(m30, yf, lado);
      total.forEach((t, k) => expect(Math.abs(suma[k]! - t) / Math.max(1, Math.abs(t)), `cara ${lado}, caso ${k}: ${suma[k]} frente a ${t}`).toBeLessThan(1e-9));
    }
  });

  it("con pilares de 40 × 40 que cruzan las caras (LV2 §14): lo de la ventana de cada pilar es su metro (una estación de cara), la franja que apoya en él no tiene estación de apoyo, y el resto suma con los metros lo que pasa por la cara", () => {
    const b = vigaY5(fisico);
    const enViga = fisico.pilares!.filter((p) => Math.abs(p.y - 5) < 1e-9);
    expect(enViga.length).toBeGreaterThanOrEqual(3);
    // La ventana de un pilar: el ancho nominal (en un reticular, el intereje) centrado en él (F-h)
    const bN = anchoNominal(fisico.losas!.find((l) => l.id === "L-N1")!);
    const ventanas = enViga.map((p): [number, number] => [p.x - bN / 2, p.x + bN / 2]);
    for (const lado of [-1, 1] as const) {
      const yf = 5 + (lado * b) / 2;
      const { suma, sin, franjas } = sumaApoyos(m40, yf, lado);
      // Las franjas sin estación de apoyo: las que las ventanas dejan con menos de la mitad
      const fuera = (f: { t0: number; t1: number }) => ventanas.reduce((a, [v0, v1]) => a - Math.max(0, Math.min(f.t1, v1) - Math.max(f.t0, v0)), f.t1 - f.t0);
      expect(sin.sort()).toEqual(
        franjas
          .filter((f) => fuera(f) < 0.5 * (f.t1 - f.t0) - 1e-6)
          .map((f) => f.id)
          .sort(),
      );
      // El metro de cada pilar: una estación de cara en su cara (y = 5 ± 0,2) con su ventana, en la franja que lo contiene
      const sumaCaras = m40.casos.map(() => 0);
      for (const p of enViga) {
        const f = franjas.find((x) => x.t0 - 1e-9 <= p.x && p.x <= x.t1 + 1e-9)!;
        const e = m40.q.franja(f.id);
        if (!e.valido) throw new Error(f.id);
        const cara = e.valor.estaciones.filter((s) => s.tipo === "cara" && s.lado === lado && s.piezas.includes(p.id) && Math.abs(s.punto[1] - (5 + lado * 0.2)) < 1e-6);
        expect(cara, `${p.id}, cara ${lado}`).toHaveLength(1);
        expect(cara[0]!.ventana!.map((v) => Math.round(v * 1000) / 1000)).toEqual([Math.round((p.x - bN / 2) * 1000) / 1000, Math.round((p.x + bN / 2) * 1000) / 1000]);
        m40.casos.forEach((_, k) => (sumaCaras[k]! += cara[0]!.medios[3 * k]! * cara[0]!.anchoEnLosa));
      }
      // El reparto es exacto: las estaciones de apoyo suman lo que aporta cada nudo de cada lámina
      // de la cara en las franjas con estación fuera de las ventanas (la mitad del lado de la lámina de
      // cada nudo, como en `porNodales`); los metros, lo de las ventanas salvo el traslado de 5 cm a la
      // cara del pilar (My − dx·Vz)
      const z = m40.c.modelo.nudos[m40.c.modelo.laminas![0]!.nudos[0]]!.z;
      const r = new Cortes(m40.c.modelo).cortar({ origen: [0, yf, z], x: [0, -lado, 0], vz: [0, 0, 1], y: [-1000, 1000], metodo: "fuerzas-nodales", soloLaminas: true, porLamina: true }, m40.casos);
      expect(r.valido && r.porLamina !== undefined).toBe(true);
      const conApoyo = franjas.filter((f) => !sin.includes(f.id));
      const segmentos = (t0: number, t1: number): [number, number][] => {
        let seg: [number, number][] = [[t0, t1]];
        for (const [a, b] of ventanas) seg = seg.flatMap(([p, q]): [number, number][] => (b <= p + 1e-9 || a >= q - 1e-9 ? [[p, q]] : [...(a > p + 1e-9 ? [[p, a] as [number, number]] : []), ...(b < q - 1e-9 ? [[b, q] as [number, number]] : [])]));
        return seg;
      };
      const fueraVentanas = conApoyo.flatMap((f) => segmentos(f.t0, f.t1));
      const enApoyos = m40.casos.map(() => 0);
      const enVentanas = m40.casos.map(() => 0);
      for (const p of r.porLamina!) {
        // y del corte = lado·(x − 0): la x de cada nudo
        const xs = p.nudos.map((nd) => lado * nd.y);
        const [a, b] = [Math.min(...xs), Math.max(...xs)];
        const punto = !(b - a > 1e-6);
        const mid = (a + b) / 2;
        p.nudos.forEach((nd, q) => {
          const [lo, hi] = xs[q]! < mid ? [a, mid] : [mid, b];
          const aporta = (acum: number[], tramos: readonly (readonly [number, number])[]) => {
            for (const [s0, s1] of tramos) {
              // Una lámina que toca la cara en un solo nudo (sin lado sobre ella) va entera al tramo del nudo
              const f = punto ? (xs[q]! > s0 - 1e-6 && xs[q]! < s1 + 1e-6 ? 1 : 0) : Math.max(0, Math.min(hi, s1) - Math.max(lo, s0)) / (hi - lo);
              if (f > 0) m40.casos.forEach((_, k) => (acum[k]! += f * nd.esfuerzos[6 * k + 4]!));
            }
          };
          aporta(enApoyos, fueraVentanas);
          aporta(enVentanas, ventanas);
        });
      }
      m40.casos.forEach((_, k) => {
        expect(Math.abs(suma[k]! - enApoyos[k]!) / Math.max(1, Math.abs(enApoyos[k]!)), `cara ${lado}, caso ${k}: apoyos ${suma[k]} frente a ${enApoyos[k]}`).toBeLessThan(1e-9);
        expect(Math.abs(sumaCaras[k]! - enVentanas[k]!) / Math.max(1, Math.abs(enVentanas[k]!)), `cara ${lado}, caso ${k}: metros ${sumaCaras[k]} frente a ${enVentanas[k]}`).toBeLessThan(0.2);
      });
    }
  });
});
