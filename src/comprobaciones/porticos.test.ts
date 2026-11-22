/**
 * CO6 (`docs/fem3d/comprobaciones.md` §8.13): los pórticos. Con el pórtico de las pruebas de las
 * vigas (pilares de 40 en x = 0, 6 y 11; vigas según X de dos vanos y un voladizo, y según Y de un
 * vano): cada viga está en un pórtico, con sus apoyos y sus vanos donde los da `Consultas.viga`. Y la
 * misma viga dibujada en tres trozos, uno al revés, da el mismo pórtico.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { porticoVigas } from "../../validacion/co/modelosVigas.ts";
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import type { CargaFisica, ModeloFisico, Viga } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { datosDespiece, porticoDe, porticosDe } from "./porticos.ts";

function consultas(f: ModeloFisico): Consultas {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error("no calcula");
  return new Consultas(f, c, r.casos, {}, r.modal);
}

/** La viga `id` (de x = 0 a 12,5 en y = 0), en tres: de P1 a P3, de P5 a P3 (al revés) y el voladizo. */
function partida(f: ModeloFisico, id: string, girado = false): ModeloFisico {
  const p = (x: number, y: number): [number, number] => (girado ? [-y, x] : [x, y]);
  const v = f.vigas!.find((x) => x.id === id)!;
  const trozos: Viga[] = [
    { ...v, id: `${id}a`, puntos: [p(0, 0), p(6, 0)] },
    { ...v, id: `${id}b`, puntos: [p(11, 0), p(6, 0)] },
    { ...v, id: `${id}c`, puntos: [p(11, 0), p(12.5, 0)] },
  ];
  const cargas = (f.cargas ?? []).flatMap((c): CargaFisica[] => (c.tipo === "viga" && c.viga === id ? trozos.map((t) => ({ ...c, id: `${c.id}-${t.id}`, viga: t.id })) : [c]));
  return { ...f, vigas: f.vigas!.flatMap((x) => (x.id === id ? trozos : [x])), cargas };
}

const cerca = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThan(tol);

beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm")));
});

describe("CO6: los pórticos de las vigas", () => {
  it("cada viga está en un pórtico y sólo en uno, con sus apoyos y sus vanos de izquierda a derecha (o de abajo arriba)", () => {
    const f = porticoVigas({ sinViento: true });
    const q = consultas(f);
    const ps = porticosDe(q);
    expect(ps.flatMap((p) => p.vigas.map((v) => v.id)).sort()).toEqual(f.vigas!.map((v) => v.id).sort());
    expect(porticosDe(q)).toBe(ps);
    const px = porticoDe(q, "F1-X0")!;
    expect(px).toMatchObject({ id: "F1-X0", planta: "F1", nombre: "P1 – P3 – P5", quiebros: [] });
    expect(px.apoyos.map((a) => [a.objeto, a.tipo])).toEqual([
      ["P1", "pilar"],
      ["P3", "pilar"],
      ["P5", "pilar"],
    ]);
    [0, 6, 11].forEach((x, i) => {
      cerca(px.apoyos[i]!.eje, x);
      cerca(px.apoyos[i]!.caras[0], x - 0.2);
      cerca(px.apoyos[i]!.caras[1], x + 0.2);
    });
    expect(px.vanos.map((v) => [v.clave, v.invertida, v.apoyos])).toEqual([
      ["F1-X0/0", false, [0, 1]],
      ["F1-X0/1", false, [1, 2]],
      ["F1-X0/2", false, [2, null]],
    ]);
    // Los vanos, los de `Consultas.viga`: entre las caras de los pilares, y el voladizo hasta la punta
    const de = q.viga("F1-X0");
    if (!de.valido) throw new Error("sin vanos");
    px.vanos.forEach((v, i) => {
      cerca(v.desde, de.valor.vanos[i]!.desde);
      cerca(v.hasta, de.valor.vanos[i]!.hasta);
      expect(v.geometria).toEqual({ b: 300, h: 500, fck: 25 });
    });
    cerca(px.x[0], -0.2);
    cerca(px.x[1], 12.5);
    // Una según Y: de abajo arriba
    const py = porticoDe(q, "F1-Y1")!;
    expect(py.nombre).toBe("P3 – P4");
    expect(py.vanos).toHaveLength(1);
    cerca(py.vanos[0]!.desde, 0.2);
    cerca(py.vanos[0]!.hasta, 4.8);
    expect(porticoDe(q, "no-existe")).toBeNull();
  });

  it("la misma alineación dibujada en tres vigas, una al revés, es el mismo pórtico; girada 90°, también", () => {
    const entero = porticoDe(consultas(porticoVigas({ sinViento: true })), "F1-X0")!;
    for (const girado of [false, true]) {
      const q = consultas(partida(porticoVigas({ sinViento: true, girado }), "F1-X0", girado));
      const p = porticoDe(q, "F1-X0b")!;
      expect(p.id).toBe("F1-X0a+F1-X0b+F1-X0c");
      expect(porticoDe(q, "F1-X0a")).toBe(p);
      expect(p.vigas.map((v) => v.invertida)).toEqual([false, true, false]);
      expect(p.nombre).toBe(entero.nombre);
      expect(p.apoyos.map((a) => a.objeto)).toEqual(entero.apoyos.map((a) => a.objeto));
      p.apoyos.forEach((a, i) => {
        cerca(a.eje, entero.apoyos[i]!.eje, 1e-9);
        cerca(a.caras[0], entero.apoyos[i]!.caras[0], 1e-9);
        cerca(a.caras[1], entero.apoyos[i]!.caras[1], 1e-9);
      });
      expect(p.vanos.map((v) => [v.clave, v.invertida, v.apoyos])).toEqual([
        ["F1-X0a/0", false, [0, 1]],
        ["F1-X0b/0", true, [1, 2]],
        ["F1-X0c/0", false, [2, null]],
      ]);
      p.vanos.forEach((v, i) => {
        cerca(v.desde, entero.vanos[i]!.desde, 1e-9);
        cerca(v.hasta, entero.vanos[i]!.hasta, 1e-9);
      });
      // Las que cruzan no se encadenan: siguen siendo pórticos de un vano
      expect(porticoDe(q, "F1-Y1")!.vigas).toHaveLength(1);
    }
  });

  it("los anclajes del despiece: el básico a fyd de cada diámetro, con la cara superior de un canto de más de 25 cm en adherencia deficiente", () => {
    const q = consultas(porticoVigas({ sinViento: true }));
    const p = porticoDe(q, "F1-X0")!;
    const d = datosDespiece(p);
    expect(d).toMatchObject({ recubrimiento: 30, cotTheta: 2 });
    expect(Object.keys(d.anclajes)).toEqual(p.vanos.map((v) => v.clave));
    // HA-25 y B500: fbd = 2,25·(0,7·fctm/1,5) con fctm = 0,3·25^(2/3); lb = Ø/4·fyd/fbd (≈ 40 Ø), y arriba, entre 0,7
    const fbd = 2.25 * ((0.7 * 0.3 * 25 ** (2 / 3)) / 1.5);
    for (const o of [12, 16, 25]) {
      const [inf, sup] = d.anclajes["F1-X0/0"]![o]!;
      expect(Math.abs(inf - ((o / 4) * (500 / 1.15)) / fbd / 1000) / inf).toBeLessThan(0.01);
      cerca(sup, inf / 0.7, 1e-9);
    }
    expect(datosDespiece(p, { recubrimiento: 35, fyk: 400 }).recubrimiento).toBe(35);
    expect(datosDespiece(p, { fyk: 400 }).anclajes["F1-X0/0"]![16]![0]).toBeLessThan(d.anclajes["F1-X0/0"]![16]![0]);
  });
});
