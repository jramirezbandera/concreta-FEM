/**
 * V2c-4, la plantilla DXF (`docs/fem3d/dibujo.md` §10.4): unidades y colocación, el redondeo de lo
 * enganchado (criterio 3), el índice por celdas frente a la fuerza bruta, las prioridades frente al
 * modelo, la operación del editor fuera de la huella (criterio 5) y calcar la retícula con núcleo de
 * A2 desde su DXF (criterio 2).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { leerProyecto, type PlantillaDxf, type Proyecto } from "../../agente/proyecto.ts";
import { huellaCompilacion } from "../../compilador/compilar.ts";
import { resolverOpciones, type ModeloFisico, type Vec2 } from "../../compilador/fisico.ts";
import { dibujoDxf } from "../../dxf/aplanar.ts";
import { dxfDeModelo, escribirDxf, type EntidadPrueba } from "../../pruebas/dxfPrueba.ts";
import { aplicar, type Operacion } from "../operaciones.ts";
import { apuntar, enganchar, indiceEnganches, RADIO_ENGANCHE, type IndiceEnganches } from "./enganches.ts";
import { ESTADO_INICIAL, paso, type EstadoHerramienta, type Evento, type NombreHerramienta, type Plantillas } from "./herramientas.ts";
import { cerca, colocar, girarPlantilla, indicePlantilla, moverPlantilla, nuevaPlantilla, proponerUnidades, redondear, transformacion } from "./plantilla.ts";

const dxf = (es: EntidadPrueba[], o: Parameters<typeof escribirDxf>[1] = {}) => dibujoDxf(escribirDxf(es, o));

describe("unidades y colocación", () => {
  const planta: EntidadPrueba[] = [{ capa: "A", polilinea: [[0, 0], [26.6, 0], [26.6, 18.4], [0, 18.4]], cerrada: true }];

  it("las unidades: $INSUNITS si da un edificio; si no, la primera de m, mm y cm que lo dé", () => {
    // La vivienda: dice mm y está en m
    expect(proponerUnidades(dxf(planta, { insunits: 4 }))).toBe("m");
    expect(proponerUnidades(dxf(planta, { escala: 1000, insunits: 4 }))).toBe("mm");
    expect(proponerUnidades(dxf(planta, { escala: 1000 }))).toBe("mm");
    expect(proponerUnidades(dxf(planta, { escala: 100, insunits: 5 }))).toBe("cm");
    // 2 660 sin decir nada: en m sería un edificio de 2,6 km; en mm, de 2,6 m; en cm, de 26,6 m
    expect(proponerUnidades(dxf(planta, { escala: 100 }))).toBe("cm");
  });

  it("sin giro ni traslación, los doubles del DXF; en mm, los de teclar el número en m", () => {
    const d = dxf([{ capa: "A", linea: [[-5.750000000007275, 0.1], [12.3, 7]] }]);
    const t = nuevaPlantilla(d, { nombre: "A", fichero: "a.dxf", sha256: "0", planta: "N1" });
    expect(t).toEqual({ nombre: "A", fichero: "a.dxf", sha256: "0", unidades: "m", plantas: ["N1"] });
    expect(Array.from(colocar(d, t).lineas)).toEqual([-5.750000000007275, 0.1, 12.3, 7]);
    const mm = dxf([{ capa: "A", linea: [[100, 300], [12300, 7000]] }]);
    expect(Array.from(colocar(mm, { ...t, unidades: "mm" }).lineas)).toEqual([0.1, 0.3, 12.3, 7]);
  });

  it("un DXF lejos del origen se trae con su esquina al origen, al metro", () => {
    const d = dxf([{ capa: "A", polilinea: [[370412.6, 4061233.2], [370440, 4061250]] }]);
    const t = nuevaPlantilla(d, { nombre: "A", fichero: "a.dxf", sha256: "0", planta: "N1" });
    expect(t.traslacion).toEqual([-370412, -4061233]);
    expect(Array.from(colocar(d, t).lineas).map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0.6, 0.2, 28, 17]);
  });

  it("mover y girar la plantilla: el punto a va a b, y el giro es alrededor de c", () => {
    const d = dxf([{ capa: "A", linea: [[1, 2], [4, 6]] }]);
    const t = nuevaPlantilla(d, { nombre: "A", fichero: "a.dxf", sha256: "0", planta: "N1" });
    const m = moverPlantilla(t, [1, 2], [0, 0]);
    expect(Array.from(colocar(d, m).lineas)).toEqual([0, 0, 3, 4]);
    expect(moverPlantilla(m, [0, 0], [1, 2])).toEqual(t);
    const g = girarPlantilla(m, [3, 4], 90);
    expect(g.giro).toBe(90);
    // (0, 0) girado 90° alrededor de (3, 4) es (7, 1); (3, 4) se queda
    expect(Array.from(colocar(d, g).lineas)).toEqual([7, 1, 3, 4]);
    const tr = transformacion(girarPlantilla(m, [0.37, -1.2], 33.3));
    const [c, s] = [Math.cos((33.3 * Math.PI) / 180), Math.sin((33.3 * Math.PI) / 180)];
    const esperado = (x: number, y: number) => [0.37 + c * (x - 1 - 0.37) - s * (y - 2 + 1.2), -1.2 + s * (x - 1 - 0.37) + c * (y - 2 + 1.2)];
    for (const [x, y] of [[1, 2], [4, 6], [-3, 8]] as const) tr(x, y).forEach((v, i) => expect(v).toBeCloseTo(esperado(x, y)[i]!, 12));
  });
});

describe("enganchar a la plantilla", () => {
  const radio = RADIO_ENGANCHE / 50;
  const vacio = (): ModeloFisico => ({ plantas: [{ id: "N1", altura: 3 }], materiales: [], secciones: [], casos: [] }) as unknown as ModeloFisico;
  const conPlantilla = (m: ModeloFisico, es: EntidadPrueba[], t: Partial<PlantillaDxf> = {}): IndiceEnganches => {
    const d = dxf(es);
    const pl = { ...nuevaPlantilla(d, { nombre: "Arq", fichero: "a.dxf", sha256: "0", planta: "N1" }), ...t };
    return { ...indiceEnganches(m, "N1"), plantilla: indicePlantilla([colocar(d, pl)]) };
  };

  it("criterio 3: lo enganchado sale redondeado a 1 mm (o 1 cm, o tal cual), y marcado como de la plantilla", () => {
    const es: EntidadPrueba[] = [{ capa: "A", linea: [[-5.750000000007275, 1.2500000000003], [3.0004, 1.25]] }];
    const ix = conPlantilla(vacio(), es);
    expect(enganchar(ix, [-5.74, 1.26], radio)).toEqual({ p: [-5.75, 1.25], tipo: "extremo", objeto: "", plantilla: "Arq" });
    expect(enganchar(ix, [3.01, 1.24], radio)!.p).toEqual([3, 1.25]);
    expect(enganchar(conPlantilla(vacio(), es, { redondeo: 0.01 }), [3.01, 1.24], radio)!.p).toEqual([3, 1.25]);
    expect(enganchar(conPlantilla(vacio(), es, { redondeo: 0 }), [-5.74, 1.26], radio)!.p).toEqual([-5.750000000007275, 1.2500000000003]);
    expect(redondear([-0.0001, 2.0005], 0.001)).toEqual([0, 2.001]);
    expect(Object.is(redondear([-0.0001, 0], 0.001)[0], 0)).toBe(true);
  });

  it("puntos medios, cruces entre sus líneas y con las del modelo, perpendicular, más cercano y el centro de un rectángulo", () => {
    const m = { ...vacio(), ejes: [{ id: "A", desde: [0, 5], hasta: [20, 5] }] } as unknown as ModeloFisico;
    const ix = conPlantilla(m, [
      { capa: "A", linea: [[0, 0], [10, 0]] },
      { capa: "A", linea: [[3, -2], [3, 8]] },
      { capa: "A", polilinea: [[12, 12], [12.4, 12], [12.4, 12.3], [12, 12.3]], cerrada: true },
    ]);
    expect(enganchar(ix, [5.05, 0.05], radio)).toMatchObject({ p: [5, 0], tipo: "medio" });
    expect(enganchar(ix, [3.05, 0.05], radio)).toMatchObject({ p: [3, 0], tipo: "cruce" });
    // Con el eje A del modelo
    expect(enganchar(ix, [3.05, 5.05], radio)).toMatchObject({ p: [3, 5], tipo: "cruce", plantilla: "Arq" });
    expect(enganchar(ix, [7.03, 0.1], radio, { ultimo: [7, 4] })).toMatchObject({ p: [7, 0], tipo: "perpendicular" });
    expect(enganchar(ix, [7.03, 0.1], radio)).toMatchObject({ p: [7.03, 0], tipo: "cercano" });
    expect(enganchar(ix, [12.21, 12.16], radio)).toMatchObject({ p: [12.2, 12.15], tipo: "centro" });
  });

  it("a igual nivel y distancia gana el modelo; un nivel mejor de la plantilla gana al modelo", () => {
    const m = { ...vacio(), ejes: [{ id: "A", desde: [0, 0], hasta: [10, 0] }] } as unknown as ModeloFisico;
    const ix = conPlantilla(m, [{ capa: "A", linea: [[0, 0], [5, 0]] }]);
    expect(enganchar(ix, [0.02, 0.02], radio)).toEqual({ p: [0, 0], tipo: "extremo", objeto: "A" });
    // El extremo (5, 0) de la plantilla gana al cercano del eje
    expect(enganchar(ix, [5.03, 0.02], radio)).toMatchObject({ p: [5, 0], tipo: "extremo", plantilla: "Arq" });
  });

  it("capas ocultas: ni se ven ni enganchan", () => {
    const es: EntidadPrueba[] = [{ capa: "COTAS", linea: [[0, 0], [5, 0]] }, { capa: "A", linea: [[0, 1], [5, 1]] }];
    const ix = conPlantilla(vacio(), es, { ocultas: ["COTAS"] });
    expect(enganchar(ix, [0.02, 0.02], radio)).toBeNull();
    expect(enganchar(ix, [0.02, 1.02], radio)).toMatchObject({ p: [0, 1] });
  });

  it("el índice por celdas da todo lo que hay a ≤ r, como la fuerza bruta", () => {
    let s = 7;
    const azar = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 100 - 20;
    const es: EntidadPrueba[] = [];
    for (let i = 0; i < 3000; i++) {
      const a: Vec2 = [azar(), azar()];
      // Cortas, largas e inclinadas, y paralelas a los ejes
      const l = i % 7 === 0 ? 60 : 1 + (i % 5);
      const g = i % 3 === 0 ? 0 : i % 3 === 1 ? Math.PI / 2 : azar();
      es.push({ capa: "A", linea: [a, [a[0] + l * Math.cos(g), a[1] + l * Math.sin(g)]] });
    }
    const d = dxf(es);
    const ix = indicePlantilla([colocar(d, nuevaPlantilla(d, { nombre: "A", fichero: "a", sha256: "0", planta: "N1" }))])!;
    const distSeg = (q: Vec2, i: number) => {
      const [ax, ay, bx, by] = [ix.seg[4 * i]!, ix.seg[4 * i + 1]!, ix.seg[4 * i + 2]!, ix.seg[4 * i + 3]!];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(q[0] - ax - t * dx, q[1] - ay - t * dy);
    };
    for (let k = 0; k < 300; k++) {
      const q: Vec2 = [azar(), azar()];
      const r = [0.01, 0.2, 3][k % 3]!;
      const c = cerca(ix, q, r);
      const seg = new Set(c.segmentos);
      for (let i = 0; i < ix.seg.length / 4; i++) if (distSeg(q, i) <= r) expect(seg.has(i)).toBe(true);
      const pts = new Set(c.puntos);
      for (let i = 0; i < ix.tipos.length; i++) if (Math.hypot(ix.pts[2 * i]! - q[0], ix.pts[2 * i + 1]! - q[1]) <= r) expect(pts.has(i)).toBe(true);
    }
  });
});

describe("la operación del editor (criterio 5)", () => {
  const nucleo = (() => {
    const l = leerProyecto(readFileSync(new URL("../../../validacion/a2/agente/nucleo/proyecto.json", import.meta.url), "utf8"));
    if (!l.valido) throw new Error("la retícula con núcleo no se lee");
    return l.proyecto;
  })();
  const t: PlantillaDxf = { nombre: "Arq", fichero: "planta.dxf", sha256: "ab", unidades: "mm", plantas: ["N1", "C"] };
  const ok = (p: Proyecto, o: Operacion) => {
    const a = aplicar(p, o);
    if (!a.ok) throw new Error(a.errores.map((x) => x.mensaje).join(" "));
    return a.proyecto;
  };

  it("añadir, cambiar y quitar plantillas no toca el modelo ni la huella", () => {
    const op = resolverOpciones(nucleo.opciones ?? {});
    const h = huellaCompilacion(nucleo.modelo, op);
    const p = ok(nucleo, { op: "plantillas", plantillas: [t] });
    expect(p.plantillas).toEqual([t]);
    expect(p.modelo).toBe(nucleo.modelo);
    expect(huellaCompilacion(p.modelo, op)).toBe(h);
    const q = ok(p, { op: "plantillas", plantillas: [] });
    expect(q).toEqual(nucleo);
    expect(aplicar(p, { op: "plantillas", plantillas: [t, t] })).toMatchObject({ ok: false, errores: [{ codigo: "editor/plantilla-repetida" }] });
    expect(aplicar(p, { op: "plantillas", plantillas: [{ ...t, nombre: " " }] })).toMatchObject({ ok: false });
  });

  it("las plantas de una plantilla siguen a su planta al renombrarla o borrarla", () => {
    const p = ok(nucleo, { op: "plantillas", plantillas: [t] });
    const n1 = p.modelo.plantas.find((x) => x.id === "N1")!;
    const r = ok(p, { op: "cambiar", coleccion: "plantas", id: "N1", objeto: { ...n1, id: "P1" } as never });
    expect(r.plantillas![0]!.plantas).toEqual(["P1", "C"]);
  });
});

describe("calcar la retícula con núcleo de A2 desde su DXF (criterio 2)", () => {
  it("pilares, vigas, losa con hueco, núcleo y puerta, enganchando sólo a la plantilla, dan la huella de la referencia", () => {
    const l = leerProyecto(readFileSync(new URL("../../../validacion/a2/agente/nucleo/proyecto.json", import.meta.url), "utf8"));
    if (!l.valido) throw new Error("la retícula con núcleo no se lee");
    const N = l.proyecto;
    const n0 = N.modelo;
    // La referencia sin cargas y sin la base de por defecto escrita en el muro (V2c2-3)
    const { cargas: _c, ...sinCargas } = n0;
    const ref: Proyecto = { ...N, modelo: { ...sinCargas, muros: n0.muros!.map(({ base, ...w }) => (base === "empotrado" ? w : { ...w, base })) } };
    const partida: Proyecto = { ...N, modelo: { plantas: n0.plantas, materiales: n0.materiales, secciones: n0.secciones, casos: n0.casos } };

    // El plano del arquitecto: en mm y con ruido de 1e-9 m
    const d = dibujoDxf(escribirDxf(dxfDeModelo(ref.modelo, "N1"), { escala: 1000, ruido: 1e-6, insunits: 4 }));
    const t = nuevaPlantilla(d, { nombre: "Arquitectura", fichero: "planta.dxf", sha256: "0", planta: "N1" });
    expect(t.unidades).toBe("mm");
    const ixPl = indicePlantilla([colocar(d, t)]);

    let p = partida;
    const errores: string[] = [];
    const usados = new Set<string>();
    // A 200 px/m: el radio de 10 px es de 5 cm
    const radio = RADIO_ENGANCHE / 200;
    const dibujar = (h: NombreHerramienta, plantillas: Plantillas, puntos: (Vec2 | "fin")[]) => {
      let e: EstadoHerramienta = ESTADO_INICIAL;
      let ultimo: Vec2 | null = null;
      for (const x of puntos) {
        const indice = { ...indiceEnganches(p.modelo, "N1"), plantilla: ixPl };
        let ev: Evento;
        if (x === "fin") ev = { tipo: "terminar" };
        else {
          // El cursor, a 1 cm del punto del plano
          const q: Vec2 = [x[0] + 0.01, x[1] + 0.007];
          const a = apuntar(indice, q, radio, { ultimo });
          usados.add(a.enganche?.plantilla ? `plantilla:${a.enganche.tipo}` : (a.enganche?.tipo ?? "nada"));
          ev = { tipo: "punto", p: a.p, enganche: a.enganche, cursor: q, radio };
          ultimo = a.p;
        }
        const r = paso(h, e, ev, { modelo: p.modelo, planta: "N1", indice, plantillas });
        e = r.estado;
        if (r.error) errores.push(`${h}: ${r.error}`);
        if (r.hecho) {
          const a = aplicar(p, r.hecho.operacion);
          if (!a.ok) throw new Error(a.errores.map((y) => y.mensaje).join(" "));
          p = a.proyecto;
        }
      }
    };
    const base: Plantillas = { pilar: { seccion: n0.pilares![0]!.seccion }, viga: { seccion: n0.vigas![0]!.seccion } };
    // Los pilares, en el centro de su rectángulo
    dibujar("pilar", base, n0.pilares!.map((x) => [x.x, x.y]));
    for (const v of n0.vigas!) dibujar("viga", base, [...v.puntos, "fin"]);
    const ln = n0.losas![0]!;
    dibujar("forjado", { ...base, forjado: { modo: "poligono", tipo: "maciza", espesor: ln.espesor, material: ln.material } }, [...ln.contorno, "fin"]);
    dibujar("hueco", { ...base, hueco: { modo: "rectangulo" } }, [ln.huecos![0]![0]!, ln.huecos![0]![2]!]);
    const w = n0.muros![0]!;
    dibujar("muro", { ...base, muro: { espesor: w.espesor, material: w.material } }, w.puntos);
    // La puerta, entre las jambas del plano
    const hw = w.huecos![0]!;
    dibujar("hueco", { ...base, hueco: { z0: hw.z0, z1: hw.z1 } }, [
      [w.puntos[0]![0] + hw.desde, w.puntos[0]![1]],
      [w.puntos[0]![0] + hw.hasta, w.puntos[0]![1]],
    ]);

    expect(errores).toEqual([]);
    // Todo lo que se enganchó (salvo donde el modelo ya tenía el mismo punto) es de la plantilla
    expect([...usados].filter((u) => !u.startsWith("plantilla:") && !["centro", "esquina"].includes(u))).toEqual([]);
    expect(usados).toContain("plantilla:centro");
    expect(usados).toContain("plantilla:cruce");
    const op = resolverOpciones(N.opciones ?? {});
    const ren = (x: Proyecto) => {
      const a = aplicar(x, { op: "renumerar" });
      if (!a.ok) throw new Error("no se renumera");
      return a.proyecto.modelo;
    };
    expect(huellaCompilacion(ren(p), op)).toBe(huellaCompilacion(ren(ref), op));
  });
});
