/**
 * La gráfica de la envolvente de una pieza (Resultados · Diagramas, panel inferior): la envolvente
 * máxima y mínima de `envolventePieza` a lo largo de la pieza, con
 *  - ejes con escala y rejilla (pasos 1-2-2,5-5), la unidad y las estaciones en m;
 *  - las cotas de los vanos de cara a cara (de los tramos, en un pilar) encima;
 *  - los apoyos con su nombre y las zonas rígidas rayadas (sin esfuerzos de la barra);
 *  - el relleno como en la planta: la máxima donde es positiva y la mínima donde es negativa, rayado;
 *  - los picos de cada vano (`fem consultar pieza`, exactos) con su combinación;
 *  - el cursor de la estación con su lectura, que es la consulta `estacion` (no se interpola nada).
 * Un clic, o arrastrar, mueve la estación; con el teclado, el deslizador de debajo (C-19).
 *
 * Todo número rotulado es de una consulta (criterio 1 de V1): los picos, de los vanos o de los puntos
 * de la envolvente; la lectura, de la estación. Las marcas de los ejes son sólo escala.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { DatosEstacion, DatosViga } from "../../../src/visor/datos.ts";
import { fmt } from "../fmt.ts";
import { queCombinaciones } from "../vistas/sonda.ts";

/** Ancho aproximado de un carácter de Geist Mono por px de cuerpo. */
const CAR = 0.62;

interface Pico {
  s: number;
  v: number;
  comb: string;
}

interface Caja {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function pasoBonito(rango: number, n: number): number {
  const bruto = rango / Math.max(1, n);
  const e = 10 ** Math.floor(Math.log10(bruto));
  const f = bruto / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}

function decimales(p: number): number {
  for (let d = 0; d < 6; d++) if (Math.abs(Math.round(p * 10 ** d) - p * 10 ** d) < 1e-6) return d;
  return 6;
}

/** Los valores de un pico: 1 decimal, 2 por debajo de la unidad (como los rótulos de la planta). */
const valor = (v: number) => fmt(v, Math.abs(v) < 0.95 ? 2 : 1);

/** Los tramos flexibles contiguos, juntos: el diagrama sólo se corta en una zona rígida. */
function tramosContinuos(flexibles: [number, number][]): [number, number][] {
  const r: [number, number][] = [];
  for (const [a, b] of [...flexibles].sort((x, y) => x[0] - y[0])) {
    const u = r[r.length - 1];
    if (u && a - u[1] < 1e-9) u[1] = Math.max(u[1], b);
    else r.push([a, b]);
  }
  return r;
}

/**
 * Los puntos de una curva recortada a un lado del cero (`signo` 1, lo positivo; −1, lo negativo),
 * con los cruces por cero interpolados para que el relleno no se deforme.
 */
function recortada(ps: { s: number; v: number }[], signo: 1 | -1): { s: number; v: number }[] {
  const r: { s: number; v: number }[] = [];
  const c = (v: number) => (signo > 0 ? Math.max(0, v) : Math.min(0, v));
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    const q = ps[i - 1];
    if (q && q.s !== p.s && Math.sign(q.v) * Math.sign(p.v) < 0) r.push({ s: q.s + ((p.s - q.s) * q.v) / (q.v - p.v), v: 0 });
    r.push({ s: p.s, v: c(p.v) });
  }
  return r;
}

export function GraficaEnvolvente({ v, s, onS, estacion, unidad, abajo }: { v: DatosViga; s: number; onS: (s: number) => void; estacion: DatosEstacion | null; unidad: string; abajo: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const caja = useRef<HTMLDivElement>(null);
  const [[w, h], setTam] = useState<[number, number]>([800, 200]);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTam([Math.max(260, Math.round(e!.contentRect.width)), Math.max(150, Math.round(e!.contentRect.height))]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [hx, setHx] = useState<number | null>(null);
  const arrastrando = useRef(false);

  const L = Math.max(v.longitud, 1e-6);
  const [ml, mr, mt, mb] = [62, 20, 30, 42];
  const pw = w - ml - mr;
  const ph = h - mt - mb;
  const X = (x: number) => ml + (x / L) * pw;
  const aS = (px: number) => Math.min(L, Math.max(0, ((px - ml) / pw) * L));

  const tramos = useMemo(() => tramosContinuos(v.flexibles), [v.flexibles]);
  const rigidas = useMemo(() => {
    const r: [number, number][] = [];
    let x = 0;
    for (const [a, b] of tramos) {
      if (a - x > 1e-6) r.push([x, a]);
      x = Math.max(x, b);
    }
    if (L - x > 1e-6) r.push([x, L]);
    return r;
  }, [tramos, L]);
  const trozos = useMemo(() => tramos.map(([a, b]) => v.envolvente.filter((p) => p.s >= a - 1e-9 && p.s <= b + 1e-9)).filter((ps) => ps.length > 0), [tramos, v.envolvente]);

  // Los picos: los de cada vano (exactos, con su combinación); sin vanos o sin extremos de ese esfuerzo, los de la envolvente
  const candidatos: Pico[] = [];
  for (const va of v.vanos) {
    const ex = va.extremos;
    if (v.esfuerzo === "My") for (const k of ["My+", "My-"]) if (ex[k]) candidatos.push({ s: ex[k].s!, v: ex[k].v, comb: ex[k].comb });
    if (v.esfuerzo === "Vz" && ex.Vz) candidatos.push({ s: ex.Vz.s!, v: ex.Vz.v, comb: ex.Vz.comb });
  }
  if (!candidatos.length && v.envolvente.length) {
    const mx = v.envolvente.reduce((a, b) => (b.max > a.max ? b : a));
    const mn = v.envolvente.reduce((a, b) => (b.min < a.min ? b : a));
    if (mx.max > 1e-9) candidatos.push({ s: mx.s, v: mx.max, comb: "" });
    if (mn.min < -1e-9) candidatos.push({ s: mn.s, v: mn.min, comb: "" });
  }

  // El dominio: de lo menor a lo mayor (con el cero), a marcas redondas
  let lo = 0;
  let hi = 0;
  for (const p of v.envolvente) {
    lo = Math.min(lo, p.min);
    hi = Math.max(hi, p.max);
  }
  for (const p of candidatos) {
    lo = Math.min(lo, p.v);
    hi = Math.max(hi, p.v);
  }
  const vacio = hi - lo < 1e-9;
  if (vacio) [lo, hi] = [-1, 1];
  const pY = pasoBonito(hi - lo, Math.max(2, Math.floor(ph / 36)));
  const lo2 = lo < -1e-12 ? Math.floor(lo / pY + 1e-9) * pY : 0;
  const hi2 = hi > 1e-12 ? Math.ceil(hi / pY - 1e-9) * pY : 0;
  const hueco = Math.min(36, ph * 0.2);
  const yA = mt + hueco;
  const yB = mt + ph - hueco;
  const Y = (val: number) => (abajo ? yA + ((val - lo2) / (hi2 - lo2)) * (yB - yA) : yA + ((hi2 - val) / (hi2 - lo2)) * (yB - yA));
  const y0 = Y(0);
  const decY = decimales(pY);
  const marcasY: number[] = [];
  for (let k = Math.round(lo2 / pY); k <= Math.round(hi2 / pY); k++) marcasY.push(k * pY);
  const pX = pasoBonito(L, Math.max(2, Math.floor(pw / 80)));
  const decX = decimales(pX);
  const marcasX: number[] = [];
  for (let k = 0; k * pX <= L + 1e-9; k++) marcasX.push(k * pX);

  const linea = (k: "max" | "min") => trozos.map((ps) => ps.map((p, i) => `${i ? "L" : "M"}${X(p.s).toFixed(1)} ${Y(p[k]).toFixed(1)}`).join("")).join("");
  const relleno = (k: "max" | "min") =>
    trozos
      .map((ps) => {
        const r = recortada(ps.map((p) => ({ s: p.s, v: p[k] })), k === "max" ? 1 : -1);
        if (r.length < 2) return "";
        return `M${X(r[0]!.s).toFixed(1)} ${y0.toFixed(1)}${r.map((p) => `L${X(p.s).toFixed(1)} ${Y(p.v).toFixed(1)}`).join("")}L${X(r[r.length - 1]!.s).toFixed(1)} ${y0.toFixed(1)}Z`;
      })
      .join("");

  // Los rótulos de los picos, sin pisarse: fuera del diagrama, si no cabe al lado, sin la combinación, y si no, nada
  // Los marcadores de todos los picos, ocupados de partida: un rótulo no tapa el punto de otro ni el suyo
  const ocupadas: Caja[] = candidatos.map((p) => ({ x0: X(p.s) - 5, y0: Y(p.v) - 5, x1: X(p.s) + 5, y1: Y(p.v) + 5 }));
  const choca = (c: Caja) => ocupadas.some((o) => c.x0 < o.x1 && c.x1 > o.x0 && c.y0 < o.y1 && c.y1 > o.y0);
  const rotulos: { p: Pico; cx: number; top: number; ancho: number; conComb: boolean }[] = [];
  const vistos: Pico[] = [];
  for (const p of [...candidatos].sort((a, b) => Math.abs(b.v) - Math.abs(a.v))) {
    // Dos picos juntos del mismo signo (los de los vanos a cada lado de un apoyo): sólo el mayor
    if (vistos.some((q) => Math.abs(X(q.s) - X(p.s)) < 24 && Math.sign(q.v) === Math.sign(p.v))) continue;
    vistos.push(p);
    const px = X(p.s);
    const py = Y(p.v);
    const fuera = py >= y0 ? 1 : -1;
    const t = valor(p.v);
    let puesto = false;
    for (const conComb of p.comb ? [true, false] : [false]) {
      const ancho = Math.max(t.length * 12 * CAR, conComb ? p.comb.length * 10 * CAR : 0) + 12;
      const alto = conComb ? 29 : 17;
      for (const dx of [0, -1, 1]) {
        const cx = Math.min(w - mr - ancho / 2, Math.max(ml + ancho / 2, px + dx * (ancho / 2 + 8)));
        const top = Math.min(h - mb - alto - 1, Math.max(2, fuera > 0 ? py + 8 : py - 8 - alto));
        const c = { x0: cx - ancho / 2, y0: top, x1: cx + ancho / 2, y1: top + alto };
        if (choca(c)) continue;
        ocupadas.push(c);
        rotulos.push({ p, cx, top, ancho, conComb });
        puesto = true;
        break;
      }
      if (puesto) break;
    }
  }

  // Los extremos de la pieza, para la cabecera: los de los vanos, de cara a cara (dentro de un apoyo no se
  // dimensiona); sin vanos, los de la envolvente
  const deVanos = candidatos.some((p) => p.comb);
  const maxG = deVanos ? Math.max(...candidatos.map((p) => p.v)) : Math.max(...v.envolvente.map((p) => p.max));
  const minG = deVanos ? Math.min(...candidatos.map((p) => p.v)) : Math.min(...v.envolvente.map((p) => p.min));
  const verMax = deVanos ? candidatos.some((p) => p.v > 0) : true;
  const verMin = deVanos ? candidatos.some((p) => p.v < 0) : true;

  // Las cotas de arriba: los vanos de cara a cara; en un pilar, sus tramos entre plantas; en una barra, su longitud
  const cotas: { a: number; b: number; texto: string; corto: string }[] =
    v.tipo === "pilar"
      ? (v.plantas ?? []).slice(1).map((p, i) => {
          const a = v.plantas![i]!.s;
          return { a, b: p.s, texto: `Tramo bajo ${p.planta} · ${fmt(p.s - a, 2)} m`, corto: `${fmt(p.s - a, 2)} m` };
        })
      : v.vanos.length
        ? v.vanos.map((va, i) => ({ a: va.desde, b: va.hasta, texto: `Vano ${i + 1} · ${fmt(va.hasta - va.desde, 2)} m`, corto: `${fmt(va.hasta - va.desde, 2)} m` }))
        : [{ a: 0, b: L, texto: `${fmt(L, 2)} m`, corto: `${fmt(L, 2)} m` }];

  // La lectura de la estación (la consulta; mientras llega la de la nueva, la anterior, atenuada)
  const lado = estacion && !estacion.rigida ? (estacion.derecha ?? estacion.izquierda) : null;
  // Un salto que se ve: los dos lados con otros valores a la precisión rotulada
  const salto = !!estacion?.izquierda && !!estacion.derecha && (fmt(estacion.izquierda.max.v, 2) !== fmt(estacion.derecha.max.v, 2) || fmt(estacion.izquierda.min.v, 2) !== fmt(estacion.derecha.min.v, 2));
  const alDia = !!estacion && Math.abs(estacion.s - s) < 1e-6;
  const lineasLectura: { texto: string; color?: string; peso?: number; chico?: boolean }[] = [{ texto: `s = ${fmt(s, 2)} m`, chico: true }];
  if (estacion?.rigida) lineasLectura.push({ texto: "zona rígida: sin esfuerzos", chico: true });
  else if (lado) {
    lineasLectura.push({ texto: `máx. ${fmt(lado.max.v, 2)} ${unidad}`, color: "var(--color-env-max)", peso: 600 }, { texto: lado.max.comb, chico: true });
    lineasLectura.push({ texto: `mín. ${fmt(lado.min.v, 2)} ${unidad}`, color: "var(--color-env-min)", peso: 600 }, { texto: lado.min.comb, chico: true });
    if (salto && estacion?.izquierda) lineasLectura.push({ texto: `izq.: ${fmt(estacion.izquierda.max.v, 2)} / ${fmt(estacion.izquierda.min.v, 2)}`, chico: true });
  } else lineasLectura.push({ texto: "…", chico: true });
  const anchoLectura = Math.max(...lineasLectura.map((l) => l.texto.length * (l.chico ? 10 : 11.5) * CAR)) + 18;
  const altoLectura = lineasLectura.reduce((a, l) => a + (l.chico ? 13 : 15), 0) + 10;
  const xs = X(s);
  const xLectura = xs + 12 + anchoLectura > w - mr ? xs - 12 - anchoLectura : xs + 12;
  const xEst = estacion ? X(Math.min(L, estacion.s)) : xs;

  const esMomento = v.esfuerzo === "My" || v.esfuerzo === "Mz";
  const signo = esMomento ? `${v.esfuerzo} > 0 hacia abajo (tracciones)` : `${v.esfuerzo} > 0 hacia arriba`;
  const que = queCombinaciones({ descripcion: v.combinaciones.descripcion, n: v.combinaciones.nombres.length }, v.combinaciones.nombres[0]);
  const caption = v.tipo === "pilar" ? "s desde la base (m)" : v.tipo === "barra" ? "s desde el inicio (m)" : "s (m)";
  const rotuloApoyo = v.tipo === "pilar" ? "forjado (zona rígida)" : "zona rígida";
  const pRayado = `${uid}-ray`;
  const pMax = `${uid}-max`;
  const pMin = `${uid}-min`;
  const recorte = `${uid}-rec`;

  return (
    <div className="flex min-h-[200px] flex-1 flex-col bg-bg-canvas">
      <div className="flex h-[32px] shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap border-b border-border-sub px-3 text-[11px] text-text-secondary">
        <span className="flex items-baseline gap-2">
          <b className="font-mono text-[12px] font-semibold text-text-primary">{v.id}</b>
          <span className="font-mono text-[12px] text-text-primary">{v.esfuerzo}</span>
          <span>{que}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <svg width={18} height={10} aria-hidden>
            <rect x={0} y={3} width={18} height={7} fill="var(--color-env-max-f)" />
            <line x1={0} x2={18} y1={3} y2={3} stroke="var(--color-env-max)" strokeWidth={2} />
          </svg>
          máxima
        </span>
        <span className="flex items-center gap-1.5">
          <svg width={18} height={10} aria-hidden>
            <rect x={0} y={0} width={18} height={7} fill="var(--color-env-min-f)" />
            <line x1={0} x2={18} y1={7} y2={7} stroke="var(--color-env-min)" strokeWidth={2} />
          </svg>
          mínima
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-[10px] w-[18px] rounded-[2px] border border-border-main" style={{ background: "repeating-linear-gradient(135deg, var(--color-text-muted) 0 1px, transparent 1px 4px)", opacity: 0.7 }} />
          {rotuloApoyo}
        </span>
        <span className="text-text-muted">{signo}</span>
        <span className="ml-auto flex items-baseline gap-3 font-mono" title={deVanos ? "Los extremos de los vanos, de cara a cara de sus apoyos" : "Los extremos de la envolvente a lo largo de la pieza"}>
          {verMax && <span>
            máx. <b className="font-semibold" style={{ color: "var(--color-env-max)" }}>{fmt(maxG, 2)}</b>
          </span>}
          {verMin && <span>
            mín. <b className="font-semibold" style={{ color: "var(--color-env-min)" }}>{fmt(minG, 2)}</b>
          </span>}
          <span className="text-text-muted">{unidad}</span>
        </span>
      </div>
      <div ref={caja} className="relative min-h-0 flex-1">
        {/* C-19: el clic es un atajo; con el teclado, la estación es el deslizador de debajo («s =») */}
        <svg
          className="absolute inset-0 select-none"
          width={w}
          height={h}
          role="img"
          aria-label={`Envolvente de ${v.esfuerzo} de ${v.id}`}
          style={{ cursor: "col-resize", touchAction: "none" }}
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            arrastrando.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            onS(aS(e.clientX - r.left));
          }}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - r.left;
            setHx(px >= ml && px <= w - mr ? px : null);
            if (arrastrando.current) onS(aS(px));
          }}
          onPointerUp={(e) => {
            arrastrando.current = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerLeave={() => setHx(null)}
        >
          <defs>
            <pattern id={pRayado} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} x2={0} y1={0} y2={6} stroke="var(--color-text-muted)" strokeWidth={1} opacity={0.45} />
            </pattern>
            <pattern id={pMax} width={5} height={10} patternUnits="userSpaceOnUse">
              <line x1={0.5} x2={0.5} y1={0} y2={10} stroke="var(--color-env-max)" strokeWidth={1} opacity={0.35} />
            </pattern>
            <pattern id={pMin} width={5} height={10} patternUnits="userSpaceOnUse">
              <line x1={0.5} x2={0.5} y1={0} y2={10} stroke="var(--color-env-min)" strokeWidth={1} opacity={0.35} />
            </pattern>
            <clipPath id={recorte}>
              <rect x={ml} y={mt} width={pw} height={ph} />
            </clipPath>
          </defs>

          {/* El fondo del área de dibujo y la rejilla */}
          <rect x={ml} y={mt} width={pw} height={ph} fill="var(--color-bg-primary)" stroke="var(--color-border-sub)" />
          {marcasY.map((t) => (
            <g key={`y${t}`}>
              {Math.abs(t) > 1e-12 && <line x1={ml} x2={w - mr} y1={Y(t)} y2={Y(t)} stroke="var(--color-border-sub)" />}
              <line x1={ml - 4} x2={ml} y1={Y(t)} y2={Y(t)} stroke="var(--color-text-muted)" />
              <text x={ml - 7} y={Y(t) + 3.5} fontSize={10} textAnchor="end" fill="var(--color-text-muted)" fontFamily="var(--font-mono)">
                {vacio ? (t === 0 ? "0" : "") : fmt(t, decY)}
              </text>
            </g>
          ))}
          {marcasX.map((t) => (
            <g key={`x${t}`}>
              <line x1={X(t)} x2={X(t)} y1={mt} y2={mt + ph} stroke="var(--color-border-sub)" strokeDasharray="2 3" />
              <line x1={X(t)} x2={X(t)} y1={mt + ph} y2={mt + ph + 4} stroke="var(--color-text-muted)" />
              <text x={X(t)} y={mt + ph + 14} fontSize={10} textAnchor="middle" fill="var(--color-text-muted)" fontFamily="var(--font-mono)">
                {fmt(t, decX)}
              </text>
            </g>
          ))}
          <text x={ml - 7} y={mt - 10} fontSize={10} textAnchor="end" fill="var(--color-text-secondary)" fontFamily="var(--font-mono)">
            {unidad}
          </text>
          <text x={ml - 7} y={mt + ph + 14} fontSize={10} textAnchor="end" fill="var(--color-text-secondary)" fontFamily="var(--font-mono)">
            {caption}
          </text>

          {/* Los apoyos (su ancho a lo largo de la pieza) y las zonas rígidas */}
          <g clipPath={`url(#${recorte})`}>
            {v.apoyos.map((a, i) => (
              <g key={`a${i}`}>
                <rect x={X(a.caras[0])} y={mt} width={Math.max(1, X(a.caras[1]) - X(a.caras[0]))} height={ph} fill="var(--color-bg-elevated)" />
                <line x1={X(a.caras[0])} x2={X(a.caras[0])} y1={mt} y2={mt + ph} stroke="var(--color-border-main)" />
                <line x1={X(a.caras[1])} x2={X(a.caras[1])} y1={mt} y2={mt + ph} stroke="var(--color-border-main)" />
              </g>
            ))}
            {rigidas.map(([a, b], i) => (
              <rect key={`r${i}`} x={X(a)} y={mt} width={Math.max(1, X(b) - X(a))} height={ph} fill={`url(#${pRayado})`} />
            ))}
          </g>

          {/* La envolvente: la máxima donde es positiva y la mínima donde es negativa, como en la planta */}
          <path d={relleno("max")} fill="var(--color-env-max-f)" />
          <path d={relleno("max")} fill={`url(#${pMax})`} />
          <path d={relleno("min")} fill="var(--color-env-min-f)" />
          <path d={relleno("min")} fill={`url(#${pMin})`} />
          <line x1={ml} x2={w - mr} y1={y0} y2={y0} stroke="var(--color-text-secondary)" strokeWidth={1.2} />
          <path d={linea("max")} fill="none" stroke="var(--color-env-max)" strokeWidth={1.8} strokeLinejoin="round" />
          <path d={linea("min")} fill="none" stroke="var(--color-env-min)" strokeWidth={1.8} strokeLinejoin="round" />

          {/* Las plantas de un pilar o los extremos de una barra */}
          {(v.plantas ?? []).map((p) => (
            <line key={`p${p.planta}${p.s}`} x1={X(p.s)} x2={X(p.s)} y1={mt} y2={mt + ph} stroke="var(--color-text-muted)" strokeDasharray="5 3" opacity={0.7} />
          ))}

          {/* Los nombres de los apoyos y de las plantas, bajo el eje */}
          {[...v.apoyos.map((a) => ({ s: a.s, t: a.objeto })), ...(v.plantas ?? []).map((p) => ({ s: p.s, t: p.planta }))].map((x, i) => {
            const ancho = x.t.length * 11 * CAR + 10;
            const cx = Math.min(w - ancho / 2 - 2, Math.max(ancho / 2 + 2, X(x.s)));
            return (
              <g key={`n${i}`}>
                <path d={`M${X(x.s)} ${mt + ph + 1}l-4 6h8z`} fill="var(--color-text-secondary)" />
                <rect x={cx - ancho / 2} y={mt + ph + 19} width={ancho} height={16} rx={3} fill="var(--color-bg-elevated)" stroke="var(--color-border-sub)" />
                <text x={cx} y={mt + ph + 31} fontSize={11} fontWeight={600} textAnchor="middle" fill="var(--color-text-secondary)" fontFamily="var(--font-mono)">
                  {x.t}
                </text>
              </g>
            );
          })}

          {/* Las cotas de los vanos (o de los tramos) */}
          {cotas.map((c, i) => {
            const xa = X(c.a);
            const xb = X(c.b);
            const yc = mt - 14;
            const largo = c.texto.length * 10.5 * CAR + 12;
            const corto = c.corto.length * 10.5 * CAR + 12;
            const t = xb - xa > largo + 10 ? c.texto : xb - xa > corto + 6 ? c.corto : null;
            return (
              <g key={`c${i}`}>
                <line x1={xa} x2={xb} y1={yc} y2={yc} stroke="var(--color-text-muted)" />
                <line x1={xa} x2={xa} y1={yc - 4} y2={yc + 4} stroke="var(--color-text-muted)" />
                <line x1={xb} x2={xb} y1={yc - 4} y2={yc + 4} stroke="var(--color-text-muted)" />
                <line x1={xa} x2={xa} y1={yc + 4} y2={mt} stroke="var(--color-border-main)" strokeDasharray="1 2" />
                <line x1={xb} x2={xb} y1={yc + 4} y2={mt} stroke="var(--color-border-main)" strokeDasharray="1 2" />
                {t && (
                  <>
                    <rect x={(xa + xb) / 2 - (t.length * 10.5 * CAR + 12) / 2} y={yc - 8} width={t.length * 10.5 * CAR + 12} height={15} fill="var(--color-bg-canvas)" />
                    <text x={(xa + xb) / 2} y={yc + 3.5} fontSize={10.5} textAnchor="middle" fill="var(--color-text-secondary)" fontFamily="var(--font-mono)">
                      {t}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Los picos con su valor y su combinación */}
          {rotulos.map(({ p, cx, top, ancho, conComb }, i) => {
            const color = p.v >= 0 ? "var(--color-env-max)" : "var(--color-env-min)";
            const px = X(p.s);
            const py = Y(p.v);
            const yUnion = top > py ? top : top + (conComb ? 29 : 17);
            return (
              <g key={`k${i}`}>
                <line x1={px} x2={cx} y1={py} y2={yUnion} stroke={color} strokeWidth={0.8} opacity={0.6} />
                <rect x={cx - ancho / 2} y={top} width={ancho} height={conComb ? 29 : 17} rx={3} fill="var(--color-bg-primary)" stroke={color} strokeOpacity={0.45} />
                <text x={cx} y={top + 12.5} fontSize={12} fontWeight={600} textAnchor="middle" fill={color} fontFamily="var(--font-mono)">
                  {valor(p.v)}
                </text>
                {conComb && (
                  <text x={cx} y={top + 24.5} fontSize={10} textAnchor="middle" fill="var(--color-text-muted)" fontFamily="var(--font-mono)">
                    {p.comb}
                  </text>
                )}
                <circle cx={px} cy={py} r={3.2} fill="var(--color-bg-primary)" stroke={color} strokeWidth={1.6} />
              </g>
            );
          })}

          {/* El cursor del ratón (sólo la posición) */}
          {hx !== null && Math.abs(hx - xs) > 3 && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={mt} y2={mt + ph} stroke="var(--color-text-muted)" strokeDasharray="2 2" opacity={0.7} />
              <rect x={hx - 26} y={mt + ph + 2} width={52} height={14} rx={3} fill="var(--color-text-secondary)" />
              <text x={hx} y={mt + ph + 12.5} fontSize={10} textAnchor="middle" fill="var(--color-bg-primary)" fontFamily="var(--font-mono)">
                {fmt(aS(hx), 2)}
              </text>
            </g>
          )}

          {/* La estación, con su lectura */}
          <g pointerEvents="none">
            <line x1={xs} x2={xs} y1={mt} y2={mt + ph} stroke="var(--color-accent)" strokeWidth={1.4} />
            <path d={`M${xs - 5} ${mt}h10l-5 6z`} fill="var(--color-accent)" />
            {lado && alDia && (
              <>
                <circle cx={xEst} cy={Y(lado.max.v)} r={3.6} fill="var(--color-env-max)" stroke="var(--color-bg-primary)" strokeWidth={1.5} />
                <circle cx={xEst} cy={Y(lado.min.v)} r={3.6} fill="var(--color-env-min)" stroke="var(--color-bg-primary)" strokeWidth={1.5} />
              </>
            )}
            <g opacity={alDia ? 1 : 0.55}>
              <rect x={xLectura} y={mt + 6} width={anchoLectura} height={altoLectura} rx={5} fill="var(--color-bg-primary)" stroke="var(--color-border-main)" style={{ filter: "drop-shadow(0 1px 3px rgb(0 0 0 / 0.12))" }} />
              {(() => {
                let y = mt + 10;
                return lineasLectura.map((l, i) => {
                  y += l.chico ? 13 : 15;
                  return (
                    <text key={i} x={xLectura + 9} y={y - 3} fontSize={l.chico ? 10 : 11.5} fontWeight={l.peso ?? 400} fill={l.color ?? (l.chico ? "var(--color-text-muted)" : "var(--color-text-primary)")} fontFamily="var(--font-mono)">
                      {l.texto}
                    </text>
                  );
                });
              })()}
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
