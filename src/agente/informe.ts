/**
 * Informe de revisión (A3, regla A3 de `docs/fem3d/agente.md`): lo que el ingeniero revisa y firma
 * antes de dar por bueno un resultado. Va ligado a la huella: si el modelo cambia, deja de valer.
 *
 * Contiene las comprobaciones de sensatez con sus avisos, el resumen del modelo, las cargas por
 * planta, el desglose del peso propio, la bajada tributaria, las hipótesis y los avisos del
 * compilador y del cálculo. Se arma como un documento (`Bloque[]`) y se escribe en Markdown y en
 * HTML. No lleva fecha ni nada que no salga del proyecto y de su cálculo, así que es determinista y
 * su sha256 se puede reproducir (`fem firmar` lo guarda).
 *
 * Puro: entran los datos y salen textos.
 */
import { resolverOpciones } from "../compilador/fisico.ts";
import { sha256 } from "../compilador/huella.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { Resumen } from "./consultas.ts";
import type { Proyecto } from "./proyecto.ts";
import { num, type Comprobacion, type SensatezModelo } from "./sensatez.ts";
import type { SensatezResultados } from "./sensatezResultados.ts";

export type Bloque =
  | { tipo: "titulo"; nivel: 1 | 2 | 3; texto: string }
  | { tipo: "parrafo"; texto: string }
  | { tipo: "lista"; items: string[] }
  | { tipo: "tabla"; cabecera: string[]; filas: string[][]; numericas?: number[] }
  /** Figura (A4): su SVG va en el HTML; en el Markdown, su título y el sha256 del SVG, que la firma cubre. */
  | { tipo: "figura"; titulo: string; svg: string };

/** Avisos que se listan de cada comprobación en el informe; del resto se dice cuántos hay. */
export const AVISOS_POR_COMPROBACION = 25;
/** Tramos de pilar de la bajada tributaria que se listan (los que más se separan). */
export const TRAMOS_TRIBUTARIA = 12;

/** Reacciones de un objeto con base (pilar, muro, apoyo o apoyo lineal) en su punto, por caso: [Fx, Fy, Fz, Mx, My, Mz] (6·nc). */
export interface ReaccionBase {
  id: string;
  tipo: "pilar" | "muro" | "apoyo" | "apoyo lineal";
  punto: readonly number[];
  R: ArrayLike<number>;
}

export interface DatosInforme {
  proyecto: Proyecto;
  /** Cargas en cimentación: las reacciones de cada pilar, muro y apoyo con base, en el orden del modelo. */
  cimentacion: readonly ReaccionBase[];
  huella: string;
  /** sha256 del núcleo WASM con el que se calculó. */
  motor: string;
  resumen: Resumen;
  hipotesis: readonly string[];
  /** Avisos del compilador y del cálculo (ya con ids físicos). */
  diagnosticos: readonly Diagnostico[];
  /** Equilibrio de cada caso (relativo). */
  equilibrio: readonly { id: string; fuerzas: number; momentos: number }[];
  modelo: SensatezModelo;
  resultados: SensatezResultados;
  /** Nombre del fichero de firmas, para decirlo en el informe. */
  ficheroFirmas: string;
  /** Figuras del render (A4): la planta del modelo y la uz de las losas de cada planta. */
  figuras?: readonly { titulo: string; svg: string }[];
}

const ESTADO: Record<Comprobacion["estado"], string> = { bien: "bien", avisos: "AVISOS", "no-aplica": "no aplica" };
const kN = (x: number) => num(x, 4);

export function documentoInforme(d: DatosInforme): Bloque[] {
  const b: Bloque[] = [];
  const titulo = (nivel: 1 | 2 | 3, texto: string) => b.push({ tipo: "titulo", nivel, texto });
  const parrafo = (texto: string) => b.push({ tipo: "parrafo", texto });
  const comprobaciones = [...d.modelo.comprobaciones, ...d.resultados.comprobaciones];
  const conAvisos = comprobaciones.filter((c) => c.estado === "avisos");
  const nAvisos = conAvisos.reduce((s, c) => s + c.avisos.length, 0);
  const otros = d.diagnosticos.filter((x) => x.severidad !== "info");

  titulo(1, `Informe de revisión${d.proyecto.nombre ? `: ${d.proyecto.nombre}` : ""}`);
  b.push({
    tipo: "lista",
    items: [
      `Huella del modelo: ${d.huella}`,
      `Esquema: ${d.proyecto.esquema}. Núcleo de cálculo: sha256 ${d.motor.slice(0, 16)}…`,
      "Este informe vale sólo para esta huella: si el proyecto cambia, la huella cambia y hay que volver a revisarlo.",
      "Las comprobaciones de sensatez son avisos de orden de magnitud sobre el modelo, no comprobaciones de norma. Un aviso puede ser legítimo (una transición, un voladizo): el ingeniero lo revisa y decide.",
    ],
  });

  titulo(2, "Veredicto");
  const eq = Math.max(0, ...d.equilibrio.map((e) => Math.max(e.fuerzas, e.momentos)));
  b.push({
    tipo: "lista",
    items: [
      conAvisos.length ? `${nAvisos} avisos de sensatez en ${conAvisos.length} de ${comprobaciones.length} comprobaciones: ${conAvisos.map((c) => c.titulo.toLowerCase()).join("; ")}.` : `Ningún aviso de sensatez en las ${comprobaciones.length} comprobaciones (${comprobaciones.filter((c) => c.estado === "no-aplica").length} no aplican a este modelo).`,
      otros.length ? `${otros.length} avisos del compilador y del cálculo (al final).` : "Ningún aviso del compilador ni del cálculo.",
      `Equilibrio de cargas y reacciones: ${num(eq, 2)} relativo como máximo (tiene que ser ≤ 1e-9).`,
    ],
  });

  titulo(2, "Comprobaciones de sensatez");
  parrafo(`Casos gravitatorios: ${d.resultados.gravedad.join(", ") || "ninguno"}. Combinaciones: flechas, ${d.resultados.combinaciones.flechas}; desplomes, ${d.resultados.combinaciones.desplomes}; axil reducido, ${d.resultados.combinaciones.axil}.`);
  b.push({ tipo: "tabla", cabecera: ["Comprobación", "Avisa si", "Estado", "Lo peor"], filas: comprobaciones.map((c) => [c.titulo, c.umbral, c.estado === "avisos" ? `${ESTADO.avisos} (${c.avisos.length})` : ESTADO[c.estado], c.peor ?? "—"]) });
  if (conAvisos.length) {
    titulo(3, "Avisos");
    for (const c of conAvisos) {
      parrafo(`${c.titulo} (${c.codigo}):`);
      const items = c.avisos.slice(0, AVISOS_POR_COMPROBACION).map((a) => a.mensaje);
      if (c.avisos.length > AVISOS_POR_COMPROBACION) items.push(`… y ${c.avisos.length - AVISOS_POR_COMPROBACION} más.`);
      b.push({ tipo: "lista", items });
    }
  }

  // ─── Modelo ────────────────────────────────────────────────────────────────────────────────
  const r = d.resumen;
  titulo(2, "Modelo");
  parrafo(
    `Objetos: ${Object.entries(r.objetos)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ")}. Modelo analítico: ${r.analitico.nudos} nudos, ${r.analitico.barras} barras y ${r.analitico.laminas} láminas.`,
  );
  b.push({
    tipo: "tabla",
    cabecera: ["Planta", "Cota (m)", "Altura (m)", "Diafragma", "Tramos de pilar", "Vigas", "Losas y paños (m²)", "Muros"],
    numericas: [1, 2],
    filas: r.plantas.map((p) => [
      p.id,
      num(p.cota, 4),
      p.altura === null ? "—" : num(p.altura, 4),
      p.diafragma === "rigido" ? "rígido" : "ninguno",
      p.pilares
        ? Object.entries(p.pilares)
            .map(([s, n]) => `${n} ${s}`)
            .join(", ")
        : "—",
      p.vigas ? `${p.vigas.n} (${num(p.vigas.m)} m)` : "—",
      [...(p.losas ?? []).map((l) => `${l.id} ${l.tipo} e = ${num(l.espesor)}: ${num(l.m2, 4)}`), ...(p.panos ?? []).map((x) => `${x.id}: ${num(x.m2, 4)}`)].join("; ") || "—",
      p.muros ? `${p.muros.n} (${num(p.muros.m)} m)` : "—",
    ]),
  });
  const op = resolverOpciones(d.proyecto.opciones);
  parrafo(
    `Opciones efectivas: ε_geom ${num(op.epsGeom)} m, ε_snap ${num(op.epsSnap)} m, zona rígida ${num(op.factorZonaRigida)}, cortante ${op.cortante ? "sí" : "no"}, malla ${num(op.tamanoMalla)} m, rejilla ${op.rejilla ? "sí" : "no"}, torsión de equilibrio ${op.torsionEquilibrio ? "sí" : "no"}, modificadores ${JSON.stringify(op.modificadores)}.`,
  );

  // ─── Cargas ────────────────────────────────────────────────────────────────────────────────
  titulo(2, "Cargas");
  b.push({
    tipo: "tabla",
    cabecera: ["Caso", "Acción", "Peso propio", "ΣFx (kN)", "ΣFy (kN)", "ΣFz (kN)"],
    numericas: [3, 4, 5],
    filas: r.casos.map((c) => [c.id, c.accion ?? "—", c.pesoPropio ? "sí" : "—", kN(c.F[0]!), kN(c.F[1]!), kN(c.F[2]!)]),
  });
  const casos = r.casos.map((c) => c.id);
  titulo(3, "Carga vertical por planta");
  parrafo("Lo que recibe cada planta (kN, hacia abajo positivo; los tramos de pilar y de muro, en la planta de su cabeza) y, entre paréntesis, por m² de sus losas y paños.");
  const area = (id: string) => (r.plantas.find((p) => p.id === id)!.losas ?? []).reduce((s, l) => s + l.m2, 0) + (r.plantas.find((p) => p.id === id)!.panos ?? []).reduce((s, x) => s + x.m2, 0);
  b.push({
    tipo: "tabla",
    cabecera: ["Planta", ...casos],
    numericas: casos.map((_, i) => i + 1),
    filas: r.plantas.map((p) => [p.id, ...casos.map((c) => (p.cargas[c] ? `${kN(p.cargas[c])}${area(p.id) > 0 ? ` (${num(p.cargas[c] / area(p.id))})` : ""}` : "—"))]),
  });
  const hz = r.plantas.filter((p) => p.horizontales);
  if (hz.length) {
    titulo(3, "Carga horizontal por planta");
    const ch = casos.filter((c) => hz.some((p) => p.horizontales![c]));
    b.push({
      tipo: "tabla",
      cabecera: ["Planta", ...ch.map((c) => `${c}: ΣFx, ΣFy (kN)`)],
      filas: r.plantas.map((p) => [p.id, ...ch.map((c) => (p.horizontales?.[c] ? `${kN(p.horizontales[c][0])}; ${kN(p.horizontales[c][1])}` : "—"))]),
    });
  }

  // ─── Cargas en cimentación ─────────────────────────────────────────────────────────────────
  if (d.cimentacion.length) {
    titulo(2, "Cargas en cimentación");
    parrafo(
      "Reacciones en la base de cada pilar, muro y apoyo, por caso, en ejes globales: fuerzas en kN y momentos en kN·m respecto al punto de la base (en un muro, el centro de sus nudos de la base). Fz > 0 es hacia arriba: el pilar comprime la cimentación. La carga que transmite cada pieza a su cimentación es la reacción cambiada de signo.",
    );
    const sumas = casos.map((_, k) => d.cimentacion.reduce((s, x) => s + x.R[6 * k + 2]!, 0));
    b.push({
      tipo: "tabla",
      cabecera: ["Objeto", "x (m)", "y (m)", ...casos.map((c) => `Fz ${c} (kN)`)],
      numericas: [1, 2, ...casos.map((_, i) => i + 3)],
      filas: [
        ...d.cimentacion.map((x) => [x.tipo === "pilar" ? x.id : `${x.id} (${x.tipo})`, num(x.punto[0]!, 4), num(x.punto[1]!, 4), ...casos.map((_, k) => kN(x.R[6 * k + 2]!))]),
        ["Total", "", "", ...sumas.map(kN)],
      ],
    });
    casos.forEach((c, k) => {
      if (!d.cimentacion.some((x) => [0, 1, 2, 3, 4, 5].some((i) => x.R[6 * k + i] !== 0))) return;
      titulo(3, `Caso ${c}`);
      b.push({
        tipo: "tabla",
        cabecera: ["Objeto", "Fx", "Fy", "Fz", "Mx", "My", "Mz"],
        numericas: [1, 2, 3, 4, 5, 6],
        filas: d.cimentacion.map((x) => [x.tipo === "pilar" ? x.id : `${x.id} (${x.tipo})`, ...[0, 1, 2, 3, 4, 5].map((i) => kN(x.R[6 * k + i]!))]),
      });
    });
  }

  // ─── Peso propio ───────────────────────────────────────────────────────────────────────────
  const pp = d.modelo.pesoPropio;
  if (pp) {
    titulo(2, "Peso propio");
    parrafo(
      `Caso ${pp.caso}. Lo esperado es Σ V·γ por tipo de pieza (losas y paños con su pp), calculado sin la malla, menos los solapes que el compilador no cuenta dos veces (C2-g y C3-g, estimados por la huella de las vigas y los muros dentro de las losas). Lo calculado es el caso de peso propio compilado sin las demás cargas. kN.`,
    );
    const filas = [...pp.plantas.filter((x) => x.esperado || x.calculado), { ...pp.total, planta: "Total" }].map((x) => [
      x.planta,
      kN(x.pilares),
      kN(x.vigas),
      kN(x.losas),
      kN(x.panos),
      kN(x.muros),
      kN(-x.solapes),
      kN(x.esperado),
      x.calculado === null ? "—" : kN(x.calculado),
      x.calculado === null || !(x.esperado || x.calculado) ? "—" : `${num(((x.calculado - x.esperado) / Math.max(x.esperado, x.calculado)) * 100, 2)} %`,
    ]);
    b.push({ tipo: "tabla", cabecera: ["Planta", "Pilares", "Vigas", "Losas", "Paños", "Muros", "Solapes", "Esperado", "Calculado", "Diferencia"], numericas: [1, 2, 3, 4, 5, 6, 7, 8, 9], filas });
  }

  // ─── Bajada tributaria ─────────────────────────────────────────────────────────────────────
  const t = d.resultados.tributaria;
  if (t.length) {
    titulo(2, "Bajada por áreas tributarias");
    const comparables = t.filter((x) => x.cociente !== null);
    const enMuro = t.filter((x) => x.enMuro).length;
    parrafo(
      `Axil de compresión en la cabeza de cada tramo de pilar con la suma de los casos gravitatorios (${d.resultados.gravedad.join(" + ")}), frente a su bajada por áreas tributarias (Voronoi de pilares y muros por planta, cada carga donde cae). Se comparan ${comparables.length} de ${t.length} tramos${enMuro ? `; ${enMuro} están embebidos en un muro` : ""}. Los que más se separan:`,
    );
    const orden = [...comparables].sort((a, b) => Math.abs(Math.log(b.cociente!)) - Math.abs(Math.log(a.cociente!))).slice(0, TRAMOS_TRIBUTARIA);
    b.push({ tipo: "tabla", cabecera: ["Pilar", "Planta (cabeza)", "Axil (kN)", "Bajada (kN)", "Axil / bajada"], numericas: [2, 3, 4], filas: orden.map((x) => [x.pilar, x.planta, kN(x.axil), kN(x.bajada), num(x.cociente!)]) });
  }

  if (d.figuras?.length) {
    titulo(2, "Figuras");
    parrafo("La planta del modelo y el desplazamiento vertical de las losas de cada planta, en la combinación de las flechas. Las figuras van en el informe HTML; aquí, el sha256 de cada SVG, así que la firma también las cubre. Todas las vistas, con «fem render».");
    for (const x of d.figuras) b.push({ tipo: "figura", titulo: x.titulo, svg: x.svg });
  }

  // ─── Hipótesis y avisos ────────────────────────────────────────────────────────────────────
  titulo(2, "Hipótesis de modelado");
  b.push({ tipo: "lista", items: d.hipotesis.length ? [...d.hipotesis] : ["Ninguna."] });
  titulo(2, "Avisos del compilador y del cálculo");
  if (!otros.length) parrafo("Ninguno.");
  else {
    const porCodigo = new Map<string, Diagnostico[]>();
    for (const x of otros) porCodigo.set(x.codigo, [...(porCodigo.get(x.codigo) ?? []), x]);
    const items: string[] = [];
    for (const [codigo, xs] of porCodigo) {
      for (const x of xs.slice(0, AVISOS_POR_COMPROBACION)) items.push(`${codigo}: ${x.mensaje}`);
      if (xs.length > AVISOS_POR_COMPROBACION) items.push(`${codigo}: … y ${xs.length - AVISOS_POR_COMPROBACION} más.`);
    }
    b.push({ tipo: "lista", items });
  }

  titulo(2, "Firma");
  parrafo(`El ingeniero firma este informe con «fem firmar <proyecto> --por "<nombre>"», que guarda en ${d.ficheroFirmas}, junto al proyecto, la huella ${d.huella.slice(0, 16)}…, quién firma, la fecha y el sha256 de este informe. El agente nunca firma.`);
  return b;
}

// ─── Markdown y HTML ────────────────────────────────────────────────────────────────────────────

const celdaMd = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function markdown(doc: readonly Bloque[]): string {
  const r: string[] = [];
  for (const x of doc) {
    if (x.tipo === "titulo") r.push(`${"#".repeat(x.nivel)} ${x.texto}`);
    else if (x.tipo === "parrafo") r.push(x.texto);
    else if (x.tipo === "lista") r.push(x.items.map((i) => `- ${i}`).join("\n"));
    else if (x.tipo === "figura") r.push(`Figura: ${x.titulo}. SVG, sha256 ${sha256(x.svg)}.`);
    else {
      const sep = x.cabecera.map((_, i) => (x.numericas?.includes(i) ? "---:" : "---"));
      r.push([x.cabecera, sep, ...x.filas].map((f) => `| ${f.map(celdaMd).join(" | ")} |`).join("\n"));
    }
    r.push("");
  }
  return r.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `:root{--fondo:#fff;--texto:#1d1f23;--suave:#5b616e;--linea:#d9dce3;--cabecera:#f3f4f7;--aviso:#9a5b00;--aviso-fondo:#fff4e0;--bien:#1f6f3f}
@media (prefers-color-scheme:dark){:root{--fondo:#16181c;--texto:#e6e8ec;--suave:#a2a8b4;--linea:#33373f;--cabecera:#20232a;--aviso:#ffb547;--aviso-fondo:#2e2412;--bien:#6fcf97}}
*{box-sizing:border-box}body{margin:0;background:var(--fondo);color:var(--texto);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.6em;margin:.2em 0 .6em}h2{font-size:1.25em;margin:1.8em 0 .5em;padding-bottom:.2em;border-bottom:1px solid var(--linea)}h3{font-size:1.05em;margin:1.3em 0 .4em}
p,li{max-width:80ch}ul{padding-left:1.3em}li{margin:.2em 0}.tabla{overflow-x:auto;margin:.6em 0}table{border-collapse:collapse;font-size:.92em}th,td{border:1px solid var(--linea);padding:4px 8px;vertical-align:top;text-align:left}
th{background:var(--cabecera);font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.avisos{color:var(--aviso);background:var(--aviso-fondo);font-weight:600}.bien{color:var(--bien)}code{font-size:.92em}
figure{margin:1em 0 1.6em}figure svg{display:block;max-width:100%;height:auto;border:1px solid var(--linea)}figcaption{color:var(--suave);font-size:.92em;margin-bottom:.4em}`;

export function html(doc: readonly Bloque[]): string {
  const titulo = doc.find((x) => x.tipo === "titulo" && x.nivel === 1);
  const r: string[] = [];
  for (const x of doc) {
    if (x.tipo === "titulo") r.push(`<h${x.nivel}>${esc(x.texto)}</h${x.nivel}>`);
    else if (x.tipo === "parrafo") r.push(`<p>${esc(x.texto)}</p>`);
    else if (x.tipo === "lista") r.push(`<ul>${x.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`);
    else if (x.tipo === "figura") r.push(`<figure><figcaption>${esc(x.titulo)}</figcaption>\n${x.svg}</figure>`);
    else {
      const celda = (s: string, i: number) => {
        const clase = [x.numericas?.includes(i) ? "n" : "", s.startsWith("AVISOS") ? "avisos" : s === "bien" ? "bien" : ""].filter(Boolean).join(" ");
        return `<td${clase ? ` class="${clase}"` : ""}>${esc(s)}</td>`;
      };
      r.push(`<div class="tabla"><table><thead><tr>${x.cabecera.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${x.filas.map((f) => `<tr>${f.map(celda).join("")}</tr>`).join("")}</tbody></table></div>`);
    }
  }
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo && titulo.tipo === "titulo" ? titulo.texto : "Informe de revisión")}</title>
<style>${CSS}</style>
</head>
<body><main>
${r.join("\n")}
</main></body>
</html>
`;
}
