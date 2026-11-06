/**
 * Criterios 3 y 4 de A0, con la CLI de verdad (un proceso aparte, como la usará un agente):
 * - 3: `fem calcular` da los mismos bits que `compilar` y `calcular` llamados desde el test (la CLI
 *   corre aquí en Node, el motor de vitest; en Bun la malla puede diferir en un ulp, C2-3);
 * - 4: la huella y los resultados no dependen del orden del JSON (claves y listas) ni del motor de
 *   JavaScript (Node y Bun), y el nombre y la descripción no entran en la huella.
 * Además, los códigos de salida y la forma de la salida.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { compilar } from "../compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../compilador/fisico.ts";
import { calcular } from "../motor/calcular.ts";
import type { ModeloAnalitico } from "../motor/modelo.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { casosValidos } from "../pruebas/comparar.ts";
import { azar, fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../pruebas/forjadosAleatorios.ts";
import { barajar } from "../pruebas/metamorficasFisicas.ts";
import { desempaquetarResultados, empaquetarResultados, type CabeceraResultados } from "./resultados.ts";
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

function guardados(ruta: string, huella: string, modelo: ModeloAnalitico) {
  const carpeta = join(ruta, "..", ".fem", huella);
  const cabecera = JSON.parse(readFileSync(join(carpeta, "resultados.json"), "utf8")) as CabeceraResultados;
  const d = desempaquetarResultados(cabecera, new Uint8Array(readFileSync(join(carpeta, "resultados.bin"))), modelo);
  if ("motivo" in d) throw new Error(d.motivo);
  return d.casos;
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
      const cli = guardados(ruta, c.huella, c.modelo);
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

  // `docs/fem3d/firma-resultados.md`: si el compilador cambia su salida sin cambiar de versión, la
  // misma huella da otra malla, y los guardados de la malla de antes se leían sobre la nueva
  it("con la misma huella y otro modelo analítico, recalcula en vez de reutilizar los guardados", () => {
    const ruta = escribir(reticulaConNucleo(), { tamanoMalla: 1 });
    const s = fem(["calcular", ruta]);
    expect(s.codigo, JSON.stringify(s.json)).toBe(0);
    const carpeta = join(ruta, "..", ".fem", s.json.huella as string);
    const fCab = join(carpeta, "resultados.json");
    const motor = (JSON.parse(readFileSync(fCab, "utf8")) as { motor: string }).motor;
    // Los resultados de otra malla, con la huella, el núcleo y el sha256 que pide la CLI
    const otra = compilar(reticulaConNucleo(), { tamanoMalla: 0.9 });
    if (!otra.valido) throw new Error("no compila");
    const r = calcular(otra.modelo);
    if (!r.valido) throw new Error("no calcula");
    const { cabecera, bytes } = empaquetarResultados(s.json.huella as string, otra.modelo, r.casos, r.estadisticas, []);
    writeFileSync(join(carpeta, "resultados.bin"), bytes);
    writeFileSync(fCab, JSON.stringify({ ...cabecera, motor, sha256: createHash("sha256").update(bytes).digest("hex") }));
    const t = fem(["calcular", ruta]);
    expect(t.codigo).toBe(0);
    expect(t.json.reutilizados).toBe(false);
    expect(t.json.casos).toEqual(s.json.casos);
    // Y lo que deja guardado es ya lo de su modelo
    expect(fem(["calcular", ruta]).json.reutilizados).toBe(true);
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
    const cf = compilar(f);
    if (!cf.valido) throw new Error("no compila");
    const [ca, cb] = [guardados(a, sa.json.huella as string, cf.modelo), guardados(b, sb.json.huella as string, cf.modelo)];
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

describe("A3: revisar", () => {
  it("revisar escribe el informe de la huella, sin firma (no hay «fem firmar»); un cambio del proyecto da otra huella", () => {
    const f = reticulaConNucleo();
    const ruta = escribir(f, undefined, { nombre: "Retícula" });
    const r = fem(["revisar", ruta]);
    expect(r.codigo).toBe(0);
    const j = r.json as { ok: boolean; huella: string; informe: { markdown: string; html: string; sha256: string }; avisos: number; comprobaciones: { codigo: string; estado: string }[] };
    expect(j.ok).toBe(true);
    expect(j).not.toHaveProperty("firma");
    // Sólo el borde sin viga: la retícula no lleva zunchos
    expect(j.avisos).toBe(1);
    expect(j.comprobaciones.find((c) => c.codigo === "sensatez/borde-sin-viga")?.estado).toBe("avisos");
    expect(j.comprobaciones.length).toBe(24); // 2026-11-05: «Caso del peso propio, sólo con el peso propio»; M-26: «Objetos lejos del resto»; MA5: «Pilares y vértices alineados»
    expect(j.comprobaciones.find((c) => c.codigo === "sensatez/casi-alineados")?.estado).toBe("bien");
    const md = readFileSync(join(ruta, "..", ".fem", j.huella, "informe.md"), "utf8");
    expect(md).toContain(j.huella);
    expect(md).toContain("# Informe de revisión: Retícula");
    expect(md).not.toMatch(/firm/i);
    expect(readFileSync(join(ruta, "..", ".fem", j.huella, "informe.html"), "utf8")).toContain("<table>");
    // Firmar ya no es una orden
    expect(fem(["firmar", ruta, "--por", "Ingeniero"]).codigo).toBe(2);
    // Otro modelo: otra huella
    const g = structuredClone(f) as ModeloFisico;
    (g.losas![0] as { espesor: number }).espesor = 0.25;
    writeFileSync(ruta, JSON.stringify({ esquema: VERSION_ESQUEMA, modelo: g }));
    const r2 = fem(["revisar", ruta]).json as { huella: string };
    expect(r2.huella).not.toBe(j.huella);
  });

  it("validar da los avisos de sensatez previos aunque el modelo no compile", () => {
    const f = structuredClone(reticulaConNucleo()) as ModeloFisico;
    (f.losas![0] as { espesor: number }).espesor = 22;
    const v = fem(["validar", escribir(f)]);
    expect(v.codigo).toBe(1);
    expect((v.json.diagnosticos as { codigo: string }[]).map((d) => d.codigo)).toContain("sensatez/espesor");
  });
});

describe("A4: render", () => {
  it("render escribe el PNG y el SVG de cada planta y vista, igual en Node y en Bun; el informe lleva las figuras", () => {
    const f = reticulaConNucleo();
    const ruta = escribir(f, undefined, { nombre: "Retícula" });
    const r = fem(["render", ruta, "--vista", "modelo,uz", "--vista", "cargas", "--planta", "N1"]);
    expect(r.codigo).toBe(0);
    const j = r.json as { ok: boolean; huella: string; valido: boolean; figuras: { planta: string; vista: string; caso?: string; png: string; svg: string; ancho: number; alto: number; extremos: { que: string; valor: number }[] }[] };
    expect(j.ok && j.valido).toBe(true);
    expect(j.figuras.map((x) => `${x.vista}${x.caso ? `-${x.caso}` : ""}`)).toEqual(["modelo", "uz", ...f.casos.map((c) => `cargas-${c.id}`)]);
    const carpeta = join(ruta, "..", ".fem", j.huella, "render");
    for (const x of j.figuras) {
      const png = readFileSync(join(carpeta, x.png));
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(png.readUInt32BE(16)).toBe(x.ancho);
      expect(png.readUInt32BE(20)).toBe(x.alto);
      expect(readFileSync(join(carpeta, x.svg), "utf8").startsWith("<svg")).toBe(true);
    }
    // UI-14: en uz, la flecha (hacia abajo) y lo que sube
    expect(j.figuras[1]!.extremos.map((x) => x.que)).toEqual(["flecha máxima", "levantamiento máximo"]);
    // UI-1: --envolvente, sólo max o min
    expect(fem(["render", ruta, "--vista", "uz", "--planta", "N1", "--envolvente", "media"]).codigo).not.toBe(0);
    expect(fem(["render", ruta, "--vista", "uz", "--planta", "N1", "--envolvente", "min"]).codigo).toBe(0);
    if (bun) {
      const png = readFileSync(join(carpeta, j.figuras[1]!.png));
      expect(fem(["render", ruta, "--vista", "uz", "--planta", "N1"], "bun").codigo).toBe(0);
      expect(readFileSync(join(carpeta, j.figuras[1]!.png)).equals(png)).toBe(true);
    }
    const rev = fem(["revisar", ruta]).json as { huella: string };
    const md = readFileSync(join(ruta, "..", ".fem", rev.huella, "informe.md"), "utf8");
    expect(md).toMatch(/Figura: Planta N1: modelo\. SVG, sha256 [0-9a-f]{64}\./);
    expect(md).toMatch(/Figura: Planta N1: uz \(mm\), .+\. SVG, sha256 [0-9a-f]{64}\./);
    expect(readFileSync(join(ruta, "..", ".fem", rev.huella, "informe.html"), "utf8")).toContain("<figure><figcaption>Planta N1: modelo</figcaption>\n<svg");
  });

  it("las vistas del modelo se dibujan aunque no compile; las de resultados, no; una vista o una planta desconocidas son orden mal dada", () => {
    const f = reticulaConNucleo();
    const mal = { ...f, pilares: [{ ...f.pilares![0]!, seccion: "no-existe" }, ...f.pilares!.slice(1)] };
    const ruta = escribir(mal);
    const m = fem(["render", ruta, "--vista", "modelo,diagnosticos", "--planta", "N1"]);
    expect(m.codigo).toBe(0);
    expect(m.json.valido).toBe(false);
    expect((m.json.figuras as unknown[]).length).toBe(2);
    const u = fem(["render", ruta, "--vista", "uz"]);
    expect(u.codigo).toBe(1);
    expect((u.json.diagnosticos as { codigo: string }[]).some((d) => d.codigo === "fisico/referencia")).toBe(true);
    expect(fem(["render", ruta, "--vista", "planta-3d"]).codigo).toBe(2);
    expect(fem(["render", ruta, "--planta", "N9"]).codigo).toBe(2);
    expect(fem(["render", ruta, "--vista", "uz", "--escala", "5:1:1"]).codigo).toBe(2);
    expect(fem(["render", ruta, "--vista", "uz", "--escala", "a lo bestia"]).codigo).toBe(2);
  });
});

describe("MA5: alinear", () => {
  it("sólo propone; con --escribir alinea, deja el fichero de antes en .bak y el proyecto valida sin el aviso", () => {
    const m = reticulaConNucleo();
    const ruta = escribir({ ...m, pilares: m.pilares!.map((p) => (p.id === "P6-5" ? { ...p, x: 6.018 } : p)) });
    const antes = readFileSync(ruta, "utf8");
    const v = fem(["validar", ruta]);
    expect((v.json.diagnosticos as { codigo: string; ids?: string[] }[]).find((d) => d.codigo === "sensatez/casi-alineados")?.ids).toContain("P6-5");
    const a = fem(["alinear", ruta]);
    expect(a.codigo).toBe(0);
    expect(a.json.escrito).toBe(false);
    expect((a.json.grupos as unknown[]).length).toBe(1);
    expect(a.json.movimientos).toEqual([{ id: "P6-5", coleccion: "pilares", de: [6.018, 5], a: [6, 5] }]);
    expect(readFileSync(ruta, "utf8")).toBe(antes);
    const b = fem(["alinear", ruta, "--escribir"]);
    expect(b.codigo).toBe(0);
    expect(b.json.escrito).toBe(true);
    expect(b.json.huella).toBe(compilar(m).huella);
    expect(readFileSync(`${ruta}.bak`, "utf8")).toBe(antes);
    expect(fem(["alinear", ruta]).json.grupos).toEqual([]);
    expect((fem(["validar", ruta]).json.diagnosticos as { codigo: string }[]).some((d) => d.codigo === "sensatez/casi-alineados")).toBe(false);
    // A 1 cm, 1,8 cm no es casi alineado; una tolerancia que no es un número es una orden mal dada
    writeFileSync(ruta, antes);
    expect(fem(["alinear", ruta, "--tolerancia", "0,01"]).json.grupos).toEqual([]);
    expect(fem(["alinear", ruta, "--tolerancia", "tres"]).codigo).toBe(2);
  });
});

describe("MA: vigas-borde", () => {
  it("sólo propone lo de «Vigas de borde» del editor; con --escribir, lo pone, deja el .bak y valida sin bordes libres", () => {
    const m = reticulaConNucleo();
    const ruta = escribir({ ...m, vigas: [] });
    const antes = readFileSync(ruta, "utf8");
    const v = fem(["validar", ruta]);
    expect((v.json.diagnosticos as { codigo: string }[]).some((d) => d.codigo === "sensatez/borde-sin-viga")).toBe(true);
    const a = fem(["vigas-borde", ruta]);
    expect(a.codigo).toBe(0);
    expect(a.json.escrito).toBe(false);
    const losas = a.json.losas as { losa: string; vigas: { id: string }[]; seccion: string }[];
    expect(losas.length).toBe(m.losas!.length);
    expect(losas.every((l) => l.vigas.length > 0 && l.seccion)).toBe(true);
    expect(readFileSync(ruta, "utf8")).toBe(antes);
    const b = fem(["vigas-borde", ruta, "--escribir", "--ancho", "0,3"]);
    expect(b.codigo).toBe(0);
    expect(b.json.escrito).toBe(true);
    expect(b.json.valido).toBe(true);
    expect(readFileSync(`${ruta}.bak`, "utf8")).toBe(antes);
    expect((fem(["validar", ruta]).json.diagnosticos as { codigo: string }[]).some((d) => d.codigo === "sensatez/borde-sin-viga")).toBe(false);
    // Ya no queda nada que poner; una losa que no existe o un ancho que no es un número son órdenes mal dadas
    expect((fem(["vigas-borde", ruta]).json.losas as { vigas?: unknown[] }[]).every((l) => !l.vigas?.length)).toBe(true);
    expect(fem(["vigas-borde", ruta, "--losa", "NO"]).codigo).toBe(2);
    expect(fem(["vigas-borde", ruta, "--ancho", "ancho"]).codigo).toBe(2);
  });
});

describe("VS4: emplazamiento", () => {
  type Mun = { ine: string; nombre: string; provincia: string; ab: number; K: number; procedencia: string; viento: { zona: string; qb: number; frontera?: string } };
  it("da el código INE, ab y K del municipio y la zona eólica de su provincia, con el aviso de frontera; no lleva proyecto", () => {
    const r = fem(["emplazamiento", "Alhaurín", "el", "Grande"]);
    expect(r.codigo).toBe(0);
    expect(r.json).toMatchObject({ orden: "emplazamiento", ok: true, consulta: "Alhaurín el Grande", provincias: [], diagnosticos: [] });
    expect((r.json.municipios as Mun[])[0]).toEqual({
      ine: "29008",
      nombre: "Alhaurín el Grande",
      provincia: "Málaga",
      ab: 0.08,
      K: 1,
      procedencia: "Anejo 1 de la NCSE-02",
      viento: { zona: "A", qb: 0.42, frontera: "El oeste (Estepona, Campo de Gibraltar) está en zona C." },
    });
    expect((r.json.notas as string[]).length).toBe(2);
    // Por su código, el mismo; y con Bun, lo mismo que con Node
    const porIne = fem(["emplazamiento", "29008"]);
    expect(porIne.json.municipios).toEqual([(r.json.municipios as Mun[])[0]]);
    if (bun) expect(fem(["emplazamiento", "29008"], "bun").json).toEqual(porIne.json);
  });

  it("los homónimos, cada uno con su provincia; «granada», primero Granada; y --top", () => {
    const t = (fem(["emplazamiento", "torrent"]).json.municipios as Mun[]).filter((m) => m.nombre === "Torrent");
    expect(t.map((m) => [m.provincia, m.ab, m.viento.zona])).toEqual([
      ["Girona", 0.05, "C"],
      ["Valencia", 0.07, "A"],
    ]);
    const g = fem(["emplazamiento", "granada", "--top", "2"]);
    expect((g.json.municipios as Mun[]).map((m) => [m.ine, m.nombre, m.ab])).toEqual([
      ["18087", "Granada", 0.23],
      ["08094", "Granada (La)", 0.04],
    ]);
    expect(g.json.total).toBeGreaterThan(2);
    // «Granada» es también una provincia: su viento, aparte
    expect(g.json.provincias).toEqual([{ ine: "18", nombre: "Granada", viento: { zona: "A", qb: 0.42 } }]);
    // Uno creado después de 2002 dice de quién hereda
    expect((fem(["emplazamiento", "29902"]).json.municipios as Mun[])[0]!.procedencia).toBe("Heredado de Antequera · el municipio se creó en 2010 y el Anejo 1, de 2002, no lo nombra");
  });

  it("lo que no figura no se da por exento: error, con las tres causas; la provincia da al menos el viento", () => {
    const m = fem(["emplazamiento", "Madrid"]);
    expect(m.codigo).toBe(1);
    expect(m.json.ok).toBe(false);
    expect(m.json.municipios).toEqual([]);
    const d = (m.json.diagnosticos as { codigo: string; severidad: string; mensaje: string }[])[0]!;
    expect([d.codigo, d.severidad]).toEqual(["emplazamiento/no-encontrado", "error"]);
    expect(d.mensaje).toContain("«Madrid»: no figura en el Anejo 1 de la NCSE-02");
    expect(d.mensaje).toContain("Compruébalo antes de darlo por exento");
    expect(m.json.provincias).toEqual([{ ine: "28", nombre: "Madrid", viento: { zona: "A", qb: 0.42 } }]);
    expect(fem(["emplazamiento", "28079"]).codigo).toBe(1);
    const nada = fem(["emplazamiento", "Villanada de Ninguna Parte"]);
    expect(nada.codigo).toBe(1);
    expect(nada.json.provincias).toEqual([]);
    expect(nada.json.notas).toEqual([]);
    // Sin nombre, o con un --top que no es un número, la orden está mal dada
    expect(fem(["emplazamiento"]).codigo).toBe(2);
    expect(fem(["emplazamiento", "granada", "--top", "muchos"]).codigo).toBe(2);
  });
});
