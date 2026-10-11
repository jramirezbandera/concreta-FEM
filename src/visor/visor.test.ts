/**
 * Criterios 1, 2 y 3 de V1 (`docs/fem3d/visor.md` §3.3) en Node, con la sesión del visor y la CLI de
 * verdad (en este mismo proceso), sobre los cuatro proyectos de ejemplo:
 * - 1, fidelidad: cada dato de cada pantalla es el de la consulta llamada a mano (`pieza`, `flechas`,
 *   `deriva`, `envolventePieza`, `revisar`…), y la escena de una planta da el mismo SVG, byte a byte,
 *   que `fem render`;
 * - 2, los mismos bits que la CLI: el sha256 de los resultados de la sesión es el de `fem calcular`,
 *   y abrir con los resultados de `.fem/` da los mismos datos que calcular;
 * - 3, resultados que no valen: los de otra huella, de otro núcleo, sin sha256 o alterados no se usan.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ejecutar } from "../../cli/ordenes.ts";
import { deriva, flechas, pieza } from "../agente/consultas.ts";
import { envolventePieza } from "../agente/render/resultados.ts";
import { conjuntoPorDefecto, escenaASvg, nombreFigura, vistaAxiles, vistaCampo, vistaCargas, vistaDiagnosticos, vistaDiagramas, vistaMalla, vistaModelo } from "../agente/render/index.ts";
import type { Escena, Primitiva } from "../agente/render/escena.ts";
import { sensatezResultados } from "../agente/sensatezResultados.ts";
import { sha256 } from "../compilador/huella.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { COMPONENTE, datosDesplomes, datosLosas, datosPilar, datosPilares, datosRevision, datosViga, desplazamientos, estacionViga, geometria3D, piezasPlanta, valorEnPunto } from "./datos.ts";
import { prepararEscena } from "./escena.ts";
import { Sesion, type EleccionCombinaciones } from "./sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
const MOTOR = sha256(new Uint8Array(WASM));
const PROYECTOS: [string, string][] = [
  ["ejemplo", ".claude/skills/fem/ejemplo.json"],
  ["1022", "validacion/a2/agente/1022/proyecto.json"],
  ["nucleo", "validacion/a2/agente/nucleo/proyecto.json"],
  ["edificio", "validacion/a2/agente/edificio/proyecto.json"],
];
const D: EleccionCombinaciones = { tipo: "defecto" };

let dir = "";
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fem-v1-"));
  await iniciarNucleo(WASM);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const valido = <T>(r: { valido: true; valor: T } | { valido: false; diagnosticos: unknown }): T => {
  if (!r.valido) throw new Error(JSON.stringify(r.diagnosticos));
  return r.valor;
};

/** Coordenadas de las formas de una escena (áreas y trazos), redondeadas como las de la escena preparada. */
function coordsPrimitivas(e: Escena): string[] {
  const r = (v: number) => String(Object.is(Math.round(v * 1e4) / 1e4, -0) ? 0 : Math.round(v * 1e4) / 1e4);
  const out: string[] = [];
  for (const p of e.primitivas as Primitiva[]) {
    if (p.tipo === "poligono" || p.tipo === "region") for (const a of p.anillos) for (const q of a) out.push(`${r(q[0])} ${r(q[1])}`);
    if (p.tipo === "linea") for (const q of p.puntos) out.push(`${r(q[0])} ${r(q[1])}`);
  }
  return out;
}

describe.each(PROYECTOS)("V1 con %s", (nombre, ruta) => {
  let proyecto = "";
  let s: Sesion;
  let cabCli: string;
  let binCli: Uint8Array;

  beforeAll(async () => {
    const sub = join(dir, nombre);
    mkdirSync(sub, { recursive: true });
    proyecto = join(sub, "proyecto.json");
    copyFileSync(join(RAIZ, ruta), proyecto);
    const c = await ejecutar(["calcular", proyecto]);
    expect(c.codigo, JSON.stringify(c.json)).toBe(0);
    const carpeta = join(sub, ".fem", String(c.json.huella));
    cabCli = readFileSync(join(carpeta, "resultados.json"), "utf8");
    binCli = new Uint8Array(readFileSync(join(carpeta, "resultados.bin")));
    const a = Sesion.abrir(readFileSync(proyecto, "utf8"), MOTOR);
    if (!a.valido) throw new Error("no abre");
    s = a.sesion;
    expect((await s.calcular()).ok).toBe(true);
  }, 120_000);

  // ─── Criterio 2 ───────────────────────────────────────────────────────────────────────────────

  it("calcular en la sesión da los bits de fem calcular", () => {
    const cab = JSON.parse(cabCli) as { sha256: string; huella: string; motor: string };
    expect(cab.huella).toBe(s.huella);
    expect(cab.motor).toBe(MOTOR);
    expect(s.estado().sha256Resultados).toBe(cab.sha256);
  });

  it("abrir con los resultados de .fem/ da los mismos datos que calcular", async () => {
    const b = (Sesion.abrir(readFileSync(proyecto, "utf8"), MOTOR) as { sesion: Sesion }).sesion;
    expect(await b.usarGuardados(cabCli, binCli)).toEqual({ ok: true });
    expect(b.estado().origen).toBe("guardados");
    expect(b.estado().sha256Resultados).toBe(s.estado().sha256Resultados);
    const planta = s.proyecto.modelo.plantas[0]!.id;
    expect(valido(datosPilares(b, planta, D))).toEqual(valido(datosPilares(s, planta, D)));
    expect(valido(datosDesplomes(b, D))).toEqual(valido(datosDesplomes(s, D)));
    expect(b.escena(planta, { vista: "campo", campo: "uz", combinaciones: D })).toEqual(s.escena(planta, { vista: "campo", campo: "uz", combinaciones: D }));
  });

  // ─── Criterio 3 ───────────────────────────────────────────────────────────────────────────────

  it("no usa resultados de otra huella, de otro núcleo, sin sha256 o alterados", async () => {
    const nueva = () => (Sesion.abrir(readFileSync(proyecto, "utf8"), MOTOR) as { sesion: Sesion }).sesion;
    const cab = JSON.parse(cabCli) as Record<string, unknown>;
    const casos: [string, string, Uint8Array, RegExp][] = [
      ["otra huella", JSON.stringify({ ...cab, huella: "0".repeat(64) }), binCli, /otra huella/],
      ["otro núcleo", JSON.stringify({ ...cab, motor: "f".repeat(64) }), binCli, /otro núcleo/],
      ["sin sha256", JSON.stringify({ ...cab, sha256: undefined }), binCli, /sha256/],
      ["un bit cambiado", cabCli, (() => { const x = binCli.slice(); x[x.length >> 1]! ^= 1; return x; })(), /no es el que se guardó/],
      ["truncado", cabCli, binCli.slice(0, binCli.length - 8), /no es el que se guardó/],
      ["cabecera rota", "{", binCli, /no es JSON/],
    ];
    for (const [que, c, b, motivo] of casos) {
      const x = nueva();
      const r = await x.usarGuardados(c, b);
      expect(r.ok, que).toBe(false);
      expect(!r.ok && r.motivo, que).toMatch(motivo);
      expect(x.calculado, que).toBe(false);
      expect(valido.bind(null, datosDesplomes(x, D)), que).toThrow();
    }
  });

  // ─── Criterio 1 ───────────────────────────────────────────────────────────────────────────────

  it("las escenas son las de A4, y la escena preparada no pierde ni mueve nada", () => {
    const f = s.proyecto.modelo;
    const d = { ...(s.proyecto.nombre ? { nombre: s.proyecto.nombre } : {}), huella: s.huella };
    const rr = s.rr!;
    const res = s.resumen!;
    const desp = conjuntoPorDefecto(s.q!, res, "desplazamientos");
    const esf = conjuntoPorDefecto(s.q!, res, "esfuerzos");
    const plantas = nombre === "edificio" ? [f.plantas[0]!.id, f.plantas[3]!.id] : f.plantas.map((p) => p.id);
    for (const planta of plantas) {
      const pares: [Parameters<Sesion["escenaA4"]>[1], Escena][] = [
        [{ vista: "modelo" }, vistaModelo(f, planta, d)],
        ...f.casos.map((c): [Parameters<Sesion["escenaA4"]>[1], Escena] => [{ vista: "cargas", caso: c.id }, vistaCargas(f, planta, c.id, d)]),
        [{ vista: "diagnosticos" }, vistaDiagnosticos(f, planta, s.diagnosticos, d)],
        [{ vista: "malla" }, vistaMalla(rr, planta, d)],
        [{ vista: "campo", campo: "uz", combinaciones: D }, vistaCampo(rr, planta, "uz", desp, d)],
        [{ vista: "campo", campo: "m11", combinaciones: D }, vistaCampo(rr, planta, "m11", esf, d)],
        [{ vista: "vigas", esfuerzo: "My", combinaciones: D }, vistaDiagramas(rr, planta, "My", esf, d)],
        [{ vista: "pilares-n", combinaciones: D }, vistaAxiles(rr, planta, esf, d)],
      ];
      for (const [v, directa] of pares) {
        const e = valido(s.escenaA4(planta, v));
        expect(e, `${planta} ${JSON.stringify(v)}`).toEqual(directa);
        // La preparada: las mismas coordenadas en el mismo orden, todos los glifos y textos
        const p = prepararEscena(e);
        const enCapas = p.capas.flatMap((c) => c.d.split(/[MLZ]/).filter(Boolean).map((t) => t.trim()));
        expect(enCapas, `${planta} ${v.vista}`).toEqual(coordsPrimitivas(e));
        expect(p.glifos.length + p.textos.length).toBe(e.primitivas.filter((x) => x.tipo === "marca" || x.tipo === "flecha" || x.tipo === "texto").length);
        expect(p.extremos).toEqual(e.extremos);
      }
    }
  });

  it("la escena da el mismo SVG que fem render, byte a byte", async () => {
    const planta = s.proyecto.modelo.plantas[0]!.id;
    const r = await ejecutar(["render", proyecto, "--planta", planta, "--vista", "modelo,uz,vigas-my,pilares-n"]);
    expect(r.codigo, JSON.stringify(r.json)).toBe(0);
    const carpeta = join(dir, nombre, ".fem", s.huella, "render");
    for (const [vista, v] of [
      ["modelo", { vista: "modelo" }],
      ["uz", { vista: "campo", campo: "uz", combinaciones: D }],
      ["vigas-my", { vista: "vigas", esfuerzo: "My", combinaciones: D }],
      ["pilares-n", { vista: "pilares-n", combinaciones: D }],
    ] as const) {
      const cli = readFileSync(join(carpeta, `${nombreFigura(planta, vista)}.svg`), "utf8");
      expect(escenaASvg(valido(s.escenaA4(planta, v))).svg, vista).toBe(cli);
    }
  }, 120_000);

  it("losas: flechas, extremos y el valor de un punto son los de las consultas", () => {
    const q = s.q!;
    const desp = conjuntoPorDefecto(q, s.resumen!, "desplazamientos");
    const flr = flechas(q, desp);
    const fl = flr.valido ? flr.valor : [];
    if (!flr.valido) expect(flr.diagnosticos[0]!.codigo).toBe("consulta/sin-losas");
    for (const p of s.proyecto.modelo.plantas) {
      for (const campo of ["uz", "m22"] as const) {
        const x = valido(datosLosas(s, p.id, campo, D));
        const ids = new Set([...(q.fisico.losas ?? []), ...(q.fisico.panos ?? [])].filter((l) => l.planta === p.id).map((l) => l.id));
        expect(x.flechas).toEqual(fl.filter((f) => ids.has(f.id)));
        // En el punto de un extremo, el valor del punto es el del extremo (un nudo de la lámina)
        for (const ex of x.escena.extremos) {
          const v = valido(valorEnPunto(s, p.id, campo, D, ex.punto![0], ex.punto![1]));
          expect(v, `${p.id} ${campo} ${ex.que}`).not.toBeNull();
          // En un nudo con salto entre regiones SPR (E5-7) hay varios valores: el extremo es uno de ellos
          expect([v!.valor, ...(v!.otros ?? [])].some((y) => Math.abs(y - ex.valor) <= 1e-9 * Math.max(1, Math.abs(ex.valor))), `${v!.valor} ${v!.otros}`).toBe(true);
          expect(v!.comb).toBe(ex.comb);
        }
      }
    }
  });

  it("vigas: vanos, envolvente y estaciones son los de pieza y envolventePieza", () => {
    const q = s.q!;
    const esf = conjuntoPorDefecto(q, s.resumen!, "esfuerzos");
    for (const p of s.proyecto.modelo.plantas) {
      const ps = piezasPlanta(s, p.id).slice(0, nombre === "edificio" ? 3 : 20);
      for (const pz of ps) {
        for (const esfuerzo of ["My", "Vz"] as const) {
          const v = valido(datosViga(s, pz.id, esfuerzo, D));
          expect(v.vanos).toEqual((valido(pieza(q, esf, pz.id)) as { vanos: unknown }).vanos);
          expect(v.envolvente).toEqual(envolventePieza(s.rr!, pz.id, esf, COMPONENTE[esfuerzo]));
          // En cada punto de la envolvente, la estación da su máximo y su mínimo (por uno de sus lados), a
          // 1e-12: el cursor evalúa el mismo diagrama en x = s − s0, con un redondeo más que la envolvente
          for (const e of v.envolvente.filter((_, i) => i % 7 === 0)) {
            const st = valido(estacionViga(s, pz.id, esfuerzo, D, e.s));
            const lados = [st.izquierda, st.derecha].filter(Boolean);
            const cerca = (x: number, y: number) => Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(y));
            expect(lados.some((l) => cerca(l!.max.v, e.max) && cerca(l!.min.v, e.min)), `${pz.id} s=${e.s}: ${JSON.stringify(lados.map((l) => [l!.max.v - e.max, l!.min.v - e.min]))}`).toBe(true);
          }
        }
      }
    }
  });

  it("pilares: los tramos son los de pieza y ν es el de A3", () => {
    const q = s.q!;
    const esf = conjuntoPorDefecto(q, s.resumen!, "esfuerzos");
    const porPilar = new Map<string, number>();
    for (const p of s.proyecto.modelo.plantas) {
      const x = valido(datosPilares(s, p.id, D));
      for (const f of x.filas) {
        const tramos = (valido(pieza(q, esf, f.pilar)) as { tramos: { planta: string }[] }).tramos;
        expect(f.tramo).toEqual(tramos.find((t) => t.planta === p.id));
        if (f.nu) porPilar.set(f.pilar, Math.max(porPilar.get(f.pilar) ?? -Infinity, f.nu.nu));
      }
    }
    for (const id of [...porPilar.keys()].slice(0, 10)) {
      const t = valido(datosPilar(s, id, D)).filas;
      expect(Math.max(...t.map((f) => f.nu?.nu ?? -Infinity))).toBe(porPilar.get(id));
    }
    // Los avisos de axil reducido de A3 dan el mismo ν que el visor en su pilar
    const a3 = sensatezResultados(q, s.resumen!, s.proyecto.opciones).comprobaciones.find((c) => c.codigo === "sensatez/axil-reducido")!;
    for (const av of a3.avisos) {
      const pilar = av.ids![0]!;
      expect(porPilar.get(pilar), pilar).toBe((av.detalles as { nu: number }).nu);
    }
  });

  it("desplomes: los de deriva", () => {
    const q = s.q!;
    const x = valido(datosDesplomes(s, D));
    expect(x.plantas).toEqual(valido(deriva(q, conjuntoPorDefecto(q, s.resumen!, "desplazamientos"))));
  });

  it("revisión: el informe es el de fem revisar (mismo sha256)", async () => {
    const r = await ejecutar(["revisar", proyecto]);
    expect(r.codigo, JSON.stringify(r.json)).toBe(0);
    const x = valido(datosRevision(s, "", "proyecto.revision.json"));
    expect(x.sha256).toBe((r.json.informe as { sha256: string }).sha256);
    expect(x.firma).toEqual(r.json.firma);
  }, 120_000);

  it("3D: la geometría y los desplazamientos son los del modelo y del cálculo", () => {
    const g = valido(geometria3D(s));
    const m = s.compilado!.modelo;
    expect(g.nudos.length).toBe(3 * m.nudos.length);
    expect(g.barras.length).toBe(2 * (m.barras?.length ?? 0));
    expect(g.laminas.length).toBe(4 * (m.laminas?.length ?? 0));
    const caso = s.proyecto.modelo.casos[0]!.id;
    const u = valido(desplazamientos(s, { tipo: "caso", caso })).u;
    const uc = s.casos![0]!.u;
    for (let i = 0; i < m.nudos.length; i += 97) for (let a = 0; a < 3; a++) expect(u[3 * i + a]).toBe(Math.fround(uc[6 * i + a]!));
  });
});
