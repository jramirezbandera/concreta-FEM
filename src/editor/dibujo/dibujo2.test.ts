/**
 * V2c-2 (`docs/fem3d/dibujo.md` §4): Forjado (recuadro y polígono), Hueco, Muro, Apoyo, Apoyo
 * lineal y las cinco cargas dan lo que daría la tabla (criterio 1); el recuadro va por los ejes con
 * sus números y lo dibujado compila sin ajustes (criterio 2); deshacer deja el proyecto de partida
 * (criterio 4).
 */
import { describe, expect, it } from "vitest";
import type { Proyecto } from "../../agente/proyecto.ts";
import { compilar } from "../../compilador/compilar.ts";
import type { ModeloFisico, Vec2 } from "../../compilador/fisico.ts";
import { escribirFila } from "../edicion.ts";
import { deshacer, hacer, historial } from "../historial.ts";
import { aplicar } from "../operaciones.ts";
import { proyectoNuevo } from "../plantilla.ts";
import { serializar } from "../serializar.ts";
import { apuntar, indiceEnganches, RADIO_ENGANCHE } from "./enganches.ts";
import { ESTADO_INICIAL, borrador, paso, type ContextoHerramienta, type EstadoHerramienta, type Evento, type NombreHerramienta, type Plantillas } from "./herramientas.ts";
import { ANCHO_ZUNCHO, desplazar, rectangulo } from "./piezas.ts";
import { operacionVigasBorde, proponerVigasBorde } from "../vigasBorde.ts";
import { contornoDesde, recuadroEn, recuadrosDe } from "./recuadros.ts";

const SECCIONES = [
  { id: "P30", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.3 },
  { id: "V30x50", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.5 },
  { id: "T70", material: "HA-30", forma: "T", bf: 0.7, hf: 0.05, bw: 0.12, h: 0.3 },
] as const;

const EJES: ModeloFisico["ejes"] = [
  { id: "A", desde: [-2, 0], hasta: [12, 0] },
  { id: "B", desde: [-2, 6.3], hasta: [12, 6.3] },
  { id: "1", desde: [0, -2], hasta: [0, 8.3] },
  { id: "2", desde: [5, -2], hasta: [5, 8.3] },
  { id: "3", desde: [10, -2], hasta: [10, 8.3] },
];

const conTabla = (p: Proyecto, tabla: Parameters<typeof escribirFila>[1], fila: Record<string, string>, id: string | null = null) => {
  const a = escribirFila(p, tabla, id, fila);
  if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
  return a.proyecto;
};

/** Una retícula de 2 × 1 vanos (10 × 6,3 m) con pilares en los cruces y vigas por sus ejes. */
function reticula(): Proyecto {
  const p0 = proyectoNuevo("dibujo");
  let p: Proyecto = { ...p0, modelo: { ...p0.modelo, secciones: SECCIONES as unknown as ModeloFisico["secciones"], ejes: EJES } };
  for (const [x, y] of [[0, 0], [5, 0], [10, 0], [0, 6.3], [5, 6.3], [10, 6.3]]) p = conTabla(p, "pilares", { x: String(x).replace(".", ","), y: String(y).replace(".", ","), desde: "Cim", hasta: "N1", seccion: "P30" });
  for (const ps of ["0 0; 5 0; 10 0", "0 6,3; 5 6,3; 10 6,3", "0 0; 0 6,3", "5 0; 5 6,3", "10 0; 10 6,3"]) p = conTabla(p, "vigas", { planta: "N1", puntos: ps, seccion: "V30x50" });
  return p;
}

const PLANTILLAS: Plantillas = {
  pilar: { seccion: "P30" },
  viga: { seccion: "V30x50" },
  forjado: { tipo: "maciza", espesor: 0.25, material: "HA-30" },
  // Lo que da la tabla, sin zunchos (los prueba «Con zunchos»)
  hueco: { zunchos: false },
  muro: { espesor: 0.25, material: "HA-30" },
  cargas: { caso: "G" },
};

function dibujar(p: Proyecto, h: NombreHerramienta, eventos: Evento[], plantillas: Plantillas = PLANTILLAS, planta = "N1") {
  let q = p;
  let e: EstadoHerramienta = ESTADO_INICIAL;
  const errores: string[] = [];
  const etiquetas: string[] = [];
  for (const ev of eventos) {
    const ctx: ContextoHerramienta = { modelo: q.modelo, planta, indice: indiceEnganches(q.modelo, planta), plantillas };
    const r = paso(h, e, ev, ctx);
    e = r.estado;
    if (r.error) errores.push(r.error);
    if (r.hecho) {
      const a = aplicar(q, r.hecho.operacion);
      if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
      q = a.proyecto;
      etiquetas.push(r.hecho.etiqueta);
    }
  }
  return { proyecto: q, estado: e, errores, etiquetas };
}

/** Un clic enganchado en q (10 px a 50 px/m), con el cursor sin enganchar y el radio, como lo da la vista. */
const clic = (p: Proyecto, q: Vec2, ultimo: Vec2 | null = null, planta = "N1"): Evento => {
  const radio = RADIO_ENGANCHE / 50;
  const a = apuntar(indiceEnganches(p.modelo, planta), q, radio, { ultimo });
  return { tipo: "punto", p: a.p, enganche: a.enganche, cursor: q, radio };
};
const punto = (p: Vec2): Evento => ({ tipo: "punto", p });

describe("recuadros", () => {
  it("los recuadros de una retícula, por los ejes y con sus números; lo que cuelga no cierra nada", () => {
    const piezas: [Vec2, Vec2][] = [
      [[0, 0], [5, 0]],
      [[5, 0], [10, 0]],
      [[0, 6.3], [10, 6.3]],
      [[0, 0], [0, 6.3]],
      [[5, 0], [5, 6.3]],
      [[10, 0], [10, 6.3]],
      // Una viga que no llega a nada y una que sale de la retícula
      [[7, 2], [8, 3]],
      [[10, 3], [13, 3]],
    ];
    const rs = recuadrosDe(piezas);
    expect(rs.length).toBe(2);
    const r = recuadroEn(rs, [7.5, 2.5])!;
    // El de 5 × 6,3, desde el vértice más cercano al punto, sin el (10; 3) colineal
    expect(contornoDesde(r.anillo, [9, 6])).toEqual([
      [10, 6.3],
      [5, 6.3],
      [5, 0],
      [10, 0],
    ]);
    expect(r.simple).toBe(true);
    expect(recuadroEn(rs, [11, 1])).toBeNull();
  });

  it("piezas colineales solapadas y en T se cortan; el cruce de ejes paralelos a X y a Y tiene sus números", () => {
    // Un recuadro de 6 × 5 hecho con una viga larga y otra encima que la solapa, y una en T por dentro
    const rs = recuadrosDe([
      [[-1, 0], [7, 0]],
      [[3, 0], [6, 0]],
      [[0, -1], [0, 5]],
      [[6, -1], [6, 5]],
      [[0, 5], [6, 5]],
      [[2, 0], [2, 5]],
    ]);
    expect(contornoDesde(recuadroEn(rs, [4, 1])!.anillo, [6, 0])).toEqual([
      [6, 0],
      [6, 5],
      [2, 5],
      [2, 0],
    ]);
  });
});

describe("Forjado (criterio 1)", () => {
  it("un clic en un recuadro es la fila de la tabla con su contorno, desde el vértice más cercano", () => {
    const p = reticula();
    const r = dibujar(p, "forjado", [clic(p, [4, 5.5])]);
    expect(r.etiquetas).toEqual(["Forjado L1 (maciza)"]);
    const t = conTabla(p, "forjados", { planta: "N1", tipo: "maciza", contorno: "5 6,3; 0 6,3; 0 0; 5 0", espesor: "0,25", material: "HA-30" });
    expect(serializar(r.proyecto)).toBe(serializar(t));
    // Otra vez en el mismo sitio: ya hay uno; fuera de la retícula, ninguno
    expect(dibujar(r.proyecto, "forjado", [clic(r.proyecto, [1, 1])]).errores).toEqual(["Ya hay un forjado (L1) ahí."]);
    expect(dibujar(p, "forjado", [clic(p, [11, 1])]).errores[0]).toMatch(/ningún recuadro/);
  });

  it("el borde de un forjado cierra el recuadro de al lado (enrasados), y un paño unidireccional empieza en la esquina del clic", () => {
    const p0 = proyectoNuevo("dibujo");
    let p: Proyecto = { ...p0, modelo: { ...p0.modelo, secciones: SECCIONES as unknown as ModeloFisico["secciones"] } };
    p = conTabla(p, "vigas", { planta: "N1", puntos: "0 0; 10 0; 10 5; 0 5; 0 0", seccion: "V30x50" });
    p = conTabla(p, "forjados", { planta: "N1", tipo: "maciza", contorno: "0 0; 4 0; 4 5; 0 5", espesor: "0,25", material: "HA-30" });
    const plantillas: Plantillas = { ...PLANTILLAS, forjado: { tipo: "unidireccional", direccion: 90, intereje: 0.7, seccion: "T70", pp: 3.5 } };
    const r = dibujar(p, "forjado", [clic(p, [9.5, 0.3])], plantillas);
    expect(r.errores).toEqual([]);
    const t = conTabla(p, "forjados", { planta: "N1", tipo: "unidireccional", contorno: "10 0; 10 5; 4 5; 4 0", direccion: "90", intereje: "0,7", seccion: "T70", pp: "3,5" });
    expect(serializar(r.proyecto)).toBe(serializar(t));
  });

  it("reticular con su plantilla, y lo que falta en ella se dice", () => {
    const p = reticula();
    const ret: Plantillas = { ...PLANTILLAS, forjado: { tipo: "reticular", espesor: 0.3, material: "HA-30", intereje: 0.8, nervio: 0.12, capa: 0.05, pp: 4.3 } };
    const r = dibujar(p, "forjado", [clic(p, [6, 1])], ret);
    const t = conTabla(p, "forjados", { planta: "N1", tipo: "reticular", contorno: "5 0; 10 0; 10 6,3; 5 6,3", espesor: "0,3", material: "HA-30", pp: "4,3", intereje: "0,8", nervio: "0,12", capa: "0,05" });
    expect(serializar(r.proyecto)).toBe(serializar(t));
    // Sin pp, sale del casetón (de hormigón, por defecto); con uno perdido de otro material, falta
    const sinPp = dibujar(p, "forjado", [clic(p, [6, 1])], { ...ret, forjado: { ...ret.forjado, pp: undefined } });
    expect(sinPp.errores).toEqual([]);
    expect(serializar(sinPp.proyecto)).toBe(serializar(conTabla(p, "forjados", { planta: "N1", tipo: "reticular", contorno: "5 0; 10 0; 10 6,3; 5 6,3", espesor: "0,3", material: "HA-30", intereje: "0,8", nervio: "0,12", capa: "0,05" })));
    expect(dibujar(p, "forjado", [clic(p, [6, 1])], { ...ret, forjado: { ...ret.forjado, pp: undefined, caseton: "perdido" } }).errores[0]).toMatch(/casetón perdido de otro material/);
    expect(dibujar(p, "forjado", [clic(p, [6, 1])], { ...PLANTILLAS, forjado: { tipo: "maciza", espesor: 0.25 } }).errores[0]).toMatch(/material/);
  });

  it("como polígono: clic a clic, y un clic en el primero lo cierra; no puede pisar otro", () => {
    const p = reticula();
    const pol: Plantillas = { ...PLANTILLAS, forjado: { ...PLANTILLAS.forjado, modo: "poligono" } };
    const r = dibujar(p, "forjado", [clic(p, [0, 0]), clic(p, [10, 0]), clic(p, [10, 6.3]), clic(p, [0, 6.3]), clic(p, [0.02, 0.01])], pol);
    expect(r.etiquetas).toEqual(["Forjado L1 (maciza)"]);
    const t = conTabla(p, "forjados", { planta: "N1", tipo: "maciza", contorno: "0 0; 10 0; 10 6,3; 0 6,3", espesor: "0,25", material: "HA-30" });
    expect(serializar(r.proyecto)).toBe(serializar(t));
    const otro = dibujar(r.proyecto, "forjado", [punto([8, 3]), punto([12, 3]), punto([12, 5]), { tipo: "terminar" }], pol);
    expect(otro.errores).toEqual(["Se solaparía con el forjado L1."]);
  });

  it("con zunchos: lo mismo que dibujarlo sin ellos y «Vigas de borde» después, en un paso; cerrado por vigas, ninguno", () => {
    const p0 = proyectoNuevo("zunchos");
    const p: Proyecto = { ...p0, modelo: { ...p0.modelo, secciones: SECCIONES as unknown as ModeloFisico["secciones"], ejes: EJES } };
    const eventos = [punto([0, 0]), punto([10, 0]), punto([10, 6.3]), punto([0, 6.3]), punto([0, 0])];
    const con: Plantillas = { ...PLANTILLAS, forjado: { ...PLANTILLAS.forjado, modo: "poligono" } };
    const r = dibujar(p, "forjado", eventos, con);
    expect(r.etiquetas).toEqual(["Forjado L1 (maciza) con 4 zunchos"]);
    // El oráculo: sin la casilla, y la orden de la barra con 0,30 × el canto
    const sin = dibujar(p, "forjado", eventos, { ...con, forjado: { ...con.forjado, zunchos: false } });
    expect(sin.etiquetas).toEqual(["Forjado L1 (maciza)"]);
    const pr = proponerVigasBorde(sin.proyecto.modelo, "L1", ANCHO_ZUNCHO, 0.25);
    if ("error" in pr) throw new Error(pr.error);
    const a = aplicar(sin.proyecto, operacionVigasBorde(sin.proyecto.modelo, pr)!);
    if (!a.ok) throw new Error();
    expect(serializar(r.proyecto)).toBe(serializar(a.proyecto));
    expect(r.proyecto.modelo.vigas!.length).toBe(4);
    // Un paso de deshacer
    const h = hacer(historial(p), r.proyecto, r.etiquetas[0]!);
    expect(serializar(deshacer(h).actual)).toBe(serializar(p));
    // El ancho de la plantilla
    const b40 = dibujar(p, "forjado", eventos, { ...con, forjado: { ...con.forjado, anchoZuncho: 0.4 } });
    expect(b40.proyecto.modelo.secciones.find((x) => x.id === b40.proyecto.modelo.vigas![0]!.seccion)).toMatchObject({ b: 0.4, h: 0.25 });
    // Cerrado por vigas: ninguno, lo de la tabla
    const q = reticula();
    const rq = dibujar(q, "forjado", [clic(q, [2, 2])], { ...PLANTILLAS, forjado: { ...PLANTILLAS.forjado, zunchos: true } });
    expect(rq.etiquetas).toEqual(["Forjado L1 (maciza)"]);
  });

  it("con zunchos, un hueco: sólo en sus lados, y el contorno de la losa no se toca", () => {
    const p = conTabla(reticula(), "forjados", { planta: "N1", tipo: "maciza", contorno: "0 0; 10 0; 10 6,3; 0 6,3", espesor: "0,25", material: "HA-30" });
    const eventos = [punto([6.6, 2.4]), punto([8.4, 4.6])];
    const r = dibujar(p, "hueco", eventos, { ...PLANTILLAS, hueco: { zunchos: true } });
    expect(r.etiquetas).toEqual(["Hueco en el forjado L1 con 4 zunchos"]);
    const l = r.proyecto.modelo.losas![0]!;
    expect(l.contorno).toEqual(p.modelo.losas![0]!.contorno);
    // El hueco no se toca (fase TB): los zunchos, enrasados por fuera de él, con su eje a b/2 de sus lados
    expect(l.huecos).toEqual([[[6.6, 2.4], [8.4, 2.4], [8.4, 4.6], [6.6, 4.6]]]);
    const antes = new Set((p.modelo.vigas ?? []).map((v) => v.id));
    const zunchos = r.proyecto.modelo.vigas!.filter((v) => !antes.has(v.id)).flatMap((v) => v.puntos);
    expect([Math.min(...zunchos.map((q) => q[0])), Math.max(...zunchos.map((q) => q[0])), Math.min(...zunchos.map((q) => q[1])), Math.max(...zunchos.map((q) => q[1]))]).toEqual([6.45, 8.55, 2.25, 4.75]);
    const sin = dibujar(p, "hueco", eventos);
    const pr = proponerVigasBorde(sin.proyecto.modelo, "L1", ANCHO_ZUNCHO, 0.25, undefined, new Set([1]));
    if ("error" in pr) throw new Error(pr.error);
    const a = aplicar(sin.proyecto, operacionVigasBorde(sin.proyecto.modelo, pr)!);
    if (!a.ok) throw new Error();
    expect(serializar(r.proyecto)).toBe(serializar(a.proyecto));
  });

  it("el borrador del recuadro sigue al cursor sin enganchar", () => {
    const p = reticula();
    const ix = indiceEnganches(p.modelo, "N1");
    const b = borrador("forjado", ESTADO_INICIAL, [5, 3], { modelo: p.modelo, planta: "N1", indice: ix, plantillas: PLANTILLAS }, [5.1, 3]);
    expect(b.anillos).toEqual([
      [
        [5, 0],
        [10, 0],
        [10, 6.3],
        [5, 6.3],
      ],
    ]);
  });
});

describe("Hueco, Muro y apoyos (criterio 1)", () => {
  const conLosa = () => conTabla(reticula(), "forjados", { planta: "N1", tipo: "maciza", contorno: "0 0; 10 0; 10 6,3; 0 6,3", espesor: "0,25", material: "HA-30" });

  it("Hueco en un forjado: un rectángulo de dos esquinas o un polígono, dentro de él", () => {
    const p = conLosa();
    const r = dibujar(p, "hueco", [punto([6.6, 2.4]), punto([8.4, 4.6])]);
    expect(r.etiquetas).toEqual(["Hueco en el forjado L1"]);
    const t = conTabla(p, "forjados", { ...filaLosa(p), huecos: "6,6 2,4; 8,4 2,4; 8,4 4,6; 6,6 4,6" }, "L1");
    expect(serializar(r.proyecto)).toBe(serializar(t));
    // Al revés (de arriba a la derecha hacia abajo a la izquierda), el mismo rectángulo antihorario
    expect(rectangulo([8.4, 4.6], [6.6, 2.4], 0)).toEqual([[8.4, 4.6], [6.6, 4.6], [6.6, 2.4], [8.4, 2.4]]);
    // Que se sale: no
    expect(dibujar(p, "hueco", [punto([9, 5]), punto([11, 6])]).errores[0]).toMatch(/dentro del forjado L1/);
    const pol = dibujar(p, "hueco", [punto([2, 2]), punto([3, 2]), punto([2.5, 3]), punto([2, 2])], { ...PLANTILLAS, hueco: { ...PLANTILLAS.hueco, modo: "poligono" } });
    expect(pol.proyecto.modelo.losas![0]!.huecos).toEqual([[[2, 2], [3, 2], [2.5, 3]]]);
  });

  it("Muro: polilínea; un clic en el primero lo cierra; con una cara en lo dibujado, el eje medio espesor más allá", () => {
    const p = reticula();
    const r = dibujar(p, "muro", [punto([6, 1]), punto([9, 1]), punto([9, 4]), punto([6, 4]), punto([6, 1])]);
    expect(r.etiquetas).toEqual(["Muro M1 (cerrado)"]);
    const t = conTabla(p, "muros", { puntos: "6 1; 9 1; 9 4; 6 4; 6 1", desde: "Cim", hasta: "N1", espesor: "0,25", material: "HA-30" });
    expect(serializar(r.proyecto)).toBe(serializar(t));
    // Con la cara izquierda (hacia dentro de un recorrido antihorario) en lo dibujado, el eje va por fuera
    const c = dibujar(p, "muro", [punto([6, 1]), punto([9, 1]), punto([9, 4]), punto([6, 4]), punto([6, 1])], { ...PLANTILLAS, muro: { ...PLANTILLAS.muro, alinear: "izquierda" } });
    expect(c.proyecto.modelo.muros![0]!.puntos).toEqual([[5.875, 0.875], [9.125, 0.875], [9.125, 4.125], [5.875, 4.125], [5.875, 0.875]]);
    expect(desplazar([[0, 0], [4, 0], [4, 3]], 0.5)).toEqual([[0, 0.5], [3.5, 0.5], [3.5, 3]]);
  });

  it("Hueco en un muro: las estaciones en un tramo (redondeadas) y las alturas sobre el suelo de la planta de abajo", () => {
    const p0 = conTabla(reticula(), "muros", { puntos: "6 1; 9 1; 9 4", desde: "Cim", hasta: "N1", espesor: "0,25", material: "HA-30" });
    const r = dibujar(p0, "hueco", [punto([7.4, 1]), punto([8.2, 1])], { ...PLANTILLAS, hueco: { z0: 0, z1: 1.2 } });
    expect(r.errores).toEqual([]);
    // 7,4 − 6 = 1,4000000000000004 en doble precisión: la estación es 1,4
    const t = conTabla(p0, "muros", { id: "M1", puntos: "6 1; 9 1; 9 4", desde: "Cim", hasta: "N1", espesor: "0,25", material: "HA-30", huecos: "1,4 2,2 0 1,2" }, "M1");
    expect(serializar(r.proyecto)).toBe(serializar(t));
    // En dos tramos, no
    expect(dibujar(p0, "hueco", [punto([8.5, 1]), punto([9, 2])]).errores).toEqual(["El hueco tiene que quedar en un solo tramo del muro."]);
    // En la segunda planta de un muro de dos, las alturas suben la de la primera (3 m)
    const p1 = { ...p0, modelo: { ...p0.modelo, plantas: [{ id: "N2", altura: null }, { id: "N1", altura: 3 }, { id: "Cim", altura: 3 }], muros: [{ ...p0.modelo.muros![0]!, hasta: "N2" }] } };
    const r2 = dibujar(p1, "hueco", [punto([7.4, 1]), punto([8.2, 1])], { ...PLANTILLAS, hueco: { z0: 0.5, z1: 2.1 } }, "N2");
    expect(r2.proyecto.modelo.muros![0]!.huecos).toEqual([{ desde: 1.4, hasta: 2.2, z0: 3.5, z1: 5.1 }]);
  });

  it("Apoyo y apoyo lineal, con lo que coaccionan", () => {
    const p = reticula();
    const a = dibujar(p, "apoyo", [punto([2.5, 3])], { ...PLANTILLAS, apoyo: { coartados: [true, true, true, false, false, false] } });
    expect(serializar(a.proyecto)).toBe(serializar(conTabla(p, "apoyos", { planta: "N1", x: "2,5", y: "3", coartados: "111000" })));
    expect(dibujar(a.proyecto, "apoyo", [punto([2.5, 3])]).errores[0]).toMatch(/Ya hay un apoyo \(A1\)/);
    const l = dibujar(p, "apoyoLineal", [punto([1, 1]), punto([4, 1]), { tipo: "terminar" }]);
    expect(serializar(l.proyecto)).toBe(serializar(conTabla(p, "apoyosLineales", { planta: "N1", puntos: "1 1; 4 1", coartados: "001000" })));
  });
});

/** La fila de la tabla de la losa L1, para cambiarle una columna. */
function filaLosa(p: Proyecto): Record<string, string> {
  const l = p.modelo.losas![0]!;
  return { id: l.id, planta: l.planta, tipo: "maciza", contorno: l.contorno.map((q) => `${q[0]} ${q[1]}`.replace(/\./g, ",")).join("; "), espesor: "0,25", material: l.material };
}

describe("cargas (criterio 1)", () => {
  const conLosa = () => conTabla(reticula(), "forjados", { planta: "N1", tipo: "maciza", contorno: "0 0; 10 0; 10 6,3; 0 6,3", espesor: "0,25", material: "HA-30" });
  const conCargas = (c: NonNullable<Plantillas["cargas"]>): Plantillas => ({ ...PLANTILLAS, cargas: { caso: "G", ...c } });

  it("Puntual, lineal y de superficie (forjado entero y zona dentro de él)", () => {
    const p = conLosa();
    const pu = dibujar(p, "puntual", [punto([2.5, 3])], conCargas({ puntual: { F: [0, 0, -10] } }));
    expect(serializar(pu.proyecto)).toBe(serializar(conTabla(p, "cargas", { tipo: "puntual", caso: "G", planta: "N1", x: "2,5", y: "3", F: "0 0 -10" })));
    expect(dibujar(p, "puntual", [punto([2.5, 3])], conCargas({})).errores[0]).toMatch(/fuerza o el momento/);
    const li = dibujar(p, "lineal", [punto([1, 1]), punto([4, 1]), punto([4, 5]), { tipo: "terminar" }], conCargas({ lineal: { q: [0, 0, -7] } }));
    expect(serializar(li.proyecto)).toBe(serializar(conTabla(p, "cargas", { tipo: "lineal", caso: "G", planta: "N1", puntos: "1 1; 4 1; 4 5", q: "0 0 -7" })));
    const su = dibujar(p, "superficie", [clic(p, [3, 3])], conCargas({ superficie: { q: [0, 0, -2] } }));
    expect(su.etiquetas).toEqual(["Carga Q1 (superficie en L1, G)"]);
    expect(serializar(su.proyecto)).toBe(serializar(conTabla(p, "cargas", { tipo: "superficie", caso: "G", planta: "N1", sobre: "L1", q: "0 0 -2" })));
    const zo = dibujar(p, "superficie", [punto([1, 1]), punto([3, 1]), punto([3, 2]), punto([1, 2]), punto([1, 1])], conCargas({ superficie: { q: [0, 0, -3], modo: "zona" } }));
    expect(serializar(zo.proyecto)).toBe(serializar(conTabla(p, "cargas", { tipo: "superficie", caso: "G", planta: "N1", sobre: "L1", q: "0 0 -3", puntos: "1 1; 3 1; 3 2; 1 2" })));
    // Sin caso, no
    expect(dibujar(p, "puntual", [punto([2.5, 3])], { ...PLANTILLAS, cargas: { puntual: { F: [0, 0, -1] } } }).errores[0]).toMatch(/caso activo/);
  });

  it("En barra: una viga o un pilar enteros; con «tramo», dos clics en la misma viga", () => {
    const p = conLosa();
    const q = conCargas({ barra: { q: [0, 0, -5] } });
    const v = dibujar(p, "barra", [clic(p, [2.5, 0.1])], q);
    expect(serializar(v.proyecto)).toBe(serializar(conTabla(p, "cargas", { tipo: "viga", caso: "G", sobre: "V1", ejes: "global", q: "0 0 -5" })));
    const pi = dibujar(p, "barra", [clic(p, [5.05, 6.28])], conCargas({ barra: { q: [2, 0, 0] } }));
    expect(serializar(pi.proyecto)).toBe(serializar(conTabla(p, "cargas", { tipo: "pilar", caso: "G", sobre: "P5", ejes: "global", q: "2 0 0" })));
    const tr = dibujar(p, "barra", [clic(p, [7, 0.02]), clic(p, [2.2, 0.01])], conCargas({ barra: { q: [0, 0, -5], modo: "tramo" } }));
    // Las estaciones, por la viga de 10 m que pasa por (5; 0)
    expect(serializar(tr.proyecto)).toBe(serializar(conTabla(p, "cargas", { tipo: "viga", caso: "G", sobre: "V1", ejes: "global", q: "0 0 -5", desde: "2,2", hasta: "7" })));
  });

  it("Empuje: un clic en un muro, del lado del terreno", () => {
    const p = conTabla(reticula(), "muros", { puntos: "6 1; 9 1", desde: "Cim", hasta: "N1", espesor: "0,25", material: "HA-30" });
    const t = conCargas({ empuje: { z1: 3, p0: 20 } });
    // Por debajo del eje (de 6 a 9, la derecha)
    const r = dibujar(p, "empuje", [clic(p, [7.3, 0.92])], t);
    expect(serializar(r.proyecto)).toBe(serializar(conTabla(p, "cargas", { tipo: "empuje", caso: "G", sobre: "M1", lado: "derecho", z0: "0", z1: "3", p0: "20", p1: "0" })));
    expect(dibujar(p, "empuje", [clic(p, [7.3, 1.08])], t).proyecto.modelo.cargas![0]).toMatchObject({ lado: "izquierdo" });
    expect(dibujar(p, "empuje", [clic(p, [7.3, 1.08])], conCargas({})).errores[0]).toMatch(/z1 y la presión p0/);
  });
});

describe("lo dibujado compila sin ajustes (criterio 2) y se deshace (criterio 4)", () => {
  it("la retícula con un núcleo, su losa por recuadros, un hueco, un muro con su hueco, apoyos y cargas", () => {
    const p0 = reticula();
    let h = historial(p0);
    const hacerTodo = (nombre: NombreHerramienta, eventos: Evento[], plantillas = PLANTILLAS) => {
      let e: EstadoHerramienta = ESTADO_INICIAL;
      for (const ev of eventos) {
        const ctx: ContextoHerramienta = { modelo: h.actual.modelo, planta: "N1", indice: indiceEnganches(h.actual.modelo, "N1"), plantillas };
        const r = paso(nombre, e, ev, ctx);
        e = r.estado;
        if (r.error) throw new Error(r.error);
        if (r.hecho) {
          const a = aplicar(h.actual, r.hecho.operacion);
          if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
          h = hacer(h, a.proyecto, r.hecho.etiqueta);
        }
      }
    };
    const en = (q: Vec2) => clic(h.actual, q);
    hacerTodo("muro", [punto([6, 2]), punto([9, 2]), punto([9, 4.5]), punto([6, 4.5]), punto([6, 2])]);
    hacerTodo("hueco", [en([7, 2.03]), punto([8, 2])], { ...PLANTILLAS, hueco: { z0: 0, z1: 2.1 } });
    hacerTodo("forjado", [en([2, 3])]);
    hacerTodo("forjado", [en([5.5, 1])]);
    hacerTodo("hueco", [punto([1, 1]), punto([2, 2])]);
    hacerTodo("apoyoLineal", [punto([1, 5]), punto([4, 5]), { tipo: "terminar" }]);
    hacerTodo("superficie", [en([2, 4])], { ...PLANTILLAS, cargas: { caso: "Q", superficie: { q: [0, 0, -3] } } });
    hacerTodo("barra", [en([2.5, 6.32])], { ...PLANTILLAS, cargas: { caso: "G", barra: { q: [0, 0, -6] } } });
    hacerTodo("empuje", [en([7.5, 1.9])], { ...PLANTILLAS, cargas: { caso: "G", empuje: { z1: 3, p0: 15 } } });
    const m = h.actual.modelo;
    // El segundo recuadro (de 5 a 10) rodea el núcleo: su contorno es el de fuera, sin el muro
    expect(m.losas!.map((l) => l.contorno)).toEqual([
      [[0, 0], [5, 0], [5, 6.3], [0, 6.3]],
      [[5, 0], [10, 0], [10, 6.3], [5, 6.3]],
    ]);
    const c = compilar(m);
    const malos = c.diagnosticos.filter((d) => ["losa/ajuste", "muro/ajuste", "topologia/casi-encuentro", "topologia/fusion", "topologia/nudos-proximos"].includes(d.codigo) || d.severidad === "error");
    expect(malos).toEqual([]);
    expect(h.pasado.length).toBe(9);
    while (h.pasado.length) h = deshacer(h);
    expect(serializar(h.actual)).toBe(serializar(p0));
  });
});
