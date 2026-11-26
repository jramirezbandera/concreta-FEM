/**
 * Fase CO6 (`docs/fem3d/comprobaciones.md` §8.10, criterio 15 en Node): los pedidos `comprobaciones`,
 * `comprobacion` y `armar` del worker dan lo de `fem comprobar` y `fem armar`: las mismas funciones
 * (`comprobarPilares`, `comprobarVigas`, `comprobarLosas`, `comprobarPunzonamientos`) sobre unas
 * consultas montadas aparte, como la CLI. Y la caché por pieza no cambia nada: tras cambiar el armado
 * de una pieza sólo se vuelve a comprobar ella, y la tabla es la de comprobarlo todo de nuevo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import type { ArmadoProyecto } from "../agente/armaduraBase.ts";
import { VERSION_ESQUEMA } from "../agente/proyecto.ts";
import { armadoPropuestoLosas, comprobarLosas } from "../comprobaciones/losas.ts";
import { armadoPropuesto, comprobarPilares } from "../comprobaciones/pilares.ts";
import { armadoPropuestoPunzonamiento, comprobarPunzonamientos } from "../comprobaciones/punzonamiento.ts";
import { armadoPropuestoVigas, comprobarVigas } from "../comprobaciones/vigas.ts";
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import type { AccionCaso, ModeloFisico } from "../compilador/fisico.ts";
import { sha256 } from "../compilador/huella.ts";
import { aplicar } from "../editor/operaciones.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Atendedor } from "./atender.ts";
import type { DatosArmar, DatosComprobaciones, DatosEsfuerzosArmado, DatosPortico, FichaComprobacion, TipoComprobacion } from "./comprobaciones.ts";
import type { DatosViga } from "./datos.ts";
import { alzadoPilar } from "../comprobaciones/dibujoArmado.ts";
import { despiecePortico } from "../comprobaciones/despieceVigas.ts";
import { datosDespiece, porticoDe, porticosDe } from "../comprobaciones/porticos.ts";
import { claseAprovechamiento, COLOR_APROVECHAMIENTO, TIPOS_COMPROBACION } from "./comprobaciones.ts";
import { dentro, type Escena } from "../agente/render/escena.ts";
import { barrasDe } from "../comprobaciones/armado.ts";
import type { Pedido } from "./protocolo.ts";

const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};

let at: Atendedor;
let q: Consultas;
let modelo: ModeloFisico;
let propuesto: DatosArmar;

const pedir = async <T>(p: Pedido): Promise<T> => {
  const r = await at.atender(p);
  if (!r.ok) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return r.valor as T;
};
const tabla = (de: TipoComprobacion, armado?: ArmadoProyecto) => pedir<DatosComprobaciones>({ tipo: "comprobaciones", de, ...(armado ? { armado } : {}) });
/** Las partes que se comprueban: sin los pilares que atraviesan la losa sin unión por su huella (§8.16). */
const comprobadas = (t: DatosComprobaciones) => t.partes.filter((p) => p.origen !== "no-aplica");

beforeAll(async () => {
  const wasm = readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm"));
  await iniciarNucleo(wasm);
  const f = edificioObjetivoLosas(2, 2, 2);
  modelo = { ...f, casos: f.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })) };
  at = new Atendedor(sha256(new Uint8Array(wasm)));
  await pedir({ tipo: "abrir", texto: JSON.stringify({ esquema: VERSION_ESQUEMA, modelo }) });
  await pedir({ tipo: "calcular" });
  // Las consultas, aparte, como las monta la CLI
  const c = compilar(modelo);
  if (!c.valido) throw new Error("no compila");
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error("no calcula");
  q = new Consultas(modelo, c, r.casos, {}, r.modal);
  propuesto = await pedir<DatosArmar>({ tipo: "armar", tipos: TIPOS_COMPROBACION });
}, 600_000);

describe("CO6: las comprobaciones en el worker", () => {
  it("CO3-k: los datos de armado de la obra van en el pedido: lo comprobado se rehace con ellos, sin reabrir ni recalcular, y la ficha de una losa dice si es de cimentación", async () => {
    const armado = { forjados: propuesto.armado.forjados! };
    const antes = await tabla("losas", armado);
    expect((await tabla("losas", armado)).comprobadas).toBe(0);
    expect(antes.datos.minimaReducidaCimentacion).toBe(false);
    const ficha = await pedir<FichaComprobacion>({ tipo: "comprobacion", de: "losas", clave: antes.partes[0]!.clave, armado });
    expect(ficha.geometria.tipo === "losas" && ficha.geometria.cimentacion).toBeFalsy();
    // Con la armadura mínima reducida en el pedido: todo vuelto a comprobar, con el mismo cálculo
    const despues = await pedir<DatosComprobaciones>({ tipo: "comprobaciones", de: "losas", armado, datos: { minimaReducidaCimentacion: true } });
    expect(despues.comprobadas).toBe(antes.partes.length);
    expect(despues.datos.minimaReducidaCimentacion).toBe(true);
    // Sin losas de cimentación, lo mismo que antes; y los pedidos siguientes sin datos siguen con los últimos
    expect(despues.partes).toEqual(antes.partes);
    expect((await tabla("losas", armado)).comprobadas).toBe(0);
    expect((await tabla("losas", armado)).datos.minimaReducidaCimentacion).toBe(true);
    // De vuelta a los de la obra (ninguno)
    const vuelta = await pedir<DatosComprobaciones>({ tipo: "comprobaciones", de: "losas", armado, datos: {} });
    expect(vuelta.datos.minimaReducidaCimentacion).toBe(false);
    expect(vuelta.comprobadas).toBe(antes.partes.length);
  });

  it("§8.14: la ficha de un tramo de pilar trae su tramo libre y los solapes (sus zonas de cercos), y los pedidos de esfuerzos dan las envolventes de ELU del pórtico y del tramo en la coordenada de su dibujo", async () => {
    const ELU = { tipo: "situaciones" as const, situaciones: ["ELU-PT", "ELU-ACC", "ELU-SIS"] as ("ELU-PT" | "ELU-ACC" | "ELU-SIS")[] };
    // Un tramo de pilar: su geometría y sus esfuerzos desde la cara del nudo de abajo
    const t = await tabla("pilares", propuesto.armado);
    const parte = t.partes[0]!;
    const ficha = await pedir<FichaComprobacion>({ tipo: "comprobacion", de: "pilares", clave: parte.clave, armado: propuesto.armado });
    const g = ficha.geometria;
    if (g.tipo !== "pilares" || !g.seccion || g.libre === undefined || !g.solapes) throw new Error("sin geometría");
    const tramo = q.pilar(parte.pieza);
    if (!tramo.valido) throw new Error("sin tramos");
    const tr = tramo.valor.find((x) => x.planta === parte.planta)!;
    expect(g.libre).toBeCloseTo(tr.cabeza.s - tr.base.s, 12);
    expect(g.solapes[16]!).toBeGreaterThan(g.solapes[12]!);
    const al = alzadoPilar(g.seccion, g.libre, ficha.armado.tipo === "pilares" ? ficha.armado.armado : undefined, g.solapes);
    expect(al.cercos).toBeGreaterThan(0);
    expect(al.zonas.at(-1)!.hasta).toBeCloseTo(g.libre, 12);
    const ep = await pedir<DatosEsfuerzosArmado>({ tipo: "esfuerzos-pilar", pilar: parte.pieza, planta: parte.planta! });
    for (const e of ["N", "My", "Mz", "Vy", "Vz"] as const) {
      const ts = ep.esfuerzos[e]!;
      expect(ts.length, e).toBeGreaterThan(0);
      const v = await pedir<DatosViga>({ tipo: "viga", id: parte.pieza, esfuerzo: e, combinaciones: ELU });
      const ps = ts.flat();
      expect(ps[0]!.x).toBeCloseTo(0, 9);
      expect(ps.at(-1)!.x).toBeCloseTo(g.libre, 9);
      // Cada punto es uno de la envolvente del pilar entero, desplazado a la cara de abajo del tramo
      for (const x of ps) expect(v.envolvente.some((y) => Math.abs(y.s - tr.base.s - x.x) < 1e-9 && y.max === x.max && y.min === x.min), `${e} en ${x.x}`).toBe(true);
      for (const x of ps) expect(x.max).toBeGreaterThanOrEqual(x.min);
    }
    // De qué combinación sale cada pésimo: las ternas del tramo, las de la consulta de la pieza, y dentro de la envolvente
    const ternas = ep.ternas!;
    for (const [ex, lado] of [["base", 0], ["cabeza", -1]] as const)
      for (const [k, c, e] of [["N-", 0, "N"], ["N+", 0, "N"], ["My", 4, "My"], ["Mz", 5, "Mz"]] as const) {
        const t = ternas[ex][k]!;
        expect(t.comb.length, `${ex} ${k}`).toBeGreaterThan(0);
        expect(t.esfuerzos.length).toBe(6);
        const punto = ep.esfuerzos[e]!.flat().at(lado)!;
        expect(t.esfuerzos[c]! <= punto.max + 1e-6 && t.esfuerzos[c]! >= punto.min - 1e-6, `${ex} ${k}`).toBe(true);
        if (k === "N-") expect(t.esfuerzos[0]!).toBeCloseTo(punto.min, 6);
        if (k === "N+") expect(t.esfuerzos[0]!).toBeCloseTo(punto.max, 6);
      }
    expect((await at.atender({ tipo: "esfuerzos-pilar", pilar: parte.pieza, planta: "no-existe" })).ok).toBe(false);
    // Un pórtico: My y Vz de cada viga en su x; una viga invertida, con el cortante cambiado de signo
    for (const p of porticosDe(q).slice(0, 4)) {
      const viga = p.vigas[0]!.id;
      const e = await pedir<DatosEsfuerzosArmado>({ tipo: "esfuerzos-portico", viga });
      expect(e.combinaciones.length).toBeGreaterThan(0);
      // El torsor y el axil, también; y los extremos de cada vano con su combinación y sus concomitantes
      for (const k of ["T", "N"] as const) expect(e.esfuerzos[k]!.length, k).toBeGreaterThan(0);
      for (const v of p.vanos) {
        const ex = e.vanos![v.clave]!;
        for (const k of ["My+", "My-", "Vz", "T"]) {
          expect(ex[k]!.comb.length, `${v.clave} ${k}`).toBeGreaterThan(0);
          expect(ex[k]!.esfuerzos!.length).toBe(6);
        }
      }
      for (const k of ["My", "Vz"] as const) {
        const ts = e.esfuerzos[k]!;
        expect(ts.length).toBeGreaterThan(0);
        for (const tm of ts) for (let i = 1; i < tm.length; i++) expect(tm[i]!.x).toBeGreaterThanOrEqual(tm[i - 1]!.x - 1e-9);
        for (const x of ts.flat()) expect(x.x >= p.x[0] - 1e-9 && x.x <= p.x[1] + 1e-9).toBe(true);
        for (const v of p.vigas) {
          const d = await pedir<DatosViga>({ tipo: "viga", id: v.id, esfuerzo: k, combinaciones: ELU });
          const suyos = ts.flat().filter((x) => x.x >= v.x[0] - 1e-9 && x.x <= v.x[1] + 1e-9);
          expect(suyos.length).toBeGreaterThan(0);
          for (const x of suyos) {
            const s = v.invertida ? v.x[1] - x.x : x.x - v.x[0];
            const cambia = v.invertida && k === "Vz";
            const casa = (y: { s: number; max: number; min: number }) => Math.abs(y.s - s) < 1e-9 && (cambia ? -y.min === x.max && -y.max === x.min : y.max === x.max && y.min === x.min);
            // (en un pilar compartido por dos vigas del pórtico, el punto puede ser de la otra)
            if (!d.envolvente.some(casa)) expect(p.vigas.length, `${k} de ${v.id} en ${x.x}`).toBeGreaterThan(1);
          }
        }
      }
    }
  });

  it("§8.13: el pedido `portico` da el pórtico de la viga y lo que su despiece necesita; con el armado propuesto, cada vano armado tiene sus barras y sus cercos", async () => {
    const vigas = modelo.vigas!.map((v) => v.id);
    for (const viga of [vigas[0]!, vigas[vigas.length - 1]!]) {
      const r = await pedir<DatosPortico>({ tipo: "portico", viga });
      const p = porticoDe(q, viga)!;
      expect(r.portico).toEqual(p);
      expect(r.despiece).toEqual(datosDespiece(p));
      expect(r.portico.vigas.some((v) => v.id === viga)).toBe(true);
    }
    const no = await at.atender({ tipo: "portico", viga: "no-existe" });
    expect(no.ok).toBe(false);
    // Todas las vigas, en algún pórtico; y el despiece de cada uno con lo propuesto
    const ps = porticosDe(q);
    expect(ps.flatMap((p) => p.vigas.map((v) => v.id)).sort()).toEqual([...vigas].sort());
    let barras = 0;
    for (const p of ps) {
      const armados = Object.fromEntries(p.vanos.map((v) => [v.clave, propuesto.armado.vigas?.[v.viga]?.[v.vano]]));
      const d = despiecePortico(p, armados, datosDespiece(p));
      barras += d.barras.length;
      for (const v of p.vanos) {
        const a = armados[v.clave];
        if (!a) continue;
        // La inferior de cada vano armado, entera: de cara a cara y más allá
        const inf = d.barras.filter((b) => b.cara === "inferior" && b.origen.some((o) => o.clave === v.clave));
        expect(inf, v.clave).toHaveLength(1);
        expect(inf[0]!.n).toBe(a.inferior.n);
        expect(inf[0]!.x[0]).toBeLessThanOrEqual(v.desde + 1e-9);
        expect(inf[0]!.x[1]).toBeGreaterThanOrEqual(v.hasta - 1e-9);
        expect(d.cercos.some((c) => c.origen.some((o) => o.clave === v.clave))).toBe(true);
      }
      expect(d.acero.total).toBeCloseTo(d.medicion.reduce((t, f) => t + f.kg, 0), 9);
    }
    expect(barras).toBeGreaterThan(0);
  });

  it("sin armado, nada cumple y todo está sin armado (el punzonamiento, sin el de su losa)", async () => {
    for (const de of TIPOS_COMPROBACION) {
      const t = await tabla(de);
      expect(comprobadas(t).length, de).toBeGreaterThan(0);
      expect(t.resumen.cumplen, de).toBe(0);
      expect(t.resumen.sinArmado, de).toBe(comprobadas(t).length);
      expect(t.resumen.partes, de).toBe(comprobadas(t).length);
    }
  });

  it("«armar» propone lo de «fem armar»: las mismas funciones, y el punzonamiento con las losas propuestas", () => {
    const rp = comprobarPilares(q, undefined, undefined, { proponer: true });
    const rv = comprobarVigas(q, undefined, undefined, { proponer: true });
    const rl = comprobarLosas(q, undefined, undefined, { proponer: true });
    if (!rp.valido || !rv.valido || !rl.valido) throw new Error("no propone");
    const forjados = armadoPropuestoLosas(rl.valor, undefined);
    const rz = comprobarPunzonamientos(q, forjados, undefined, undefined, { proponer: true });
    if (!rz.valido) throw new Error("no propone");
    const esperado: ArmadoProyecto = { pilares: armadoPropuesto(rp.valor, undefined), vigas: armadoPropuestoVigas(rv.valor, undefined), forjados };
    const punz = armadoPropuestoPunzonamiento(rz.valor, undefined);
    if (Object.keys(punz).length) esperado.punzonamiento = punz;
    expect(propuesto.armado).toEqual(esperado);
    expect(propuesto.resumen.pilares!.partes).toBe(rp.valor.resumen.tramos);
    expect(propuesto.resumen.vigas!.partes).toBe(rv.valor.resumen.vanos);
    // Lo propuesto es un armado válido del proyecto: la operación `armado` lo acepta
    const ap = aplicar({ esquema: VERSION_ESQUEMA, modelo }, { op: "armado", armado: propuesto.armado });
    expect(ap.ok).toBe(true);
  });

  it("con el armado propuesto, la tabla de cada tipo es la de su función, parte a parte", async () => {
    const a = propuesto.armado;
    const rp = comprobarPilares(q, a.pilares, undefined, { filas: true });
    const rv = comprobarVigas(q, a.vigas, undefined, { filas: true });
    const rl = comprobarLosas(q, a.forjados, undefined, { filas: true });
    const rz = comprobarPunzonamientos(q, a.forjados, a.punzonamiento, undefined, { filas: true });
    if (!rp.valido || !rv.valido || !rl.valido || !rz.valido) throw new Error("no comprueba");
    const esperado: Record<TipoComprobacion, { clave: string; cumple: boolean; aprovechamiento: number | null; texto?: string; manda?: string; filas: number }[]> = {
      pilares: rp.valor.pilares.flatMap((p) => p.tramos.map((t) => ({ clave: `${p.pilar}/${t.planta}`, cumple: t.cumple, aprovechamiento: t.aprovechamiento, texto: t.texto, manda: t.manda?.id, filas: t.filas!.length }))),
      vigas: rv.valor.vigas.flatMap((g) => g.vanos.map((v) => ({ clave: `${g.viga}/${v.vano}`, cumple: v.cumple, aprovechamiento: v.aprovechamiento, texto: v.texto, manda: v.manda?.id, filas: v.filas!.length }))),
      losas: rl.valor.losas.map((l) => ({ clave: l.losa, cumple: l.cumple, aprovechamiento: l.aprovechamiento, texto: l.texto, manda: l.manda?.id, filas: l.filas!.length })),
      punzonamiento: rz.valor.pilares.map((p) => ({ clave: `${p.pilar}/${p.planta}`, cumple: p.cumple, aprovechamiento: p.aprovechamiento, texto: p.texto, manda: p.manda?.id, filas: p.filas!.length })),
    };
    for (const de of TIPOS_COMPROBACION) {
      const t = await tabla(de, a);
      expect(comprobadas(t).map((p) => ({ clave: p.clave, cumple: p.cumple, aprovechamiento: p.aprovechamiento, texto: p.texto, manda: p.manda?.id })), de).toEqual(esperado[de].map(({ filas: _f, ...x }) => x));
      expect(t.resumen.sinArmado, de).toBe(0);
      expect(t.resumen.cumplen + t.resumen.noCumplen, de).toBe(comprobadas(t).length);
      // Lo propuesto cumple (criterio 12), también visto desde la app
      expect(t.partes.filter((p) => !p.cumple).map((p) => `${p.clave}: ${p.manda?.descripcion ?? p.pendientes[0]}`), de).toEqual(propuesto.sinPropuesta.filter((x) => x.tipo === de).length ? expect.any(Array) : []);
      // La ficha de cada parte, con todas las filas del módulo
      for (const e of esperado[de].slice(0, 3)) {
        const f = await pedir<FichaComprobacion>({ tipo: "comprobacion", de, clave: e.clave, armado: a });
        expect(f.filas.length, `${de} ${e.clave}`).toBe(e.filas);
        expect(f.armado.tipo).toBe(de);
        expect(f.aprovechamiento).toBe(e.aprovechamiento);
      }
    }
  });

  it("la caché: lo ya comprobado no se repite, y al cambiar una pieza sólo se comprueba ella, con la tabla de comprobarlo todo", async () => {
    const a = propuesto.armado;
    for (const de of TIPOS_COMPROBACION) expect((await tabla(de, a)).comprobadas, de).toBe(0);
    // Un pilar, con cercos más separados
    const [pilar, tramos] = Object.entries(a.pilares!)[0]!;
    const cambiado: ArmadoProyecto = { ...a, pilares: { ...a.pilares, [pilar]: Object.fromEntries(Object.entries(tramos).map(([k, t]) => [k, { ...t, cercos: { ...t.cercos, separacion: 400 } }])) } };
    const t = await tabla("pilares", cambiado);
    expect(t.comprobadas).toBe(Object.keys(tramos).length);
    const r = comprobarPilares(q, cambiado.pilares, undefined, {});
    if (!r.valido) throw new Error("no comprueba");
    expect(t.partes.map((p) => [p.clave, p.cumple, p.aprovechamiento, p.manda?.id])).toEqual(r.valor.pilares.flatMap((p) => p.tramos.map((x) => [`${p.pilar}/${x.planta}`, x.cumple, x.aprovechamiento, x.manda?.id])));
    expect(t.partes.filter((p) => p.pieza === pilar).every((p) => !p.cumple)).toBe(true);
    // El punzonamiento no depende de los pilares: sigue en la caché; con otra losa, se repite entero
    expect((await tabla("punzonamiento", cambiado)).comprobadas).toBe(0);
    const [losa, forjado] = Object.entries(a.forjados!)[0]!;
    const otra: ArmadoProyecto = { ...a, forjados: { ...a.forjados, [losa]: { ...forjado, refuerzos: [] } } };
    const z = await tabla("punzonamiento", otra);
    expect(z.comprobadas).toBe(z.partes.length);
    // Y volver al armado de antes da lo de antes
    const vuelta = await tabla("pilares", a);
    const rp = comprobarPilares(q, a.pilares, undefined, {});
    if (!rp.valido) throw new Error("no comprueba");
    expect(vuelta.partes.map((p) => [p.clave, p.cumple, p.aprovechamiento])).toEqual(rp.valor.pilares.flatMap((p) => p.tramos.map((x) => [`${p.pilar}/${x.planta}`, x.cumple, x.aprovechamiento])));
  });

  it("proponer sólo unas piezas o sólo lo que falta deja lo demás como estaba", async () => {
    const a = propuesto.armado;
    const [pilar] = Object.keys(a.pilares!);
    const sinUno: ArmadoProyecto = { ...a, pilares: Object.fromEntries(Object.entries(a.pilares!).filter(([id]) => id !== pilar)) };
    const r = await pedir<DatosArmar>({ tipo: "armar", tipos: ["pilares"], armado: sinUno, soloSinArmado: true });
    expect(Object.keys(r.armado.pilares!).sort()).toEqual(Object.keys(a.pilares!).sort());
    for (const [id, t] of Object.entries(sinUno.pilares!)) expect(r.armado.pilares![id], id).toEqual(t);
    expect(r.armado.vigas).toEqual(a.vigas);
    const uno = await pedir<DatosArmar>({ tipo: "armar", tipos: ["pilares", "vigas"], armado: sinUno, ids: [pilar!] });
    expect(Object.keys(uno.armado.pilares![pilar!]!).length).toBeGreaterThan(0);
    expect(uno.resumen.vigas).toBeUndefined();
  });

  it("CO6-b: con «sólo lo que falta», la armadura de punzonamiento escrita se queda; sin él, se sustituye o se quita", async () => {
    const a = propuesto.armado;
    const t = await tabla("punzonamiento", a);
    const partes = comprobadas(t);
    expect(partes.length).toBeGreaterThan(0);
    const [pilar, planta] = partes[0]!.clave.split("/") as [string, string];
    // Una armadura escrita a mano, haga falta o no
    const escrita = { diametro: 10, ramas: 2, separacion: 120 };
    const conEscrita: ArmadoProyecto = { ...a, punzonamiento: { ...a.punzonamiento, [pilar]: { ...a.punzonamiento?.[pilar], [planta]: escrita } } };
    const falta = await pedir<DatosArmar>({ tipo: "armar", tipos: TIPOS_COMPROBACION, armado: conEscrita, soloSinArmado: true });
    expect(falta.armado.punzonamiento?.[pilar]?.[planta]).toEqual(escrita);
    expect(falta.resumen.punzonamiento!.conservadas).toBe(1);
    // Lo demás, como sin ella
    expect(falta.armado.pilares).toEqual(a.pilares);
    expect(falta.armado.forjados).toEqual(a.forjados);
    for (const p of partes.slice(1)) {
      const [x, y] = p.clave.split("/") as [string, string];
      expect(falta.armado.punzonamiento?.[x]?.[y], p.clave).toEqual(a.punzonamiento?.[x]?.[y]);
    }
    // Sin «sólo lo que falta», la de las tablas: la de antes, o ninguna si no hace falta
    const todo = await pedir<DatosArmar>({ tipo: "armar", tipos: ["punzonamiento"], armado: conEscrita });
    expect(todo.armado.punzonamiento?.[pilar]?.[planta]).toEqual(a.punzonamiento?.[pilar]?.[planta]);
    expect(todo.resumen.punzonamiento!.conservadas).toBeUndefined();
  });

  it("CO6-d: la planta con cada parte del color de su aprovechamiento; un clic en una elige su pieza", async () => {
    const a = propuesto.armado;
    // Un pilar sin cumplir (cercos a 400) y otro sin armado
    const [p1, t1] = Object.entries(a.pilares!)[0]!;
    const [p2] = Object.entries(a.pilares!)[1]!;
    const { [p2]: _quitado, ...resto } = a.pilares!;
    const mezcla: ArmadoProyecto = { ...a, pilares: { ...resto, [p1]: Object.fromEntries(Object.entries(t1).map(([k, t]) => [k, { ...t, cercos: { ...t.cercos, separacion: 400 } }])) } };
    for (const de of TIPOS_COMPROBACION) {
      const arm = de === "pilares" ? mezcla : a;
      const t = await tabla(de, arm);
      for (const planta of modelo.plantas.map((p) => p.id)) {
        const vista = { vista: "comprobacion" as const, de, armado: arm };
        const r = await at.atender({ tipo: "escena", planta, vista });
        if (!r.ok) throw new Error(r.diagnosticos.map((d) => d.mensaje).join(" "));
        // La escena de A4, sin preparar: la de la sesión
        const sa = (at as unknown as { sesion: { escenaA4: (p: string, v: unknown) => { valido: true; valor: Escena } } }).sesion.escenaA4(planta, vista);
        const coloreados = sa.valor.primitivas.filter((x): x is Extract<Escena["primitivas"][number], { tipo: "poligono" }> => x.tipo === "poligono" && x.estilo === "contorno" && !!x.relleno);
        // En la planta: los tramos con la cabeza en ella, las uniones de su losa, sus vigas y sus losas
        const esperadas = t.partes.filter((p) => (de === "vigas" ? modelo.vigas?.find((v) => v.id === p.pieza)?.planta === planta : p.planta === planta));
        const piezas = new Set(coloreados.map((x) => x.objeto));
        expect([...piezas].sort(), `${de} ${planta}`).toEqual([...new Set(esperadas.map((p) => p.pieza))].sort());
        for (const p of esperadas) {
          const suyos = coloreados.filter((x) => x.objeto === p.pieza);
          expect(suyos.every((x) => x.relleno === COLOR_APROVECHAMIENTO[claseAprovechamiento(p)]) || de === "vigas", `${de} ${p.clave}`).toBe(true);
        }
        if (de === "vigas") {
          // Cada vano, su color: los de una viga pueden ser distintos, pero cada polígono es el de un vano
          const colores = new Set(Object.values(COLOR_APROVECHAMIENTO));
          expect(coloreados.every((x) => colores.has(x.relleno!))).toBe(true);
        }
        // Un clic dentro de una parte elige su pieza: a un cuarto de la banda de un vano (a mitad de luz la
        // cruza una viga secundaria) o del cuadrilátero de un pilar; en una losa, lo de encima manda
        const una = de === "losas" ? undefined : coloreados.find((x) => x.anillos[0]!.length === 4);
        if (una) {
          const [q0, q1, q2, q3] = una.anillos[0]! as [number, number][];
          const c: [number, number] = [0.75 * ((q0![0] + q3![0]) / 2) + 0.25 * ((q1![0] + q2![0]) / 2), 0.75 * ((q0![1] + q3![1]) / 2) + 0.25 * ((q1![1] + q2![1]) / 2)];
          const e = await pedir<{ objeto: string } | null>({ tipo: "elegir", fuente: { tipo: "planta", planta, vista }, punto: c, radio: 0.01 });
          expect(e?.objeto, `${de} ${planta}`).toBe(una.objeto);
          // Sólo lo de la pestaña (elegibles): con su tipo, la misma; con otro, nunca ésa
          const suyo = de === "vigas" ? "viga" : "pilar";
          const otro = suyo === "viga" ? "pilar" : "viga";
          const conSuyo = await pedir<{ objeto: string } | null>({ tipo: "elegir", fuente: { tipo: "planta", planta, vista }, punto: c, radio: 0.01, elegibles: [suyo] });
          expect(conSuyo?.objeto, `${de} ${planta}`).toBe(una.objeto);
          const conOtro = await pedir<{ objeto: string } | null>({ tipo: "elegir", fuente: { tipo: "planta", planta, vista }, punto: c, radio: 0.01, elegibles: [otro] });
          const deOtro = new Set((otro === "viga" ? modelo.vigas : modelo.pilares)?.map((x) => x.id));
          expect(conOtro === null || deOtro.has(conOtro.objeto), `${de} ${planta}: ${conOtro?.objeto}`).toBe(true);
          // La ventana, igual: sólo objetos del tipo
          const ventana = await pedir<string[]>({ tipo: "ventana", fuente: { tipo: "planta", planta, vista }, caja: [-1e4, -1e4, 1e4, 1e4], modo: "toca", elegibles: [suyo] });
          const delSuyo = new Set((suyo === "viga" ? modelo.vigas : modelo.pilares)?.map((x) => x.id));
          expect(ventana.length > 0 && ventana.every((id) => delSuyo.has(id)), `${de} ${planta}`).toBe(true);
        }
      }
    }
    // Los colores de los pilares cambiados: rojo el de los cercos a 400, gris el que no tiene armado
    const t = await tabla("pilares", mezcla);
    expect(t.partes.filter((p) => p.pieza === p1).every((p) => claseAprovechamiento(p) === "no-cumple")).toBe(true);
    expect(t.partes.filter((p) => p.pieza === p2).every((p) => claseAprovechamiento(p) === "sin-armado")).toBe(true);
  });

  it("§8.11: la planta con el armado dibujado: las barras de cada pilar en su huella, los refuerzos de las losas con su id y el armado de cada vano", async () => {
    const a = propuesto.armado;
    const sesion = (at as unknown as { sesion: { escenaA4: (p: string, v: unknown) => { valido: true; valor: Escena } } }).sesion;
    const escena = (planta: string, de: TipoComprobacion, extra: object = {}) => sesion.escenaA4(planta, { vista: "comprobacion", de, armado: a, dibujo: "armado", ...extra }).valor;
    const tPilares = await tabla("pilares", a);
    let [barrasVistas, refuerzosVistos, vanosVistos] = [0, 0, 0];
    for (const planta of modelo.plantas.map((p) => p.id)) {
      // Pilares: tantas barras como su armado, todas dentro de su huella
      const ep = escena(planta, "pilares");
      for (const p of tPilares.partes.filter((x) => x.planta === planta)) {
        const ficha = await pedir<FichaComprobacion>({ tipo: "comprobacion", de: "pilares", clave: p.clave, armado: a });
        const huella = ep.primitivas.find((x): x is Extract<Escena["primitivas"][number], { tipo: "poligono" }> => x.tipo === "poligono" && x.estilo === "contorno" && x.objeto === p.pieza)!;
        const marcas = ep.primitivas.filter((x): x is Extract<Escena["primitivas"][number], { tipo: "marca" }> => x.tipo === "marca" && x.estilo === "armado-barra" && dentro(x.p, huella.anillos[0]!));
        // (sin `objeto`: elegido el pilar se resalta su huella, no cada barra)
        expect(marcas.every((m) => m.objeto === undefined)).toBe(true);
        expect(ficha.armado.tipo === "pilares" && ficha.armado.armado ? barrasDe(ficha.armado.armado) : 0, p.clave).toBe(marcas.length);
        expect(marcas.length).toBeGreaterThanOrEqual(4);
        for (const m of marcas) expect(dentro(m.p, huella.anillos[0]!), p.clave).toBe(true);
        expect(huella.relleno).toBe(COLOR_APROVECHAMIENTO[claseAprovechamiento(p)]);
        barrasVistas += marcas.length;
      }
      // Losas: cada refuerzo de las de la planta, con su id; con una sola cara, sólo los suyos
      const el = escena(planta, "losas");
      const inf = escena(planta, "losas", { cara: "inferior" });
      expect(inf.primitivas.some((x) => "estilo" in x && x.estilo.startsWith("armado-superior"))).toBe(false);
      // §8.12: con una cara, sin los cercos; con «cercos», sólo ellos
      expect(inf.primitivas.some((x) => "estilo" in x && x.estilo === "armado-cercos")).toBe(false);
      const soloCercos = escena(planta, "losas", { cara: "cercos" });
      expect(soloCercos.primitivas.some((x) => "estilo" in x && /^armado-(inferior|superior)/.test(x.estilo))).toBe(false);
      expect(soloCercos.primitivas.some((x) => "estilo" in x && x.estilo === "armado-cercos")).toBe(el.primitivas.some((x) => "estilo" in x && x.estilo === "armado-cercos"));
      for (const l of (modelo.losas ?? []).filter((x) => x.planta === planta)) {
        const suyo = a.forjados?.[l.id];
        (suyo?.refuerzos ?? []).forEach((r, i) => {
          const grueso = r.armadura.endsWith("inf") ? "armado-inferior" : "armado-superior";
          const lineas = el.primitivas.filter((x) => x.tipo === "linea" && x.objeto === `${l.id}/R${i + 1}`);
          expect(lineas.some((x) => x.tipo === "linea" && x.estilo === grueso), `${l.id}/R${i + 1}`).toBe(true);
          expect(inf.primitivas.some((x) => "objeto" in x && x.objeto === `${l.id}/R${i + 1}`)).toBe(r.armadura.endsWith("inf"));
          refuerzosVistos++;
        });
        // La base, en las notas
        if (suyo) expect(el.notas.some((n) => n.startsWith(`${l.id}, armadura base`))).toBe(true);
      }
      // Vigas: cada vano con armado, rotulado con su inferior
      const ev = escena(planta, "vigas");
      const tv = await tabla("vigas", a);
      for (const p of tv.partes.filter((x) => modelo.vigas?.find((v) => v.id === x.pieza)?.planta === planta)) {
        const textos = ev.primitivas.filter((x) => x.tipo === "texto" && x.objeto === p.pieza).map((x) => (x.tipo === "texto" ? x.texto : ""));
        expect(textos.some((t) => t.startsWith("inf ")), p.clave).toBe(true);
        vanosVistos++;
      }
      // Punzonamiento: el perímetro crítico de cada unión de la planta
      const eu = escena(planta, "punzonamiento");
      const tu = await tabla("punzonamiento", a);
      // (el de un pilar que no se comprueba, a puntos: como referencia)
      for (const p of tu.partes.filter((x) => x.planta === planta)) expect(eu.primitivas.some((x) => x.tipo === "linea" && x.estilo === (p.origen === "no-aplica" ? "armado-critico-sin" : "armado-critico") && x.objeto === p.pieza), p.clave).toBe(true);
    }
    expect(barrasVistas).toBeGreaterThan(0);
    expect(vanosVistos).toBeGreaterThan(0);
    expect(refuerzosVistos).toBe(Object.values(a.forjados ?? {}).reduce((t, f) => t + (f.refuerzos?.length ?? 0), 0));
    // Un clic en un refuerzo lo elige por su id
    const con = Object.entries(a.forjados ?? {}).find(([, f]) => f.refuerzos?.length);
    if (con) {
      const planta = modelo.losas!.find((l) => l.id === con[0])!.planta;
      const vista = { vista: "comprobacion" as const, de: "losas" as const, armado: a, dibujo: "armado" as const };
      const marca = escena(planta, "losas").primitivas.find((x): x is Extract<Escena["primitivas"][number], { tipo: "marca" }> => x.tipo === "marca" && !!x.objeto?.startsWith(`${con[0]}/R`))!;
      const e = await pedir<{ objeto: string } | null>({ tipo: "elegir", fuente: { tipo: "planta", planta, vista }, punto: marca.p, radio: 0.05 });
      expect(e?.objeto.startsWith(`${con[0]}/R`)).toBe(true);
    }
  });

  it("§8.16: los pilares que atraviesan la losa dentro del ancho de sus vigas no se comprueban a punzonamiento, y se dice por qué; un clic en un ábaco elige su pilar", async () => {
    const a = propuesto.armado;
    const t = await tabla("punzonamiento", a);
    const no = t.partes.filter((p) => p.origen === "no-aplica");
    // El edificio objetivo tiene vigas en los ejes: los pilares van dentro de su ancho
    expect(no.length).toBeGreaterThan(0);
    expect(t.resumen.noAplica).toBe(no.length);
    for (const p of no) {
      expect(p.cumple).toBe(true);
      expect(p.aprovechamiento).toBeNull();
      expect(p.pendientes[0]).toMatch(/dentro del ancho de/);
      // Ninguna unión comprobada de ese pilar en esa planta: o se comprueba o no
      expect(t.partes.filter((x) => x.clave === p.clave).length).toBe(1);
      const f = await pedir<FichaComprobacion>({ tipo: "comprobacion", de: "punzonamiento", clave: p.clave, armado: a });
      expect(f.geometria.tipo === "punzonamiento" && f.geometria.d).toBeGreaterThan(0);
      expect(f.hipotesis?.length).toBeGreaterThan(0);
      // Es lo que da `transmitidoPilar`: la losa no le pasa nada por su huella
      const tr = q.transmitidoPilar(p.pieza, p.planta!);
      expect(tr.valido && tr.valor).toBeNull();
    }
    // Las uniones comprobadas, con sus hipótesis de partida en la ficha
    const si = comprobadas(t)[0];
    if (si) {
      const f = await pedir<FichaComprobacion>({ tipo: "comprobacion", de: "punzonamiento", clave: si.clave, armado: a });
      expect(f.hipotesis?.some((x) => x.startsWith("Demanda:"))).toBe(true);
      expect(f.hipotesis?.some((x) => x.startsWith("Canto útil d ="))).toBe(true);
    }
    // En la planta del punzonamiento, ningún ábaco se queda con su id: un clic en él es un clic en su pilar
    const sesion = (at as unknown as { sesion: { escenaA4: (p: string, v: unknown) => { valido: true; valor: Escena } } }).sesion;
    for (const planta of modelo.plantas.map((x) => x.id)) {
      const e = sesion.escenaA4(planta, { vista: "comprobacion", de: "punzonamiento", armado: a, dibujo: "armado" }).valor;
      const conPilar = new Set(t.partes.filter((x) => x.planta === planta).map((x) => x.pieza));
      for (const x of e.primitivas) if ("objeto" in x && x.objeto && /\/A\d+$/.test(x.objeto)) expect(conPilar.size, `${planta} ${x.objeto}`).toBe(0);
    }
  });

  it("§8.16: el armado de las losas en el 3D: cada refuerzo con su contorno y sus barras, en la cota de su cara", async () => {
    const a = propuesto.armado;
    const d = await pedir<import("./diagramas3d.ts").Diagramas3D>({ tipo: "armado-losas-3d", planta: null, armado: a });
    const n = Object.values(a.forjados ?? {}).reduce((t, f) => t + (f.refuerzos?.length ?? 0), 0);
    if (!n) return;
    expect(d.lineas.length % 6).toBe(0);
    expect(d.signoLinea.length).toBe(d.lineas.length / 6);
    // Los superiores, por encima de los inferiores de la misma losa
    const zs = (s: number) => [...d.signoLinea.keys()].filter((i) => d.signoLinea[i] === s).map((i) => d.lineas[6 * i + 2]!);
    const [sup, inf] = [zs(1), zs(0)];
    if (sup.length && inf.length) expect(Math.min(...sup)).toBeGreaterThan(Math.min(...inf));
    // Con una sola cara, sólo la suya
    const soloInf = await pedir<import("./diagramas3d.ts").Diagramas3D>({ tipo: "armado-losas-3d", planta: null, armado: a, cara: "inferior" });
    expect([...soloInf.signoLinea].every((x) => x === 0)).toBe(true);
  });

  it("§8.21: el punzonamiento en el 3D: el perímetro crítico de cada unión, con su clave y su pilar, sobre su losa", async () => {
    const a = propuesto.armado;
    const t = await pedir<DatosComprobaciones>({ tipo: "comprobaciones", de: "punzonamiento", armado: a });
    const d = await pedir<import("./diagramas3d.ts").Diagramas3D>({ tipo: "punzonamiento-3d", armado: a });
    // Una unión dibujada por cada parte de la tabla con canto útil, con su clave; su pieza, el pilar
    const claves = new Set(t.partes.map((x) => x.clave));
    expect(d.objetos!.length).toBeGreaterThan(0);
    for (const [k, id] of d.objetos!.entries()) {
      expect(claves.has(id), id).toBe(true);
      expect(d.piezaObjeto![k]).toBe(id.split("/")[0]);
    }
    expect(new Set(d.objetos).size).toBe(d.objetos!.length);
    const n = d.lineas.length / 6;
    expect([d.objetoLinea!.length, d.claseLinea!.length, d.colorLinea!.length / 3]).toEqual([n, n, n]);
    expect([...d.objetoLinea!].every((k) => k < d.objetos!.length)).toBe(true);
    // Cada línea, horizontal; y las de una planta, por encima de las de las plantas de debajo
    for (let i = 0; i < n; i++) expect(d.lineas[6 * i + 2]).toBe(d.lineas[6 * i + 5]);
    expect(d.leyenda.length).toBeGreaterThan(0);
  });

  it("sin resultados no hay comprobaciones", async () => {
    const otro = new Atendedor("x");
    await otro.atender({ tipo: "abrir", texto: JSON.stringify({ esquema: VERSION_ESQUEMA, modelo }) });
    const r = await otro.atender({ tipo: "comprobaciones", de: "pilares" });
    expect(r.ok).toBe(false);
  });
});
