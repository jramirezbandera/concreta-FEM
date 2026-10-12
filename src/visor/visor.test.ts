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
import { conjuntoPorDefecto, escenaASvg, nombreFigura, planoDeEje, vistaAlzado, vistaAxiles, vistaCampo, vistaCargas, vistaDiagnosticos, vistaDiagramas, vistaMalla, vistaModelo } from "../agente/render/index.ts";
import type { Escena, Vec2 } from "../agente/render/escena.ts";
import { sensatezResultados } from "../agente/sensatezResultados.ts";
import { sha256 } from "../compilador/huella.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { COMPONENTE, datosDesplomes, datosLosas, datosPilar, datosPilares, datosRevision, datosViga, desplazamientos, estacionViga, geometria3D, piezasPlanta, valorEnPunto } from "./datos.ts";
import { origenDe, prepararEscena, type EscenaPreparada } from "./escena.ts";
import { alambrico } from "./alambrico.ts";
import { ejesDe } from "../compilador/ejes.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { cajaDe, dentro } from "../agente/render/escena.ts";
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

/**
 * Criterio 1 de I2: los búferes de la escena preparada son, capa a capa y en orden, los vértices de
 * las primitivas de la escena de A4 (en Float32 respecto al centro de su caja), con su estilo.
 */
export function comprobarBuferes(e: Escena, p: EscenaPreparada, que: string): void {
  const o = origenDe(e);
  const f = (q: Vec2) => [Math.fround(q[0] - o[0]), Math.fround(q[1] - o[1])];
  // Las capas: las primitivas de forma seguidas con el mismo estilo, forma y relleno
  const grupos: { estilo: string; forma: string; relleno?: string; seg: number[]; tri: number[] }[] = [];
  for (const x of e.primitivas) {
    if (x.tipo !== "poligono" && x.tipo !== "region" && x.tipo !== "linea") continue;
    const forma = x.tipo === "poligono" ? "area" : x.tipo === "region" ? "region" : "trazo";
    const relleno = x.tipo === "linea" ? undefined : x.relleno;
    let g = grupos[grupos.length - 1];
    if (!g || g.estilo !== x.estilo || g.forma !== forma || g.relleno !== relleno) grupos.push((g = { estilo: x.estilo, forma, ...(relleno !== undefined ? { relleno } : {}), seg: [], tri: [] }));
    if (x.tipo === "linea") for (let i = 1; i < x.puntos.length; i++) g.seg.push(...f(x.puntos[i - 1]!), ...f(x.puntos[i]!));
    else
      for (const r of x.anillos) {
        r.forEach((q, i) => g!.seg.push(...f(q), ...f(r[(i + 1) % r.length]!)));
        for (let i = 1; i + 1 < r.length; i++) g.tri.push(...f(r[0]!), ...f(r[i]!), ...f(r[i + 1]!));
      }
  }
  expect(p.origen, que).toEqual(o);
  expect(p.capas.map((c) => [c.estilo, c.forma, c.relleno]), que).toEqual(grupos.map((g) => [g.estilo, g.forma, g.relleno]));
  p.capas.forEach((c, i) => {
    expect(Array.from(c.segmentos), `${que} capa ${i}`).toEqual(grupos[i]!.seg);
    expect(Array.from(c.abanicos), `${que} capa ${i}`).toEqual(grupos[i]!.tri);
  });
  expect(p.glifos).toEqual(e.primitivas.filter((x) => x.tipo === "marca" || x.tipo === "flecha"));
  expect(p.textos).toEqual(e.primitivas.filter((x) => x.tipo === "texto"));
  expect(p.extremos).toEqual(e.extremos);
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
        // La preparada (I2): los mismos vértices en el mismo orden, todos los glifos y textos
        comprobarBuferes(e, prepararEscena(e), `${planta} ${v.vista}`);
      }
    }
  });

  it("I2: los alzados de cada eje, preparados sin perder ni mover nada; elegir y resaltar en ellos", () => {
    const f = s.proyecto.modelo;
    const d = { ...(s.proyecto.nombre ? { nombre: s.proyecto.nombre } : {}), huella: s.huella };
    for (const eje of ejesDe(f).ejes) {
      const e = valido(s.alzadoA4({ eje: eje.id }));
      expect(e).toEqual(vistaAlzado(f, planoDeEje(f, eje.id)!, d));
      comprobarBuferes(e, valido(s.alzado({ eje: eje.id })), `alzado ${eje.id}`);
      // Un clic en el centro de cada pilar dibujado lo elige; resaltarlo da sus formas
      for (const x of e.primitivas.filter((q) => q.tipo === "poligono" && q.estilo === "pilar-alzado").slice(0, 3)) {
        if (x.tipo !== "poligono") continue;
        const [u0, z0, u1, z1] = cajaDe(x.anillos[0]!);
        const q: Vec2 = [(u0 + u1) / 2, (z0 + z1) / 2];
        const r = s.elegir({ tipo: "alzado", plano: { eje: eje.id } }, q, 0.01);
        // El pilar o algo más pequeño que lo tapa (un muro o una viga cortados delante), nunca un eje
        const area = (a: readonly Vec2[]) => Math.abs(a.reduce((t, p, i) => t + p[0] * a[(i + 1) % a.length]![1] - a[(i + 1) % a.length]![0] * p[1], 0)) / 2;
        const tapa = e.primitivas.some((y) => y.tipo === "poligono" && y.objeto === r?.objeto && y.estilo === "seccion-cortada" && area(y.anillos[0]!) <= area(x.anillos[0]!) && dentro(q, y.anillos[0]!));
        expect(r?.objeto === x.objeto || tapa, `${eje.id}: ${r?.objeto} en ${x.objeto}`).toBe(true);
      }
    }
  });

  it("I2: ventana (dentro y toca) y resaltar varios", () => {
    const planta = s.proyecto.modelo.plantas[0]!.id;
    const fu = { tipo: "planta" as const, planta, vista: { vista: "modelo" as const } };
    const e = valido(s.escenaA4(planta, { vista: "modelo" }));
    // Toda la caja: «dentro» da todos los objetos dibujados; una ventana vacía, ninguno
    const todos = [...new Set(e.primitivas.flatMap((p) => (p.tipo !== "texto" && "objeto" in p && p.objeto ? [p.objeto] : [])))];
    const [x0, y0, x1, y1] = e.caja;
    expect(new Set(s.ventana(fu, [x0 - 1, y0 - 1, x1 + 1, y1 + 1], "dentro"))).toEqual(new Set(todos));
    expect(s.ventana(fu, [x1 + 100, y1 + 100, x1 + 101, y1 + 101], "toca")).toEqual([]);
    // Una ventana pequeña en el centro de un pilar: «toca» lo da a él (y a lo que lo rodea); «dentro», a ninguno de ellos
    const pil = s.proyecto.modelo.pilares?.find((p) => e.primitivas.some((q) => q.tipo === "poligono" && q.objeto === p.id));
    if (pil) {
      const v: [number, number, number, number] = [pil.x - 0.01, pil.y - 0.01, pil.x + 0.01, pil.y + 0.01];
      expect(s.ventana(fu, v, "toca")).toContain(pil.id);
      expect(s.ventana(fu, v, "dentro")).not.toContain(pil.id);
      const r = s.elegir(fu, null, 0, [pil.id, "no-existe"]);
      expect(r?.objetos).toEqual([pil.id]);
    }
  });

  it("I2: 3D alámbrico, cada segmento de su objeto y con su cota", () => {
    const f = s.proyecto.modelo;
    const a = alambrico(f);
    const cotas = cotasPlantas(f.plantas);
    const z = (i: number) => a.segmentos[i]! + a.origen[2];
    const n = a.objeto.length;
    for (let i = 0; i < n; i++) {
      const o = a.objetos[a.objeto[i]!]!;
      const [za, zb] = [z(6 * i + 2), z(6 * i + 5)];
      const x = (k: number) => a.segmentos[6 * i + k]! + a.origen[k % 3]!;
      if (o.tipo === "pilar") {
        const p = f.pilares!.find((q) => q.id === o.id)!;
        for (const [k, v] of [[0, p.x], [1, p.y], [3, p.x], [4, p.y]] as const) expect(x(k)).toBeCloseTo(v, 5);
        expect(zb).toBeCloseTo(cotas[a.planta[i]!]!, 5);
        expect(za).toBeCloseTo(cotas[a.planta[i]! + 1]!, 5);
      } else if (o.tipo === "viga" || o.tipo === "losa" || o.tipo === "pano") {
        const c = cotas[a.planta[i]!]!;
        expect(za).toBeCloseTo(c, 5);
        expect(zb).toBeCloseTo(c, 5);
      }
    }
    // Todos los objetos con sitio, una vez cada uno
    const ids = a.objetos.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of f.pilares ?? []) expect(ids).toContain(p.id);
    for (const v of f.vigas ?? []) expect(ids).toContain(v.id);
    for (const l of f.losas ?? []) expect(ids).toContain(l.id);
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
