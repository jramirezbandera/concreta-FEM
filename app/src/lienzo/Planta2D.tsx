/**
 * Lienzo de una planta: dibuja la escena preparada de la sesión (la de A4) con zoom y encuadre.
 *
 * La geometría va en un grupo con la transformación del modelo a la pantalla (los trazos no escalan:
 * `non-scaling-stroke`), así que encuadrar sólo cambia un atributo. Los glifos y los rótulos tienen
 * tamaño en píxeles y se recolocan en cada encuadre. Un clic sin arrastre elige: se manda el punto
 * (m) y el radio de 6 px en m, y la sesión dice qué objeto hay.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { rotulo, type Vec2 } from "../../../src/agente/render/escena.ts";
import type { Eleccion, EscenaPreparada, Glifo } from "../../../src/visor/escena.ts";
import { useTheme } from "../tema/useTheme.ts";
import { atributos, pintura } from "./pintura.ts";
import { colocarRotulos } from "./rotulos.ts";
import { IDENTITY_VIEW, makeTransform, uniformInsets, withView, type CanvasView2D } from "./transform.ts";
import { useCanvasView2D } from "./useCanvasView2D.ts";
import { ZoomControls } from "./ZoomControls.tsx";

export interface MarcaExtra {
  p: Vec2;
  texto?: string;
}

interface Props {
  escena: EscenaPreparada | null;
  resaltado?: Eleccion | null;
  marcas?: MarcaExtra[];
  onClic?: (p: Vec2, radio: number) => void;
  /** Algo que encima del lienzo dice por qué no hay dibujo o que está cambiando. */
  aviso?: ReactNode;
  /** La leyenda y las notas de la escena, en la esquina. */
  leyenda?: boolean;
  /** Etiqueta accesible del dibujo. */
  titulo: string;
}

/** Radio de elección, px. */
const RADIO_CLIC = 6;
const MARGEN = 24;

function GlifoSvg({ g, x, y, tema }: { g: Glifo; x: number; y: number; tema: "light" | "dark" }) {
  const p = pintura(g.estilo, tema);
  const a = atributos(p);
  if (g.tipo === "marca") {
    const r = g.radio;
    if (g.forma === "circulo") return <circle cx={x} cy={y} r={r} {...a} />;
    if (g.forma === "cuadrado") return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} {...a} />;
    return <path d={`M${x} ${y - r}L${x + r} ${y + r * 0.8}L${x - r} ${y + r * 0.8}Z`} {...a} />;
  }
  if (g.d) {
    const l = Math.hypot(g.d[0], g.d[1]) || 1;
    const [ux, uy] = [g.d[0] / l, -g.d[1] / l];
    const [ex, ey] = [x + ux * 30, y + uy * 30];
    const [nx, ny] = [-uy, ux];
    return <path d={`M${x} ${y}L${ex} ${ey}M${ex - ux * 8 + nx * 5} ${ey - uy * 8 + ny * 5}L${ex} ${ey}L${ex - ux * 8 - nx * 5} ${ey - uy * 8 - ny * 5}`} {...atributos({ ...p, fill: undefined })} />;
  }
  return (
    <g>
      <circle cx={x} cy={y} r={7} fill="var(--color-bg-canvas)" stroke={p.stroke} strokeWidth={2} />
      {g.abajo === false ? <path d={`M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x + 5} ${y - 5}L${x - 5} ${y + 5}`} stroke={p.stroke} strokeWidth={2} /> : <circle cx={x} cy={y} r={2.6} fill={p.stroke} />}
    </g>
  );
}

export function Planta2D({ escena, resaltado, marcas, onClic, aviso, leyenda = true, titulo }: Props) {
  const { theme: tema } = useTheme();
  const caja = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tam, setTam] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<CanvasView2D>(IDENTITY_VIEW);
  // Las coordenadas del cursor se escriben en el DOM: un render por movimiento recolocaría los rótulos
  const pista = useRef<HTMLSpanElement>(null);
  const [verLeyenda, setVerLeyenda] = useState(true);

  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e!.contentRect;
      setTam({ w: Math.max(40, Math.round(r.width)), h: Math.max(40, Math.round(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Otra caja (otra planta): vuelta al encuadre completo
  const claveCaja = escena ? escena.caja.join(",") : "";
  const [cajaVista, setCajaVista] = useState(claveCaja);
  if (claveCaja !== cajaVista) {
    setCajaVista(claveCaja);
    setView(IDENTITY_VIEW);
  }

  const base = useMemo(() => {
    const [x0, y0, x1, y1] = escena?.caja ?? [0, 0, 10, 10];
    const insetDerecho = leyenda && verLeyenda && escena?.leyenda.length ? 216 : 0;
    return makeTransform(
      [
        { x: x0, y: y0 },
        { x: x1, y: y1 },
      ],
      tam.w,
      tam.h,
      { ...uniformInsets(MARGEN), right: MARGEN + insetDerecho },
    );
  }, [escena?.caja, tam.w, tam.h, leyenda, verLeyenda, escena?.leyenda.length]);

  const bounds = useMemo(() => {
    const [x0, y0, x1, y1] = escena?.caja ?? [0, 0, 10, 10];
    return { minX: base.sx(x0), maxX: base.sx(x1), minY: base.sy(y1), maxY: base.sy(y0) };
  }, [base, escena?.caja]);

  const api = useCanvasView2D({ svgRef, view, setView, bounds, width: tam.w, height: tam.h, enabled: !!escena, panIzquierdo: true });
  const t = withView(base, view);
  const px = (q: Vec2): [number, number] => [t.sx(q[0]), t.sy(q[1])];
  const matriz = `matrix(${t.scale} 0 0 ${-t.scale} ${t.sx(0)} ${t.sy(0)})`;

  const rotulos = useMemo(() => {
    if (!escena) return { puestos: [], omitidos: 0 };
    const tv = withView(base, view);
    return colocarRotulos(escena.textos, (q) => [tv.sx(q[0]), tv.sy(q[1])], tam.w, tam.h);
  }, [escena, base, view, tam.w, tam.h]);
  const AYUDA = "arrastrar: encuadrar · rueda: zoom · clic: elegir";

  const alPuntero = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const q = t.invert(e.clientX - r.left, e.clientY - r.top);
    if (pista.current) pista.current.textContent = `x ${rotulo(q.x, 4)} · y ${rotulo(q.y, 4)} m`;
  };
  const alClic = (e: React.MouseEvent) => {
    if (!onClic || api.acabaDeArrastrar()) return;
    const r = svgRef.current!.getBoundingClientRect();
    const q = t.invert(e.clientX - r.left, e.clientY - r.top);
    onClic([q.x, q.y], RADIO_CLIC / t.scale);
  };

  return (
    <div ref={caja} className="lienzo canvas-dot-grid" style={{ background: "var(--color-bg-canvas)" }}>
      <svg ref={svgRef} role="img" aria-label={titulo} onPointerMove={alPuntero} onPointerLeave={() => {
          if (pista.current) pista.current.textContent = AYUDA;
        }} onClick={alClic} style={{ cursor: api.isPanning() ? "grabbing" : onClic ? "crosshair" : "grab" }}>
        {escena && (
          <>
            <g transform={matriz}>
              {escena.capas.map((c, i) => {
                const p = pintura(c.estilo, tema);
                if (c.forma === "region") return <path key={i} d={c.d} fill={c.relleno} stroke={c.relleno} strokeWidth={0.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />;
                const a = atributos(c.forma === "trazo" ? { ...p, fill: undefined } : p, c.forma === "trazo" ? undefined : c.relleno);
                return <path key={i} d={c.d} fillRule="evenodd" strokeLinecap="round" vectorEffect="non-scaling-stroke" {...a} />;
              })}
              {resaltado && (
                <>
                  {resaltado.areas && <path d={resaltado.areas} fillRule="evenodd" fill="var(--color-accent)" fillOpacity={0.25} stroke="var(--color-accent)" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
                  {resaltado.trazos && <path d={resaltado.trazos} fill="none" stroke="var(--color-accent)" strokeWidth={5} strokeOpacity={0.55} strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
                </>
              )}
            </g>
            {escena.glifos.map((g, i) => {
              const [x, y] = px(g.p);
              return <GlifoSvg key={i} g={g} x={x} y={y} tema={tema} />;
            })}
            {resaltado?.puntos.map((q, i) => {
              const [x, y] = px(q);
              return <circle key={`r${i}`} cx={x} cy={y} r={10} fill="none" stroke="var(--color-accent)" strokeWidth={2.5} />;
            })}
            <g fontFamily="var(--font-sans)">
              {rotulos.puestos.map((r, i) => {
                const giro = r.t.giro ? `rotate(${-r.t.giro} ${r.x} ${r.y})` : undefined;
                return (
                  <g key={i} transform={giro}>
                    {r.fondo && <rect x={r.fondo[0]} y={r.fondo[1]} width={r.fondo[2]} height={r.fondo[3]} fill="var(--color-bg-canvas)" fillOpacity={0.85} />}
                    <text x={r.x} y={r.y} fontSize={r.tam} fontWeight={r.t.negrita ? 600 : 400} textAnchor={r.ancla === "inicio" ? "start" : r.ancla === "medio" ? "middle" : "end"} fill={r.t.color ?? "var(--color-text-primary)"} className="halo">
                      {r.t.texto}
                    </text>
                  </g>
                );
              })}
            </g>
            {marcas?.map((m, i) => {
              const [x, y] = px(m.p);
              return (
                <g key={`m${i}`}>
                  <circle cx={x} cy={y} r={5} fill="var(--color-accent)" stroke="var(--color-bg-canvas)" strokeWidth={2} />
                  {m.texto && (
                    <text x={x + 9} y={y - 8} fontSize={12} fontWeight={600} fontFamily="var(--font-mono)" fill="var(--color-accent)" className="halo">
                      {m.texto}
                    </text>
                  )}
                </g>
              );
            })}
          </>
        )}
      </svg>

      {escena && leyenda && escena.leyenda.length > 0 && (
        <div className="absolute right-3 top-3 z-10 max-h-[calc(100%-24px)] w-[188px] overflow-y-auto rounded-md border border-border-main bg-bg-primary/95 text-[11px] scroll-hide">
          <button type="button" className="flex w-full items-center justify-between px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled" onClick={() => setVerLeyenda((v) => !v)} aria-expanded={verLeyenda}>
            Leyenda <span aria-hidden="true">{verLeyenda ? "−" : "+"}</span>
          </button>
          {verLeyenda && (
            <div className="px-2.5 pb-2">
              {escena.leyenda.map((l, i) => {
                const p = l.estilo ? pintura(l.estilo, tema) : {};
                return (
                  <div key={i} className="flex items-start gap-2 py-[2px] text-text-secondary">
                    <svg width={18} height={12} className="mt-[1px] shrink-0" aria-hidden="true">
                      {l.relleno || p.fill ? <rect x={0.5} y={0.5} width={17} height={11} {...atributos({ ...p, sw: Math.min(p.sw ?? 1, 1.5) }, l.relleno)} /> : <path d="M0 6h18" {...atributos(p)} />}
                    </svg>
                    <span className={l.relleno ? "mono" : undefined}>{l.texto}</span>
                  </div>
                );
              })}
              {escena.notas.length > 0 && (
                <div className="mt-2 border-t border-border-sub pt-1.5 text-[10.5px] leading-snug text-text-disabled">
                  {escena.notas.map((n, i) => (
                    <p key={i} className="mt-1">
                      {n}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded border border-border-main bg-bg-primary/95 px-2 py-0.5 font-mono text-[11px] text-text-secondary">
        <span ref={pista}>{AYUDA}</span>
        {rotulos.omitidos > 0 ? ` · ${rotulos.omitidos} rótulos no caben` : ""}
      </div>

      <ZoomControls k={view.k} onZoomIn={api.zoomIn} onZoomOut={api.zoomOut} onReset={api.reset} disabled={!escena} />

      {aviso && <div className="velo">{aviso}</div>}
    </div>
  );
}
