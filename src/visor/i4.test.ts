/**
 * El resto de I4 (`docs/fem3d/interfaz.md` §15, criterios de §15.1) sobre los proyectos de V1:
 * - pilares por colores: el valor de cada tramo es el del cuadro de pilares, bit a bit;
 * - reacciones: cada flecha es la resultante de la consulta, en su sentido, y en una combinación la
 *   suma de las Fz es el total de la consulta;
 * - reacciones en planta y en alzado (tras I4): los valores de las flechas del 3D, cada objeto en su
 *   planta, y la suma de todas las plantas es el total de cada caso;
 * - muros: sus valores son los del SPR en sus ejes; F22 < 0 en la base de un muro cargado;
 * - deformada: sus extremos son los de sus desplazamientos;
 * - bajo el cursor: `valor-lamina` en las losas es `valor-punto`; la estación de un pilar existe;
 * - el alzado de un pilar es su envolvente;
 * - sin resultados, ningún pedido de resultados en 3D devuelve nada.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { reacciones } from "../agente/consultas.ts";
import { canonico3D, tramosEspacio } from "../agente/render/diagramas.ts";
import { PROFUNDIDAD_ALZADO, planoDeEje } from "../agente/render/alzado.ts";
import { envolventePieza, valoresCampo, vistaCampo } from "../agente/render/resultados.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { ejesDe } from "../compilador/ejes.ts";
import { sha256 } from "../compilador/huella.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Atendedor } from "./atender.ts";
import { compresionTramo, datosPilares, datosViga, desplazamientos, estacionViga, filasPilarQ, valorEnPunto } from "./datos.ts";
import { SIN_BANDA } from "./pilares3d.ts";
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

const valido = <T>(r: { valido: true; valor: T } | { valido: false; diagnosticos: unknown }): T => {
  if (!r.valido) throw new Error(JSON.stringify(r.diagnosticos));
  return r.valor;
};

beforeAll(async () => {
  await iniciarNucleo(WASM);
});

describe.each(PROYECTOS)("I4 (resto) con %s", (_nombre, ruta) => {
  let s: Sesion;
  beforeAll(async () => {
    const a = Sesion.abrir(readFileSync(join(RAIZ, ruta), "utf8"), MOTOR);
    if (!a.valido) throw new Error("no abre");
    s = a.sesion;
    expect((await s.calcular()).ok).toBe(true);
  }, 120_000);

  it.each(["N", "nu"] as const)("pilares por colores, %s: el valor de cada tramo es el del cuadro, bit a bit", (magnitud) => {
    const q = s.q!;
    const conj = valido(s.conjunto(D, "esfuerzos"));
    const d = valido(s.pilares3D({ magnitud, combinaciones: D, planta: null }));
    const f = s.proyecto.modelo;
    const cotas = cotasPlantas(f.plantas);
    const cota = (p: string) => cotas[f.plantas.findIndex((x) => x.id === p)]!;
    let n = 0;
    for (const p of f.pilares ?? []) {
      for (const fila of valido(filasPilarQ(q, conj, p.id))) {
        const t = d.tramos.find((x) => x.pilar === p.id && x.planta === fila.planta)!;
        expect(t).toBeDefined();
        const esperado = magnitud === "N" ? (compresionTramo(fila)?.v ?? null) : (fila.nu?.nu ?? null);
        expect(t.valor).toBe(esperado);
        expect(t.comb).toBe(magnitud === "N" ? (compresionTramo(fila)?.comb ?? null) : (fila.nu?.comb ?? null));
        // En el eje del pilar, de la cota de su base a la de su cabeza
        expect(t.a).toEqual([p.x, p.y, cota(t.plantaBase)]);
        expect(t.b).toEqual([p.x, p.y, cota(t.planta)]);
        n++;
      }
    }
    expect(d.tramos.length).toBe(n);
    // La banda de cada tramo contiene su valor; sin valor, la gris
    d.tramos.forEach((t, i) => {
      if (t.valor === null) return expect(d.banda[i]).toBe(SIN_BANDA);
      expect(d.banda[i]).toBeLessThan(d.colores.length);
    });
    // Y es lo que da el cuadro de cada planta (la pantalla Pilares)
    for (const pl of f.plantas.slice(0, 3)) {
      const c = valido(datosPilares(s, pl.id, D));
      for (const fila of c.filas) {
        const t = d.tramos.find((x) => x.pilar === fila.pilar && x.planta === pl.id)!;
        expect(t.valor).toBe(magnitud === "N" ? (compresionTramo(fila)?.v ?? null) : (fila.nu?.nu ?? null));
      }
    }
    // El extremo rotulado es el del cuadro
    const conValor = d.tramos.filter((t) => t.valor !== null).map((t) => t.valor!);
    if (magnitud === "N" && conValor.length && Math.min(...conValor) < 0) expect(d.extremos[0]!.valor).toBe(Math.min(...conValor));
    if (magnitud === "nu" && conValor.length) {
      expect(d.extremos[0]!.valor).toBe(Math.max(...conValor));
      expect(d.limite).toBe(0.65);
    }
    // Una planta: sólo sus tramos
    const pl = f.plantas[0]!.id;
    expect(valido(s.pilares3D({ magnitud, combinaciones: D, planta: pl })).tramos.every((t) => t.planta === pl)).toBe(true);
  });

  it("reacciones: cada flecha es la resultante de la consulta, en el sentido de su fuerza; la suma de una combinación, su total", () => {
    const q = s.q!;
    const conj = valido(s.conjunto(D, "lineal"));
    const d = valido(s.reacciones3D(D));
    const r = valido(reacciones(q, conj, { todos: true }));
    expect(d.objetos.map((o) => o.id)).toEqual(r.objetos.map((o) => o.id));
    d.objetos.forEach((o, i) => {
      const x = r.objetos[i]!;
      const k = conj.nombres.indexOf(o.comb);
      expect(o.R).toEqual(x.R[k]);
      // La de mayor |Fz| (la primera, si empatan)
      const fz = x.R.map((v) => Math.abs(v[2]!));
      expect(k).toBe(fz.indexOf(Math.max(...fz)));
      expect(o.punto).toEqual([...x.punto]);
    });
    // El fuste vertical de cada objeto: acaba en su punto y va en el sentido de Fz
    const o0 = d.origen;
    for (let i = 0; i < d.tipoSegmento.length; i++) {
      if (d.tipoSegmento[i] !== 0) continue;
      const o = d.objetos[d.objetoSegmento[i]!]!;
      const [z0, z1] = [d.segmentos[6 * i + 2]! + o0[2], d.segmentos[6 * i + 5]! + o0[2]];
      // El primer segmento de cada flecha es su fuste (cola → punta)
      if (i > 0 && d.objetoSegmento[i - 1] === d.objetoSegmento[i] && d.tipoSegmento[i - 1] === 0) continue;
      expect(Math.abs(z1 - o.punto[2])).toBeLessThan(1e-4);
      // El sentido, en las que se ven (una de menos de 1 mm se pierde en el Float32)
      if ((Math.abs(o.R[2]!) * d.escala.m) / d.escala.valor > 1e-3) expect(Math.sign(z1 - z0)).toBe(Math.sign(o.R[2]!));
    }
    // Con una sola combinación (cada caso), la suma de las Fz es el total de la consulta
    for (const c of s.proyecto.modelo.casos) {
      const e: EleccionCombinaciones = { tipo: "caso", caso: c.id };
      const x = valido(s.reacciones3D(e));
      const suma = x.objetos.reduce((t, o) => t + o.R[2]!, 0);
      const total = x.totales[0]!.F[2]!;
      expect(Math.abs(suma - total)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(total)));
    }
  });

  it("reacciones en planta y en alzado: cada valor es el de la flecha del 3D; las plantas suman el total de cada caso", () => {
    const f = s.proyecto.modelo;
    const d3 = valido(s.reacciones3D(D));
    const porId = new Map(d3.objetos.map((o) => [o.id, o]));
    const enPlanta = new Set<string>();
    for (const p of f.plantas) {
      const e = valido(s.escenaA4(p.id, { vista: "reacciones", combinaciones: D }));
      const fz = e.extremos.filter((x) => x.que === "Fz");
      // Los objetos de la planta (la de su base o la suya), cada uno una vez
      expect(fz.map((x) => x.objeto).sort()).toEqual(d3.objetos.filter((o) => o.planta === p.id).map((o) => o.id).sort());
      for (const x of fz) {
        const o = porId.get(x.objeto!)!;
        expect(x.valor).toBe(o.R[2]);
        expect(x.comb).toBe(o.comb);
        enPlanta.add(o.id);
      }
      for (const x of e.extremos.filter((y) => y.que === "|(Fx, Fy)|")) {
        const o = porId.get(x.objeto!)!;
        expect(x.valor).toBe(Math.hypot(o.R[0]!, o.R[1]!));
      }
      // Sin apoyos, la nota dice dónde están
      if (!fz.length && d3.objetos.length) expect(e.notas.some((n) => n.startsWith("En esta planta no hay apoyos"))).toBe(true);
    }
    expect(enPlanta.size).toBe(d3.objetos.length);
    // Con un caso, la suma de las Fz de todas las plantas es el total de la consulta
    for (const c of f.casos) {
      const e: EleccionCombinaciones = { tipo: "caso", caso: c.id };
      const total = valido(s.reacciones3D(e)).totales[0]!.F[2]!;
      let suma = 0;
      for (const p of f.plantas) for (const x of valido(s.escenaA4(p.id, { vista: "reacciones", combinaciones: e })).extremos) if (x.que === "Fz") suma += x.valor;
      expect(Math.abs(suma - total)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(total)));
    }
    // Alzado: los objetos a menos de la profundidad del plano, con Fz y la componente en el plano
    for (const eje of ejesDe(f).ejes) {
      const plano = planoDeEje(f, eje.id)!;
      const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
      const dir = [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L];
      const w = (q: readonly number[]) => -(q[0]! - plano.desde[0]) * dir[1]! + (q[1]! - plano.desde[1]) * dir[0]!;
      const e = valido(s.alzadoA4({ eje: eje.id }, undefined, { combinaciones: D }));
      const fz = e.extremos.filter((x) => x.que === "Fz");
      expect(fz.map((x) => x.objeto).sort()).toEqual(d3.objetos.filter((o) => Math.abs(w(o.punto)) <= PROFUNDIDAD_ALZADO).map((o) => o.id).sort());
      for (const x of fz) expect(x.valor).toBe(porId.get(x.objeto!)!.R[2]);
      for (const x of e.extremos.filter((y) => y.que === "F en el plano")) {
        const o = porId.get(x.objeto!)!;
        expect(x.valor).toBe(o.R[0]! * dir[0]! + o.R[1]! * dir[1]!);
      }
      // Las flechas verticales acaban en su objeto, a la altura de su punto
      for (const x of fz) {
        const o = porId.get(x.objeto!)!;
        const fuste = e.primitivas.find((q) => q.tipo === "linea" && q.estilo === "reaccion-vertical" && q.objeto === o.id);
        if (o.R[2] !== 0) expect(fuste && fuste.tipo === "linea" && fuste.puntos[1]![1]).toBe(o.punto[2]);
      }
    }
  });

  it("muros: los valores son los del SPR en sus ejes, y F22 < 0 en la base de un muro cargado", () => {
    const rr = s.rr!;
    const f = s.proyecto.modelo;
    const conMuros = (f.muros ?? []).length > 0;
    const conj = valido(s.conjunto(D, "esfuerzos"));
    const XI = [-1, 1, 1, -1];
    const ETA = [-1, -1, 1, 1];
    let comprobadas = 0;
    for (const pl of f.plantas) {
      const { laminas } = rr.laminas(pl.id, "muros");
      if (!conMuros) expect(laminas).toEqual([]);
      for (const campo of ["f22", "m11"] as const) {
        const fac = conj.factores[0]!;
        const { v } = valoresCampo(rr, pl.id, campo, fac, "muros");
        const ev = s.casos!.map((c) => rr.campos.evaluador(c.u));
        laminas.slice(0, 20).forEach((l, i) => {
          for (let a = 0; a < 4; a++) {
            let e = 0;
            for (let k = 0; k < fac.length; k++) if (fac[k]) e += fac[k]! * ev[k]!.en(l, XI[a]!, ETA[a]!)[campo === "f22" ? 1 : 3]!;
            expect(v[4 * i + a]).toBeCloseTo(e, 9);
          }
          comprobadas++;
        });
      }
    }
    if (!conMuros) return;
    expect(comprobadas).toBeGreaterThan(0);
    // F22 en la base del muro con la carga permanente: compresión
    const pp = f.casos.find((c) => c.pesoPropio)!;
    const iso = valido(s.isovalores3D({ campo: "f22", combinaciones: { tipo: "caso", caso: pp.id }, planta: null, superficies: "muros" }));
    expect(iso.plantas.length).toBeGreaterThan(0);
    const nudosMuro = (rr.c.mapeo.laminas ?? []).flatMap((m, l) => (m.muro ? rr.c.modelo.laminas![l]!.nudos : []));
    const zMin = Math.min(...nudosMuro.map((n) => rr.c.modelo.nudos[n]!.z));
    const base: number[] = [];
    for (const pl of f.plantas) {
      const { laminas } = rr.laminas(pl.id, "muros");
      const { v } = valoresCampo(rr, pl.id, "f22", valido(s.conjunto({ tipo: "caso", caso: pp.id }, "esfuerzos")).factores[0]!, "muros");
      laminas.forEach((l, i) => {
        if (Math.min(...rr.c.modelo.laminas![l]!.nudos.map((n) => rr.c.modelo.nudos[n]!.z)) <= zMin + 1e-6) base.push((v[4 * i]! + v[4 * i + 1]!) / 2);
      });
    }
    expect(base.length).toBeGreaterThan(0);
    expect(base.reduce((a, b) => a + b, 0) / base.length).toBeLessThan(0);
    // Losas y muros juntos: la escala cubre los dos
    const p0 = iso.plantas[0]!;
    const losas = valido(s.isovalores3D({ campo: "m11", combinaciones: D, planta: p0, superficies: "losas" }));
    const muros = valido(s.isovalores3D({ campo: "m11", combinaciones: D, planta: p0, superficies: "muros" }));
    const todas = valido(s.isovalores3D({ campo: "m11", combinaciones: D, planta: p0, superficies: "todas" }));
    if (losas.mapa && muros.mapa && todas.mapa && losas.combinacion?.nombre === muros.combinacion?.nombre && todas.combinacion?.nombre === losas.combinacion?.nombre) {
      expect(todas.mapa.maximo).toBe(Math.max(losas.mapa.maximo, muros.mapa.maximo));
      expect(todas.mapa.minimo).toBe(Math.min(losas.mapa.minimo, muros.mapa.minimo));
    }
    expect(todas.lamina.length).toBe(todas.triangulos.length / 9);
  });

  it("bajo el cursor: valor-lamina en las losas es valor-punto, bit a bit; en un vértice, su valor", () => {
    const rr = s.rr!;
    const c = rr.c;
    for (const campo of ["uz", "m22", "f11"] as const) {
      for (const pl of s.proyecto.modelo.plantas) {
        const { laminas } = rr.laminas(pl.id);
        if (!laminas.length) continue;
        const iso = valido(s.isovalores3D({ campo, combinaciones: D, planta: pl.id }));
        const nombre = iso.combinacion!.nombre;
        for (const l of laminas.filter((_, i) => i % Math.max(1, Math.floor(laminas.length / 12)) === 0)) {
          const P = c.modelo.laminas![l]!.nudos.map((n) => c.modelo.nudos[n]!);
          const p: [number, number, number] = [(P[0]!.x + P[1]!.x + P[2]!.x + P[3]!.x) / 4, (P[0]!.y + P[1]!.y + P[2]!.y + P[3]!.y) / 4, P[0]!.z];
          const a = valido(s.valorLamina({ campo, combinaciones: D, nombre, lamina: l, punto: p }));
          const b = valido(valorEnPunto(s, pl.id, campo, D, p[0], p[1]));
          if (b === null) expect(a).toBeNull();
          else {
            expect(a?.valor).toBe(b.valor);
            expect(a?.comb).toBe(b.comb);
          }
        }
      }
    }
    // En un muro: en un vértice de la lámina, el valor de ese nudo
    const f = s.proyecto.modelo;
    if (!(f.muros ?? []).length) return;
    for (const pl of f.plantas) {
      const { laminas } = rr.laminas(pl.id, "muros");
      if (!laminas.length) continue;
      const iso = valido(s.isovalores3D({ campo: "f22", combinaciones: D, planta: pl.id, superficies: "muros" }));
      const k = valido(s.conjunto({ tipo: "una", de: D, nombre: iso.combinacion!.nombre }, "esfuerzos")).factores[0]!;
      const { v } = valoresCampo(rr, pl.id, "f22", k, "muros");
      laminas.slice(0, 10).forEach((l, i) => {
        const n = c.modelo.nudos[c.modelo.laminas![l]!.nudos[2]]!;
        const x = valido(s.valorLamina({ campo: "f22", combinaciones: D, nombre: iso.combinacion!.nombre, lamina: l, punto: [n.x, n.y, n.z] }));
        expect(x?.valor).toBeCloseTo(v[4 * i + 2]!, 6);
        expect(x?.objeto).toBe(c.mapeo.laminas![l]!.muro);
      });
    }
  });

  it("deformada: sus extremos son los de sus desplazamientos", () => {
    const conj = valido(s.conjunto(D, "desplazamientos"));
    const e: EleccionCombinaciones = { tipo: "una", de: D, nombre: conj.nombres[0]! };
    const d = valido(desplazamientos(s, e));
    const f = valido(s.conjunto(e, "desplazamientos")).factores[0]!;
    const casos = s.casos!;
    let [nmax, umax, nmin, zmin] = [-1, -1, -1, Infinity];
    for (let i = 0; i < casos[0]!.u.length / 6; i++) {
      const w = [0, 1, 2].map((a) => {
        let v = 0;
        for (let k = 0; k < f.length; k++) if (f[k]) v += f[k]! * casos[k]!.u[6 * i + a]!;
        return v;
      });
      if (Math.hypot(w[0]!, w[1]!, w[2]!) > umax) [nmax, umax] = [i, Math.hypot(w[0]!, w[1]!, w[2]!)];
      if (w[2]! < zmin) [nmin, zmin] = [i, w[2]!];
    }
    expect(d.extremos[0]).toMatchObject({ que: "mayor |u|", nudo: nmax, valor: umax * 1000 });
    if (zmin < 0) expect(d.extremos[1]).toMatchObject({ que: "menor uz", nudo: nmin, valor: zmin * 1000 });
    const n = s.compilado!.modelo.nudos[nmax]!;
    expect(d.extremos[0]!.punto).toEqual([n.x, n.y, n.z]);
  });

  it("el alzado de un pilar es su envolvente, con sus plantas; su estación tiene valores", () => {
    const rr = s.rr!;
    const conj = valido(s.conjunto(D, "esfuerzos"));
    for (const p of (s.proyecto.modelo.pilares ?? []).slice(0, 4)) {
      const v = valido(datosViga(s, p.id, "N", D));
      expect(v.tipo).toBe("pilar");
      expect(v.envolvente).toEqual(envolventePieza(rr, p.id, conj, 0));
      const ss = v.plantas!.map((x) => x.s);
      expect(ss).toEqual([...ss].sort((a, b) => a - b));
      expect(v.plantas![0]!.planta).toBe(p.desde);
      expect(v.plantas![v.plantas!.length - 1]!.planta).toBe(p.hasta);
      const [a, b] = v.flexibles[0]!;
      const e = valido(estacionViga(s, p.id, "N", D, (a + b) / 2));
      expect(e.rigida).toBe(false);
      expect(e.derecha?.min.v).toBeLessThanOrEqual(e.derecha!.max.v);
    }
  });

  it("los ejes de los diagramas en 3D son los de sus tramos, con sus estaciones", () => {
    const rr = s.rr!;
    const d = valido(s.diagramas3D({ esfuerzo: "My", combinaciones: D, planta: null, piezas: "todas" }));
    expect(d.ejes.length).toBe(6 * d.ejePieza.length);
    for (let i = 0; i < d.ejePieza.length; i += Math.max(1, Math.floor(d.ejePieza.length / 50))) {
      const id = d.piezas[d.ejePieza[i]!]!.id;
      const tr = tramosEspacio(rr, id, canonico3D).find((t) => t.t.s0 === d.ejeS[2 * i] && t.t.s1 === d.ejeS[2 * i + 1])!;
      expect(tr).toBeDefined();
      for (let k = 0; k < 3; k++) expect(d.ejes[6 * i + k]).toBe(Math.fround(tr.a[k]! - d.origen[k]!));
    }
  });

  it("F11, F22 y F12 en la planta: un mapa con su nota", () => {
    const rr = s.rr!;
    const conj = valido(s.conjunto(D, "esfuerzos"));
    for (const pl of s.proyecto.modelo.plantas) {
      if (!rr.laminas(pl.id).laminas.length) continue;
      const e = vistaCampo(rr, pl.id, "f22", conj, { huella: s.huella });
      expect(e.notas.some((n) => n.includes("diafragma"))).toBe(true);
      expect(e.cabecera.join(" ")).toContain("F22");
    }
  });
});

describe("I4 (resto) por el protocolo", () => {
  it("sin resultados no hay pilares, reacciones ni valor bajo el cursor; con ellos, sí", async () => {
    const a = new Atendedor(MOTOR);
    expect((await a.atender({ tipo: "abrir", texto: readFileSync(join(RAIZ, "validacion/a2/agente/nucleo/proyecto.json"), "utf8") })).ok).toBe(true);
    const pedidos = [
      { tipo: "pilares3d", magnitud: "N", combinaciones: D, planta: null },
      { tipo: "reacciones3d", combinaciones: D },
      { tipo: "isovalores3d", campo: "f22", combinaciones: D, planta: null, superficies: "muros" },
      { tipo: "valor-lamina", campo: "uz", combinaciones: D, nombre: "x", lamina: 0, punto: [0, 0, 0] },
    ] as const;
    for (const p of pedidos) {
      const r = await a.atender(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.diagnosticos[0]!.codigo).toBe("visor/sin-resultados");
    }
    expect((await a.atender({ tipo: "calcular" })).ok).toBe(true);
    for (const p of pedidos.slice(0, 3)) expect((await a.atender(p)).ok).toBe(true);
    // Una lámina que no existe, o una combinación que no está
    expect((await a.atender({ tipo: "valor-lamina", campo: "uz", combinaciones: D, nombre: "x", lamina: -1, punto: [0, 0, 0] })).ok).toBe(false);
    expect((await a.atender({ tipo: "valor-lamina", campo: "uz", combinaciones: D, nombre: "no-existe", lamina: 0, punto: [0, 0, 0] })).ok).toBe(false);
  }, 60_000);
});
