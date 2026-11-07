/**
 * «Situación», en el navegador de Modelo y Cargas: dónde está lo que se ve. A la izquierda, el alzado
 * esquemático del edificio (las plantas a escala, como en el gestor de plantas); a la derecha, la
 * planta esquemática (los ejes de replanteo, los pilares y los contornos de los forjados). Lo que
 * enseña la vista activa va resaltado: su planta en el alzado (y sus forjados en la planta) o, en un
 * alzado, su eje en la planta, con las flechas de corte hacia donde se mira. Lo de las otras vistas
 * abiertas, más tenue.
 *
 * Es también un navegador: un clic en una planta la enseña en planta y uno en un eje enseña su
 * alzado, en la vista activa si es de ese tipo o, si no, en otra abierta que lo sea (como «Planta» y
 * «Alzado» de la barra), y si no hay ninguna, la vista activa pasa a serlo.
 */
import type { KeyboardEvent } from "react";
import type { Vec2 } from "../../../src/compilador/fisico.ts";
import { useVisor } from "../contexto.ts";
import { Seccion } from "../componentes/comunes.tsx";
import { cota, fmt } from "../fmt.ts";
import { useVistas, vistasDe, type EstadoVista, type TipoVista } from "../vistas/estado.ts";
import { ejePorDefecto } from "../vistas/Zona.tsx";

type Eje = { id: string; nombre?: string; desde: Vec2; hasta: Vec2 };

/** Lo que enseña cada vista abierta, resuelto como en `CeldaVista` (planta y eje por defecto). */
function vistasResueltas(vistas: readonly EstadoVista[], n: number, plantas: readonly { id: string }[], ejes: readonly Eje[]) {
  return vistas.slice(0, n).map((v, i) => ({
    tipo: v.tipo,
    planta: plantas.some((p) => p.id === v.planta) ? v.planta! : v.tipo === "3d" ? null : (plantas[0]?.id ?? null),
    eje: ejes.some((x) => x.id === v.eje) ? v.eje! : ejePorDefecto(ejes, vistas.slice(0, i).filter((x) => x.tipo === "alzado").length),
  }));
}

const alPulsar = (f: () => void) => ({
  role: "button" as const,
  tabIndex: 0,
  onClick: f,
  onKeyDown: (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      f();
    }
  },
});

export function Situacion() {
  const { proyecto } = useVisor();
  const vistas = useVistas();
  const e = proyecto.estado!;
  const m = proyecto.edicion?.proyecto.modelo;
  const n = vistasDe(vistas.disposicion);
  const rs = vistasResueltas(vistas.vistas, n, e.plantas, e.ejes);
  const act = rs[vistas.activa] ?? rs[0]!;

  /** Enseña algo en la vista activa si es de su tipo, en otra abierta que lo sea o, si no, en la activa. */
  const ir = (tipo: Exclude<TipoVista, "3d">, cambio: Partial<EstadoVista>) => {
    let i = vistas.activa;
    if (vistas.vistas[i]!.tipo !== tipo) {
      const otra = vistas.vistas.slice(0, n).findIndex((v) => v.tipo === tipo);
      if (otra >= 0) i = otra;
    }
    vistas.poner(i, { tipo, ...cambio });
    vistas.activar(i);
  };

  const valor = act.tipo === "planta" ? `Planta ${act.planta ?? ""}` : act.tipo === "alzado" ? `Alzado ${act.eje ?? ""}` : act.planta ? `3D · ${act.planta}` : "3D";
  // Lo que enseñan las otras vistas abiertas
  const otras = rs.filter((_, i) => i !== vistas.activa);
  const plantasOtras = new Set(otras.filter((r) => r.tipo !== "alzado" && r.planta).map((r) => r.planta!));
  const ejesOtros = new Set(otras.filter((r) => r.tipo === "alzado" && r.eje).map((r) => r.eje!));
  const plantaActiva = act.tipo !== "alzado" ? act.planta : null;
  const ejeActivo = act.tipo === "alzado" ? act.eje : null;

  if (!e.plantas.length) return null;
  return (
    <Seccion titulo="Situación" valor={valor}>
      <div className="situacion">
        <AlzadoEsquema plantas={e.plantas} activa={plantaActiva} otras={plantasOtras} onPlanta={(p) => ir("planta", { planta: p })} />
        <PlantaEsquema ejes={e.ejes} modelo={m} plantaActiva={plantaActiva} enPlanta={act.tipo === "planta"} activo={ejeActivo} otros={ejesOtros} onEje={(x) => ir("alzado", { eje: x })} />
      </div>
      <p className="sit-nota">Clic: ver esa planta o el alzado de ese eje.</p>
    </Seccion>
  );
}

// ─── El alzado esquemático ──────────────────────────────────────────────────────────────────────

const WA = 92;
const X_FORJADO = [36, 88] as const;
const X_PILARES = [44, 62, 80];
const MIN_FILA = 15;
const MAX_ALTO = 150;

function AlzadoEsquema({ plantas, activa, otras, onPlanta }: { plantas: readonly { id: string; nombre?: string; cota: number | null; altura: number | null }[]; activa: string | null; otras: ReadonlySet<string>; onPlanta: (id: string) => void }) {
  const total = plantas.reduce((s, p) => s + (p.altura ?? 0), 0);
  const k = total > 0 ? Math.min(28, MAX_ALTO / total) : 28;
  const ys: number[] = [];
  // La altura de una planta es la del tramo de debajo: la fila va de su forjado al de la siguiente
  plantas.forEach((_, i) => ys.push(i === 0 ? 9 : ys[i - 1]! + Math.max(MIN_FILA, (plantas[i - 1]!.altura ?? 0) * k)));
  const ultima = plantas.length - 1;
  const alto = ys[ultima]! + 12;
  return (
    <svg className="sit-alzado" viewBox={`0 0 ${WA} ${alto}`} width={WA} height={alto} role="group" aria-label="Alzado esquemático: las plantas">
      {plantas.map((p, i) => {
        const y = ys[i]!;
        const abajo = i < ultima ? ys[i + 1]! : null;
        const id = p.id.length > 6 ? `${p.id.slice(0, 5)}…` : p.id;
        return (
          <g key={p.id} className="sit-nivel" data-activa={p.id === activa || undefined} data-otra={(p.id !== activa && otras.has(p.id)) || undefined} aria-label={`Ver la planta ${p.id}`} aria-pressed={p.id === activa} {...alPulsar(() => onPlanta(p.id))}>
            <title>{`${p.id}${p.nombre ? ` · ${p.nombre}` : ""} · cota ${cota(p.cota)}${p.altura ? ` · ${fmt(p.altura, 2)} m` : ""}`}</title>
            <rect className="sit-banda" x={0} y={y - 6.5} width={WA} height={13} rx={3} />
            {abajo !== null && X_PILARES.map((x) => <rect key={x} className="sit-pilar" x={x - 1.25} y={y + 2.5} width={2.5} height={Math.max(0, abajo - y - 5)} />)}
            {i === ultima ? (
              <rect className="sit-forjado sit-cim" x={X_FORJADO[0] - 4} y={y - 2.5} width={X_FORJADO[1] - X_FORJADO[0] + 8} height={5} rx={1} />
            ) : (
              <rect className="sit-forjado" x={X_FORJADO[0]} y={y - 1.75} width={X_FORJADO[1] - X_FORJADO[0]} height={3.5} rx={1} />
            )}
            <text className="sit-id" x={2} y={y + 3.5}>
              {id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── La planta esquemática ──────────────────────────────────────────────────────────────────────

const WP = 132;
const MAX_ALTO_PLANTA = 150;
const PAD = 13;
const R_BURBUJA = 5.5;

interface ModeloEsquema {
  pilares?: readonly { id: string; x: number; y: number }[];
  losas?: readonly { planta: string; contorno: readonly Vec2[] }[];
  panos?: readonly { planta: string; contorno: readonly Vec2[] }[];
}

function PlantaEsquema({ ejes, modelo, plantaActiva, enPlanta, activo, otros, onEje }: { ejes: readonly Eje[]; modelo: ModeloEsquema | undefined; plantaActiva: string | null; enPlanta: boolean; activo: string | null; otros: ReadonlySet<string>; onEje: (id: string) => void }) {
  const forjados = [...(modelo?.losas ?? []), ...(modelo?.panos ?? [])].filter((f) => f.contorno.length >= 3);
  const pilares = modelo?.pilares ?? [];
  const pts: Vec2[] = [...ejes.flatMap((x) => [x.desde, x.hasta]), ...pilares.map((p) => [p.x, p.y] as Vec2), ...forjados.flatMap((f) => f.contorno)];
  if (!pts.length) return <p className="sit-vacia">Sin ejes ni piezas aún: la planta esquemática sale al dibujarlos.</p>;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const bw = Math.max(x1 - x0, 1e-6);
  const bh = Math.max(y1 - y0, 1e-6);
  const k = Math.min((WP - 2 * PAD) / bw, (MAX_ALTO_PLANTA - 2 * PAD) / bh);
  const alto = Math.max(bh * k + 2 * PAD, 48);
  // Centrado en lo que sobra
  const ox = (WP - bw * k) / 2;
  const oy = (alto - bh * k) / 2;
  const px = (p: Vec2): [number, number] => [ox + (p[0] - x0) * k, alto - oy - (p[1] - y0) * k];
  const camino = (c: readonly Vec2[]) => `M${c.map((p) => px(p).map((v) => v.toFixed(1)).join(" ")).join("L")}Z`;
  // Los ejes del alzado activo, encima
  const orden = [...ejes].sort((a, b) => Number(a.id === activo) - Number(b.id === activo));
  // Las burbujas, antes del primer punto o, si pisa otra, después del último; si también, sin burbuja
  // (el eje sigue con su nombre al pasar el ratón). La del eje activo, la primera.
  const burbujas = new Map<string, [number, number]>();
  for (const x of [...orden].reverse()) {
    const [a, b] = [px(x.desde), px(x.hasta)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const [ux, uy] = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const d = R_BURBUJA + 2;
    const libre = (c: [number, number]) => [...burbujas.values()].every((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) >= 2 * R_BURBUJA + 0.5);
    const c = ([[a[0] - ux * d, a[1] - uy * d], [b[0] + ux * d, b[1] + uy * d]] as [number, number][]).find(libre);
    if (c) burbujas.set(x.id, c);
  }
  return (
    <svg className="sit-planta" viewBox={`0 0 ${WP} ${alto}`} width={WP} height={alto} role="group" aria-label="Planta esquemática: los ejes">
      {forjados.map((f, i) => (
        <path key={i} className="sit-losa" data-activa={(enPlanta && f.planta === plantaActiva) || undefined} d={camino(f.contorno)} />
      ))}
      {pilares.map((p) => {
        const [x, y] = px([p.x, p.y]);
        return <rect key={p.id} className="sit-pil" x={x - 1.75} y={y - 1.75} width={3.5} height={3.5} />;
      })}
      {orden.map((x) => {
        const [a, b] = [px(x.desde), px(x.hasta)];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const [ux, uy] = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
        const c = burbujas.get(x.id);
        // Hacia donde se mira en el alzado (u de desde a hasta, a la derecha de la pantalla): en planta,
        // a la izquierda de la directriz; en el SVG (y hacia abajo), (uy, −ux)
        const [nx, ny] = [uy, -ux];
        const es = x.id === activo;
        const nombre = x.nombre ?? x.id;
        return (
          <g key={x.id} className="sit-eje" data-activo={es || undefined} data-otro={(!es && otros.has(x.id)) || undefined} aria-label={`Ver el alzado del eje ${nombre}`} aria-pressed={es} {...alPulsar(() => onEje(x.id))}>
            <title>{`Alzado del eje ${nombre}`}</title>
            <line className="sit-eje-toque" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
            <line className="sit-eje-linea" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
            {es &&
              [a, b].map(([qx, qy], j) => {
                // Las flechas de corte: de cada extremo, hacia donde se mira
                const [tx, ty] = [qx + nx * 8, qy + ny * 8];
                const [bx, by] = [qx + nx * 4.5, qy + ny * 4.5];
                const f = (v: number) => v.toFixed(1);
                return <path key={j} className="sit-corte" d={`M${f(qx)} ${f(qy)}L${f(tx)} ${f(ty)}M${f(tx)} ${f(ty)}L${f(bx + ux * 2.6)} ${f(by + uy * 2.6)}L${f(bx - ux * 2.6)} ${f(by - uy * 2.6)}Z`} />;
              })}
            {c && <circle className="sit-burbuja" cx={c[0]} cy={c[1]} r={R_BURBUJA} />}
            {c && (
              <text className="sit-burbuja-txt" x={c[0]} y={c[1] + 2.6}>
                {nombre.length > 2 ? nombre.slice(0, 2) : nombre}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
