/**
 * Huellas de un juego fijo de modelos con losas (criterio 7 de C2): la de compilación (sobre el
 * modelo físico), la de la topología del modelo analítico (sólo enteros: nudos de cada lámina,
 * barra y restricción, y apoyos) y las coordenadas de sus nudos. El test
 * `src/compilador/huella-c2.test.ts` ejecuta este script con Bun (JavaScriptCore) y compara su
 * salida con lo que calcula Node (V8): la malla tiene que ser la misma en los dos, también con
 * pilares girados y un eje 1 cualquiera, que usan senos y cosenos que difieren en 1 ulp (COM-12).
 * Las coordenadas se comparan a 1e-12, no por su huella a 12 cifras: con decenas de miles de
 * números y un ulp de diferencia, alguno cae en la frontera del redondeo.
 *
 *   bun validacion/c2/huellas.ts      → JSON por la salida estándar
 */
import { compilar } from "../../src/compilador/compilar.ts";
import { huellaDe } from "../../src/compilador/huella.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import { losaPlanaFisica } from "./losaPlana.ts";
import { reticulaEnrasada } from "./modelos.ts";

export interface HuellasC2 {
  nombre: string;
  compilacion: string;
  topologia: string;
  coordenadas: number[];
}

export function huellasC2(): HuellasC2[] {
  const modelos = [
    { nombre: "losa plana de H25", f: losaPlanaFisica() },
    // Toda en rejilla alineada y plantillas de pilar (H52)
    { nombre: "retícula enrasada", f: reticulaEnrasada(2) },
    ...[1, 2, 3, 5, 8].flatMap((s) => (["x", "azar"] as const).map((e) => ({ nombre: `aleatorio ${s}, eje 1 ${e}`, f: conLosasAleatorias(fisicoAleatorio(s), s, { eje1: e }) }))),
  ];
  return modelos.map(({ nombre, f }) => {
    const r = compilar(f);
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

if (import.meta.main) console.log(JSON.stringify(huellasC2()));
