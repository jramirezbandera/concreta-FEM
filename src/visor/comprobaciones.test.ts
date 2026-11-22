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
import type { DatosArmar, DatosComprobaciones, DatosPortico, FichaComprobacion, TipoComprobacion } from "./comprobaciones.ts";
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
      expect(t.partes.length, de).toBeGreaterThan(0);
      expect(t.resumen.cumplen, de).toBe(0);
      expect(t.resumen.sinArmado, de).toBe(t.partes.length);
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
      expect(t.partes.map((p) => ({ clave: p.clave, cumple: p.cumple, aprovechamiento: p.aprovechamiento, texto: p.texto, manda: p.manda?.id })), de).toEqual(esperado[de].map(({ filas: _f, ...x }) => x));
      expect(t.resumen.sinArmado, de).toBe(0);
      expect(t.resumen.cumplen + t.resumen.noCumplen, de).toBe(t.partes.length);
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
    expect(t.partes.length).toBeGreaterThan(0);
    const [pilar, planta] = t.partes[0]!.clave.split("/") as [string, string];
    // Una armadura escrita a mano, haga falta o no
    const escrita = { diametro: 10, ramas: 2, separacion: 120 };
    const conEscrita: ArmadoProyecto = { ...a, punzonamiento: { ...a.punzonamiento, [pilar]: { ...a.punzonamiento?.[pilar], [planta]: escrita } } };
    const falta = await pedir<DatosArmar>({ tipo: "armar", tipos: TIPOS_COMPROBACION, armado: conEscrita, soloSinArmado: true });
    expect(falta.armado.punzonamiento?.[pilar]?.[planta]).toEqual(escrita);
    expect(falta.resumen.punzonamiento!.conservadas).toBe(1);
    // Lo demás, como sin ella
    expect(falta.armado.pilares).toEqual(a.pilares);
    expect(falta.armado.forjados).toEqual(a.forjados);
    for (const p of t.partes.slice(1)) {
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
        const marcas = ep.primitivas.filter((x): x is Extract<Escena["primitivas"][number], { tipo: "marca" }> => x.tipo === "marca" && x.estilo === "armado-barra" && x.objeto === p.pieza);
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
      for (const p of tu.partes.filter((x) => x.planta === planta)) expect(eu.primitivas.some((x) => x.tipo === "linea" && x.estilo === "armado-critico" && x.objeto === p.pieza), p.clave).toBe(true);
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

  it("sin resultados no hay comprobaciones", async () => {
    const otro = new Atendedor("x");
    await otro.atender({ tipo: "abrir", texto: JSON.stringify({ esquema: VERSION_ESQUEMA, modelo }) });
    const r = await otro.atender({ tipo: "comprobaciones", de: "pilares" });
    expect(r.ok).toBe(false);
  });
});
