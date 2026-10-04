/**
 * Huellas de un juego fijo de modelos con muros (criterio 7 de C3), como las de C2: la de
 * compilación (sobre el modelo físico), la de la topología del modelo analítico (sólo enteros) y
 * las coordenadas de sus nudos. El test `src/compilador/huella-c3.test.ts` ejecuta este script con
 * Bun (JavaScriptCore) y compara su salida con lo que calcula Node (V8): la malla de los muros
 * (estaciones, subdivisión y filas) tiene que ser la misma en los dos.
 *
 *   bun validacion/c3/huellas.ts      → JSON por la salida estándar
 */
import { compilar } from "../../src/compilador/compilar.ts";
import { huellaDe } from "../../src/compilador/huella.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import { conMurosAleatorios } from "../../src/pruebas/murosAleatorios.ts";
import { murosEtabs15 } from "../e6/etabs15.ts";
import { fisicoEtabs } from "./etabs15.ts";

export interface HuellasC3 {
  nombre: string;
  compilacion: string;
  topologia: string;
  coordenadas: number[];
}

export function huellasC3(): HuellasC3[] {
  const etabs = murosEtabs15().filter((m) => ["15c-3-60", "15d-3", "15f-3"].includes(m.id));
  const modelos = [
    ...etabs.map((m) => ({ nombre: `ETABS ${m.id}`, f: fisicoEtabs(m), h: m.h(1) * 0.0254 })),
    ...[1, 2, 3, 5, 8].map((s) => ({ nombre: `aleatorio ${s}`, f: conMurosAleatorios(conLosasAleatorias(fisicoAleatorio(s), s, { eje1: "azar" }), s), h: undefined })),
    ...[4, 6].map((s) => ({ nombre: `aleatorio ${s} sin losas`, f: conMurosAleatorios(fisicoAleatorio(s), s), h: undefined })),
  ];
  return modelos.map(({ nombre, f, h }) => {
    const r = compilar(f, h ? { tamanoMalla: h } : {});
    if (!r.valido) throw new Error(`${nombre}: ${r.diagnosticos.map((d) => d.mensaje).join("; ")}`);
    const m = r.modelo;
    const topologia = huellaDe({
      laminas: (m.laminas ?? []).map((l) => l.nudos),
      barras: (m.barras ?? []).map((b) => b.nudos),
      restricciones: (m.restricciones ?? []).map((x) => [x.tipo, x.maestro, ...x.esclavos]),
      apoyos: (m.apoyos ?? []).map((a) => [a.nudo, ...a.coartados]),
      cargas: m.casos.map((c) => [(c.nodales ?? []).map((x) => x.nudo), (c.barras ?? []).map((x) => x.barra), (c.laminas ?? []).map((x) => x.lamina)]),
    });
    return { nombre, compilacion: r.huella, topologia, coordenadas: m.nudos.flatMap((n) => [n.x, n.y, n.z]) };
  });
}

if (import.meta.main) console.log(JSON.stringify(huellasC3()));
