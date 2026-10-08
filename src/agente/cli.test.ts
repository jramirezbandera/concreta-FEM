/**
 * Criterios 3 y 4 de A0, con la CLI de verdad (un proceso aparte, como la usará un agente):
 * - 3: `fem calcular` da los mismos bits que `compilar` y `calcular` llamados desde el test (la CLI
 *   corre aquí en Node, el motor de vitest; en Bun la malla puede diferir en un ulp, C2-3);
 * - 4: la huella y los resultados no dependen del orden del JSON (claves y listas) ni del motor de
 *   JavaScript (Node y Bun), y el nombre y la descripción no entran en la huella.
 * Además, los códigos de salida y la forma de la salida.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { compilar } from "../compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { azar, fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../pruebas/forjadosAleatorios.ts";
import { barajar } from "../pruebas/metamorficasFisicas.ts";
import { desempaquetarResultados, type CabeceraResultados } from "./resultados.ts";
import { VERSION_ESQUEMA } from "./proyecto.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const FEM = join(RAIZ, "cli", "fem.ts");
const bun = (() => {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

let dir = "";
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fem-a0-"));
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Ejecuta la CLI con Node (o con Bun) y devuelve su salida JSON y su código. */
function fem(args: string[], motor: "node" | "bun" = "node"): { codigo: number; json: Record<string, unknown> } {
  const r = spawnSync(motor, [FEM, ...args], { encoding: "utf8", cwd: dir, maxBuffer: 1 << 26 });
  const lineas = r.stdout.trim().split("\n");
  expect(lineas.length, r.stderr).toBe(1);
  return { codigo: r.status ?? -1, json: JSON.parse(lineas[0]!) as Record<string, unknown> };
}

let n = 0;
function escribir(modelo: ModeloFisico, opciones?: OpcionesCompilacion, extra: Record<string, unknown> = {}): string {
  const sub = join(dir, `p${++n}`);
  mkdirSync(sub, { recursive: true });
  const ruta = join(sub, "proyecto.json");
  writeFileSync(ruta, JSON.stringify({ esquema: VERSION_ESQUEMA, ...extra, modelo, ...(opciones ? { opciones } : {}) }, null, 2));
  return ruta;
}

function guardados(ruta: string, huella: string) {
  const carpeta = join(ruta, "..", ".fem", huella);
  const cabecera = JSON.parse(readFileSync(join(carpeta, "resultados.json"), "utf8")) as CabeceraResultados;
  const casos = desempaquetarResultados(cabecera, new Uint8Array(readFileSync(join(carpeta, "resultados.bin"))));
  expect(casos).not.toBeNull();
  return casos!;
}

const mismosBits = (a: Float64Array, b: Float64Array) => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

const MODELOS: [string, () => ModeloFisico, OpcionesCompilacion | undefined][] = [
  ["retícula con núcleo (losas, muros y huecos)", reticulaConNucleo, { tamanoMalla: 1 }],
  ["al azar 4, unidireccional", () => conForjadosAleatorios(fisicoAleatorio(4), 4, { tipo: "unidireccional" }), undefined],
  ["al azar 6, reticular", () => conForjadosAleatorios(fisicoAleatorio(6), 6, { tipo: "reticular" }), undefined],
];

describe("criterio 3 de A0: fem calcular da los mismos bits que compilar y calcular", () => {
  for (const [nombre, modelo, opciones] of MODELOS)
    it(nombre, () => {
      const ruta = escribir(modelo(), opciones);
      const s = fem(["calcular", ruta]);
      expect(s.codigo, JSON.stringify(s.json)).toBe(0);
      expect(s.json.ok).toBe(true);
      expect(s.json.reutilizados).toBe(false);
      const c = compilar(modelo(), opciones);
      if (!c.valido) throw new Error("no compila");
      expect(s.json.huella).toBe(c.huella);
      const directos = casosValidos(calcular(c.modelo));
      const cli = guardados(ruta, c.huella);
      expect(cli.length).toBe(directos.length);
      directos.forEach((d, k) => {
        for (const campo of ["u", "reacciones", "esfuerzosBarras", "esfuerzosLaminas"] as const) expect(mismosBits(cli[k]![campo], d[campo]), `${d.id}.${campo}`).toBe(true);
        expect(cli[k]!.equilibrio).toEqual(d.equilibrio);
      });
      // La segunda vez reutiliza los guardados
      const t = fem(["calcular", ruta]);
      expect(t.json.reutilizados).toBe(true);
      expect(t.json.casos).toEqual(s.json.casos);
    });
});

/** El mismo JSON con las claves de cada objeto en orden inverso. */
function clavesAlReves(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clavesAlReves);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, clavesAlReves(x)]));
  return v;
}

describe("criterio 4 de A0: la salida no depende del orden del JSON ni del motor de JavaScript", () => {
  it("claves en otro orden y listas barajadas: la misma huella y los mismos bits", () => {
    const f = conForjadosAleatorios(fisicoAleatorio(5), 5);
    const r = azar(5);
    const g = clavesAlReves({ ...f, materiales: barajar(f.materiales, r), secciones: barajar(f.secciones, r), pilares: barajar(f.pilares!, r), vigas: barajar(f.vigas!, r), cargas: barajar(f.cargas!, r), ...(f.panos ? { panos: barajar(f.panos, r) } : {}), ...(f.losas ? { losas: barajar(f.losas, r) } : {}) }) as ModeloFisico;
    const [a, b] = [escribir(f), escribir(g)];
    const [sa, sb] = [fem(["calcular", a]), fem(["calcular", b])];
    expect(sa.codigo).toBe(0);
    expect(sb.json.huella).toBe(sa.json.huella);
    expect(sb.json.huella).toBe(compilar(f).huella);
    const [ca, cb] = [guardados(a, sa.json.huella as string), guardados(b, sb.json.huella as string)];
    ca.forEach((c, k) => {
      for (const campo of ["u", "reacciones", "esfuerzosBarras", "esfuerzosLaminas"] as const) expect(mismosBits(c[campo], cb[k]![campo]), campo).toBe(true);
    });
  });

  it("el nombre, la descripción y $schema no entran en la huella", () => {
    const f = fisicoAleatorio(3);
    const a = fem(["compilar", escribir(f)]);
    const b = fem(["compilar", escribir(f, undefined, { nombre: "otro", descripcion: "lo que sea", $schema: "./proyecto.schema.json" })]);
    expect(b.json.huella).toBe(a.json.huella);
    const c = fem(["compilar", escribir(f, { tamanoMalla: 0.5 })]);
    expect(c.json.huella).not.toBe(a.json.huella);
  });

  it.skipIf(!bun)("Node y Bun dan la misma huella y la misma salida de validar y compilar", () => {
    for (const [nombre, modelo, opciones] of MODELOS) {
      const ruta = escribir(modelo(), opciones);
      for (const orden of ["validar", "compilar"]) {
        const [x, y] = [fem([orden, ruta, "--cifras", "9"]), fem([orden, ruta, "--cifras", "9"], "bun")];
        expect(y.codigo, nombre).toBe(x.codigo);
        const sinTiempo = (j: Record<string, unknown>) => ({ ...j, estadisticas: { ...(j.estadisticas as object), segundos: 0 } });
        expect(sinTiempo(y.json), `${nombre} ${orden}`).toEqual(sinTiempo(x.json));
      }
    }
  });
});

describe("códigos de salida y forma de la salida", () => {
  it("bien (0), modelo con errores (1), orden mal dada (2)", () => {
    const f = fisicoAleatorio(2);
    expect(fem(["validar", escribir(f)]).codigo).toBe(0);
    // Error del compilador: una sección que no existe
    const mal = { ...f, pilares: [{ ...f.pilares![0]!, seccion: "no-existe" }, ...f.pilares!.slice(1)] };
    const v = fem(["validar", escribir(mal)]);
    expect(v.codigo).toBe(1);
    expect(v.json.ok).toBe(false);
    expect((v.json.diagnosticos as { codigo: string; ids: string[] }[]).some((d) => d.codigo === "fisico/referencia" && d.ids.includes(f.pilares![0]!.id))).toBe(true);
    // Error de esquema: un campo mal escrito
    const errata = { ...f, pilares: [{ ...f.pilares![0]!, secion: "x" }, ...f.pilares!.slice(1)] };
    const e = fem(["calcular", escribir(errata)]);
    expect(e.codigo).toBe(1);
    expect((e.json.diagnosticos as { codigo: string }[])[0]!.codigo).toBe("esquema/campo-desconocido");
    // Orden mal dada
    expect(fem(["validar", join(dir, "no-existe.json")]).codigo).toBe(2);
    expect(fem(["nada"]).codigo).toBe(2);
    expect(fem(["validar"]).codigo).toBe(2);
    expect(fem(["consultar", escribir(f), "lo-que-sea"]).codigo).toBe(2);
    expect(fem(["validar", escribir(f), "--opcion-rara"]).codigo).toBe(2);
    const roto = join(dir, "roto.json");
    writeFileSync(roto, "{ no es json");
    expect(fem(["validar", roto]).codigo).toBe(2);
    expect(fem(["ayuda"]).codigo).toBe(0);
    const esq = fem(["esquema"]);
    expect(esq.json.version).toBe(VERSION_ESQUEMA);
  });

  it("cada salida lleva orden, ok y diagnosticos; los números a 6 cifras salvo con --exacto", () => {
    const ruta = escribir(fisicoAleatorio(1));
    for (const args of [["validar", ruta], ["compilar", ruta], ["calcular", ruta], ["resumen", ruta], ["consultar", ruta, "reacciones"], ["esquema"]]) {
      const s = fem(args);
      expect(s.json.orden).toBe(args[0]);
      expect(typeof s.json.ok).toBe("boolean");
      if (args[0] !== "esquema") expect(Array.isArray(s.json.diagnosticos)).toBe(true);
    }
    const x = fem(["consultar", ruta, "reacciones", "--exacto"]).json as { valor: { totales: { F: number[] }[] } };
    const y = fem(["consultar", ruta, "reacciones"]).json as { valor: { totales: { F: number[] }[] } };
    const F = x.valor.totales[0]!.F[2]!;
    expect(y.valor.totales[0]!.F[2]).toBe(Number(F.toPrecision(6)));
  });
});
