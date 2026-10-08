/**
 * Compara el motor con SAP2000 en un modelo del usuario: lee el modelo (.$2k) y las tablas de
 * resultados que exporta SAP2000, calcula el modelo con el motor y compara, caso por caso,
 * desplazamientos y reacciones de los nudos, esfuerzos de las barras en las estaciones de SAP2000 y
 * esfuerzos de las áreas en sus nudos. Ver LEEME.md.
 *
 * Uso: bun validacion/e6/sap2000/comparar.ts <modelo.$2k> <resultados.$2k|.txt|.csv> […] → informe en pantalla
 *      y en <modelo>.comparacion.txt
 *
 * Convenios: P = N, V2 = Vz, V3 = −Vy, T = T, M2 = −Mz, M3 = My (cabecera de src/motor/modelo.ts);
 * F11…V23 de las áreas son los Nx…Qy del motor en los mismos ejes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calcular } from "../../../src/motor/calcular.ts";
import { DiagramasBarras } from "../../../src/motor/barras.ts";
import { ResultantesLaminas } from "../../../src/motor/laminas.ts";
import type { ResultadoCaso } from "../../../src/motor/modelo.ts";
import { iniciarNucleo } from "../../../src/nucleo/index.ts";
import { importarS2k, type Importado, type Trozo } from "./importar.ts";
import { leerTablas, num, type Tablas } from "./s2k.ts";

/** Diferencias de un grupo de magnitudes: la mayor absoluta frente al mayor valor de SAP2000, y dónde. */
export interface Grupo {
  nombre: string;
  n: number;
  maxSap: number;
  maxDif: number;
  donde: string;
  /** Fracción de valores con |motor − SAP| ≤ 1 % y ≤ 5 % del mayor valor de SAP2000 del grupo. */
  al1: number;
  al5: number;
}

class Acumulador {
  private filas: { dif: number; sap: number; donde: string }[] = [];
  readonly nombre: string;
  constructor(nombre: string) {
    this.nombre = nombre;
  }
  sumar(motor: number, sap: number, donde: string): void {
    if (Number.isFinite(motor) && Number.isFinite(sap)) this.filas.push({ dif: Math.abs(motor - sap), sap: Math.abs(sap), donde });
  }
  grupo(): Grupo | null {
    if (!this.filas.length) return null;
    const maxSap = Math.max(...this.filas.map((f) => f.sap));
    const peor = this.filas.reduce((a, b) => (b.dif > a.dif ? b : a));
    const frac = (t: number) => this.filas.filter((f) => f.dif <= t * maxSap).length / this.filas.length;
    return { nombre: this.nombre, n: this.filas.length, maxSap, maxDif: peor.dif, donde: peor.donde, al1: frac(0.01), al5: frac(0.05) };
  }
}

/** Resultados del motor por caso de SAP2000: la combinación de los de sus patrones. */
function combinar(imp: Importado, porPatron: ResultadoCaso[], factores: Map<string, number>): { u: Float64Array; reacciones: Float64Array; peso: (k: number) => number } {
  const P = porPatron[0]!.u.length;
  const u = new Float64Array(P);
  const reacciones = new Float64Array(P);
  const peso = (k: number) => factores.get(imp.patrones[k]!) ?? 0;
  porPatron.forEach((c, k) => {
    const f = peso(k);
    if (!f) return;
    for (let i = 0; i < P; i++) {
      u[i] += f * c.u[i]!;
      reacciones[i] += f * c.reacciones[i]!;
    }
  });
  return { u, reacciones, peso };
}

export function compararConSap(imp: Importado, porPatron: ResultadoCaso[], resultados: Tablas): Map<string, Grupo[]> {
  const { fuerza: F, longitud: L } = imp;
  const informe = new Map<string, Grupo[]>();
  const diagramas = new DiagramasBarras(imp.modelo);
  const laminas = new ResultantesLaminas(imp.modelo);
  const cache = new Map<string, ReturnType<DiagramasBarras["diagrama"]>>();
  const diagrama = (b: number, k: number) => {
    const clave = `${b},${k}`;
    if (!cache.has(clave)) cache.set(clave, diagramas.diagrama(b, k, porPatron[k]!));
    return cache.get(clave)!;
  };
  const casos = new Set([...(resultados.get("JOINT DISPLACEMENTS") ?? []), ...(resultados.get("JOINT REACTIONS") ?? []), ...(resultados.get("ELEMENT FORCES - FRAMES") ?? []), ...(resultados.get("ELEMENT FORCES - AREA SHELLS") ?? [])].map((r) => r.OutputCase!));
  for (const caso of casos) {
    const factores = imp.casosSap.get(caso);
    if (!factores) continue;
    const c = combinar(imp, porPatron, factores);
    const grupos = {
      tras: new Acumulador("desplazamientos (U1–U3)"),
      giros: new Acumulador("giros (R1–R3)"),
      fuerzas: new Acumulador("reacciones (F1–F3)"),
      momentos: new Acumulador("reacciones (M1–M3)"),
      axil: new Acumulador("barras: P"),
      cortante: new Acumulador("barras: V2, V3"),
      torsor: new Acumulador("barras: T"),
      flector: new Acumulador("barras: M2, M3"),
      membrana: new Acumulador("áreas: F11, F22, F12"),
      momentoArea: new Acumulador("áreas: M11, M22, M12"),
      cortanteArea: new Acumulador("áreas: V13, V23"),
    };
    for (const r of resultados.get("JOINT DISPLACEMENTS") ?? []) {
      if (r.OutputCase !== caso) continue;
      const v = imp.nudos.get(r.Joint!);
      if (v === undefined) continue;
      ["U1", "U2", "U3"].forEach((k, g) => grupos.tras.sumar(c.u[6 * v + g]!, num(r, k) * L, `nudo ${r.Joint} ${k}`));
      ["R1", "R2", "R3"].forEach((k, g) => grupos.giros.sumar(c.u[6 * v + 3 + g]!, num(r, k), `nudo ${r.Joint} ${k}`));
    }
    for (const r of resultados.get("JOINT REACTIONS") ?? []) {
      if (r.OutputCase !== caso) continue;
      const v = imp.nudos.get(r.Joint!);
      if (v === undefined) continue;
      ["F1", "F2", "F3"].forEach((k, g) => grupos.fuerzas.sumar(c.reacciones[6 * v + g]!, num(r, k) * F, `nudo ${r.Joint} ${k}`));
      ["M1", "M2", "M3"].forEach((k, g) => grupos.momentos.sumar(c.reacciones[6 * v + 3 + g]!, num(r, k) * F * L, `nudo ${r.Joint} ${k}`));
    }
    for (const r of resultados.get("ELEMENT FORCES - FRAMES") ?? []) {
      if (r.OutputCase !== caso) continue;
      const sap = imp.barras.get(r.Frame!);
      if (!sap) continue;
      const s = num(r, "Station") * L;
      // En un nudo intermedio SAP2000 da dos filas con la misma estación: el final de un elemento
      // (ElemStation > 0) y el principio del siguiente (ElemStation = 0). Cada una se compara con su
      // lado del salto. Las estaciones en las zonas rígidas no se comparan.
      const alFinal = r.ElemStation !== undefined ? num(r, "ElemStation") > 1e-9 : undefined;
      const dentro = (t: Trozo) => s >= t.s0 - 1e-9 && s <= t.s1 + 1e-9;
      const tr =
        (alFinal === true ? sap.trozos.find((t) => dentro(t) && s > t.s0 + 1e-9) : alFinal === false ? sap.trozos.find((t) => dentro(t) && s < t.s1 - 1e-9) : undefined) ??
        sap.trozos.find(dentro);
      if (!tr) continue;
      const x = Math.min(Math.max(s - tr.s0, 0), tr.s1 - tr.s0);
      const lado = (alFinal ?? x >= tr.s1 - tr.s0) ? -1 : 1;
      const e = [0, 0, 0, 0, 0, 0];
      imp.patrones.forEach((_, k) => {
        const f = c.peso(k);
        if (!f) return;
        const v = diagrama(tr.barra, k).esfuerzosEn(x, lado);
        for (let g = 0; g < 6; g++) e[g]! += f * v[g]!;
      });
      const [N, Vy, Vz, T, My, Mz] = e as [number, number, number, number, number, number];
      const donde = `barra ${r.Frame} en ${r.Station}`;
      grupos.axil.sumar(N, num(r, "P") * F, donde);
      grupos.cortante.sumar(Vz, num(r, "V2") * F, `${donde} V2`);
      grupos.cortante.sumar(-Vy, num(r, "V3") * F, `${donde} V3`);
      grupos.torsor.sumar(T, num(r, "T") * F * L, donde);
      grupos.flector.sumar(-Mz, num(r, "M2") * F * L, `${donde} M2`);
      grupos.flector.sumar(My, num(r, "M3") * F * L, `${donde} M3`);
    }
    const enNudos = new Map<number, Float64Array>();
    for (const r of resultados.get("ELEMENT FORCES - AREA SHELLS") ?? []) {
      if (r.OutputCase !== caso) continue;
      const l = imp.laminas.get(r.Area!);
      const v = imp.nudos.get(r.Joint!);
      if (l === undefined || v === undefined) continue;
      if (!enNudos.has(l)) enNudos.set(l, laminas.enNudos(l, c.u));
      const a = imp.modelo.laminas![l]!.nudos.indexOf(v);
      if (a < 0) continue;
      const m = enNudos.get(l)!.subarray(8 * a, 8 * a + 8);
      const donde = `área ${r.Area} nudo ${r.Joint}`;
      ["F11", "F22", "F12"].forEach((k, g) => grupos.membrana.sumar(m[g]!, num(r, k) * (F / L), `${donde} ${k}`));
      ["M11", "M22", "M12"].forEach((k, g) => grupos.momentoArea.sumar(m[3 + g]!, num(r, k) * F, `${donde} ${k}`));
      ["V13", "V23"].forEach((k, g) => grupos.cortanteArea.sumar(m[6 + g]!, num(r, k) * (F / L), `${donde} ${k}`));
    }
    informe.set(
      caso,
      Object.values(grupos)
        .map((g) => g.grupo())
        .filter((g): g is Grupo => g !== null),
    );
  }
  return informe;
}

if (import.meta.main) {
  const [rutaModelo, ...rutasResultados] = process.argv.slice(2);
  if (!rutaModelo) {
    console.error("Uso: bun validacion/e6/sap2000/comparar.ts <modelo.$2k> [resultados …]");
    process.exit(1);
  }
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const imp = importarS2k(leerTablas(readFileSync(rutaModelo, "latin1")));
  const lineas = [`# Comparación motor – SAP2000 de ${rutaModelo} (${new Date().toISOString().slice(0, 10)})`, ""];
  lineas.push(`Modelo: ${imp.modelo.nudos.length} nudos, ${imp.modelo.barras?.length ?? 0} barras, ${imp.modelo.laminas?.length ?? 0} láminas; patrones: ${imp.patrones.join(", ")}`);
  for (const a of imp.avisos) lineas.push(`Aviso: ${a}`);
  if (imp.errores.length) {
    lineas.push("", "No se puede traducir el modelo:", ...imp.errores.map((e) => `  - ${e}`));
  } else {
    const r = calcular(imp.modelo);
    for (const d of r.diagnosticos) lineas.push(`${d.severidad}: ${d.codigo}: ${d.mensaje}`);
    if (r.valido) {
      const resultados = leerTablas([rutaModelo, ...rutasResultados].map((ruta) => readFileSync(ruta, "latin1")).join("\n"));
      const informe = compararConSap(imp, r.casos, resultados);
      if (!informe.size) lineas.push("", "Las tablas de resultados no traen ningún caso estático lineal del modelo.");
      for (const [caso, grupos] of informe) {
        lineas.push("", `## Caso ${caso}`, "grupo | valores | máx. |SAP2000| | máx. |motor − SAP2000| (relativa) | dónde | ≤ 1 % | ≤ 5 %");
        for (const g of grupos) {
          lineas.push(`${g.nombre} | ${g.n} | ${g.maxSap.toExponential(3)} | ${g.maxDif.toExponential(2)} (${((100 * g.maxDif) / (g.maxSap || 1)).toFixed(2)} %) | ${g.donde} | ${(100 * g.al1).toFixed(0)} % | ${(100 * g.al5).toFixed(0)} %`);
        }
      }
    }
  }
  const salida = rutaModelo.replace(/\.[^.]+$/, "") + ".comparacion.txt";
  writeFileSync(salida, lineas.join("\n") + "\n");
  console.log(lineas.join("\n"));
  console.log(`\nEscrito ${salida}`);
}
