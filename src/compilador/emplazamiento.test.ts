/**
 * El emplazamiento común al viento y al sismo (`acciones.emplazamiento`, VS4):
 * 1. el viento sin zona toma la de la provincia (por su código o por el municipio) y da las mismas
 *    fuerzas, bit a bit, que con esa zona escrita; la zona escrita manda; la altitud, también;
 * 2. el sismo sin `ine` toma el del emplazamiento y da el mismo espectro que con él escrito;
 * 3. lo que no vale (códigos, provincia que no casa, municipio fuera de la tabla) es un error, y un
 *    municipio sólo por su nombre avisa en el sismo de que sin ab no hay casos.
 */
import { describe, expect, it } from "vitest";
import { compilar } from "./compilar.ts";
import { erroresEmplazamiento, sismoEfectivo, vientoEfectivo } from "./emplazamiento.ts";
import type { AccionesEdificio, ModeloFisico, Vec2 } from "./fisico.ts";
import { calcularSismo } from "./sismo.ts";
import { calcularViento } from "./viento.ts";

const rect = (X: number, Y: number): Vec2[] => [
  [0, 0],
  [X, 0],
  [X, Y],
  [0, Y],
];

/** Dos plantas de 12 × 8 con cuatro pilares de esquina y una losa por planta. */
function edificio(acciones: AccionesEdificio): ModeloFisico {
  const esquinas: Vec2[] = [
    [0.15, 0.15],
    [11.85, 0.15],
    [11.85, 7.85],
    [0.15, 7.85],
  ];
  return {
    plantas: [
      { id: "N2", altura: null },
      { id: "N1", altura: 3 },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [{ id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 }],
    pilares: esquinas.map(([x, y], i) => ({ id: `P${i + 1}`, x, y, desde: "C", hasta: "N2", seccion: "P30" })),
    losas: ["N1", "N2"].map((p, i) => ({ id: `L${i + 1}`, planta: p, contorno: rect(12, 8), espesor: 0.2, material: "HA" })),
    casos: [
      { id: "G", pesoPropio: true, accion: { tipo: "G" } },
      { id: "Q", accion: { tipo: "Q", psi: "uso-A" } },
    ],
    acciones,
  };
}

describe("el viento toma la zona y la altitud del emplazamiento", () => {
  it("sin zona, la de la provincia: las mismas fuerzas que con la zona escrita", () => {
    // Málaga (29) es zona A; Cádiz (11), C
    for (const [emp, zona] of [
      [{ provincia: "29" }, "A"],
      [{ ine: "29008", municipio: "Alhaurín el Grande" }, "A"],
      [{ provincia: "11" }, "C"],
    ] as const) {
      const v = calcularViento(edificio({ emplazamiento: emp, viento: { aspereza: "IV" } }))!;
      const w = calcularViento(edificio({ viento: { zona, aspereza: "IV" } }))!;
      expect(v.errores).toEqual([]);
      expect(v.viento!.zona).toBe(zona);
      expect(v.viento!.zonaOrigen).toBe("provincia");
      expect(v.viento!.x).toEqual(w.viento!.x);
      expect(v.viento!.y).toEqual(w.viento!.y);
    }
  });

  it("la zona escrita manda sobre la de la provincia", () => {
    const v = calcularViento(edificio({ emplazamiento: { provincia: "29" }, viento: { zona: "C", aspereza: "IV" } }))!;
    expect(v.viento!.zona).toBe("C");
    expect(v.viento!.zonaOrigen).toBe("escrita");
  });

  it("con frontera en la figura D.1, avisa", () => {
    // Alicante (03): «El interior (Alcoi, Villena, Elda) está en zona A»
    const v = calcularViento(edificio({ emplazamiento: { provincia: "03" }, viento: { aspereza: "IV" } }))!;
    expect(v.avisos.map((a) => a.codigo)).toContain("viento/zona-frontera");
  });

  it("sin zona ni provincia, el error lo dice", () => {
    const v = calcularViento(edificio({ emplazamiento: { altitud: 100 }, viento: { aspereza: "IV" } }))!;
    expect(v.errores.map((e) => e.codigo)).toEqual(["viento/zona"]);
    expect(compilar(edificio({ viento: { aspereza: "IV" } })).diagnosticos.map((d) => d.codigo)).toContain("viento/zona");
  });

  it("la altitud del emplazamiento vale para el viento, y la suya manda", () => {
    expect(vientoEfectivo(edificio({ emplazamiento: { provincia: "29", altitud: 2500 }, viento: { aspereza: "IV" } }))!.viento.altitud).toBe(2500);
    expect(calcularViento(edificio({ emplazamiento: { provincia: "29", altitud: 2500 }, viento: { aspereza: "IV" } }))!.errores.map((e) => e.codigo)).toEqual(["viento/altitud"]);
    expect(vientoEfectivo(edificio({ emplazamiento: { altitud: 2500 }, viento: { zona: "A", aspereza: "IV", altitud: 100 } }))!.viento.altitud).toBe(100);
  });
});

describe("el sismo toma el municipio del emplazamiento", () => {
  const resto = { terreno: "II", mu: 2 } as const;

  it("sin ine, el del emplazamiento: el mismo espectro que con él escrito", () => {
    const a = calcularSismo(edificio({ emplazamiento: { ine: "29008", municipio: "Alhaurín el Grande" }, sismo: { ...resto } }))!;
    const b = calcularSismo(edificio({ sismo: { ...resto, ine: "29008", municipio: "Alhaurín el Grande" } }))!;
    expect(a.errores).toEqual([]);
    expect(a.espectro).toEqual(b.espectro);
    expect(a.espectro!.municipio).toMatchObject({ ine: "29008", ab: 0.08, K: 1 });
  });

  it("el ine del sismo manda sobre el del emplazamiento", () => {
    expect(sismoEfectivo(edificio({ emplazamiento: { ine: "29008" }, sismo: { ...resto, ine: "21010" } }))!.ine).toBe("21010");
  });

  it("un municipio sólo por su nombre: sin ab, masas y modos con un aviso; con ab y K, su nombre acompaña", () => {
    const m = edificio({ emplazamiento: { provincia: "29", municipio: "Un pueblo" }, sismo: {} });
    const c = calcularSismo(m)!;
    expect(c.errores).toEqual([]);
    expect(c.espectro).toBe(null);
    expect(c.avisos.map((a) => a.codigo)).toContain("sismo/municipio-fuera-del-anejo");
    const d = calcularSismo(edificio({ emplazamiento: { provincia: "29", municipio: "Un pueblo" }, sismo: { ...resto, ab: 0.05, K: 1 } }))!;
    expect(d.errores).toEqual([]);
    expect(d.espectro!.emplazamiento.ab).toBe(0.05);
    expect(d.avisos.map((a) => a.codigo)).not.toContain("sismo/municipio-fuera-del-anejo");
  });
});

describe("lo que no vale del emplazamiento", () => {
  const codigos = (emplazamiento: unknown) => erroresEmplazamiento(edificio({ emplazamiento } as AccionesEdificio)).map((e) => e.codigo);
  it("códigos mal escritos, un municipio que no está en la tabla y una provincia que no casa", () => {
    expect(codigos({ provincia: "29", ine: "29008", municipio: "Alhaurín el Grande", altitud: 120 })).toEqual([]);
    expect(codigos({ provincia: "9" })).toEqual(["emplazamiento/provincia"]);
    expect(codigos({ provincia: "99" })).toEqual(["emplazamiento/provincia"]);
    expect(codigos({ ine: "2908" })).toEqual(["emplazamiento/ine"]);
    expect(codigos({ ine: "29999" })).toEqual(["emplazamiento/municipio-desconocido"]);
    expect(codigos({ provincia: "11", ine: "29008" })).toEqual(["emplazamiento/provincia"]);
    expect(codigos({ altitud: "alta" })).toEqual(["emplazamiento/altitud"]);
    expect(codigos("Málaga")).toEqual(["emplazamiento/no-valido"]);
  });

  it("compilar los da, y sin emplazamiento nada cambia", () => {
    expect(compilar(edificio({ emplazamiento: { ine: "29999" } })).diagnosticos.map((d) => d.codigo)).toContain("emplazamiento/municipio-desconocido");
    expect(compilar(edificio({ emplazamiento: { ine: "29008", municipio: "Alhaurín el Grande" } })).valido).toBe(true);
  });
});
