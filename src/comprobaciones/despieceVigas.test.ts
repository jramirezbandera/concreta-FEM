/**
 * CO6 (`docs/fem3d/comprobaciones.md` §8.13): el despiece de las vigas de un pórtico. Sobre un
 * pórtico escrito a mano (dos vanos y un voladizo), cada regla con sus números: la inferior con su
 * anclaje y su patilla, la corrida que pasa o se corta a los 12 m, las barras de los apoyos (lo común
 * pasa, lo de más se ancla), los cercos contados y la medición. Y, con armados al azar, lo que no
 * puede fallar: en cada zona hay al menos el acero que dice su armado.
 */
import { describe, expect, it } from "vitest";
import type { ArmadoVanoViga } from "./armado.ts";
import { alzadoVano } from "./dibujoArmado.ts";
import { BARRA_MAXIMA, desarrolloCerco, despiecePortico, filasBarras, pesoBarra, type BarraDespiece, type DatosDespiece } from "./despieceVigas.ts";
import type { Portico, VanoPortico } from "./porticos.ts";

const G = { b: 300, h: 500, fck: 25 };
const vano = (clave: string, desde: number, hasta: number, apoyos: [number | null, number | null], invertida = false): VanoPortico => ({ clave, viga: clave.split("/")[0]!, vano: Number(clave.split("/")[1]), invertida, desde, hasta, apoyos, seccion: "v", geometria: G });
/** Pilares de 40 en x = 0, 6 y 11; dos vanos y un voladizo hasta 12,5. */
const PORTICO: Portico = {
  id: "V1",
  planta: "F1",
  nombre: "P1 – P2 – P3",
  vigas: [{ id: "V1", invertida: false, x: [0, 12.5] }],
  apoyos: [
    { objeto: "P1", tipo: "pilar", eje: 0, caras: [-0.2, 0.2] },
    { objeto: "P2", tipo: "pilar", eje: 6, caras: [5.8, 6.2] },
    { objeto: "P3", tipo: "pilar", eje: 11, caras: [10.8, 11.2] },
  ],
  vanos: [vano("V1/0", 0.2, 5.8, [0, 1]), vano("V1/1", 6.2, 10.8, [1, 2]), vano("V1/2", 11.2, 12.5, [2, null])],
  x: [-0.2, 12.5],
  quiebros: [],
};
/** Anclajes redondos, para hacer las cuentas a mano: [buena adherencia, cara superior], m. */
const LB: Record<number, [number, number]> = { 8: [0.3, 0.45], 12: [0.5, 0.7], 16: [0.65, 0.95], 20: [0.8, 1.15] };
const DATOS: DatosDespiece = { recubrimiento: 30, cotTheta: 2, anclajes: { "V1/0": LB, "V1/1": LB, "V1/2": LB } };
const CERCOS = { diametro: 8, separacion: 200 };
const base = (inferior: [number, number], superior: [number, number]): ArmadoVanoViga => ({ inferior: { n: inferior[0], diametro: inferior[1] }, superior: { n: superior[0], diametro: superior[1] }, cercos: CERCOS });
const cerca = (a: number, b: number) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(1e-9);
const tramo = (b: BarraDespiece, x0: number, x1: number, patillas: [number, number] = [0, 0]) => {
  cerca(b.x[0], x0);
  cerca(b.x[1], x1);
  cerca(b.patillas[0], patillas[0]);
  cerca(b.patillas[1], patillas[1]);
};

describe("CO6: el despiece de las vigas de un pórtico", () => {
  it("la inferior, por vano: de cara a cara más su anclaje; en el apoyo extremo, hasta el recubrimiento y con patilla; en el voladizo, hasta la punta", () => {
    const d = despiecePortico(PORTICO, { "V1/0": base([3, 16], [2, 12]), "V1/2": base([2, 12], [2, 12]) }, DATOS);
    const inf = d.barras.filter((b) => b.cara === "inferior");
    expect(inf.map((b) => [b.n, b.diametro, b.origen])).toEqual([
      [3, 16, [{ clave: "V1/0", ruta: "inferior" }]],
      [2, 12, [{ clave: "V1/2", ruta: "inferior" }]],
    ]);
    // P1 es extremo: caben 0,40 − 0,03 = 0,37 m rectos de los 0,65: patilla, la mayor de 0,7·0,65 − 0,37 y 10 Ø, a 5 cm. En P2, recta 0,65 más allá de su cara
    tramo(inf[0]!, 0.2 - 0.37, 5.8 + 0.65, [0.2, 0]);
    expect(inf[0]!.largo).toBe(6.82);
    // El voladizo: 0,50 dentro de P3 (hay vano al otro lado) y hasta el recubrimiento de la punta
    tramo(inf[1]!, 11.2 - 0.5, 12.5 - 0.03);
    expect(d.avisos).toEqual([]);
    // Las marcas, seguidas: la inferior, la corrida, las de los apoyos
    expect(d.barras.map((b) => b.marca)).toEqual(d.barras.map((_, i) => i + 1));
    expect(d.barras.map((b) => b.papel)).toEqual(["vano", "vano", "corrida", "corrida"]);
  });

  it("la corrida pasa de un vano a otro si es la misma, hasta los 12 m; si no, se ancla más allá de la cara", () => {
    const a = base([2, 12], [2, 12]);
    const d = despiecePortico(PORTICO, { "V1/0": a, "V1/1": a, "V1/2": a }, DATOS);
    const sup = d.barras.filter((b) => b.papel === "corrida");
    expect(sup).toHaveLength(2);
    // Los dos primeros vanos, una barra (11,67 m con su anclaje); con el voladizo pasaría de 12 m
    tramo(sup[0]!, -0.17, 10.8 + 0.7, [0.15, 0]);
    expect(sup[0]!.origen.map((o) => o.clave)).toEqual(["V1/0", "V1/1"]);
    tramo(sup[1]!, 11.2 - 0.7, 12.47);
    expect(sup.every((b) => b.largo <= BARRA_MAXIMA)).toBe(true);
    // Otra corrida en el segundo vano: cada una se ancla más allá de la cara de P2
    const otra = despiecePortico(PORTICO, { "V1/0": a, "V1/1": base([2, 12], [3, 12]) }, DATOS).barras.filter((b) => b.papel === "corrida");
    tramo(otra[0]!, -0.17, 5.8 + 0.7, [0.15, 0]);
    tramo(otra[1]!, 6.2 - 0.7, 10.8 + 0.7);
    expect(otra.map((b) => b.n)).toEqual([2, 3]);
  });

  it("las zonas de los apoyos: del mismo Ø, lo que tienen de más sobre la corrida; de otro, toda, y la corrida es el montaje del centro", () => {
    const d = despiecePortico(
      PORTICO,
      {
        "V1/0": { ...base([3, 16], [2, 12]), superiorFin: { n: 4, diametro: 12 } },
        "V1/1": { ...base([3, 16], [2, 12]), superiorInicio: { n: 4, diametro: 16 } },
        "V1/2": base([2, 12], [2, 12]),
      },
      DATOS,
    );
    const corridas = d.barras.filter((b) => b.papel === "corrida");
    const apoyos = d.barras.filter((b) => b.papel === "apoyo");
    // La del primer vano llega a P2 y se ancla; la del segundo empieza un anclaje antes del fin de la zona (6,2 + 4,6/4) y sigue por el voladizo
    tramo(corridas[0]!, -0.17, 5.8 + 0.7, [0.15, 0]);
    tramo(corridas[1]!, 6.2 + 1.15 - 0.7, 12.47);
    expect(corridas[1]!.origen.map((o) => o.clave)).toEqual(["V1/1", "V1/2"]);
    // A la izquierda de P2, 4Ø12 − 2Ø12 = 2Ø12: la zona (5,6/4) más el decalaje (0,9·d·cot θ/2, d = 500 − 30 − 8 − 6) y el anclaje, a 5 cm
    expect(apoyos.map((b) => [b.n, b.diametro, b.origen[0]!.ruta])).toEqual([
      [2, 12, "superiorFin"],
      [4, 16, "superiorInicio"],
    ]);
    const de12 = Math.ceil((0.9 * 0.456 + 0.7) / 0.05 - 1e-9) * 0.05;
    tramo(apoyos[0]!, 5.8 - 1.4 - de12, 5.8 + 0.7);
    const de16 = Math.ceil((0.9 * 0.454 + 0.95) / 0.05 - 1e-9) * 0.05;
    tramo(apoyos[1]!, 6.2 - 0.95, 6.2 + 1.15 + de16);
    // Para acotarlas: el eje del apoyo que tienen dentro (el de P2, en x = 6)
    expect(apoyos.map((b) => b.ejes)).toEqual([[6], [6]]);
    expect(corridas[1]!.ejes).toEqual([11]);
  });

  it("sobre un apoyo con el mismo Ø a los dos lados: lo común pasa de un vano a otro y lo que un lado tiene de más se ancla más allá de su cara", () => {
    const d = despiecePortico(
      PORTICO,
      {
        "V1/0": { ...base([3, 16], [2, 16]), superiorFin: { n: 5, diametro: 16 } },
        "V1/1": { ...base([3, 16], [2, 16]), superiorInicio: { n: 3, diametro: 16 } },
      },
      DATOS,
    );
    const apoyos = d.barras.filter((b) => b.papel === "apoyo");
    const de = Math.ceil((0.9 * 0.454 + 0.95) / 0.05 - 1e-9) * 0.05;
    expect(apoyos.map((b) => b.n)).toEqual([1, 2]);
    // 1Ø16 común (3 − 2 y 5 − 2): de un vano a otro; los 2Ø16 de más del primero, hasta 0,95 más allá de su cara
    tramo(apoyos[0]!, 5.8 - 1.4 - de, 6.2 + 1.15 + de);
    expect(apoyos[0]!.origen).toEqual([
      { clave: "V1/0", ruta: "superiorFin" },
      { clave: "V1/1", ruta: "superiorInicio" },
    ]);
    tramo(apoyos[1]!, 5.8 - 1.4 - de, 5.8 + 0.95);
    // Las dos hacen falta en la zona del primer vano: no se unen aunque sean iguales
    const iguales = despiecePortico(PORTICO, { "V1/0": { ...base([3, 16], [2, 16]), superiorFin: { n: 6, diametro: 16 } }, "V1/1": { ...base([3, 16], [2, 16]), superiorInicio: { n: 4, diametro: 16 } } }, DATOS).barras.filter((b) => b.papel === "apoyo");
    expect(iguales.map((b) => b.n)).toEqual([2, 2]);
    // La corrida, 2Ø16 en los dos vanos: de una pieza mediría 12,22 m con su patilla, así que son dos
    expect(d.barras.filter((b) => b.papel === "corrida").map((b) => b.largo)).toEqual([7.22, 6.5]);
  });

  it("una viga invertida: lo de su inicio queda a la derecha, con el campo del que sale", () => {
    const p: Portico = { ...PORTICO, vanos: [vano("V1/0", 0.2, 5.8, [0, 1], true)] };
    const a: ArmadoVanoViga = { ...base([3, 16], [2, 12]), superiorInicio: { n: 4, diametro: 12 }, cercosInicio: { diametro: 8, separacion: 100 } };
    const d = despiecePortico(p, { "V1/0": a }, DATOS);
    const ap = d.barras.find((b) => b.papel === "apoyo")!;
    expect(ap.origen).toEqual([{ clave: "V1/0", ruta: "superiorInicio" }]);
    // En P2 (ahora extremo: no hay más vanos), con patilla
    expect(ap.x[1]).toBeGreaterThan(5.8);
    expect(ap.patillas[1]).toBeGreaterThan(0);
    // Los cercos del inicio, a la derecha: los de 100 acaban a 5 cm de la cara de P2
    const c = d.cercos;
    expect(c.map((x) => x.origen[0]!.ruta)).toEqual(["cercos", "cercosInicio"]);
    cerca(c[1]!.x[1], 5.8 - 0.05);
    const al = alzadoVano(5.6, a);
    expect(c[1]!.n).toBe(al.zonas[0].posiciones.length);
    expect(c[0]!.n).toBe(al.zonas[1].posiciones.length + al.zonas[2].posiciones.length);
  });

  it("los cercos, contados por tramos del mismo cerco, y la medición: el acero es el de las barras y los cercos", () => {
    const a: ArmadoVanoViga = { ...base([3, 16], [2, 12]), cercosInicio: { diametro: 8, separacion: 100 }, cercosFin: { diametro: 8, separacion: 100, ramas: 4 } };
    const d = despiecePortico(PORTICO, { "V1/0": a, "V1/1": base([2, 16], [2, 12]) }, DATOS);
    const al = alzadoVano(5.6, a);
    expect(d.cercos.map((c) => [c.n, c.cercos.separacion, c.origen[0]])).toEqual([
      [al.zonas[0].posiciones.length, 100, { clave: "V1/0", ruta: "cercosInicio" }],
      [al.zonas[1].posiciones.length, 200, { clave: "V1/0", ruta: "cercos" }],
      [al.zonas[2].posiciones.length, 100, { clave: "V1/0", ruta: "cercosFin" }],
      [alzadoVano(4.6, base([2, 16], [2, 12])).zonas.reduce((t, z) => t + z.posiciones.length, 0), 200, { clave: "V1/1", ruta: "cercos" }],
    ]);
    // El primero, a 5 cm de la cara; el último del vano, a 5 cm de la otra como mucho una separación antes
    cerca(d.cercos[0]!.x[0], 0.2 + 0.05);
    expect(d.cercos[2]!.x[1]).toBeLessThanOrEqual(5.8 - 0.05 + 1e-9);
    // El desarrollo: el cerco de 2 ramas, 2·(232 + 432) + 2·80 mm; con 4 ramas, otro de un tercio del ancho
    cerca(desarrolloCerco(G, CERCOS, 30), (2 * (232 + 432) + 160) / 1000);
    cerca(desarrolloCerco(G, { ...CERCOS, ramas: 4 }, 30), (2 * (232 + 432) + 160 + 2 * (232 / 3 + 432) + 160) / 1000);
    cerca(desarrolloCerco(G, { ...CERCOS, ramas: 3 }, 30), (2 * (232 + 432) + 160 + 432 + 160) / 1000);
    // La medición: una fila por barra y por tramo de cercos; el peso, 7 850 kg/m³
    cerca(pesoBarra(16), 7850 * Math.PI * 0.008 ** 2);
    expect(d.medicion).toHaveLength(d.barras.length + d.cercos.length);
    const kg = [...d.barras.map((b) => b.n * b.largo * pesoBarra(b.diametro)), ...d.cercos.map((c) => c.n * c.largo * pesoBarra(c.cercos.diametro))].reduce((t, x) => t + x, 0);
    expect(Math.abs(d.acero.total - kg)).toBeLessThan(1e-9);
    expect(d.acero.porDiametro.map((x) => x.diametro)).toEqual([8, 12, 16]);
    expect(Math.abs(d.acero.porDiametro.reduce((t, x) => t + x.kg, 0) - kg)).toBeLessThan(1e-9);
  });

  it("dos barras de apoyo iguales que se pisan en un vano corto son una; una patilla que no cabe en el canto se avisa", () => {
    // Un vano de 2,4 m: las zonas de sus dos apoyos, con el decalaje y el anclaje, se pisan
    const p: Portico = { ...PORTICO, apoyos: [PORTICO.apoyos[0]!, { objeto: "P2", tipo: "pilar", eje: 2.8, caras: [2.6, 3] }], vanos: [vano("V1/0", 0.2, 2.6, [0, 1])] };
    const a: ArmadoVanoViga = { ...base([2, 12], [2, 12]), superiorInicio: { n: 4, diametro: 12 }, superiorFin: { n: 4, diametro: 12 } };
    const d = despiecePortico(p, { "V1/0": a }, { ...DATOS, anclajes: { "V1/0": LB } });
    const ap = d.barras.filter((b) => b.papel === "apoyo");
    expect(ap).toHaveLength(1);
    expect(ap[0]!.n).toBe(2);
    expect(ap[0]!.origen.map((o) => o.ruta)).toEqual(["superiorInicio", "superiorFin"]);
    expect(ap[0]!.patillas.every((x) => x > 0)).toBe(true);
    // Un canto de 20 cm con Ø20 en un apoyo de 25: la patilla (0,7·1,15 − 0,22 → 0,60) no cabe en 14 cm
    const plana: Portico = { ...p, apoyos: [{ objeto: "P1", tipo: "pilar", eje: 0, caras: [-0.05, 0.2] }, p.apoyos[1]!], vanos: [{ ...p.vanos[0]!, geometria: { b: 300, h: 200, fck: 25 } }] };
    const av = despiecePortico(plana, { "V1/0": base([2, 12], [2, 20]) }, { ...DATOS, anclajes: { "V1/0": LB } }).avisos;
    expect(av.some((x) => /Ø20 de V1\/0 no cabe en P1: pide una patilla de 60 cm/.test(x))).toBe(true);
  });

  it("un armado a medias (lo que se está escribiendo) no rompe nada: se dibuja lo que vale", () => {
    const d = despiecePortico(PORTICO, { "V1/0": { inferior: { n: 3, diametro: 16 }, superior: { n: 0, diametro: 12 } as never, cercos: { diametro: 8 } as never }, "V1/1": null, "V1/2": undefined }, DATOS);
    expect(d.barras.map((b) => b.cara)).toEqual(["inferior"]);
    expect(d.cercos).toEqual([]);
    expect(despiecePortico(PORTICO, {}, DATOS)).toMatchObject({ barras: [], cercos: [], medicion: [], avisos: [] });
  });

  it("las filas del dibujo: en una fila ninguna barra pisa a otra (ni a su rótulo), y la corrida va en la más cercana a la viga", () => {
    const d = despiecePortico(
      PORTICO,
      {
        "V1/0": { ...base([3, 16], [2, 12]), superiorFin: { n: 4, diametro: 12 } },
        "V1/1": { ...base([3, 16], [2, 12]), superiorInicio: { n: 4, diametro: 16 }, superiorFin: { n: 3, diametro: 16 }, piel: { n: 1, diametro: 12 } },
        "V1/2": { ...base([2, 12], [2, 12]), superiorInicio: { n: 3, diametro: 16 } },
      },
      DATOS,
    );
    for (const ancho of [0, 2.5]) {
      const filas = filasBarras(d.barras, ancho);
      expect(filas.size).toBe(d.barras.length);
      const ocupa = (b: BarraDespiece) => {
        const medio = Math.max((b.x[1] - b.x[0]) / 2, ancho / 2);
        return [(b.x[0] + b.x[1]) / 2 - medio, (b.x[0] + b.x[1]) / 2 + medio] as const;
      };
      for (const a of d.barras)
        for (const b of d.barras) {
          if (a.marca >= b.marca || a.cara !== b.cara || filas.get(a.marca) !== filas.get(b.marca)) continue;
          const [oa, ob] = [ocupa(a), ocupa(b)];
          expect(oa[1] <= ob[0] + 1e-9 || ob[1] <= oa[0] + 1e-9, `${a.marca} y ${b.marca}`).toBe(true);
        }
      expect(d.barras.filter((b) => b.papel === "corrida").some((b) => filas.get(b.marca) === 0)).toBe(true);
    }
    // La de piel: las dos caras
    expect(d.barras.find((b) => b.cara === "piel")!.n).toBe(2);
  });

  it("con armados al azar: en cada zona hay al menos el acero de su armado, la inferior cubre el vano entero y nada sale del pórtico", () => {
    let semilla = 12345;
    const azar = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
    const de = <T>(xs: readonly T[]): T => xs[Math.floor(azar() * xs.length)]!;
    const barras = () => ({ n: de([2, 3, 4, 5]), diametro: de([12, 16, 20]) });
    const area = (b: { n: number; diametro: number }) => (b.n * Math.PI * b.diametro ** 2) / 4;
    for (let caso = 0; caso < 300; caso++) {
      const inv = PORTICO.vanos.map(() => azar() < 0.3);
      const p: Portico = { ...PORTICO, vanos: PORTICO.vanos.map((v, i) => ({ ...v, invertida: inv[i]! })) };
      const armados: Record<string, ArmadoVanoViga> = {};
      for (const v of p.vanos) armados[v.clave] = { inferior: barras(), superior: barras(), cercos: CERCOS, ...(azar() < 0.6 ? { superiorInicio: barras() } : {}), ...(azar() < 0.6 ? { superiorFin: barras() } : {}) };
      const d = despiecePortico(p, armados, DATOS);
      const enX = (cara: "inferior" | "superior", x: number) => d.barras.filter((b) => b.cara === cara && b.x[0] <= x + 1e-9 && b.x[1] >= x - 1e-9).reduce((t, b) => t + area(b), 0);
      for (const v of p.vanos) {
        const a = armados[v.clave]!;
        const L = v.hasta - v.desde;
        const [izq, der] = v.invertida ? [a.superiorFin, a.superiorInicio] : [a.superiorInicio, a.superiorFin];
        const zonas: [number, number, { n: number; diametro: number }][] = [
          [v.desde, v.desde + L / 4, izq ?? a.superior],
          [v.desde + L / 4, v.hasta - L / 4, a.superior],
          [v.hasta - L / 4, v.hasta, der ?? a.superior],
        ];
        // Un extremo libre: la barra acaba en su recubrimiento
        const [x0, x1] = [v.apoyos[0] === null ? v.desde + 0.03 : v.desde, v.apoyos[1] === null ? v.hasta - 0.03 : v.hasta];
        for (const [z0, z1, b] of zonas) for (const x of [Math.max(z0, x0), (z0 + z1) / 2, Math.min(z1, x1)]) expect(enX("superior", x), `caso ${caso}, ${v.clave}, superior en ${x}`).toBeGreaterThanOrEqual(area(b) - 1e-6);
        for (const x of [x0, (x0 + x1) / 2, x1]) expect(enX("inferior", x), `caso ${caso}, ${v.clave}, inferior en ${x}`).toBeGreaterThanOrEqual(area(a.inferior) - 1e-6);
      }
      for (const b of d.barras) {
        expect(b.x[0]).toBeGreaterThanOrEqual(p.x[0] - 1e-9);
        expect(b.x[1]).toBeLessThanOrEqual(p.x[1] + 1e-9);
        expect(b.x[1]).toBeGreaterThan(b.x[0]);
        expect(b.largo).toBeLessThanOrEqual(BARRA_MAXIMA + 1e-9);
      }
      // El mismo despiece otra vez: no depende de nada más
      expect(despiecePortico(p, armados, DATOS)).toEqual(d);
    }
  });
});
