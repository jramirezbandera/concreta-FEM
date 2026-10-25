/**
 * CT1 (`docs/fem3d/cotas.md` §4, criterio 1): un pilar puesto con una cota fijada queda a la
 * distancia tecleada de su referencia, bit a bit con ejes paralelos a X o a Y, y con las dos fijadas
 * es la fila de la tabla con esas coordenadas. Y los rótulos de la cadena no engañan (§2.4).
 */
import { describe, expect, it } from "vitest";
import type { Proyecto } from "../../agente/proyecto.ts";
import { capaEjes, rotuloCota } from "../../agente/render/ejes.ts";
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { escribirFila } from "../edicion.ts";
import { aplicar } from "../operaciones.ts";
import { proyectoNuevo } from "../plantilla.ts";
import { aMarco, colocar, cotasEn, limpio, referenciasCotas } from "./cotas.ts";
import { indiceEnganches } from "./enganches.ts";
import { borrador, ESTADO_INICIAL, paso, type ContextoHerramienta, type EstadoHerramienta, type Evento, type Plantillas } from "./herramientas.ts";

const SECCIONES = [{ id: "P30", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.3 }] as const;

const EJES: ModeloFisico["ejes"] = [
  { id: "A", desde: [-2, 0], hasta: [12, 0] },
  { id: "B", desde: [-2, 6.3], hasta: [12, 6.3] },
  { id: "1", desde: [0, -2], hasta: [0, 8.3] },
  { id: "2", desde: [3, -2], hasta: [3, 8.3] },
  { id: "3", desde: [10, -2], hasta: [10, 8.3] },
];

function base(ejes?: ModeloFisico["ejes"]): Proyecto {
  const p = proyectoNuevo("cotas");
  return { ...p, modelo: { ...p.modelo, secciones: SECCIONES as unknown as ModeloFisico["secciones"], ...(ejes ? { ejes } : {}) } };
}

const PLANTILLAS: Plantillas = { pilar: { seccion: "P30" }, viga: {} };

function dibujar(p: Proyecto, eventos: Evento[]) {
  let q = p;
  let e: EstadoHerramienta = ESTADO_INICIAL;
  const errores: string[] = [];
  let salir = false;
  for (const ev of eventos) {
    const ctx: ContextoHerramienta = { modelo: q.modelo, planta: "N1", indice: indiceEnganches(q.modelo, "N1"), plantillas: PLANTILLAS };
    const r = paso("pilar", e, ev, ctx);
    e = r.estado;
    if (r.error) errores.push(r.error);
    if (r.salir) salir = true;
    if (r.hecho) {
      const a = aplicar(q, r.hecho.operacion);
      if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
      q = a.proyecto;
    }
  }
  return { proyecto: q, estado: e, errores, salir };
}

const conTabla = (p: Proyecto, fila: Record<string, string>) => {
  const a = escribirFila(p, "pilares", null, fila);
  if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
  return a.proyecto;
};

const tab = (cursor: Vec2, atras = false): Evento => ({ tipo: "tab", cursor, atras });
const fijar = (valor: number, cursor: Vec2): Evento => ({ tipo: "fijar", valor, cursor });

describe("referencias y cotas temporales", () => {
  const p = conTabla(base(EJES), { x: "6,5", y: "2", desde: "Cim", hasta: "N1", seccion: "P30" });
  const R = referenciasCotas(p.modelo, "N1", 0);

  it("ejes y pilares, por valor, y un pilar en un eje es el eje", () => {
    expect(R.s.map((r) => [r.valor, r.nombre])).toEqual([
      [0, "eje 1"],
      [3, "eje 2"],
      [6.5, "P1"],
      [10, "eje 3"],
    ]);
    expect(R.t.map((r) => r.nombre)).toEqual(["eje A", "P1", "eje B"]);
    const q = conTabla(p, { x: "3", y: "4", desde: "Cim", hasta: "N1", seccion: "P30" });
    expect(referenciasCotas(q.modelo, "N1", 0).s.map((r) => r.nombre)).toEqual(["eje 1", "eje 2", "P1", "eje 3"]);
  });

  it("la más cercana a cada lado, sin la que pasa por el punto", () => {
    const cs = cotasEn(R, [4, 1]);
    expect(cs.map((c) => [c.lado, c.ref.nombre, c.distancia])).toEqual([
      ["izquierda", "eje 2", 1],
      ["derecha", "P1", 2.5],
      ["abajo", "eje A", 1],
      ["arriba", "P1", 1],
    ]);
    // En un cruce de ejes, a los siguientes
    expect(cotasEn(R, [3, 0]).map((c) => [c.lado, c.ref.nombre])).toEqual([
      ["izquierda", "eje 1"],
      ["derecha", "P1"],
      ["arriba", "P1"],
    ]);
  });

  it("la cota parte de la recta de la referencia y su línea de referencia del pilar", () => {
    const c = cotasEn(R, [4, 5]).find((x) => x.lado === "derecha")!;
    expect(c.a).toEqual([6.5, 5]);
    expect(c.b).toEqual([4, 5]);
    expect(c.extension).toEqual([[6.5, 2], [6.5, 5]]);
    // Dentro de un eje, sin línea de referencia
    expect(cotasEn(R, [4, 5]).find((x) => x.lado === "izquierda")!.extension).toBeNull();
  });

  it("limpio: quita el ruido de una suma y deja lo demás", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(limpio(0.1 + 0.2)).toBe(0.3);
    expect(limpio(1 / 3)).toBe(1 / 3);
    expect(limpio(-0)).toBe(0);
  });
});

describe("la herramienta Pilar con cotas (criterio 1)", () => {
  const p0 = base(EJES);

  it("Tab recorre las cotas del cursor, también hacia atrás", () => {
    const c: Vec2 = [4, 1];
    const lados = (evs: Evento[]) => dibujar(p0, evs).estado.activa;
    expect(lados([tab(c)])).toBe("izquierda");
    expect(lados([tab(c), tab(c)])).toBe("derecha");
    expect(lados([tab(c), tab(c), tab(c), tab(c), tab(c)])).toBe("izquierda");
    expect(lados([tab(c, true)])).toBe("arriba");
    // Sin referencias a la izquierda, se la salta
    expect(lados([tab([-1, 1])])).toBe("derecha");
  });

  it("una cota fijada: exacta desde su referencia, bit a bit, y la otra coordenada la del cursor", () => {
    for (const v of [0.1, 0.2, 2.4, 2.45, 3.3, 5.4, 0.7]) {
      const r = dibujar(p0, [tab([4, 1.234]), fijar(v, [4, 1.234]), { tipo: "terminar", p: [4.5, 1.234] }]);
      expect(r.errores).toEqual([]);
      const pil = r.proyecto.modelo.pilares![0]!;
      // Desde el eje 2 (x = 3): la x es la que daría escribir 3 + v en la tabla
      expect(pil.x).toBe(Number((3 + v).toFixed(6)));
      expect(pil.y).toBe(1.234);
    }
  });

  it("derecha y arriba restan; un clic coloca como Intro", () => {
    const c: Vec2 = [4, 1];
    const r = dibujar(p0, [tab(c), tab(c), fijar(1.25, c), fijar(0.4, c), { tipo: "punto", p: [7, 3] }]);
    expect(r.errores).toEqual([]);
    const pil = r.proyecto.modelo.pilares![0]!;
    // Derecha desde el eje 3 (x = 10); tras fijar, la activa pasó a «abajo» (eje A, y = 0)
    expect([pil.x, pil.y]).toEqual([8.75, 0.4]);
  });

  it("las dos fijadas: la fila de la tabla con esas coordenadas, byte a byte", () => {
    const c: Vec2 = [4, 1];
    const r = dibujar(p0, [tab(c), fijar(2.35, c), fijar(1.15, c), { tipo: "terminar", p: [9, 9] }]);
    const t = conTabla(p0, { x: "5,35", y: "1,15", desde: "Cim", hasta: "N1", seccion: "P30" });
    expect(JSON.stringify(r.proyecto)).toBe(JSON.stringify(t));
  });

  it("lo fijado se suelta al colocar, con Esc, y Esc sin nada vuelve a Elegir", () => {
    const c: Vec2 = [4, 1];
    expect(dibujar(p0, [tab(c), fijar(1, c), { tipo: "punto", p: c }]).estado).toEqual(ESTADO_INICIAL);
    const r = dibujar(p0, [tab(c), fijar(1, c), { tipo: "anular" }]);
    expect(r.estado).toEqual(ESTADO_INICIAL);
    expect(r.salir).toBe(false);
    expect(r.proyecto.modelo.pilares ?? []).toEqual([]);
    expect(dibujar(p0, [tab(c), fijar(1, c), { tipo: "anular" }, { tipo: "anular" }]).salir).toBe(true);
  });

  it("sin cota activa, un número no fija nada y lo dice; ni una distancia negativa", () => {
    const c: Vec2 = [4, 1];
    const r = dibujar(p0, [fijar(2, c)]);
    expect(r.estado).toEqual(ESTADO_INICIAL);
    expect(r.errores[0]).toMatch(/Tab/);
    expect(dibujar(p0, [tab(c), fijar(-1, c)]).errores[0]).toMatch(/negativa/);
  });

  it("Intro sin nada fijado no pone ningún pilar", () => {
    expect(dibujar(p0, [{ tipo: "terminar", p: [4, 1] }]).proyecto.modelo.pilares ?? []).toEqual([]);
  });

  it("volver a fijar la misma dirección la cambia, desde la misma referencia", () => {
    const c: Vec2 = [4, 1];
    const r = dibujar(p0, [tab(c), fijar(1, c), tab(c, true), tab(c, true), fijar(0.5, [8, 1]), { tipo: "terminar", p: [8, 1] }]);
    // Tab atrás desde «abajo» vuelve a «derecha»… y otra vez a «izquierda»: la fijada, eje 2
    expect(r.proyecto.modelo.pilares![0]!.x).toBe(3.5);
  });

  it("el borrador lleva las cotas y la huella en el punto colocado", () => {
    const ctx: ContextoHerramienta = { modelo: p0.modelo, planta: "N1", indice: indiceEnganches(p0.modelo, "N1"), plantillas: PLANTILLAS };
    const e = dibujar(p0, [tab([4, 1]), fijar(1, [4, 1])]).estado;
    const b = borrador("pilar", e, [4.6, 2], ctx);
    expect(b.cotas.find((c) => c.lado === "izquierda")).toMatchObject({ fija: true, distancia: 1, b: [4, 2] });
    expect(b.cotas.find((c) => c.lado === "abajo")).toMatchObject({ activa: true, distancia: 2 });
    // La huella de 30 × 30, centrada en (4; 2)
    expect(b.anillos[0]!.map((q) => q.map((v) => Math.round(v * 1e9) / 1e9))).toContainEqual([3.85, 1.85]);
  });

  it("con ejes girados, la distancia fijada se mide en perpendicular", () => {
    const g = 30;
    const [c, s] = [Math.cos((g * Math.PI) / 180), Math.sin((g * Math.PI) / 180)];
    const rot = (x: number, y: number): Vec2 => [x * c - y * s, x * s + y * c];
    const ejes: ModeloFisico["ejes"] = [
      { id: "1", desde: rot(0, -2), hasta: rot(0, 8) },
      { id: "2", desde: rot(5, -2), hasta: rot(5, 8) },
      { id: "A", desde: rot(-2, 0), hasta: rot(8, 0) },
    ];
    const p = { ...base(ejes) };
    const losa = { id: "L1", planta: "N1", contorno: [rot(0, 0), rot(5, 0), rot(5, 5), rot(0, 5)], espesor: 0.25, material: "HA-30", eje1: g };
    const q: Proyecto = { ...p, modelo: { ...p.modelo, losas: [losa] as unknown as ModeloFisico["losas"] } };
    const cur = rot(1.7, 2.2);
    const r = dibujar(q, [tab(cur), fijar(1.2, cur), { tipo: "terminar", p: cur }]);
    expect(r.errores).toEqual([]);
    const pil = r.proyecto.modelo.pilares![0]!;
    const R = referenciasCotas(q.modelo, "N1", g);
    const [ss, tt] = aMarco(R, [pil.x, pil.y]);
    expect(ss).toBeCloseTo(1.2, 12);
    // La otra coordenada, la del cursor
    expect(tt).toBeCloseTo(2.2, 12);
    expect(colocar(R, cur, [])).toBe(cur);
  });
});

describe("rótulos de la cadena (§2.4)", () => {
  it("en mm si no es un número entero de cm", () => {
    expect(rotuloCota(5.4)).toBe("5,40");
    expect(rotuloCota(5.397)).toBe("5,397");
    expect(rotuloCota(5.4004)).toBe("5,40");
    expect(rotuloCota(5.4006)).toBe("5,401");
  });

  it("«≈» en las cotas de un eje propuesto con los pilares fuera de su recta", () => {
    const fila = (x: string, y: string) => ({ x, y, desde: "Cim", hasta: "N1", seccion: "P30" });
    let p = base();
    for (const [x, y] of [
      ["0", "0"],
      ["5", "0"],
      ["0", "6"],
      ["5,003", "6"],
    ])
      p = conTabla(p, fila(x!, y!));
    const { primitivas, notas } = capaEjes(p.modelo, { cotas: true });
    const textos = primitivas.filter((x) => x.tipo === "texto" && x.clase === "cota").map((x) => (x as { texto: string }).texto);
    // El eje 2 pasa por la media (5,0015): sus pilares, a 1,5 mm
    expect(textos).toContain("≈5,002");
    expect(textos).toContain("6,00");
    expect(notas.some((n) => /eje 2 no están en su recta: hasta 0,002 m/.test(n))).toBe(true);
    // Alineados, sin «≈»
    const q = conTabla(conTabla(conTabla(conTabla(base(), fila("0", "0")), fila("5", "0")), fila("0", "6")), fila("5", "6"));
    expect(capaEjes(q.modelo, { cotas: true }).primitivas.some((x) => x.tipo === "texto" && (x as { texto: string }).texto.startsWith("≈"))).toBe(false);
  });
});
