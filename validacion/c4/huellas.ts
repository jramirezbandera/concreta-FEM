/**
 * Huellas de un juego fijo de modelos con forjados (criterio 7 de C4), como las de C2 y C3: la de
 * compilación (sobre el modelo físico), la de la topología del modelo analítico (sólo enteros:
 * láminas, barras con sus liberaciones, restricciones, apoyos y qué cargas van a qué) y las
 * coordenadas de sus nudos. El test `src/compilador/huella-c4.test.ts` ejecuta este script con Bun
 * (JavaScriptCore) y compara su salida con lo que calcula Node (V8): las viguetas (rectas, nudos y
 * reparto) y la malla de los reticulares tienen que ser las mismas en los dos.
 *
 *   bun validacion/c4/huellas.ts      → JSON por la salida estándar
 */
import { compilar } from "../../src/compilador/compilar.ts";
import { huellaDe } from "../../src/compilador/huella.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conForjadosAleatorios } from "../../src/pruebas/forjadosAleatorios.ts";
import { casosManoC4 } from "./mano.ts";

export interface HuellasC4 {
  nombre: string;
  compilacion: string;
  topologia: string;
  coordenadas: number[];
}

export function huellasC4(): HuellasC4[] {
  const mano = casosManoC4();
  const modelos = [
    ...mano.map((c, i) => ({ nombre: `a mano ${i + 1}`, f: c.fisico, o: c.opciones })),
    ...[1, 2, 3, 5, 8].map((s) => ({ nombre: `aleatorio ${s}`, f: conForjadosAleatorios(fisicoAleatorio(s), s), o: {} })),
    ...[4, 7].map((s) => ({ nombre: `aleatorio ${s} unidireccional`, f: conForjadosAleatorios(fisicoAleatorio(s), s, { tipo: "unidireccional" }), o: {} })),
    ...[6, 9].map((s) => ({ nombre: `aleatorio ${s} reticular`, f: conForjadosAleatorios(fisicoAleatorio(s), s, { tipo: "reticular" }), o: {} })),
  ];
  return modelos.map(({ nombre, f, o }) => {
    const r = compilar(f, o);
    if (!r.valido) throw new Error(`${nombre}: ${r.diagnosticos.map((d) => d.mensaje).join("; ")}`);
    const m = r.modelo;
    const topologia = huellaDe({
      laminas: (m.laminas ?? []).map((l) => [...l.nudos, l.multiplicadores ? 1 : 0]),
      barras: (m.barras ?? []).map((b) => [...b.nudos, ...(b.liberaciones?.i ?? []).map(Number), ...(b.liberaciones?.j ?? []).map(Number)]),
      restricciones: (m.restricciones ?? []).map((x) => [x.tipo, x.maestro, ...x.esclavos]),
      apoyos: (m.apoyos ?? []).map((a) => [a.nudo, ...a.coartados]),
      cargas: m.casos.map((c) => [(c.nodales ?? []).map((x) => x.nudo), (c.barras ?? []).map((x) => x.barra), (c.laminas ?? []).map((x) => x.lamina)]),
    });
    return { nombre, compilacion: r.huella, topologia, coordenadas: m.nudos.flatMap((n) => [n.x, n.y, n.z]) };
  });
}

if (import.meta.main) console.log(JSON.stringify(huellasC4()));
