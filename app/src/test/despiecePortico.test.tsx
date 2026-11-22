/**
 * CO6 · DOM (`docs/fem3d/comprobaciones.md` §8.13): el despiece de un pórtico, dibujado. Lo que se
 * pinta es lo de `despiecePortico` (cada barra con su marca y su largo, los cercos contados, la tabla
 * con el acero); un clic en un vano lo elige, el campo con el foco resalta sus barras y las secciones
 * son las del vano elegido.
 */
import { fireEvent, render, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import type { ArmadoVanoViga } from "../../../src/comprobaciones/armado.ts";
import { despiecePortico, type DatosDespiece } from "../../../src/comprobaciones/despieceVigas.ts";
import type { Portico, VanoPortico } from "../../../src/comprobaciones/porticos.ts";
import { DespiecePortico } from "../editor/DespiecePortico.tsx";
import { fmt } from "../fmt.ts";

class SinTamano {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => {
  globalThis.ResizeObserver ??= SinTamano as unknown as typeof ResizeObserver;
});

const G = { b: 300, h: 500, fck: 25 };
const vano = (clave: string, desde: number, hasta: number, apoyos: [number | null, number | null], invertida = false): VanoPortico => ({ clave, viga: clave.split("/")[0]!, vano: Number(clave.split("/")[1]), invertida, desde, hasta, apoyos, seccion: "V30x50", geometria: G });
const PORTICO: Portico = {
  id: "V1+V2",
  planta: "F1",
  nombre: "P1 – P2 – P3",
  vigas: [
    { id: "V1", invertida: false, x: [0, 6] },
    { id: "V2", invertida: true, x: [6, 12.5] },
  ],
  apoyos: [
    { objeto: "P1", tipo: "pilar", eje: 0, caras: [-0.2, 0.2] },
    { objeto: "P2", tipo: "pilar", eje: 6, caras: [5.8, 6.2] },
    { objeto: "P3", tipo: "pilar", eje: 11, caras: [10.8, 11.2] },
  ],
  // V2 se dibujó de derecha a izquierda: su vano 0 es el voladizo
  vanos: [vano("V1/0", 0.2, 5.8, [0, 1]), vano("V2/1", 6.2, 10.8, [1, 2], true), vano("V2/0", 11.2, 12.5, [2, null], true)],
  x: [-0.2, 12.5],
  quiebros: [],
};
const LB: Record<number, [number, number]> = { 8: [0.3, 0.45], 12: [0.5, 0.7], 16: [0.65, 0.95], 20: [0.8, 1.15] };
const DESPIECE: DatosDespiece = { recubrimiento: 30, cotTheta: 2, anclajes: { "V1/0": LB, "V2/1": LB, "V2/0": LB } };
const ARMADOS: Record<string, ArmadoVanoViga> = {
  "V1/0": { inferior: { n: 3, diametro: 16 }, superior: { n: 2, diametro: 12 }, superiorFin: { n: 4, diametro: 12 }, cercos: { diametro: 8, separacion: 200 }, cercosInicio: { diametro: 8, separacion: 100 } },
  // Invertida: su fin es el apoyo de la izquierda (P2)
  "V2/1": { inferior: { n: 3, diametro: 16 }, superior: { n: 2, diametro: 12 }, superiorFin: { n: 4, diametro: 16 }, cercos: { diametro: 8, separacion: 200 } },
};
const DATOS = { portico: PORTICO, despiece: DESPIECE };

describe("CO6 · DOM: el despiece de un pórtico", () => {
  it("dibuja lo de `despiecePortico`: cada barra con su marca y su largo, los cercos contados y la tabla con el acero", () => {
    const d = despiecePortico(PORTICO, ARMADOS, DESPIECE);
    const { container } = render(<DespiecePortico datos={DATOS} armados={ARMADOS} elegida={null} activo={null} />);
    const raiz = container.querySelector('[data-despiece-portico="V1+V2"]')!;
    expect(raiz.textContent).toContain("Pórtico P1 – P2 – P3");
    const barras = [...raiz.querySelectorAll("[data-barra]")];
    expect(barras.map((b) => b.getAttribute("data-barra"))).toEqual(d.barras.map((b) => String(b.marca)));
    d.barras.forEach((b, i) => {
      expect(barras[i]!.getAttribute("data-grupo")).toBe(b.cara);
      expect(barras[i]!.querySelector(".dp-rotulo")!.textContent).toBe(`${b.n}Ø${b.diametro} L=${fmt(b.largo, 2)}`);
      expect(barras[i]!.querySelector(".dp-marca-numero")!.textContent).toBe(String(b.marca));
    });
    // Las superiores de apoyo, acotadas a cada lado del eje de P2
    const apoyo = d.barras.filter((b) => b.papel === "apoyo");
    expect(apoyo.length).toBe(2);
    for (const b of apoyo) expect(raiz.querySelector(`[data-barra="${b.marca}"] .dp-cota-barra text`)!.textContent).toBe(`${fmt(6 - b.x[0], 2)} | ${fmt(b.x[1] - 6, 2)}`);
    expect([...raiz.querySelectorAll("[data-cercos] text")].map((t) => t.textContent)).toEqual(d.cercos.map((c) => `${c.n}cØ${c.cercos.diametro}/${c.cercos.separacion}`));
    // La tabla: una fila por barra y por tramo de cercos, y el total
    const filas = within(raiz.querySelector("[data-tabla-despiece]") as HTMLElement).getAllByRole("row");
    expect(filas).toHaveLength(d.medicion.length + 2);
    d.medicion.forEach((f, i) => expect(within(filas[i + 1]!).getAllByRole("cell").map((c) => c.textContent)).toEqual([f.marca, f.que, String(f.n), String(f.diametro), fmt(f.largo, 2), fmt(f.total, 2), fmt(f.kg, 1)]));
    expect(filas.at(-1)!.textContent).toContain(fmt(d.acero.total, 1));
    expect(raiz.querySelector("[data-acero-portico]")!.textContent).toContain(`${fmt(d.acero.total, 0)} kg`);
    // El voladizo no tiene armado: lo dice, y no hay secciones sin vano elegido
    expect([...raiz.querySelectorAll("text.ca-falta")].map((t) => t.textContent)).toEqual(["sin armado"]);
    expect(raiz.querySelector("[data-secciones-vano]")).toBeNull();
    expect(raiz.querySelectorAll("[data-aviso-despiece]")).toHaveLength(d.avisos.length);
  });

  it("un clic en un vano lo elige; el elegido lleva sus secciones (en el sentido del pórtico) y el campo con el foco resalta sus barras", () => {
    const clics: string[] = [];
    const estados = { "V1/0": { texto: "Cumple", tono: "ok" as const, aprovechamiento: 0.83 }, "V2/1": { texto: "No cumple", tono: "fail" as const, aprovechamiento: 1.12 } };
    const { container, rerender } = render(<DespiecePortico datos={DATOS} armados={ARMADOS} estados={estados} elegida="V2/1" activo={null} onVano={(c) => clics.push(c)} />);
    const vanos = [...container.querySelectorAll("[data-vano]")];
    expect(vanos.map((v) => [v.getAttribute("data-vano"), v.hasAttribute("data-on")])).toEqual([
      ["V1/0", false],
      ["V2/1", true],
      ["V2/0", false],
    ]);
    // El nombre de cada vano, con su aprovechamiento y su tono
    expect(vanos.map((v) => v.querySelector("text")!.textContent)).toEqual([`V1 · ${fmt(0.83, 2)}`, `V2 · 2 · ${fmt(1.12, 2)}`, "V2 · 1"]);
    expect(vanos[1]!.querySelector("text")!.getAttribute("data-tono")).toBe("fail");
    fireEvent.click(vanos[0]!);
    expect(clics).toEqual(["V1/0"]);
    // Las secciones del elegido: su fin (4Ø16) va a la izquierda, junto a P2
    const sec = container.querySelector('[data-secciones-vano="V2/1"]')!;
    const titulos = [...sec.querySelectorAll("text.ca-titulo")].map((t) => t.textContent);
    expect(titulos).toEqual(["Junto a P2", "Centro", "Junto a P3"]);
    const superiores = [...sec.querySelectorAll("[data-seccion-armada]")].map((s) => s.querySelectorAll('.ca-barra[data-grupo="superior"]').length);
    expect(superiores).toEqual([4, 2, 2]);
    // Lo que no es del vano elegido, atenuado; lo del campo con el foco, resaltado
    const d = despiecePortico(PORTICO, ARMADOS, DESPIECE);
    const suya = (m: number) => container.querySelector(`[data-barra="${m}"]`)!;
    for (const b of d.barras) expect(suya(b.marca).hasAttribute("data-otro"), `barra ${b.marca}`).toBe(!b.origen.some((o) => o.clave === "V2/1"));
    expect(container.querySelectorAll("[data-barra][data-activo]")).toHaveLength(0);
    rerender(<DespiecePortico datos={DATOS} armados={ARMADOS} estados={estados} elegida="V2/1" activo="superiorFin" onVano={(c) => clics.push(c)} />);
    const activas = [...container.querySelectorAll("[data-barra][data-activo]")].map((b) => Number(b.getAttribute("data-barra")));
    expect(activas).toEqual(d.barras.filter((b) => b.origen.some((o) => o.clave === "V2/1" && o.ruta === "superiorFin")).map((b) => b.marca));
    expect(activas).toHaveLength(1);
  });

  it("sigue a lo que se escribe (un armado a medias) y, sin ningún armado, lo dice", () => {
    const { container, rerender } = render(<DespiecePortico datos={DATOS} armados={{ "V1/0": { inferior: { n: 2, diametro: 20 }, superior: { n: 2 } as never } }} elegida="V1/0" activo="inferior" />);
    const barras = [...container.querySelectorAll("[data-barra]")];
    expect(barras).toHaveLength(1);
    expect(barras[0]!.querySelector(".dp-rotulo")!.textContent).toMatch(/^2Ø20 L=/);
    expect(barras[0]!.hasAttribute("data-activo")).toBe(true);
    rerender(<DespiecePortico datos={DATOS} armados={{}} elegida={null} activo={null} />);
    expect(container.querySelectorAll("[data-barra]")).toHaveLength(0);
    expect(container.querySelector("[data-tabla-despiece]")).toBeNull();
    expect(container.textContent).toContain("Ningún vano de este pórtico tiene armado");
  });
});
