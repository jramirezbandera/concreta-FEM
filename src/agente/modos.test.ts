/**
 * VS2 en la capa de agente (`docs/fem3d/viento-sismo.md` §5):
 * - criterio 1: la masa del peso propio es el peso esperado de A3 (el de la sensatez, sin la malla);
 * - el análisis modal se guarda con los resultados y se relee con los mismos bits; unos resultados
 *   sin él no valen para un modelo que lo pide, ni al revés;
 * - `fem consultar modos`: la consulta acotada y la CLI de verdad, también reutilizando lo guardado.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { compilar } from "../compilador/compilar.ts";
import { Consultas } from "../compilador/consultas.ts";
import type { ModeloFisico } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import { GRAVEDAD } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { modos } from "./consultas.ts";
import { VERSION_ESQUEMA } from "./proyecto.ts";
import { desempaquetarResultados, empaquetarResultados } from "./resultados.ts";
import { pesoPropioCalculado, pesoPropioEsperado, Plantas } from "./sensatez.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
let dir = "";
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fem-vs2-"));
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Con el sismo en las acciones: G entero (el del peso propio), la mitad de Q y nada de los demás (no llevan acción). */
const conSismo = (f: ModeloFisico): ModeloFisico => ({ ...f, acciones: { ...f.acciones, sismo: { masas: f.casos.filter((c) => !c.pesoPropio).map((c) => ({ caso: c.id, fraccion: c.id === "Q" ? 0.5 : 0 })) } } });

function calculado(f: ModeloFisico) {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return { c, r };
}

describe("VS2: la masa es el peso que se calcula", () => {
  it("criterio 1: con sólo el peso propio, Σ m·g es el peso esperado de A3 (sin la malla)", () => {
    for (const [nombre, base, tol] of [
      ["losas", edificioObjetivoLosas(2, 3, 2), 1e-9],
      ["núcleo de muros", reticulaConNucleo(), 1e-3],
    ] as const) {
      // sólo el peso propio: sin las cargas del modelo
      const f: ModeloFisico = { ...base, cargas: [], acciones: { sismo: { masas: base.casos.filter((c) => !c.pesoPropio).map((c) => ({ caso: c.id, fraccion: 0 })) } } };
      const { r } = calculado(f);
      const esperado = pesoPropioEsperado(f, new Plantas(f)).reduce((s, x) => s + x.esperado, 0);
      expect(Math.abs(r.modal!.masas.total * GRAVEDAD - esperado) / esperado, nombre).toBeLessThan(tol);
    }
  });

  it("el peso propio calculado de la revisión no se pierde con las acciones del programa (las masas nombran casos que ahí se quitan)", () => {
    const base = edificioObjetivoLosas(2, 3, 2);
    const sin = pesoPropioCalculado(base, undefined)!;
    const con = pesoPropioCalculado(conSismo({ ...base, acciones: { viento: { zona: "A", aspereza: "IV" } } }), undefined);
    expect(con).not.toBe(null);
    expect([...con!]).toEqual([...sin]);
  });
});

describe("VS2: el análisis modal, con los resultados guardados", () => {
  it("se empaqueta y se relee con los mismos bits; sin él, los resultados no valen para un modelo que lo pide", () => {
    const f = conSismo(edificioObjetivoLosas(2, 3, 2));
    const { c, r } = calculado(f);
    const md = r.modal!;
    const { cabecera, bytes } = empaquetarResultados(c.huella, c.modelo, r.casos, r.estadisticas, [], md);
    // la cabecera pasa por JSON, como en el disco
    const d = desempaquetarResultados(JSON.parse(JSON.stringify(cabecera)), bytes, c.modelo);
    if ("motivo" in d) throw new Error(d.motivo);
    expect(d.casos.length).toBe(r.casos.length);
    const otro = d.modal!;
    expect(otro.masas).toEqual(md.masas);
    expect(otro.diafragmas).toEqual(md.diafragmas);
    expect(otro.modos.length).toBe(md.modos.length);
    md.modos.forEach((m, i) => {
      const o = otro.modos[i]!;
      expect(o.omega2).toBe(m.omega2);
      expect(o.masaEfectiva).toEqual(m.masaEfectiva);
      for (const campo of ["forma", "fuerzas", "u", "reacciones", "esfuerzosBarras", "esfuerzosLaminas"] as const) expect(Buffer.from(o[campo].buffer, o[campo].byteOffset, o[campo].byteLength).equals(Buffer.from(m[campo].buffer, m[campo].byteOffset, m[campo].byteLength)), `${campo} del modo ${i + 1}`).toBe(true);
    });
    // los casos, como sin el modal
    r.casos.forEach((caso, k) => expect(Buffer.from(d.casos[k]!.u.buffer).equals(Buffer.from(caso.u.buffer))).toBe(true));

    // unos resultados sin los modos no valen para este modelo…
    const sin = empaquetarResultados(c.huella, c.modelo, r.casos, r.estadisticas, []);
    const mal = desempaquetarResultados(sin.cabecera, sin.bytes, c.modelo);
    expect("motivo" in mal && mal.motivo).toContain("no llevan los modos");
    // … ni los que los llevan, para el modelo sin el sismo (otra firma: no es el mismo modelo analítico)
    const { modal: _m, ...sinModal } = c.modelo;
    expect("motivo" in desempaquetarResultados(cabecera, bytes, sinModal)).toBe(true);
    // y si los bytes no son todos, tampoco
    expect("motivo" in desempaquetarResultados(cabecera, bytes.slice(0, bytes.length - 8), c.modelo)).toBe(true);
  });
});

describe("VS2: la consulta «modos»", () => {
  it("masas por planta, y los modos de mayor periodo con su masa efectiva acumulada y su forma", () => {
    const f = conSismo(edificioObjetivoLosas(3, 3, 2));
    const { c, r } = calculado(f);
    const q = new Consultas(f, c, r.casos, {}, r.modal);
    const todos = modos(q, { todos: true });
    if (!todos.valido) throw new Error("sin modos");
    const v = todos.valor;
    expect(v.plantas.map((p) => p.planta)).toEqual(["N1", "N2", "N3"]);
    expect(v.numeroDeModos).toBe(9);
    expect(v.modos.length).toBe(9);
    expect(v.omitidos).toBe(undefined);
    expect(Math.abs(v.peso - v.masas.plantas * GRAVEDAD)).toBeLessThan(1e-9);
    expect(Math.abs(v.plantas.reduce((s, p) => s + p.masa, 0) - v.masas.plantas)).toBeLessThan(1e-9);
    // entre todos los modos, toda la masa
    for (const d of [0, 1, 2]) expect(Math.abs(v.modos[8]!.acumulada[d]! - 1)).toBeLessThan(1e-10);
    v.modos.forEach((m, i) => {
      expect(m.modo).toBe(i + 1);
      expect(Math.abs(m.f * m.T - 1)).toBeLessThan(1e-12);
      if (i) expect(m.T).toBeLessThanOrEqual(v.modos[i - 1]!.T);
      // la forma, con la mayor traslación igual a 1
      expect(Math.abs(Math.max(...m.forma.flatMap((x) => [Math.abs(x[0]), Math.abs(x[1])])) - 1)).toBeLessThan(1e-12);
    });
    // por defecto y con --top, los primeros
    const tres = modos(q, { top: 3 });
    if (!tres.valido) throw new Error("sin modos");
    expect(tres.valor.modos.length).toBe(3);
    expect(tres.valor.omitidos).toBe(6);
    expect(tres.valor.modos).toEqual(v.modos.slice(0, 3));
  });

  it("la CLI: `fem consultar modos` calcula, guarda el modal y lo reutiliza con los mismos números; sin el sismo, lo dice", () => {
    const fem = (args: string[]) => {
      const x = spawnSync("node", [join(RAIZ, "cli", "fem.ts"), ...args], { encoding: "utf8", cwd: dir, maxBuffer: 1 << 26 });
      const lineas = x.stdout.trim().split("\n");
      expect(lineas.length, x.stderr).toBe(1);
      return { codigo: x.status ?? -1, json: JSON.parse(lineas[0]!) as Record<string, any> };
    };
    const escribir = (nombre: string, modelo: ModeloFisico) => {
      mkdirSync(join(dir, nombre), { recursive: true });
      const ruta = join(dir, nombre, "proyecto.json");
      writeFileSync(ruta, JSON.stringify({ esquema: VERSION_ESQUEMA, modelo }, null, 2));
      return ruta;
    };
    const f = conSismo(edificioObjetivoLosas(2, 3, 2));
    const ruta = escribir("con", f);
    // el proyecto con `acciones.sismo` cumple el esquema
    expect(fem(["validar", ruta]).codigo).toBe(0);
    const a = fem(["consultar", ruta, "modos", "--exacto"]);
    expect(a.codigo).toBe(0);
    expect(a.json.valor.numeroDeModos).toBe(6);
    expect(a.json.valor.plantas.map((p: { planta: string }) => p.planta)).toEqual(["N1", "N2"]);
    // lo mismo que el motor llamado desde aquí
    const { r } = calculado(f);
    expect(a.json.valor.modos.map((m: { T: number }) => m.T)).toEqual(r.modal!.modos.map((m) => m.periodo));
    // la segunda vez reutiliza los resultados guardados, con su modal
    const b = fem(["consultar", ruta, "modos", "--exacto"]);
    expect(b.json.valor).toEqual(a.json.valor);
    const calc = fem(["calcular", ruta]);
    expect(calc.json.reutilizados).toBe(true);
    expect(calc.json.modos.numero).toBe(6);
    expect(calc.json.modos.equilibrio).toBeLessThan(1e-9);
    // las demás consultas siguen igual con el modal guardado
    expect(fem(["consultar", ruta, "reacciones", "--casos"]).codigo).toBe(0);
    // sin el sismo en las acciones
    const sin = fem(["consultar", escribir("sin", edificioObjetivoLosas(2, 3, 2)), "modos"]);
    expect(sin.codigo).toBe(1);
    expect(sin.json.diagnosticos[0].codigo).toBe("consulta/sin-modal");
  });
});
