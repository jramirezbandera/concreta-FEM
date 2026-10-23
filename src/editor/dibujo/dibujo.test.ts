/**
 * V2c-1 (`docs/fem3d/dibujo.md` §4): las herramientas dan lo que daría la tabla (criterio 1), el
 * enganche es exacto, por prioridad y con el radio en px (criterio 2), y deshacer deja el proyecto de
 * partida (criterio 4).
 */
import { describe, expect, it } from "vitest";
import type { Proyecto } from "../../agente/proyecto.ts";
import { compilar } from "../../compilador/compilar.ts";
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { escribirFila } from "../edicion.ts";
import { deshacer, hacer, historial } from "../historial.ts";
import { aplicar, type Operacion } from "../operaciones.ts";
import { proyectoNuevo } from "../plantilla.ts";
import { serializar } from "../serializar.ts";
import { apuntar, bajoCursor, cruce, enganchar, indiceEnganches, ortogonal, RADIO_ENGANCHE } from "./enganches.ts";
import { alinearACara, ESTADO_INICIAL, ejeNuevo, operacionProponerEjes, paso, type ContextoHerramienta, type EstadoHerramienta, type Evento, type NombreHerramienta, type Plantillas } from "./herramientas.ts";
import { leerEntrada, resolverEntrada } from "./teclado.ts";

const SECCIONES = [
  { id: "P30", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.3 },
  { id: "P40", material: "HA-30", forma: "rectangular", b: 0.4, h: 0.4 },
  { id: "V30x50", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.5 },
] as const;

/** Un proyecto nuevo (N1 sobre Cim) con secciones y, si se dan, ejes. */
function base(ejes?: ModeloFisico["ejes"]): Proyecto {
  const p = proyectoNuevo("dibujo");
  return { ...p, modelo: { ...p.modelo, secciones: SECCIONES as unknown as ModeloFisico["secciones"], ...(ejes ? { ejes } : {}) } };
}

const EJES: ModeloFisico["ejes"] = [
  { id: "A", desde: [-2, 0], hasta: [12, 0] },
  { id: "B", desde: [-2, 6.3], hasta: [12, 6.3] },
  { id: "1", desde: [0, -2], hasta: [0, 8.3] },
  { id: "2", desde: [5, -2], hasta: [5, 8.3] },
  { id: "3", desde: [10, -2], hasta: [10, 8.3] },
];

const PLANTILLAS: Plantillas = { pilar: { seccion: "P30" }, viga: { seccion: "V30x50" } };

/** Aplica una secuencia de eventos de una herramienta y devuelve el proyecto y lo que dijo. */
function dibujar(p: Proyecto, h: NombreHerramienta, eventos: Evento[], plantillas: Plantillas = PLANTILLAS, planta = "N1") {
  let q = p;
  let e: EstadoHerramienta = ESTADO_INICIAL;
  const errores: string[] = [];
  const etiquetas: string[] = [];
  let salir = false;
  for (const ev of eventos) {
    const ctx: ContextoHerramienta = { modelo: q.modelo, planta, indice: indiceEnganches(q.modelo, planta), plantillas };
    const r = paso(h, e, ev, ctx);
    e = r.estado;
    if (r.error) errores.push(r.error);
    if (r.salir) salir = true;
    if (r.hecho) {
      const a = aplicar(q, r.hecho.operacion);
      if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
      q = a.proyecto;
      etiquetas.push(r.hecho.etiqueta);
    }
  }
  return { proyecto: q, estado: e, errores, etiquetas, salir };
}

/** Un clic enganchado en q (radio de 10 px a 50 px/m), como lo da la vista. */
const clic = (p: Proyecto, q: Vec2, ultimo: Vec2 | null = null, planta = "N1"): Evento => {
  const a = apuntar(indiceEnganches(p.modelo, planta), q, RADIO_ENGANCHE / 50, { ultimo });
  return { tipo: "punto", p: a.p, enganche: a.enganche };
};

const conTabla = (p: Proyecto, tabla: Parameters<typeof escribirFila>[1], fila: Record<string, string>) => {
  const a = escribirFila(p, tabla, null, fila);
  if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
  return a.proyecto;
};

describe("enganches (criterio 2)", () => {
  const p0 = conTabla(conTabla(base(EJES), "pilares", { x: "5", y: "6,3", desde: "Cim", hasta: "N1", seccion: "P40", fijo: "esquina-superior-derecha" }), "vigas", { planta: "N1", puntos: "0 0; 5 0; 10 0", seccion: "V30x50" });
  const ix = indiceEnganches(p0.modelo, "N1");
  const pilar = p0.modelo.pilares![0]!;

  it("el punto de un rasgo es el del modelo, bit a bit", () => {
    const e = enganchar(ix, [5.03, 6.28], 0.1)!;
    expect(e.tipo).toBe("fijo");
    expect(Object.is(e.p[0], pilar.x) && Object.is(e.p[1], pilar.y)).toBe(true);
    // El centro del pilar con punto fijo en la esquina: 0,2 m hacia abajo y a la izquierda
    const c = enganchar(ix, [4.79, 6.11], 0.05)!;
    expect(c.tipo).toBe("centro");
    expect(c.p).toEqual([4.8, 6.1]);
    // El vértice de la viga es el número del modelo
    const v = enganchar(ix, [5.02, 0.01], 0.05)!;
    expect(v.tipo).toBe("vertice");
    expect(v.p).toBe(p0.modelo.vigas![0]!.puntos[1]);
  });

  it("por prioridad: el punto fijo gana a la esquina y el extremo al cruce que está en el mismo sitio; el cruce, al punto medio más cerca", () => {
    // Esquina superior derecha = punto fijo; la cercana gana sólo dentro de su nivel
    expect(enganchar(ix, [5, 6.3], 0.5)!.tipo).toBe("fijo");
    // (0, 0): extremo de la viga y cruce de A con 1
    expect(enganchar(ix, [0.01, 0.01], 0.1)!.tipo).toBe("extremo");
    // Entre el cruce B-3 (10; 6,3) y el punto medio del eje 3 (10; 3,15) no hay pugna; cerca del
    // cruce A-2 (5; 0), el medio de la viga entre 0 y 5 (2,5; 0) está lejos: gana el vértice
    const cerca = enganchar(ix, [10.04, 6.3], 0.05)!;
    expect(cerca.tipo).toBe("cruce");
    expect(cerca.p).toEqual([10, 6.3]);
    const medio = enganchar(ix, [2.51, 0.02], 0.05)!;
    expect(medio.tipo).toBe("medio");
    expect(medio.p).toEqual([2.5, 0]);
    // Sin otra cosa cerca, el más cercano de una recta
    const cercano = enganchar(ix, [7.5, 0.03], 0.05)!;
    expect(cercano.tipo).toBe("medio");
    const libre = enganchar(ix, [8.1, 0.03], 0.05)!;
    expect(libre.tipo).toBe("cercano");
    expect(libre.p).toEqual([8.1, 0]);
  });

  it("el cruce de dos ejes paralelos a X y a Y tiene sus números, bit a bit", () => {
    // (6 + 2) / 58 · 58 − 2 no es 6 en doble precisión
    expect(cruce([-2, 5], [56, 5], [6, -2], [6, 37])).toEqual([6, 5]);
    expect(cruce([6, -2], [6, 37], [-2, 5.3], [56, 5.3])).toEqual([6, 5.3]);
  });

  it("perpendicular desde el último punto, y la cara de un pilar", () => {
    const e = enganchar(ix, [10.03, 3], 0.05, { ultimo: [7, 3] })!;
    expect(e.tipo).toBe("perpendicular");
    expect(e.p).toEqual([10, 3]);
    // La cara inferior del pilar (y = 5,9), lejos de esquinas y medios
    const c = enganchar(ix, [4.65, 5.88], 0.05)!;
    expect(c.tipo).toBe("cara");
    expect(c.p[1]).toBeCloseTo(5.9, 12);
  });

  it("el radio es de 10 px a cualquier zoom", () => {
    // El cruce B-1 (0; 6,3), en diagonal hacia dentro: a 9 px engancha, a 11 px no (queda el más cercano del eje)
    const k = Math.SQRT1_2;
    for (const escala of [5, 50, 500]) {
      const radio = RADIO_ENGANCHE / escala;
      expect(enganchar(ix, [(9 * k) / escala, 6.3 - (9 * k) / escala], radio)?.tipo).toBe("cruce");
      expect(enganchar(ix, [(11 * k) / escala, 6.3 - (11 * k) / escala], radio)?.tipo).toBe("cercano");
    }
  });

  it("los tipos se pueden desactivar", () => {
    expect(enganchar(ix, [0.01, 0.01], 0.1, { activos: new Set(["cruce"]) })!.tipo).toBe("cruce");
    expect(enganchar(ix, [0.01, 0.01], 0.1, { activos: new Set() })).toBeNull();
  });

  it("ortogonal: a 0°/90° de los ejes, con la otra coordenada bit a bit, y a 45° con Mayús", () => {
    const u: Vec2 = [1.1, 2.3];
    expect(ortogonal(u, [4, 2.5], 0, false)).toEqual([4, 2.3]);
    expect(ortogonal(u, [1.3, 7], 0, false)).toEqual([1.1, 7]);
    const d = ortogonal([0, 0], [3, 2.8], 0, true);
    expect(d[0]).toBeCloseTo(2.9, 12);
    expect(d[1]).toBeCloseTo(2.9, 12);
    // Un enganche gana al ortogonal
    expect(apuntar(ix, [10.02, 6.31], 0.05, { ultimo: u, orto: true }).enganche?.tipo).toBe("cruce");
    expect(apuntar(ix, [8, 4], 0.05, { ultimo: u, orto: true }).p).toEqual([8, 2.3]);
    expect(apuntar(ix, [8, 4], 0.05, { ultimo: u }).p).toEqual([8, 4]);
  });

  it("lo que hay bajo el cursor: el pilar, la viga, el eje", () => {
    expect(bajoCursor(ix, [4.8, 6.1], 0.05)?.id).toBe(pilar.id);
    expect(bajoCursor(ix, [7, 0.1], 0.05)?.id).toBe(p0.modelo.vigas![0]!.id);
    expect(bajoCursor(ix, [10.02, 4], 0.05)?.id).toBe("3");
    expect(bajoCursor(ix, [7, 3], 0.05)).toBeNull();
  });
});

describe("lo que se teclea", () => {
  it("lee absolutas, relativas, polares y longitudes con coma o punto decimal", () => {
    expect(leerEntrada("12,5; 4")).toEqual({ ok: true, valor: { tipo: "absoluta", p: [12.5, 4] } });
    expect(leerEntrada("3,5 4,2")).toEqual({ ok: true, valor: { tipo: "absoluta", p: [3.5, 4.2] } });
    expect(leerEntrada("3, 5")).toEqual({ ok: true, valor: { tipo: "absoluta", p: [3, 5] } });
    expect(leerEntrada("3.5,4.2")).toEqual({ ok: true, valor: { tipo: "absoluta", p: [3.5, 4.2] } });
    expect(leerEntrada("@6; 0")).toEqual({ ok: true, valor: { tipo: "relativa", d: [6, 0] } });
    expect(leerEntrada("@5<90")).toEqual({ ok: true, valor: { tipo: "polar", l: 5, angulo: 90 } });
    expect(leerEntrada("6,3")).toEqual({ ok: true, valor: { tipo: "longitud", l: 6.3 } });
    expect(leerEntrada("3,5,4").ok).toBe(false);
    expect(leerEntrada("@5<").ok).toBe(false);
  });

  it("resuelve con el último punto y el cursor", () => {
    const c = { ultimo: [1, 2] as Vec2, cursor: [9, 2.4] as Vec2, direccion: 0, orto: true, mayus: false };
    expect(resolverEntrada({ tipo: "relativa", d: [6, 0] }, c)).toEqual({ ok: true, valor: [7, 2] });
    expect(resolverEntrada({ tipo: "polar", l: 5, angulo: 90 }, c)).toEqual({ ok: true, valor: [1, 7] });
    expect(resolverEntrada({ tipo: "longitud", l: 4 }, c)).toEqual({ ok: true, valor: [5, 2] });
    // Con los ejes de la losa a 30°, el polar va desde ellos
    const r = resolverEntrada({ tipo: "polar", l: 2, angulo: 60 }, { ...c, direccion: 30 });
    expect(r.ok && r.valor).toEqual([1, 4]);
    expect(resolverEntrada({ tipo: "relativa", d: [1, 1] }, { ...c, ultimo: null }).ok).toBe(false);
  });
});

describe("herramientas (criterio 1: lo mismo que la tabla)", () => {
  it("Pilar: un clic en un cruce es la fila de la tabla con esas coordenadas", () => {
    const p = base(EJES);
    const r = dibujar(p, "pilar", [clic(p, [5.02, 6.29])], { ...PLANTILLAS, pilar: { seccion: "P30", giro: 90, fijo: "mitad-derecha" } });
    expect(r.etiquetas).toEqual(["Pilar P1"]);
    const t = conTabla(p, "pilares", { x: "5", y: "6,3", desde: "Cim", hasta: "N1", seccion: "P30", giro: "90", fijo: "mitad-derecha" });
    expect(serializar(r.proyecto)).toBe(serializar(t));
  });

  it("Pilar con ventana: uno en cada cruce de dentro, por filas de arriba abajo; y no repite", () => {
    const p = base(EJES);
    const r = dibujar(p, "pilar", [{ tipo: "ventana", caja: [-1, -1, 6, 7] }]);
    expect(r.etiquetas).toEqual(["4 pilares en los cruces de ejes"]);
    expect(r.proyecto.modelo.pilares!.map((x) => [x.id, x.x, x.y])).toEqual([
      ["P1", 0, 6.3],
      ["P2", 5, 6.3],
      ["P3", 0, 0],
      ["P4", 5, 0],
    ]);
    const otra = dibujar(r.proyecto, "pilar", [{ tipo: "ventana", caja: [-1, -1, 11, 7] }, { tipo: "ventana", caja: [-1, -1, 11, 7] }]);
    expect(otra.proyecto.modelo.pilares!.length).toBe(6);
    expect(otra.errores).toEqual(["Ya hay un pilar en todos los cruces de la ventana."]);
    // Con un clic, tampoco
    expect(dibujar(r.proyecto, "pilar", [clic(r.proyecto, [0, 0])]).errores[0]).toMatch(/Ya hay un pilar \(P3\)/);
  });

  it("Pilar: sin sección o con la base por encima, no crea nada y dice por qué", () => {
    const p = base(EJES);
    expect(dibujar(p, "pilar", [clic(p, [0, 0])], { ...PLANTILLAS, pilar: {} }).errores[0]).toMatch(/sección/);
    expect(dibujar(p, "pilar", [clic(p, [0, 0], null, "Cim")], PLANTILLAS, "Cim").errores[0]).toMatch(/por debajo/);
  });

  it("Viga: polilínea enganchada; el doble clic no repite el punto; Retroceso y Esc", () => {
    const p = dibujar(base(EJES), "pilar", [{ tipo: "ventana", caja: [-1, -1, 11, 7] }]).proyecto;
    const a: Vec2 = [0.01, 6.31];
    const r = dibujar(p, "viga", [clic(p, a), clic(p, [7, 6.6]), { tipo: "retroceso" }, clic(p, [5.02, 6.3]), clic(p, [10, 6.29]), clic(p, [10, 6.29]), { tipo: "terminar" }]);
    expect(r.etiquetas).toEqual(["Viga V1"]);
    const t = conTabla(p, "vigas", { planta: "N1", puntos: "0 6,3; 5 6,3; 10 6,3", seccion: "V30x50" });
    expect(serializar(r.proyecto)).toBe(serializar(t));
    // Esc con puntos anula; sin puntos, sale
    const e = dibujar(p, "viga", [clic(p, a), { tipo: "anular" }]);
    expect(e.estado.puntos.length).toBe(0);
    expect(e.salir).toBe(false);
    expect(dibujar(p, "viga", [{ tipo: "anular" }]).salir).toBe(true);
    expect(dibujar(p, "viga", [clic(p, a), { tipo: "terminar" }]).errores).toEqual(["Una viga necesita al menos dos puntos."]);
  });

  it("Viga alineada a la cara de los pilares (V2c-b)", () => {
    const p = conTabla(conTabla(base(EJES), "pilares", { x: "0", y: "0", desde: "Cim", hasta: "N1", seccion: "P40" }), "pilares", { x: "5", y: "0", desde: "Cim", hasta: "N1", seccion: "P40" });
    const plantillas = (alinear: "izquierda" | "derecha"): Plantillas => ({ ...PLANTILLAS, viga: { seccion: "V30x50", alinear } });
    // De izquierda a derecha, la izquierda es +Y: la cara de la viga en y = 0,2, la del pilar
    const vigaCon = (alinear: "izquierda" | "derecha") => dibujar(p, "viga", [clic(p, [0, 0]), clic(p, [5, 0]), { tipo: "terminar" }], plantillas(alinear)).proyecto.modelo.vigas![0]!.puntos;
    for (const [lado, y] of [["izquierda", 0.05], ["derecha", -0.05]] as const) {
      const v = vigaCon(lado);
      // La x no se mueve (el tramo va según X) y las dos y son la misma
      expect([v[0]![0], v[1]![0]]).toEqual([0, 5]);
      expect(v[0]![1]).toBe(v[1]![1]);
      expect(v[0]![1]).toBeCloseTo(y, 15);
    }
    // Una L: el vértice es el cruce de los dos tramos desplazados
    const q = conTabla(p, "pilares", { x: "5", y: "6,3", desde: "Cim", hasta: "N1", seccion: "P40" });
    const ix = indiceEnganches(q.modelo, "N1");
    const esquinas: Vec2[] = [[0, 0], [5, 0], [5, 6.3]];
    const pts = esquinas.map((x) => ({ p: x, pilar: ix.siluetas.find((s) => s.tipo === "pilar" && s.cerrados[0]!.some((c) => Math.abs(c[0] - x[0]) < 0.3 && Math.abs(c[1] - x[1]) < 0.3))!.id }));
    const l = alinearACara(q.modelo, "N1", pts, "derecha", 0.3);
    expect(l[0]![1]).toBeCloseTo(-0.05, 12);
    expect(l[1]![0]).toBeCloseTo(5.05, 12);
    expect(l[1]![1]).toBeCloseTo(-0.05, 12);
    expect(l[2]![0]).toBeCloseTo(5.05, 12);
  });

  it("Ejes: dos clics; el nombre siguiente, letra o número; el primero guarda los propuestos", () => {
    const p = base(EJES);
    const r = dibujar(p, "ejes", [clic(p, [-2, 12]), clic(p, [-2, 12]), { tipo: "punto", p: [12, 12] }, { tipo: "punto", p: [15, -2] }, { tipo: "punto", p: [15, 8] }]);
    expect(r.etiquetas).toEqual(["Eje C", "Eje 4"]);
    expect(r.proyecto.modelo.ejes!.slice(-2)).toEqual([
      { id: "C", desde: [-2, 12], hasta: [12, 12] },
      { id: "4", desde: [15, -2], hasta: [15, 8] },
    ]);
    // Sin ejes en el modelo, con los propuestos de los pilares
    const sin = dibujar(base(), "pilar", [{ tipo: "punto", p: [0, 0] }, { tipo: "punto", p: [6, 0] }, { tipo: "punto", p: [0, 5] }, { tipo: "punto", p: [6, 5] }]).proyecto;
    expect(sin.modelo.ejes).toBeUndefined();
    const h = ejeNuevo(sin.modelo, [-2, 9], [8, 9]);
    expect(h.etiqueta).toBe("Eje C (y los 4 propuestos)");
    const a = aplicar(sin, h.operacion);
    expect(a.ok && a.proyecto.modelo.ejes!.map((e) => e.id)).toEqual(["1", "2", "A", "B", "C"]);
    // «Proponer ejes» los guarda; con ejes en el modelo, no hay propuesta
    const pr = operacionProponerEjes(sin.modelo)!;
    const b = aplicar(sin, pr.operacion);
    expect(b.ok && b.proyecto.modelo.ejes!.length).toBe(4);
    expect(operacionProponerEjes(b.ok ? b.proyecto.modelo : sin.modelo)).toBeNull();
  });
});

describe("dibujar desde los ejes compila sin ajustes (criterio 2) y se deshace (criterio 4)", () => {
  it("una retícula de 2 × 1 con vigas por los pilares, una en T por el punto medio y una losa a ejes", () => {
    const p0 = base(EJES);
    let h = historial(p0);
    const hacerTodo = (nombre: NombreHerramienta, eventos: Evento[], plantillas = PLANTILLAS) => {
      // Cada evento con el proyecto de ese momento: como en la app, el índice se rehace al cambiar
      let e: EstadoHerramienta = ESTADO_INICIAL;
      for (const ev of eventos) {
        const ctx: ContextoHerramienta = { modelo: h.actual.modelo, planta: "N1", indice: indiceEnganches(h.actual.modelo, "N1"), plantillas };
        const r = paso(nombre, e, ev, ctx);
        e = r.estado;
        if (r.hecho) {
          const a = aplicar(h.actual, r.hecho.operacion);
          if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
          h = hacer(h, a.proyecto, r.hecho.etiqueta);
        }
      }
    };
    const en = (q: Vec2, ultimo: Vec2 | null = null) => clic(h.actual, q, ultimo);
    hacerTodo("pilar", [{ tipo: "ventana", caja: [-1, -1, 11, 7] }]);
    hacerTodo("viga", [en([0, 0]), en([5.01, 0]), en([10, 0.01]), { tipo: "terminar" }]);
    hacerTodo("viga", [en([0, 6.3]), en([10, 6.3]), { tipo: "terminar" }]);
    for (const x of [0, 5, 10]) hacerTodo("viga", [en([x, 0]), en([x, 6.3]), { tipo: "terminar" }]);
    // Una viga en T desde el punto medio de un vano hasta el de enfrente, por la perpendicular
    hacerTodo("viga", [en([2.51, 0.01]), en([2.49, 6.31], [2.5, 0]), { tipo: "terminar" }]);
    const vt = h.actual.modelo.vigas!.at(-1)!;
    expect(vt.puntos).toEqual([
      [2.5, 0],
      [2.5, 6.3],
    ]);
    const losa: Operacion = { op: "crear", coleccion: "losas", objeto: { id: "L1", planta: "N1", contorno: [[0, 0], [10, 0], [10, 6.3], [0, 6.3]], espesor: 0.25, material: "HA-30" } };
    const a = aplicar(h.actual, losa);
    expect(a.ok).toBe(true);
    const c = compilar(a.ok ? a.proyecto.modelo : h.actual.modelo);
    const malos = c.diagnosticos.filter((d) => ["losa/ajuste", "muro/ajuste", "topologia/casi-encuentro", "topologia/fusion", "topologia/nudos-proximos"].includes(d.codigo) || d.severidad === "error");
    expect(malos).toEqual([]);
    // Una acción, un paso: 1 ventana + 6 vigas; deshacer todo da el proyecto de partida, byte a byte
    expect(h.pasado.length).toBe(7);
    while (h.pasado.length) h = deshacer(h);
    expect(h.actual).toBe(p0);
    expect(serializar(h.actual)).toBe(serializar(p0));
  });
});
