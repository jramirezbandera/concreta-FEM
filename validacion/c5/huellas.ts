/**
 * Huellas de un juego fijo de modelos con las bandas propuestas (criterio 7 de C5): la de las bandas
 * de la propuesta, la de compilación (sobre el modelo físico con ellas), la de la topología del
 * modelo analítico y las coordenadas de sus nudos. El test `src/compilador/huella-c5.test.ts` ejecuta
 * este script con Bun (JavaScriptCore) y compara su salida con lo que calcula Node (V8): la propuesta
 * y la malla con sus caras (trazos exactos, C5-g) tienen que ser las mismas en los dos, también con
 * la planta girada 37°, que usa senos y cosenos que difieren en 1 ulp (COM-12).
 *
 *   bun validacion/c5/huellas.ts      → JSON por la salida estándar
 */
import { compilar } from "../../src/compilador/compilar.ts";
import { huellaDe } from "../../src/compilador/huella.ts";
import { fisicoAleatorio } from "../../src/pruebas/fisicoAleatorio.ts";
import { conLosasAleatorias } from "../../src/pruebas/losasAleatorias.ts";
import { planos, transformar } from "../../src/pruebas/metamorficasFisicas.ts";
import { losaPlanaFisica } from "../c2/losaPlana.ts";
import { conPropuesta, losaPilaresMezclados } from "./modelos.ts";

export interface HuellasC5 {
  nombre: string;
  bandas: string;
  compilacion: string;
  topologia: string;
  coordenadas: number[];
}

export function huellasC5(): HuellasC5[] {
  const giro37 = planos().find((p) => p.nombre === "giro de 37°")!.t;
  const modelos = [
    { nombre: "losa plana de H25", f: conPropuesta(losaPlanaFisica()) },
    { nombre: "pilares mezclados", f: conPropuesta(losaPilaresMezclados()) },
    { nombre: "pilares mezclados, girada 37°", f: conPropuesta(transformar(losaPilaresMezclados(), giro37)) },
    ...[1, 3].map((s) => ({ nombre: `aleatorio ${s}, eje 1 al azar`, f: conPropuesta(conLosasAleatorias(fisicoAleatorio(s), s, { eje1: "azar" })) })),
  ];
  return modelos.map(({ nombre, f }) => {
    const r = compilar(f);
    if (!r.valido) throw new Error(`${nombre}: ${r.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join("; ")}`);
    const m = r.modelo;
    const topologia = huellaDe({
      laminas: (m.laminas ?? []).map((l) => l.nudos),
      barras: (m.barras ?? []).map((b) => b.nudos),
      restricciones: (m.restricciones ?? []).map((x) => [x.tipo, x.maestro, ...x.esclavos]),
      apoyos: (m.apoyos ?? []).map((a) => [a.nudo, ...a.coartados]),
    });
    return { nombre, bandas: huellaDe(f.bandas ?? []), compilacion: r.huella, topologia, coordenadas: m.nudos.flatMap((n) => [n.x, n.y, n.z]) };
  });
}

if (import.meta.main) console.log(JSON.stringify(huellasC5()));
