/**
 * El croquis de un forjado en Propiedades: su planta (contorno, huecos, ábacos y la dirección, con
 * la retícula de nervios o las viguetas a su intereje) y su sección a escala, con cada cota rotulada
 * con el nombre de su campo. Sigue a lo que se escribe (`croquisForjado`, de la fila tal cual), el
 * campo con el foco o bajo el ratón se resalta en el dibujo y un clic en una cota lleva a su campo.
 * Lo que falta se dice en el sitio de su cota.
 */
import { useId } from "react";
import type { Seccion, Vec2 } from "../../../src/compilador/fisico.ts";
import type { CroquisForjado } from "../../../src/editor/ficha.ts";
import { describirSeccion } from "../../../src/editor/gestores.ts";
import { fmt } from "../fmt.ts";

/** m → cm, con un decimal si lo tiene («72», «12,5»). */
const cm = (v: number) => String(Math.round(v * 1000) / 10).replace(".", ",");

interface Props {
  c: CroquisForjado;
  /** El campo resaltado (con el foco o bajo el ratón). */
  activo: string | null;
  /** Lleva al campo `clave`. */
  onCampo: (clave: string) => void;
}

/** Atributos de una parte del dibujo que lleva a su campo. */
const parte = (clave: string, { activo, onCampo }: Pick<Props, "activo" | "onCampo">) => ({
  "data-activo": activo === clave || undefined,
  "data-campo": clave,
  onClick: () => onCampo(clave),
  onMouseDown: (e: { preventDefault(): void }) => e.preventDefault(),
});

// ─── Planta ─────────────────────────────────────────────────────────────────────────────────────

const W = 262;
const H = 150;
const M = 14;

const NOMBRE_DIRECCION = { maciza: "eje 1", reticular: "nervios", unidireccional: "viguetas" } as const;

export function PlantaForjado({ c, activo, onCampo }: Props) {
  const id = useId().replace(/:/g, "");
  if (!c.contorno || !c.caja) {
    return (
      <div className="croquis croquis-vacio">
        <span>
          Sin contorno que dibujar. Escríbalo («x y; x y; …») o dibújelo con la herramienta <b>Forjado</b>.
        </span>
      </div>
    );
  }
  // La caja con los ábacos, que pueden salirse del contorno
  const todos = [c.contorno, ...c.abacos].flat();
  const [x0, y0, x1, y1] = [Math.min(...todos.map((p) => p[0])), Math.min(...todos.map((p) => p[1])), Math.max(...todos.map((p) => p[0])), Math.max(...todos.map((p) => p[1]))];
  const [ax0, ay0, ax1, ay1] = c.caja;
  const k = Math.min((W - 2 * M) / Math.max(x1 - x0, 1e-9), (H - 2 * M) / Math.max(y1 - y0, 1e-9));
  const dx = (W - (x1 - x0) * k) / 2;
  const dy = (H - (y1 - y0) * k) / 2;
  const P = ([x, y]: Vec2): [number, number] => [dx + (x - x0) * k, H - dy - (y - y0) * k];
  const d = (p: readonly Vec2[]) => `M${p.map((q) => P(q).map((v) => v.toFixed(1)).join(" ")).join("L")}Z`;
  const paso = c.intereje ? c.intereje * k : 0;
  const trama = c.tipo !== "maciza" && paso >= 3;
  const a = (-c.direccion * Math.PI) / 180;
  const [cx, cy] = [W / 2, H / 2];
  const largo = 30;
  const [fx, fy] = [cx + largo * Math.cos(a), cy + largo * Math.sin(a)];
  const prop = { activo, onCampo };
  const huecos = c.huecos.length ? ` · ${c.huecos.length} hueco${c.huecos.length > 1 ? "s" : ""}` : "";
  const abacos = c.abacos.length ? ` · ${c.abacos.length} ábaco${c.abacos.length > 1 ? "s" : ""}` : "";
  return (
    <figure className="croquis">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Planta del forjado: ${c.contorno.length} vértices`}>
        <defs>
          {trama && (
            <pattern id={`t${id}`} patternUnits="userSpaceOnUse" width={paso} height={paso} patternTransform={`rotate(${-c.direccion})`}>
              <line x1={0} y1={0} x2={paso} y2={0} className="cq-trama" />
              {c.tipo === "reticular" && <line x1={0} y1={0} x2={0} y2={paso} className="cq-trama" />}
            </pattern>
          )}
        </defs>
        <path d={d(c.contorno) + c.huecos.map(d).join("")} fillRule="evenodd" className="cq-losa" />
        {trama && <path d={d(c.contorno) + c.huecos.map(d).join("")} fillRule="evenodd" fill={`url(#t${id})`} className="cq-sin-eventos" />}
        <path d={d(c.contorno)} className="cq-borde" {...parte("contorno", prop)} />
        {c.abacos.map((p, i) => (
          <path key={`a${i}`} d={d(p)} className="cq-abaco" {...parte("abacos", prop)} />
        ))}
        {c.huecos.map((p, i) => {
          const n = p.length;
          const [a0, a1, b0, b1] = [P(p[0]!), P(p[Math.floor(n / 2)]!), P(p[1]!), P(p[(Math.floor(n / 2) + 1) % n]!)];
          return (
            <g key={`h${i}`} className="cq-hueco" {...parte("huecos", prop)}>
              <path d={d(p)} />
              <line x1={a0[0]} y1={a0[1]} x2={a1[0]} y2={a1[1]} />
              {n >= 4 && <line x1={b0[0]} y1={b0[1]} x2={b1[0]} y2={b1[1]} />}
            </g>
          );
        })}
        {activo === "contorno" &&
          c.contorno.map((q, i) => {
            const [x, y] = P(q);
            return (
              <g key={`v${i}`} className="cq-vertice">
                <circle cx={x} cy={y} r={i === 0 ? 3.5 : 2.5} />
                <text x={x + 4} y={y - 4}>
                  {i + 1}
                </text>
              </g>
            );
          })}
        <g className="cq-flecha" {...parte("direccion", prop)}>
          <line x1={cx} y1={cy} x2={fx} y2={fy} />
          <path d={`M${fx} ${fy}l${(-7 * Math.cos(a - 0.4)).toFixed(2)} ${(-7 * Math.sin(a - 0.4)).toFixed(2)}M${fx} ${fy}l${(-7 * Math.cos(a + 0.4)).toFixed(2)} ${(-7 * Math.sin(a + 0.4)).toFixed(2)}`} />
          <circle cx={cx} cy={cy} r={2} />
          <text x={fx + 6 * Math.cos(a)} y={fy + 6 * Math.sin(a) + 3.5} textAnchor={Math.cos(a) < -0.3 ? "end" : Math.cos(a) > 0.3 ? "start" : "middle"}>
            {NOMBRE_DIRECCION[c.tipo]} {fmt(c.direccion, Number.isInteger(c.direccion) ? 0 : 1)}°
          </text>
        </g>
        <g className="cq-ejes" transform={`translate(8 ${H - 8})`}>
          <path d="M0 0h16M0 0v-16" />
          <text x={19} y={3}>
            X
          </text>
          <text x={-2.5} y={-19}>
            Y
          </text>
        </g>
      </svg>
      <figcaption>
        {c.contorno.length} vértices · {fmt(ax1 - ax0, 2)} × {fmt(ay1 - ay0, 2)} m · {fmt(c.area, 1)} m²{huecos}
        {abacos}
      </figcaption>
    </figure>
  );
}

// ─── Sección ────────────────────────────────────────────────────────────────────────────────────

/** Valores con que se dibuja lo que aún no está escrito (la cota dice que falta). */
const TIPICO = { canto: 0.3, intereje: 0.8, nervio: 0.12, capa: 0.05 };

/** Una cota horizontal (`y` es la línea) o vertical (`x` es la línea), con su rótulo y su campo. */
function Cota({ campo, titulo, valor, a, b, linea, vertical, lado, rotulo, prop }: { campo: string; titulo: string; valor: number | undefined; a: number; b: number; linea: number; vertical?: boolean; lado: 1 | -1; rotulo?: { x: number; y: number }; prop: Pick<Props, "activo" | "onCampo"> }) {
  const texto = valor === undefined ? `${titulo} ?` : `${titulo} ${cm(valor)}`;
  const t = 3;
  return (
    <g className="cq-cota" data-falta={valor === undefined || undefined} {...parte(campo, prop)}>
      {vertical ? (
        <>
          <line x1={linea} y1={a} x2={linea} y2={b} />
          <line x1={linea - t} y1={a} x2={linea + t} y2={a} />
          <line x1={linea - t} y1={b} x2={linea + t} y2={b} />
          {rotulo ? (
            // Fuera de la cota (una capa de pocos píxeles): el rótulo con una línea hasta ella
            <>
              <path d={`M${linea} ${(a + b) / 2}L${rotulo.x + 2} ${rotulo.y + 3}`} className="cq-guia" />
              <text x={rotulo.x} y={rotulo.y} textAnchor="end">
                {texto}
              </text>
            </>
          ) : (
            // En vertical, junto a la cota, para no salirse del dibujo
            <text x={linea + lado * 5} y={(a + b) / 2} textAnchor="middle" transform={`rotate(-90 ${linea + lado * 5} ${(a + b) / 2})`} dy={lado < 0 ? 0 : 7}>
              {texto}
            </text>
          )}
        </>
      ) : (
        <>
          <line x1={a} y1={linea} x2={b} y2={linea} />
          <line x1={a} y1={linea - t} x2={a} y2={linea + t} />
          <line x1={b} y1={linea - t} x2={b} y2={linea + t} />
          <text x={(a + b) / 2} y={linea + (lado > 0 ? 12 : -5)} textAnchor="middle">
            {texto}
          </text>
        </>
      )}
      {/* Zona de clic más ancha que la línea */}
      <rect x={vertical ? linea - 6 : Math.min(a, b)} y={vertical ? Math.min(a, b) : linea - 6} width={vertical ? 12 : Math.abs(b - a)} height={vertical ? Math.abs(b - a) : 12} className="cq-clic" />
    </g>
  );
}

const WS = 262;

export function SeccionForjado({ c, activo, onCampo }: Props) {
  const prop = { activo, onCampo };
  if (c.tipo === "maciza") {
    const h = c.canto ?? TIPICO.canto;
    const ancho = 1.2;
    const k = Math.min((WS - 50) / ancho, 60 / h);
    const [x0, y0] = [30, 16];
    return (
      <figure className="croquis">
        <svg viewBox={`0 0 ${WS} ${h * k + 32}`} width={WS} height={h * k + 32} role="img" aria-label="Sección de la losa maciza">
          <rect x={x0} y={y0} width={ancho * k} height={h * k} className="cq-hormigon" data-activo={activo === "espesor" || activo === "material" || undefined} />
          <path d={`M${x0 - 4} ${y0 - 4}l8 ${h * k + 8}M${x0 + ancho * k - 4} ${y0 - 4}l8 ${h * k + 8}`} className="cq-corte" />
          <Cota campo="espesor" titulo="canto" valor={c.canto} a={y0} b={y0 + h * k} linea={x0 - 12} vertical lado={-1} prop={prop} />
        </svg>
        <figcaption>Losa maciza{c.canto ? ` de ${cm(c.canto)} cm` : ""}: lámina de canto constante.</figcaption>
      </figure>
    );
  }
  if (c.tipo === "reticular") {
    const h = c.canto ?? TIPICO.canto;
    const s = c.intereje ?? TIPICO.intereje;
    const bw = Math.min(c.nervio ?? TIPICO.nervio, s * 0.9);
    const hf = Math.min(c.capa ?? TIPICO.capa, h * 0.9);
    const k = Math.min((WS - 46) / (2 * s), 80 / h);
    const [x0, y0] = [30, 28];
    const X = (x: number) => x0 + x * k;
    const Y = (y: number) => y0 + y * k;
    const ejes = [s / 2, (3 * s) / 2];
    const huecos: [number, number][] = [
      [0, s / 2 - bw / 2],
      [s / 2 + bw / 2, (3 * s) / 2 - bw / 2],
      [(3 * s) / 2 + bw / 2, 2 * s],
    ];
    const contorno = `M${X(0)} ${Y(0)}H${X(2 * s)}V${Y(hf)}` + [...ejes].reverse().map((e) => `H${X(e + bw / 2)}V${Y(h)}H${X(e - bw / 2)}V${Y(hf)}`).join("") + `H${X(0)}Z`;
    const altoSvg = Y(h) + 26;
    return (
      <figure className="croquis">
        <svg viewBox={`0 0 ${WS} ${altoSvg}`} width={WS} height={altoSvg} role="img" aria-label="Sección del reticular">
          {huecos.map(([a, b], i) => (
            <rect key={i} x={X(a)} y={Y(hf)} width={(b - a) * k} height={(h - hf) * k} className="cq-caseton" data-perdido={c.caseton === "perdido" || undefined} {...parte("caseton", prop)} />
          ))}
          <path d={contorno} className="cq-hormigon" data-activo={activo === "material" || undefined} />
          <rect x={X(0)} y={Y(0)} width={2 * s * k} height={hf * k} className="cq-zona" data-activo={activo === "capa" || undefined} />
          {ejes.map((e) => (
            <rect key={e} x={X(e - bw / 2)} y={Y(hf)} width={bw * k} height={(h - hf) * k} className="cq-zona" data-activo={activo === "nervio" || undefined} />
          ))}
          {ejes.map((e) => (
            <line key={e} x1={X(e)} y1={Y(0) - 16} x2={X(e)} y2={Y(h) + 4} className="cq-eje" />
          ))}
          <path d={`M${X(0) - 4} ${Y(0) - 3}l8 ${hf * k + 6}M${X(2 * s) - 4} ${Y(0) - 3}l8 ${hf * k + 6}`} className="cq-corte" />
          <Cota campo="intereje" titulo="intereje" valor={c.intereje} a={X(ejes[0]!)} b={X(ejes[1]!)} linea={Y(0) - 10} lado={-1} prop={prop} />
          <Cota campo="espesor" titulo="canto" valor={c.canto} a={Y(0)} b={Y(h)} linea={X(0) - 10} vertical lado={-1} prop={prop} />
          <Cota campo="capa" titulo="capa" valor={c.capa} a={Y(0)} b={Y(hf)} linea={X(2 * s) + 8} vertical lado={1} rotulo={{ x: X(2 * s) + 6, y: Y(0) - 14 }} prop={prop} />
          <Cota campo="nervio" titulo="nervio" valor={c.nervio} a={X(ejes[1]! - bw / 2)} b={X(ejes[1]! + bw / 2)} linea={Y(h) + 7} lado={1} prop={prop} />
        </svg>
        <figcaption>
          {c.canto && c.capa ? `Reticular ${cm(c.canto - c.capa)}+${cm(c.capa)}` : "Reticular"}
          {c.intereje && c.nervio ? ` · nervios de ${cm(c.nervio)} cada ${cm(c.intereje)} cm` : ""} · casetón {c.caseton}
          {c.volumen !== undefined && (
            <>
              <br />
              Hormigón en lo aligerado: {fmt(c.volumen, 3)} m³/m² (espesor medio {cm(c.volumen)} cm).
            </>
          )}
        </figcaption>
      </figure>
    );
  }
  return <SeccionUnidireccional c={c} prop={prop} />;
}

/** La forma de una vigueta en m, con el ala arriba; null si no tiene una que dibujar. */
function formaVigueta(v: Seccion): { b: number; h: number; d: (X: (x: number) => number, Y: (y: number) => number, e: number) => string } | null {
  if (v.forma === "T") {
    const { bf, hf, bw, h } = v;
    return { b: bf, h, d: (X, Y, e) => `M${X(e - bf / 2)} ${Y(0)}H${X(e + bf / 2)}V${Y(hf)}H${X(e + bw / 2)}V${Y(h)}H${X(e - bw / 2)}V${Y(hf)}H${X(e - bf / 2)}Z` };
  }
  if (v.forma === "rectangular" || (v.forma === "general" && v.b && v.h)) {
    const [b, h] = [v.b!, v.h!];
    return { b, h, d: (X, Y, e) => `M${X(e - b / 2)} ${Y(0)}H${X(e + b / 2)}V${Y(h)}H${X(e - b / 2)}Z` };
  }
  return null;
}

function SeccionUnidireccional({ c, prop }: { c: CroquisForjado; prop: Pick<Props, "activo" | "onCampo"> }) {
  const v = c.vigueta;
  const forma = v ? formaVigueta(v) : null;
  const s = c.intereje ?? Math.max(forma?.b ?? 0, 0.7);
  const h = forma?.h ?? 0.3;
  const k = Math.min((WS - 60) / (2 * s), 70 / h);
  const [x0, y0] = [30, 28];
  const X = (x: number) => x0 + x * k;
  const Y = (y: number) => y0 + y * k;
  const ejes = [s / 2, (3 * s) / 2];
  const altoSvg = Y(h) + 26;
  return (
    <figure className="croquis">
      <svg viewBox={`0 0 ${WS} ${altoSvg}`} width={WS} height={altoSvg} role="img" aria-label="Sección del unidireccional">
        {ejes.map((e) =>
          forma ? (
            <path key={e} d={forma.d(X, Y, e)} className="cq-hormigon" {...parte("seccion", prop)} data-activo={prop.activo === "seccion" || undefined} />
          ) : (
            <rect key={e} x={X(e) - 8} y={Y(0)} width={16} height={h * k} className="cq-falta" {...parte("seccion", prop)} />
          ),
        )}
        {ejes.map((e) => (
          <line key={`e${e}`} x1={X(e)} y1={Y(0) - 16} x2={X(e)} y2={Y(h) + 4} className="cq-eje" />
        ))}
        <Cota campo="intereje" titulo="intereje" valor={c.intereje} a={X(ejes[0]!)} b={X(ejes[1]!)} linea={Y(0) - 10} lado={-1} prop={prop} />
      </svg>
      <figcaption>
        {v ? `Vigueta ${v.id}: ${describirSeccion(v)}` : "Falta la vigueta: elija su sección."} El peso es el pp (con las bovedillas); la vigueta no pesa.
      </figcaption>
    </figure>
  );
}
