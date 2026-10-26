/**
 * V2c-3 (`docs/fem3d/dibujo.md` §9): Mover, Copiar, Girar y Simetría con secuencias de eventos dan lo
 * que daría la tabla (criterio 1), con el punto base y el destino enganchados o tecleados; el
 * borrador enseña lo transformado; deshacer cada acción deja el proyecto de partida (criterio 4).
 */
import { describe, expect, it } from "vitest";
import type { Proyecto } from "../../agente/proyecto.ts";
import { compilar } from "../../compilador/compilar.ts";
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { escribirFila, filas } from "../edicion.ts";
import { deshacer, hacer, historial, type Historial } from "../historial.ts";
import { aplicar } from "../operaciones.ts";
import { proyectoNuevo } from "../plantilla.ts";
import { serializar } from "../serializar.ts";
import { leerEntrada, resolverEntrada } from "./teclado.ts";
import { apuntar, indiceEnganches, RADIO_ENGANCHE } from "./enganches.ts";
import { anguloGiro, medidaEditar } from "./editar.ts";
import { ayuda, borrador, ESTADO_INICIAL, paso, ultimoPunto, type ContextoHerramienta, type EstadoHerramienta, type Evento, type NombreHerramienta, type Plantillas } from "./herramientas.ts";

const SECCIONES = [
  { id: "P30", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.3 },
  { id: "V30x50", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.5 },
] as const;

const conTabla = (p: Proyecto, tabla: Parameters<typeof escribirFila>[1], fila: Record<string, string>, id: string | null = null) => {
  const a = escribirFila(p, tabla, id, fila);
  if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
  return a.proyecto;
};

/** Una retícula de 2 × 1 vanos (10 × 6,3 m): pilares en los cruces, vigas de pilar a pilar, una losa y una carga puntual. */
function reticula(): Proyecto {
  const p0 = proyectoNuevo("editar");
  let p: Proyecto = { ...p0, modelo: { ...p0.modelo, secciones: SECCIONES as unknown as ModeloFisico["secciones"] } };
  for (const [x, y] of [[0, 0], [5, 0], [10, 0], [0, 6.3], [5, 6.3], [10, 6.3]]) p = conTabla(p, "pilares", { x: String(x).replace(".", ","), y: String(y).replace(".", ","), desde: "Cim", hasta: "N1", seccion: "P30" });
  for (const ps of ["0 0; 5 0", "5 0; 10 0", "0 6,3; 5 6,3", "5 6,3; 10 6,3", "0 0; 0 6,3", "5 0; 5 6,3", "10 0; 10 6,3"]) p = conTabla(p, "vigas", { planta: "N1", puntos: ps, seccion: "V30x50" });
  p = conTabla(p, "forjados", { planta: "N1", tipo: "maciza", contorno: "0 0; 10 0; 10 6,3; 0 6,3", espesor: "0,25", material: "HA-30" });
  p = conTabla(p, "cargas", { tipo: "puntual", caso: "G", planta: "N1", x: "2,5", y: "3", F: "0 0 -10" });
  return p;
}

const PLANTILLAS: Plantillas = { pilar: { seccion: "P30" }, viga: { seccion: "V30x50" } };

/** Los eventos de una herramienta, con lo elegido en la vista; cada acción, un paso del historial. */
function editar(p: Proyecto, h: NombreHerramienta, eventos: Evento[], elegidos: readonly string[] = [], plantillas: Plantillas = PLANTILLAS) {
  let h0: Historial = historial(p);
  let e: EstadoHerramienta = ESTADO_INICIAL;
  const errores: string[] = [];
  const etiquetas: string[] = [];
  const avisos: string[] = [];
  let salir = false;
  for (const ev of eventos) {
    const q = h0.actual;
    const ctx: ContextoHerramienta = { modelo: q.modelo, planta: "N1", indice: indiceEnganches(q.modelo, "N1"), plantillas, elegidos };
    const r = paso(h, e, ev, ctx);
    e = r.estado;
    salir ||= !!r.salir;
    if (r.error) errores.push(r.error);
    if (r.hecho) {
      const a = aplicar(q, r.hecho.operacion);
      if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
      h0 = hacer(h0, a.proyecto, r.hecho.etiqueta);
      etiquetas.push(r.hecho.etiqueta);
      avisos.push(...(r.hecho.avisos ?? []));
    }
  }
  return { proyecto: h0.actual, historial: h0, estado: e, errores, etiquetas, avisos, salir };
}

/** Un clic enganchado en q (10 px a 50 px/m), como lo da la vista. */
const clic = (p: Proyecto, q: Vec2, ctrl = false): Evento => {
  const a = apuntar(indiceEnganches(p.modelo, "N1"), q, RADIO_ENGANCHE / 50, {});
  return { tipo: "punto", p: a.p, enganche: a.enganche, cursor: q, radio: RADIO_ENGANCHE / 50, ...(ctrl ? { ctrl } : {}) };
};

/** Lo tecleado, resuelto como en el campo (con el último punto del estado). */
const tecleado = (texto: string, ultimo: Vec2 | null): Evento => {
  const l = leerEntrada(texto);
  if (!l.ok) throw new Error(l.mensaje);
  const r = resolverEntrada(l.valor, { ultimo, cursor: null, direccion: 0, orto: false, mayus: false });
  if (!r.ok) throw new Error(r.mensaje);
  return { tipo: "punto", p: r.valor };
};

const idDe = (p: Proyecto, x: number, y: number) => p.modelo.pilares!.find((q) => q.x === x && q.y === y)!.id;

describe("Mover", () => {
  it("sin nada elegido, pide elegir; un clic en el pilar y el destino tecleado dan lo de la tabla, con sus vigas", () => {
    const p = reticula();
    const P = idDe(p, 5, 0);
    const r = editar(p, "mover", [clic(p, [3, 3]), { tipo: "elegidos", ids: [P] }, clic(p, [5.02, 0.01]), tecleado("@0,45; 0", [5, 0])]);
    expect(r.errores).toEqual(["Mover: elija primero lo que quiere transformar."]);
    expect(r.etiquetas).toEqual([`Mover ${P} (0,45; 0 m)`]);
    // Lo mismo, escrito en la tabla: el pilar y el extremo de las tres vigas que acaban en él
    const fila = (q: Proyecto, t: "pilares" | "vigas", id: string) => filas(q.modelo, t).find((x) => x.id === id)!.fila;
    let t = conTabla(p, "pilares", { ...fila(p, "pilares", P), x: "5,45" }, P);
    for (const v of p.modelo.vigas!.filter((v) => v.puntos.some((q) => q[0] === 5 && q[1] === 0))) {
      const f = fila(t, "vigas", v.id);
      t = conTabla(t, "vigas", { ...f, puntos: f.puntos!.replace(/(^|; )5 0(?=;|$)/, "$15,45 0") }, v.id);
    }
    expect(serializar(r.proyecto)).toBe(serializar(t));
    // Vuelve al punto base con lo mismo elegido
    expect(r.estado).toEqual({ puntos: [], elegidos: [P] });
  });

  it("con Ctrl en el destino, el pilar solo; se avisa de las vigas que se quedan", () => {
    const p = reticula();
    const P = idDe(p, 10, 0);
    const r = editar(p, "mover", [clic(p, [10, 0]), { tipo: "punto", p: [10.5, 0.2], ctrl: true }], [P]);
    expect(r.proyecto.modelo.vigas).toEqual(p.modelo.vigas);
    expect(r.proyecto.modelo.pilares!.find((x) => x.id === P)).toMatchObject({ x: 10.5, y: 0.2 });
    expect(r.avisos).toEqual(["Las vigas V2 y V7 acaban en un pilar que se mueve y se quedan donde estaban."]);
  });

  it("Intro confirma lo elegido; Esc anula el punto y, sin él, sale a Elegir", () => {
    const p = reticula();
    const r = editar(p, "mover", [{ tipo: "terminar" }, clic(p, [0, 0]), { tipo: "anular" }], ["L1"]);
    expect(r.estado).toEqual({ puntos: [], elegidos: ["L1"] });
    expect(r.salir).toBe(false);
    expect(editar(p, "mover", [{ tipo: "terminar" }, { tipo: "anular" }], ["L1"]).salir).toBe(true);
    // Sin nada que se pueda mover
    expect(editar(p, "mover", [{ tipo: "elegidos", ids: ["HA-30"] }]).errores).toEqual(["Lo elegido no tiene geometría: elija pilares, vigas, forjados, muros, apoyos, cargas o ejes."]);
  });
});

describe("Copiar", () => {
  it("una copia por destino hasta Intro; cada una, un paso de deshacer", () => {
    const p = reticula();
    const vigas = ["V1", "V2"];
    const r = editar(p, "copiar", [clic(p, [0, 0]), tecleado("@0; 2,1", [0, 0]), tecleado("@0; 4,2", [0, 0]), { tipo: "terminar" }], vigas);
    expect(r.etiquetas).toEqual(["Copiar V1 y V2 (0; 2,1 m)", "Copiar V1 y V2 (0; 4,2 m)"]);
    expect(r.proyecto.modelo.vigas!.slice(-4)).toEqual([
      { id: "V8", planta: "N1", puntos: [[0, 2.1], [5, 2.1]], seccion: "V30x50" },
      { id: "V9", planta: "N1", puntos: [[5, 2.1], [10, 2.1]], seccion: "V30x50" },
      { id: "V10", planta: "N1", puntos: [[0, 4.2], [5, 4.2]], seccion: "V30x50" },
      { id: "V11", planta: "N1", puntos: [[5, 4.2], [10, 4.2]], seccion: "V30x50" },
    ]);
    // Lo copiado no se mueve, ni sus vigas
    expect(r.proyecto.modelo.vigas!.slice(0, 7)).toEqual(p.modelo.vigas);
    expect(r.estado).toEqual({ puntos: [], elegidos: vigas });
    expect(serializar(deshacer(deshacer(r.historial)).actual)).toBe(serializar(p));
    // Las copias por las vigas a media luz compilan
    const c = compilar(r.proyecto.modelo);
    expect(c.diagnosticos.filter((d) => d.severidad === "error")).toEqual([]);
  });

  it("a otras plantas, con la plantilla", () => {
    const p0 = reticula();
    const p = { ...p0, modelo: { ...p0.modelo, plantas: [{ id: "N2", altura: null }, ...p0.modelo.plantas.map((x, i) => (i === 0 ? { ...x, altura: 3 } : x))] } } as Proyecto;
    // Intro confirma lo elegido; otra vez, sin punto base, lo copia en su sitio
    const r = editar(p, "copiar", [{ tipo: "terminar" }, { tipo: "terminar" }], ["L1"], { ...PLANTILLAS, editar: { plantas: ["N2"] } });
    expect(r.etiquetas).toEqual(["Copiar L1 (0; 0 m)"]);
    expect(r.proyecto.modelo.losas!.at(-1)).toEqual({ ...p.modelo.losas![0], id: "L2", planta: "N2" });
  });
});

describe("Girar y Simetría", () => {
  it("girar 90° con los grados escritos; con un clic, el ángulo desde +X", () => {
    const p = reticula();
    const r = editar(p, "girar", [clic(p, [0, 0]), { tipo: "fijar", valor: 90, cursor: null }], ["V1", "Q1"]);
    expect(r.etiquetas).toEqual(["Girar V1 y Q1 90°"]);
    expect(r.proyecto.modelo.vigas![0]!.puntos).toEqual([[0, 0], [0, 5]]);
    expect(r.proyecto.modelo.cargas![0]).toMatchObject({ x: -3, y: 2.5 });
    expect(anguloGiro([0, 0], [0, -2])).toBe(-90);
    expect(anguloGiro([1, 1], [0, 1])).toBe(180);
    const s = editar(p, "girar", [clic(p, [0, 0]), clic(p, [0, 6.3])], ["V1"]);
    expect(s.proyecto.modelo.vigas![0]!.puntos).toEqual([[0, 0], [0, 5]]);
  });

  it("simetría por un eje: mueve; con «conservar», copia", () => {
    const p = reticula();
    const eje = [tecleado("5; 0", null), tecleado("5; 6,3", null)];
    const m = editar(p, "simetria", eje, ["Q1"]);
    expect(m.proyecto.modelo.cargas![0]).toMatchObject({ x: 7.5, y: 3 });
    expect(m.proyecto.modelo.cargas!.length).toBe(1);
    const c = editar(p, "simetria", eje, ["Q1"], { ...PLANTILLAS, editar: { conservar: true } });
    expect(c.etiquetas).toEqual(["Simetría de Q1 (con lo original)"]);
    expect(c.proyecto.modelo.cargas!.map((x) => [x.id, (x as { x: number }).x])).toEqual([
      ["Q1", 2.5],
      ["Q2", 7.5],
    ]);
  });
});

describe("el borrador y la barra", () => {
  it("lo elegido transformado con el cursor, la línea del punto base y el desplazamiento", () => {
    const p = reticula();
    const ctx: ContextoHerramienta = { modelo: p.modelo, planta: "N1", indice: indiceEnganches(p.modelo, "N1"), plantillas: PLANTILLAS, elegidos: ["V1", "Q1"] };
    const e: EstadoHerramienta = { puntos: [{ p: [0, 0] }], elegidos: ["V1", "Q1"] };
    const b = borrador("mover", e, [1, 2], ctx);
    expect(b.lineas).toContainEqual([[0, 0], [1, 2]]);
    expect(b.puntos).toEqual([[3.5, 5]]);
    expect(b.anillos.length + b.lineas.length).toBeGreaterThan(1);
    expect(medidaEditar("mover", e, [1, 2])).toBe("Δ 1,00; 2,00 m");
    expect(medidaEditar("girar", e, [0, 2])).toBe("Ángulo 90,00°");
    expect(ultimoPunto(e)).toEqual([0, 0]);
    expect(ayuda("mover", e, PLANTILLAS)).toBe("Mover 2 objetos: el destino (clic, «x; y», «@dx; dy» o una distancia). Con Ctrl, los pilares sin sus vigas. Esc anula.");
  });
});
