/**
 * `Recientes` y lo que guarda sólo de las últimas barras (`EsfuerzosPiezas`, `DiagramasBarras`): con
 * un tope de una o dos barras, pidiendo los diagramas caso a caso por todo el modelo (lo peor: se
 * rehace casi todo), salen los mismos números, bit a bit, que guardándolo todo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { compilar } from "../compilador/compilar.ts";
import type { ModeloFisico } from "../compilador/fisico.ts";
import { EsfuerzosPiezas } from "../compilador/resultados.ts";
import { Consultas } from "../compilador/consultas.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { valido } from "../pruebas/metamorficasFisicas.ts";
import { calcular } from "./calcular.ts";
import { Recientes } from "./recientes.ts";

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("Recientes", () => {
  it("guarda las últimas claves pedidas; sale la que lleva más tiempo sin pedirse", () => {
    const r = new Recientes<number, string | null>(3);
    r.set(1, "a");
    r.set(2, null);
    r.set(3, "c");
    expect(r.get(1)).toBe("a"); // 1 pasa a ser la más reciente
    r.set(4, "d"); // sale 2
    expect(r.has(2)).toBe(false);
    expect(r.get(2)).toBeUndefined();
    expect([r.get(3), r.get(1), r.get(4)]).toEqual(["c", "a", "d"]);
    r.set(5, "e"); // sale 3
    expect(r.has(3)).toBe(false);
    expect(r.size).toBe(3);
    // null es un valor guardado
    r.set(6, null);
    expect(r.has(6)).toBe(true);
    expect(r.get(6)).toBeNull();
    r.clear();
    expect(r.size).toBe(0);
  });
});

/** Dos recuadros con vigas en los bordes y en el eje común, losa, cargas de superficie, de viga y una puntual. */
const MODELO: ModeloFisico = {
  plantas: [
    { id: "P1", altura: null },
    { id: "P0", altura: 3 },
  ],
  materiales: [{ id: "H", tipo: "hormigon", fck: 25 }],
  secciones: [
    { id: "p", material: "H", forma: "rectangular", b: 0.3, h: 0.3 },
    { id: "v", material: "H", forma: "rectangular", b: 0.3, h: 0.5 },
  ],
  pilares: [
    [0, 0],
    [6, 0],
    [12, 0],
    [0, 5],
    [6, 5],
    [12, 5],
  ].map(([x, y], k) => ({ id: `C${k + 1}`, x: x!, y: y!, desde: "P0", hasta: "P1", seccion: "p" })),
  vigas: [
    { id: "VA", planta: "P1", puntos: [[0, 0], [12, 0]], seccion: "v" },
    { id: "VB", planta: "P1", puntos: [[0, 5], [12, 5]], seccion: "v" },
    { id: "V1", planta: "P1", puntos: [[0, 0], [0, 5]], seccion: "v" },
    { id: "V2", planta: "P1", puntos: [[6, 0], [6, 5]], seccion: "v" },
    { id: "V3", planta: "P1", puntos: [[12, 0], [12, 5]], seccion: "v" },
  ],
  losas: [{ id: "L", planta: "P1", material: "H", espesor: 0.2, contorno: [[0, 0], [12, 0], [12, 5], [0, 5]] }],
  casos: [{ id: "G", pesoPropio: true }, { id: "CM" }, { id: "Q" }],
  cargas: [
    { tipo: "superficie", id: "cm", caso: "CM", planta: "P1", losa: "L", q: [0, 0, -2] },
    { tipo: "superficie", id: "q", caso: "Q", planta: "P1", losa: "L", q: [0, 0, -3] },
    { tipo: "viga", id: "pv", caso: "CM", viga: "VA", q: [0, 0, -4], ejes: "global" },
    { tipo: "puntual", id: "pq", caso: "Q", planta: "P1", x: 3.3, y: 1.6, F: [0, 0, -20] },
  ],
};

describe("los campos de los casos del cálculo, sólo de la planta en la que se trabaja", () => {
  it("sin el sismo del programa, las franjas de otra planta sueltan lo de la anterior, y volver da los mismos bits", () => {
    // Dos plantas con su losa: la de arriba y una igual debajo
    const f: ModeloFisico = {
      ...MODELO,
      plantas: [{ id: "P2", altura: null }, { id: "P1", altura: 3 }, { id: "P0", altura: 3 }],
      pilares: MODELO.pilares!.map((p) => ({ ...p, hasta: "P2" })),
      vigas: [...MODELO.vigas!, ...MODELO.vigas!.map((v) => ({ ...v, id: `${v.id}2`, planta: "P2" }))],
      losas: [...MODELO.losas!, { ...MODELO.losas![0]!, id: "L2", planta: "P2" }],
      cargas: [...MODELO.cargas!, { tipo: "superficie", id: "q2", caso: "Q", planta: "P2", losa: "L2", q: [0, 0, -3] }],
    };
    const r = valido(compilar(f));
    const casos = casosValidos(calcular(r.modelo));
    const q = new Consultas(f, r, casos);
    const ef = q.efimeros;
    expect(ef.cuales).toEqual([]);
    expect(ef.porPlanta).toEqual(casos.map((_, k) => k));
    // La primera franja de una dirección (las de una dirección se hacen todas a la vez)
    const franja = (x: Consultas, l: string, direccion: 1 | 2) => {
      const fs = x.franjas(l);
      if (!fs.valido) throw new Error("sin franjas");
      const e = x.franja(fs.valor.find((y) => y.direccion === direccion)!.id);
      if (!e.valido) throw new Error("sin franja");
      return JSON.stringify(e.valor, (_k, v) => (v instanceof Float64Array ? Array.from(v) : v));
    };
    // La primera franja de L deja los evaluadores de L; las de L2 los sueltan
    franja(q, "L", 1);
    const u = casos[0]!.u;
    expect(q.campos.tieneEvaluador(u)).toBe(true);
    franja(q, "L2", 1);
    expect(ef.soltadosPorPlanta).toBe(1);
    // Las de la otra dirección de L, con sus evaluadores rehechos: las de unas consultas que sólo han estado en L
    const rehecha = franja(q, "L", 2);
    expect(ef.soltadosPorPlanta).toBe(2);
    const solo = new Consultas(f, r, casos);
    franja(solo, "L", 1);
    expect(rehecha).toBe(franja(solo, "L", 2));
    expect(solo.efimeros.soltadosPorPlanta).toBe(0);
  });
});

describe("lo que se guarda sólo de las últimas barras", () => {
  it("con un tope de una o dos barras, los diagramas pedidos caso a caso por todo el modelo son los mismos, bit a bit", () => {
    const r = valido(compilar(MODELO));
    const casos = casosValidos(calcular(r.modelo));
    const nb = r.modelo.barras!.length;
    expect(nb).toBeGreaterThan(20);
    const muestras = (ep: EsfuerzosPiezas, b: number, k: number) => {
      const d = ep.diagrama(b, k);
      return [0, 0.37, 0.5, 1].flatMap((t) => [...d.esfuerzosEn(t * d.L, t === 0 ? 1 : -1), ...d.desplazamientosEn(t * d.L)]).concat([...ep.extremos(b, k)]);
    };
    // Guardándolo todo (el tope por encima de las barras), barra a barra
    const todo = new EsfuerzosPiezas(r.modelo, r.mapeo, casos, { barrasGuardadas: 10 * nb, barrasConCargas: 10 * nb });
    const esperado = new Map<string, number[]>();
    for (let b = 0; b < nb; b++) for (let k = 0; k < casos.length; k++) esperado.set(`${b}/${k}`, muestras(todo, b, k));
    for (const tope of [1, 2]) {
      const poco = new EsfuerzosPiezas(r.modelo, r.mapeo, casos, { barrasGuardadas: tope, barrasConCargas: tope });
      // Caso a caso, por todas las barras, dos veces (lo segundo, rehecho)
      for (let vuelta = 0; vuelta < 2; vuelta++)
        for (let k = 0; k < casos.length; k++)
          for (let b = nb - 1; b >= 0; b--) {
            const x = muestras(poco, b, k);
            const e = esperado.get(`${b}/${k}`)!;
            for (let i = 0; i < e.length; i++) if (!Object.is(x[i], e[i])) expect([b, k, i, x[i]], `tope ${tope}`).toEqual([b, k, i, e[i]]);
          }
    }
  });
});
