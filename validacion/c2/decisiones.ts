/**
 * Efecto de las decisiones por defecto de C2 en el edificio objetivo con losas, reducido a 3
 * plantas (`modelos.ts`), para que el usuario decida con números:
 * - C2-a, tamaño de malla: h = 0,5, 0,75 (por defecto) y 1 m;
 * - C2-f, diafragma rígido (por defecto) o semirrígido (`diafragma: "ninguno"`, la membrana de las
 *   losas);
 * - C1-a con losas: factor de zona rígida 0, 0,5 (por defecto) y 1;
 * - C2-g: el peso que se quita a las vigas por el solape con la losa.
 *
 * Magnitudes: nudos, ecuaciones y tiempo; deriva de la planta de arriba con el viento en X; flecha
 * en el centro de un vano de la planta de arriba con G + Q; y My de la banda de pilar en la cara del
 * pilar central (24, 15), por fuerzas nodales, con G + Q (la banda va de su cara al pilar siguiente,
 * con 2,5 m de ancho).
 *
 * Uso: node validacion/c2/decisiones.ts > validacion/c2/out_decisiones.txt
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../../src/compilador/fisico.ts";
import { resultanteAnalitica } from "../../src/compilador/cargas.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { Cortes, type Corte } from "../../src/motor/cortes.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { valido } from "../../src/pruebas/metamorficasFisicas.ts";
import { edificioObjetivoLosas } from "./modelos.ts";

const PLANTAS = 3;
const ARRIBA = `N${PLANTAS}`;

function modelo(diafragma: "rigido" | "ninguno" = "rigido"): ModeloFisico {
  const f = edificioObjetivoLosas(PLANTAS);
  return {
    ...f,
    plantas: f.plantas.map((p) => (p.tipo === "sotano" ? p : { ...p, diafragma })),
    bandas: [{ id: "banda", planta: ARRIBA, desde: [24.2, 15], hasta: [29.8, 15], ancho: 2.5 }],
  };
}

interface Medida {
  nudos: number;
  ecuaciones: number;
  ms: number;
  deriva: number;
  flecha: number;
  My: number;
}

function medir(f: ModeloFisico, op: OpcionesCompilacion): Medida {
  const r = valido(compilar(f, op));
  const m = r.modelo;
  const t0 = performance.now();
  const c = calcular(m);
  const ms = performance.now() - t0;
  const casos = casosValidos(c);
  const k = (id: string) => m.casos.findIndex((x) => x.id === id);
  const [G, Q, Vx] = [k("G"), k("Q"), k("Vx")];
  const zTop = Math.max(...m.nudos.map((n) => n.z));
  // Deriva: ux medio de los nudos de pilar de la planta de arriba
  const pilares = Object.entries(r.mapeo.nudosPilar).filter(([clave]) => clave.endsWith(`@${ARRIBA}`)).map(([, n]) => n);
  const deriva = pilares.reduce((s, n) => s + casos[Vx]!.u[6 * n]!, 0) / pilares.length;
  // Flecha en el centro del vano (27, 17,5) de la planta de arriba: el nudo más cercano
  let nc = 0;
  let dmin = Infinity;
  m.nudos.forEach((n, i) => {
    if (n.z !== zTop || r.mapeo.nudos[i]!.maestro) return;
    const d = (n.x - 27) ** 2 + (n.y - 17.5) ** 2;
    if (d < dmin) [dmin, nc] = [d, i];
  });
  const flecha = casos[G]!.u[6 * nc + 2]! + casos[Q]!.u[6 * nc + 2]!;
  const corte: Corte = { origen: [24.2, 15, zTop], x: [1, 0, 0], vz: [0, 0, 1], y: [-1.25, 1.25], metodo: "fuerzas-nodales" };
  const rc = new Cortes(m).cortar(corte, casos);
  if (!rc.valido) throw new Error(rc.diagnosticos.map((d) => d.mensaje).join(" | "));
  const My = rc.esfuerzos[6 * G + 4]! + rc.esfuerzos[6 * Q + 4]!;
  return { nudos: m.nudos.length, ecuaciones: c.estadisticas!.ecuaciones, ms, deriva, flecha, My };
}

if (import.meta.main) {
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const lineas: string[] = [`# validacion/c2/decisiones.ts — ${new Date().toLocaleDateString("sv-SE")}: edificio objetivo con losas, ${PLANTAS} plantas`];
  const fila = (nombre: string, x: Medida, ref?: Medida) => {
    const p = (a: number, b?: number) => (b === undefined ? "" : ` (${(100 * (a / b - 1) >= 0 ? "+" : "") + (100 * (a / b - 1)).toFixed(1)} %)`);
    return `| ${nombre} | ${x.nudos} | ${x.ecuaciones} | ${(x.ms / 1000).toFixed(1)} s | ${(1000 * x.deriva).toFixed(3)} mm${p(x.deriva, ref?.deriva)} | ${(1000 * x.flecha).toFixed(3)} mm${p(x.flecha, ref?.flecha)} | ${x.My.toFixed(1)}${p(x.My, ref?.My)} |`;
  };
  const cabecera = ["| variante | nudos | ecuaciones | cálculo | deriva arriba (Vx) | flecha del vano (G + Q) | My banda en la cara (G + Q), kN·m |", "|---|---|---|---|---|---|---|"];

  lineas.push("", "## C2-a: tamaño de malla (frente a h = 0,5)");
  lineas.push(...cabecera);
  const finas = medir(modelo(), { tamanoMalla: 0.5 });
  lineas.push(fila("h = 0,5", finas));
  const base = medir(modelo(), {});
  lineas.push(fila("h = 0,75 (por defecto)", base, finas));
  lineas.push(fila("h = 1", medir(modelo(), { tamanoMalla: 1 }), finas));

  lineas.push("", "## C2-f: diafragma (frente al rígido)");
  lineas.push(...cabecera);
  lineas.push(fila("rígido (por defecto)", base));
  lineas.push(fila("semirrígido (membrana de las losas)", medir(modelo("ninguno"), {}), base));

  lineas.push("", "## C1-a con losas: factor de zona rígida (frente a 0,5)");
  lineas.push(...cabecera);
  lineas.push(fila("0", medir(modelo(), { factorZonaRigida: 0 }), base));
  lineas.push(fila("0,5 (por defecto)", base));
  lineas.push(fila("1", medir(modelo(), { factorZonaRigida: 1 }), base));

  // C2-g: el peso que se quita a las vigas, frente a las mismas vigas como sección general (sin solape)
  const pesoG = (f: ModeloFisico) => {
    const r = valido(compilar(f, {}));
    return -resultanteAnalitica(r.modelo, r.modelo.casos.findIndex((x) => x.id === "G"), [0, 0, 0]).F[2];
  };
  const f = modelo();
  const generales: ModeloFisico = {
    ...f,
    secciones: f.secciones.map((x) => (x.forma === "rectangular" && x.id.startsWith("v") ? { id: x.id, material: x.material, forma: "general" as const, A: x.b * x.h, Iy: (x.b * x.h ** 3) / 12, Iz: (x.h * x.b ** 3) / 12, J: 1e-3, b: x.b, h: x.h } : x)),
  };
  const [conSolape, sinSolape] = [pesoG(f), pesoG(generales)];
  lineas.push("", "## C2-g: solape del peso de las vigas con la losa");
  lineas.push(
    `Caso G (peso propio y permanentes): ${conSolape.toFixed(0)} kN. Con las vigas enteras (sin descontar lo que solapa con la losa) serían ${sinSolape.toFixed(0)} kN: se quitan ${(sinSolape - conSolape).toFixed(0)} kN, el ${((100 * (sinSolape - conSolape)) / sinSolape).toFixed(1)} % del caso G, que de otro modo se contaría dos veces (en la carga y en la masa sísmica).`,
  );

  const texto = lineas.join("\n");
  console.log(texto);
}
