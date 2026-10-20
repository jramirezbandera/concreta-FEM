/**
 * SVG de una escena (A4): la planta encuadrada a la izquierda, con la cabecera arriba, y a la derecha
 * la leyenda, la escala y las notas. Determinista: las coordenadas van en px con un decimal, sin
 * fechas ni identificadores al azar, así que el mismo proyecto da el mismo SVG byte a byte.
 *
 * Tamaños (criterio 3 de A4): el lado mayor mide como mucho LADO_MAXIMO px, que es lo que un modelo
 * de visión recibe sin reducir, y ningún texto baja de TEXTO_MINIMO px. Los rótulos que se solapan
 * con otro de más prioridad se omiten y se cuentan (`omitidos`).
 *
 * Puro: sin IO.
 */
import { anchoTexto, TEXTO_MINIMO, type Escena, type Estilo, type Texto, type Vec2 } from "./escena.ts";
import { rotulosLineas, type LineaRotulada } from "./isovalores.ts";

export const LADO_MAXIMO = 1568;
const PANEL = 380;
const MARGEN = 28;
/** Escala máxima, px/m (un modelo pequeño no se amplía más). */
const ESCALA_MAXIMA = 120;
const LINEA_LEYENDA = 18;
const TAM_LEYENDA = 13;
const FUENTE = "Roboto";

export interface Pintura {
  fill?: string;
  stroke?: string;
  sw?: number;
  dash?: string;
  opacity?: number;
}

/** Pintura de cada estilo (el visor de V1 usa la misma en el tema claro). */
export const ESTILOS: Record<Estilo, Pintura> = {
  losa: { fill: "#e9edf2", stroke: "#7d8794", sw: 1.2 },
  "losa-reticular": { fill: "#dfe9df", stroke: "#6f8a6f", sw: 1 },
  abaco: { fill: "#b9cdb9", stroke: "#58745a", sw: 1 },
  "abaco-relleno": { fill: "#b9cdb9" },
  "abaco-borde": { stroke: "#58745a", sw: 1 },
  pano: { fill: "#f3ead9", stroke: "#97835c", sw: 1 },
  "pano-viguetas": { stroke: "#b49a68", sw: 1 },
  viga: { fill: "#c3cbd4", stroke: "#4c5560", sw: 0.8 },
  vigueta: { stroke: "#7a6a4a", sw: 1.4 },
  "pilar-llega": { fill: "#1f2933", stroke: "#1f2933", sw: 1 },
  "pilar-arranca": { fill: "#ffffff", stroke: "#1f2933", sw: 1.6 },
  "muro-llega": { fill: "#4a5561", stroke: "#2a313a", sw: 0.8 },
  "muro-arranca": { fill: "#ffffff", stroke: "#2a313a", sw: 1.4, dash: "5 3" },
  "muro-hueco": { fill: "#ffffff", stroke: "#c2410c", sw: 1.6 },
  apoyo: { fill: "#0f766e", stroke: "#0f766e", sw: 1 },
  "apoyo-lineal": { stroke: "#0f766e", sw: 3.5 },
  banda: { stroke: "#6d28d9", sw: 1.2, dash: "10 5" },
  "hueco-aspa": { stroke: "#7d8794", sw: 0.8 },
  eje: { stroke: "#8794a3", sw: 0.8, dash: "14 3 2 3" },
  "eje-burbuja": { fill: "#ffffff", stroke: "#475569", sw: 1.2 },
  cota: { stroke: "#6b7280", sw: 0.8 },
  nivel: { stroke: "#9aa4b1", sw: 0.8 },
  "pilar-alzado": { fill: "#dde2e8", stroke: "#1f2933", sw: 1 },
  "viga-alzado": { fill: "#c3cbd4", stroke: "#4c5560", sw: 0.8 },
  "muro-alzado": { fill: "#cfd5dc", stroke: "#2a313a", sw: 0.8 },
  "losa-cortada": { fill: "#5f6b78", stroke: "#2a313a", sw: 0.8 },
  "pano-cortado": { fill: "#97835c", stroke: "#5c4e33", sw: 0.8 },
  "seccion-cortada": { fill: "#1f2933", stroke: "#1f2933", sw: 0.8 },
  "carga-superficie": { fill: "#2563eb", stroke: "#1d4ed8", sw: 1.4, opacity: 0.16 },
  "carga-lineal": { stroke: "#dc2626", sw: 3 },
  "carga-puntual": { fill: "#dc2626", stroke: "#dc2626", sw: 2 },
  "carga-pieza": { stroke: "#ea580c", sw: 3.5 },
  "carga-banda-lineal": { fill: "#dc2626", stroke: "#dc2626", sw: 1.2, opacity: 0.14 },
  "carga-banda-pieza": { fill: "#ea580c", stroke: "#c2410c", sw: 1.2, opacity: 0.14 },
  atenuado: { fill: "#f3f4f6", stroke: "#c4c8ce", sw: 0.8 },
  "atenuado-linea": { stroke: "#c4c8ce", sw: 1 },
  "diagnostico-error": { fill: "#dc2626", stroke: "#7f1d1d", sw: 1 },
  "diagnostico-aviso": { fill: "#f59e0b", stroke: "#78350f", sw: 1 },
  malla: { fill: "#ffffff", stroke: "#94a3b8", sw: 0.6 },
  "malla-abaco": { fill: "#dfe9df", stroke: "#94a3b8", sw: 0.6 },
  "malla-rigida": { fill: "#9ca3af", stroke: "#4b5563", sw: 0.6 },
  "malla-barra": { stroke: "#b45309", sw: 1.6 },
  "malla-encima": { stroke: "#64748b", sw: 0.5 },
  "malla-nudo-barra": { fill: "#b45309", stroke: "#b45309", sw: 1 },
  "sin-mapa": { fill: "#e5e7eb", stroke: "#9ca3af", sw: 0.6 },
  isobanda: {},
  isolinea: { stroke: "#2b313a", sw: 0.7 },
  "isolinea-cero": { stroke: "#111827", sw: 1.6 },
  "fuera-escala": { stroke: "#ffffff", sw: 0.8 },
  contorno: { stroke: "#374151", sw: 1.2 },
  "diagrama-positivo": { fill: "#dc2626", stroke: "#b91c1c", sw: 0.8, opacity: 0.55 },
  "diagrama-negativo": { fill: "#2563eb", stroke: "#1d4ed8", sw: 0.8, opacity: 0.55 },
  "diagrama-eje": { stroke: "#6b7280", sw: 1 },
  "extremo-maximo": { fill: "#ffffff", stroke: "#111827", sw: 2 },
  "extremo-minimo": { fill: "#111827", stroke: "#111827", sw: 2 },
  "valor-pilar": { fill: "#1f2933", stroke: "#1f2933", sw: 1 },
  "reaccion-vertical": { fill: "#0d9488", stroke: "#0d9488", sw: 2 },
  "reaccion-horizontal": { stroke: "#d97706", sw: 2 },
  "armado-cubierto": { fill: "#e5e7eb" },
  "zona-refuerzo": { stroke: "#111827", sw: 1.8 },
};

/** Número en px con un decimal, sin «-0» ni «.0». */
const f = (v: number): string => {
  const t = (Math.round(v * 10) / 10).toFixed(1);
  const s = t.endsWith(".0") ? t.slice(0, -2) : t;
  return s === "-0" ? "0" : s;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function atributos(p: Pintura, relleno?: string): string {
  const a: string[] = [];
  const fill = relleno ?? p.fill;
  a.push(`fill="${fill ?? "none"}"`);
  if (p.stroke) a.push(`stroke="${p.stroke}" stroke-width="${f(p.sw ?? 1)}" stroke-linejoin="round"`);
  if (p.dash) a.push(`stroke-dasharray="${p.dash}"`);
  if (p.opacity !== undefined) a.push(`fill-opacity="${p.opacity}"`);
  return a.join(" ");
}

export interface Encuadre {
  ancho: number;
  alto: number;
  /** px por m. */
  escala: number;
  /** Del modelo a px. */
  px: (q: Vec2) => [number, number];
}

/** Líneas de un texto partidas para caber en `ancho` px. */
function partir(t: string, tamano: number, ancho: number): string[] {
  const r: string[] = [];
  let linea = "";
  for (const palabra of t.split(" ")) {
    const prueba = linea ? `${linea} ${palabra}` : palabra;
    if (linea && anchoTexto(prueba, tamano) > ancho) {
      r.push(linea);
      linea = palabra;
    } else linea = prueba;
  }
  if (linea) r.push(linea);
  return r;
}

/** Longitud redonda de la barra de escala: la mayor de 1, 2, 5 × 10ᵏ m que cabe en `maxPx`. */
function barraEscala(escala: number, maxPx: number): number {
  let mejor = 0.1;
  for (let k = -1; k <= 3; k++) for (const m of [1, 2, 5]) if (m * 10 ** k * escala <= maxPx) mejor = Math.max(mejor, m * 10 ** k);
  return mejor;
}

export interface Svg {
  svg: string;
  encuadre: Encuadre;
  /** Rótulos omitidos por solaparse con otro de más prioridad. */
  omitidos: number;
}

export function escenaASvg(e: Escena): Svg {
  // Cabecera
  const altoCabecera = 20 + 24 + e.cabecera.length * 18;
  const [x0, y0, x1, y1] = e.caja;
  const dx = Math.max(x1 - x0, 1);
  const dy = Math.max(y1 - y0, 1);
  const escala = Math.min((LADO_MAXIMO - PANEL - 2 * MARGEN) / dx, (LADO_MAXIMO - altoCabecera - 2 * MARGEN) / dy, ESCALA_MAXIMA);
  const anchoPlano = dx * escala + 2 * MARGEN;
  const ancho = Math.round(anchoPlano + PANEL);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const px = (q: Vec2): [number, number] => [MARGEN + (dx * escala) / 2 + (q[0] - cx) * escala, altoCabecera + MARGEN + (dy * escala) / 2 - (q[1] - cy) * escala];

  // Leyenda: entradas, escala y notas, partidas al ancho del panel
  const xPanel = Math.round(anchoPlano) + 16;
  const anchoUtil = PANEL - 32;
  const leyenda: string[] = [];
  let y = altoCabecera + 8;
  const L = barraEscala(escala, 200);
  const xb = xPanel;
  leyenda.push(`<text x="${xb}" y="${f(y + 14)}" font-size="${TAM_LEYENDA}" font-weight="bold">Escala y ejes</text>`);
  y += 26;
  leyenda.push(`<path d="M${f(xb)} ${f(y + 6)}H${f(xb + L * escala)}" stroke="#111827" stroke-width="3" fill="none"/>`);
  leyenda.push(`<text x="${f(xb + L * escala + 8)}" y="${f(y + 11)}" font-size="${TAM_LEYENDA}">${esc(`${String(L).replace(".", ",")} m`)}</text>`);
  // Ejes X e Y
  const ax = xb + 270;
  leyenda.push(`<path d="M${ax} ${f(y + 30)}h40M${ax + 34} ${f(y + 26)}l6 4l-6 4M${ax} ${f(y + 30)}v-36M${ax - 4} ${f(y)}l4 -6l4 6" stroke="#111827" stroke-width="1.6" fill="none"/>`);
  leyenda.push(`<text x="${ax + 44}" y="${f(y + 34)}" font-size="${TAM_LEYENDA}">X</text><text x="${ax - 4}" y="${f(y - 10)}" font-size="${TAM_LEYENDA}">Y</text>`);
  y += 44;
  const maxY = LADO_MAXIMO - 12;
  let cortadas = 0;
  if (e.leyenda.length) {
    leyenda.push(`<text x="${xb}" y="${f(y + 14)}" font-size="${TAM_LEYENDA}" font-weight="bold">Leyenda</text>`);
    y += 24;
    if (e.tituloLeyenda) {
      for (const l of partir(e.tituloLeyenda, TAM_LEYENDA, anchoUtil)) {
        leyenda.push(`<text x="${xb}" y="${f(y + 13)}" font-size="${TAM_LEYENDA}">${esc(l)}</text>`);
        y += LINEA_LEYENDA;
      }
      y += 6;
    }
    for (const it of e.leyenda) {
      const lineas = partir(it.texto, TAM_LEYENDA, anchoUtil - 34);
      if (y + lineas.length * LINEA_LEYENDA > maxY) {
        cortadas++;
        continue;
      }
      const p = it.estilo ? ESTILOS[it.estilo] : {};
      if (it.relleno || p.fill) leyenda.push(`<rect x="${xb}" y="${f(y + 2)}" width="24" height="13" ${atributos({ ...p, sw: Math.min(p.sw ?? 1, 1.5) }, it.relleno)}/>`);
      else leyenda.push(`<path d="M${xb} ${f(y + 9)}h24" ${atributos(p)}/>`);
      lineas.forEach((l, i) => leyenda.push(`<text x="${xb + 32}" y="${f(y + 13 + i * LINEA_LEYENDA)}" font-size="${TAM_LEYENDA}">${esc(l)}</text>`));
      y += lineas.length * LINEA_LEYENDA + 4;
    }
  }
  if (e.notas.length || cortadas) {
    y += 8;
    leyenda.push(`<text x="${xb}" y="${f(y + 14)}" font-size="${TAM_LEYENDA}" font-weight="bold">Notas</text>`);
    y += 24;
    const notas = cortadas ? [...e.notas, `(${cortadas} entradas de la leyenda no caben)`] : e.notas;
    for (const n of notas) {
      const lineas = partir(n, TEXTO_MINIMO + 1, anchoUtil);
      if (y + lineas.length * 16 > maxY) {
        leyenda.push(`<text x="${xb}" y="${f(y + 12)}" font-size="${TEXTO_MINIMO + 1}">…</text>`);
        y += 16;
        break;
      }
      lineas.forEach((l, i) => leyenda.push(`<text x="${xb}" y="${f(y + 12 + i * 16)}" font-size="${TEXTO_MINIMO + 1}">${esc(l)}</text>`));
      y += lineas.length * 16 + 4;
    }
  }
  const alto = Math.min(LADO_MAXIMO, Math.round(Math.max(altoCabecera + dy * escala + 2 * MARGEN, y + 16)));

  // Formas
  const formas: string[] = [];
  const textos: Texto[] = [];
  const rotuladas: LineaRotulada[] = [];
  const d = (anillos: readonly (readonly Vec2[])[]) =>
    anillos
      .map((r) => {
        const q = r.map(px);
        return `M${q.map(([a, b]) => `${f(a)} ${f(b)}`).join("L")}Z`;
      })
      .join("");
  for (const p of e.primitivas) {
    const pin = ESTILOS[p.tipo === "texto" ? "contorno" : p.estilo];
    switch (p.tipo) {
      case "poligono":
        formas.push(`<path d="${d(p.anillos)}" fill-rule="evenodd" ${atributos(pin, p.relleno)}/>`);
        break;
      case "region":
        // El trazo del mismo color tapa la costura del antialias con la banda vecina
        formas.push(`<path d="${d(p.anillos)}" fill="${p.relleno}" stroke="${p.relleno}" stroke-width="0.6" stroke-linejoin="round"/>`);
        break;
      case "linea": {
        const q = p.puntos.map(px);
        formas.push(`<path d="M${q.map(([a, b]) => `${f(a)} ${f(b)}`).join("L")}" ${atributos({ ...pin, fill: undefined })} stroke-linecap="round"/>`);
        if (p.rotulo) rotuladas.push({ puntos: p.puntos, texto: p.rotulo });
        break;
      }
      case "marca": {
        const [a, b] = px(p.p);
        const r = p.radio;
        if (p.forma === "circulo") formas.push(`<circle cx="${f(a)}" cy="${f(b)}" r="${f(r)}" ${atributos(pin)}/>`);
        else if (p.forma === "cuadrado") formas.push(`<rect x="${f(a - r)}" y="${f(b - r)}" width="${f(2 * r)}" height="${f(2 * r)}" ${atributos(pin)}/>`);
        else formas.push(`<path d="M${f(a)} ${f(b - r)}L${f(a + r)} ${f(b + r * 0.8)}L${f(a - r)} ${f(b + r * 0.8)}Z" ${atributos(pin)}/>`);
        break;
      }
      case "flecha": {
        const [a, b] = px(p.p);
        if (p.d) {
          const l = Math.hypot(p.d[0], p.d[1]) || 1;
          const [ux, uy] = [p.d[0] / l, -p.d[1] / l];
          const [ex, ey] = [a + ux * 30, b + uy * 30];
          const [nx, ny] = [-uy, ux];
          formas.push(
            `<path d="M${f(a)} ${f(b)}L${f(ex)} ${f(ey)}M${f(ex - ux * 8 + nx * 5)} ${f(ey - uy * 8 + ny * 5)}L${f(ex)} ${f(ey)}L${f(ex - ux * 8 - nx * 5)} ${f(ey - uy * 8 - ny * 5)}" ${atributos({ ...pin, fill: undefined })}/>`,
          );
        } else {
          formas.push(`<circle cx="${f(a)}" cy="${f(b)}" r="7" fill="#ffffff" stroke="${pin.stroke}" stroke-width="2"/>`);
          formas.push(p.abajo === false ? `<path d="M${f(a - 5)} ${f(b - 5)}L${f(a + 5)} ${f(b + 5)}M${f(a + 5)} ${f(b - 5)}L${f(a - 5)} ${f(b + 5)}" stroke="${pin.stroke}" stroke-width="2"/>` : `<circle cx="${f(a)}" cy="${f(b)}" r="2.6" fill="${pin.stroke}"/>`);
        }
        break;
      }
      case "texto":
        textos.push(p);
        break;
    }
  }

  // Los de las líneas rotuladas (isolíneas), con la escala del dibujo
  textos.push(...rotulosLineas(rotuladas, escala, (t, tam) => anchoTexto(t, tam)));
  // Rótulos: por prioridad, sin solapes y dentro del plano
  const puestos: [number, number, number, number][] = [];
  const rotulos: string[] = [];
  let omitidos = 0;
  const orden = textos.map((t, i) => [t, i] as const).sort((a, b) => b[0].prioridad - a[0].prioridad || a[1] - b[1]);
  for (const [t] of orden) {
    const tam = Math.max(TEXTO_MINIMO, t.tamano);
    const w = anchoTexto(t.texto, tam, t.negrita);
    const g = (-(t.giro ?? 0) * Math.PI) / 180;
    const [c, s] = [Math.cos(g), Math.sin(g)];
    let puesto = false;
    for (const pos of [{ p: t.p, dx: t.dx, dy: t.dy, ancla: t.ancla }, ...(t.alternativas ?? [])]) {
      // El desplazamiento gira con el texto
      const [a0, b0] = px(pos.p ?? t.p);
      const [ox, oy] = [pos.dx ?? 0, pos.dy ?? 0];
      const [a, b] = [a0 + ox * c - oy * s, b0 + ox * s + oy * c];
      const ancla = pos.ancla ?? "inicio";
      const xi = ancla === "inicio" ? 0 : ancla === "medio" ? -w / 2 : -w;
      // Caja local [xi, -0.8·tam] – [xi + w, 0.25·tam], girada
      const esquinas = [
        [xi - 2, -0.8 * tam],
        [xi + w + 2, -0.8 * tam],
        [xi + w + 2, 0.25 * tam],
        [xi - 2, 0.25 * tam],
      ].map(([u, v]) => [a + u! * c - v! * s, b + u! * s + v! * c]);
      const caja: [number, number, number, number] = [Math.min(...esquinas.map((q) => q[0]!)), Math.min(...esquinas.map((q) => q[1]!)), Math.max(...esquinas.map((q) => q[0]!)), Math.max(...esquinas.map((q) => q[1]!))];
      const fuera = caja[0] < 2 || caja[2] > anchoPlano - 2 || caja[1] < altoCabecera || caja[3] > alto - 2;
      if (fuera || puestos.some((q) => caja[0] < q[2] && caja[2] > q[0] && caja[1] < q[3] && caja[3] > q[1])) continue;
      puestos.push(caja);
      const giro = t.giro ? ` transform="rotate(${f(-t.giro)} ${f(a)} ${f(b)})"` : "";
      const anchor = ancla === "inicio" ? "" : ` text-anchor="${ancla === "medio" ? "middle" : "end"}"`;
      if (t.fondo) rotulos.push(`<rect x="${f(a + xi - 2)}" y="${f(b - 0.8 * tam)}" width="${f(w + 4)}" height="${f(1.05 * tam)}" fill="#ffffff" fill-opacity="0.85"${giro}/>`);
      rotulos.push(`<text x="${f(a)}" y="${f(b)}" font-size="${tam}"${t.negrita ? ' font-weight="bold"' : ""}${anchor}${t.color ? ` fill="${t.color}"` : ""}${giro}>${esc(t.texto)}</text>`);
      puesto = true;
      break;
    }
    if (!puesto) omitidos++;
  }

  const cabecera = [`<text x="${MARGEN}" y="32" font-size="20" font-weight="bold">${esc(e.titulo)}</text>`, ...e.cabecera.map((l, i) => `<text x="${MARGEN}" y="${56 + i * 18}" font-size="14" fill="#374151">${esc(l)}</text>`)];
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}" font-family="${FUENTE}">`,
    `<rect width="${ancho}" height="${alto}" fill="#ffffff"/>`,
    `<path d="M${f(anchoPlano)} ${altoCabecera}V${alto - 8}" stroke="#d1d5db" stroke-width="1"/>`,
    ...cabecera,
    `<g>`,
    ...formas,
    `</g>`,
    `<g>`,
    ...rotulos,
    `</g>`,
    ...leyenda,
    `</svg>`,
    "",
  ].join("\n");
  return { svg, encuadre: { ancho, alto, escala, px }, omitidos };
}
