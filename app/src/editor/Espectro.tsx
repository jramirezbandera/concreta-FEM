/**
 * La curva del espectro de la NCSE-02 (VS4): el espectro elástico α(T) del art. 2.3 y el coeficiente
 * αᵢ(T) de los modos del art. 3.6.2.2 (con β = ν/μ dentro) según X y según Y, con TA, TB y los
 * periodos de los modos si hay resultados.
 *
 * Se dibuja al ancho real de su caja, en píxeles (antes, un viewBox fijo estirado al 100 %: el texto
 * crecía con el diálogo y la leyenda tapaba la curva). La leyenda va fuera, en HTML; los ejes llevan
 * sus marcas y su magnitud, y con `ac` el eje de la derecha da ac·αᵢ en g, lo que llega a las fuerzas.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { DatosSismo } from "../../../src/visor/programa.ts";
import { fmt } from "../fmt.ts";

type Curva = DatosSismo["curva"] & object;

const ALTO = 230;
const M = { izq: 40, der: 46, arr: 14, aba: 34 };

/** Interpolación lineal en la curva muestreada. */
function valorEn(T: readonly number[], v: readonly number[], t: number): number {
  if (t <= T[0]!) return v[0]!;
  const n = T.length - 1;
  if (t >= T[n]!) return v[n]!;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (T[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - T[lo]!) / (T[hi]! - T[lo]!);
  return v[lo]! + f * (v[hi]! - v[lo]!);
}

/** Marcas «redondas» de 0 a `max`: unas 5. */
function marcas(max: number, n = 5): number[] {
  const paso0 = max / n;
  const p = Math.pow(10, Math.floor(Math.log10(paso0)));
  const paso = [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= paso0) ?? paso0;
  const r: number[] = [];
  for (let x = 0; x <= max + 1e-9; x += paso) r.push(Number(x.toFixed(6)));
  return r;
}

const iguales = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) < 1e-12);

export function Espectro({ curva, periodos, TA, TB, ac }: { curva: Curva; periodos: number[]; TA: number; TB: number; ac?: number }) {
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    setAncho(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setAncho(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const unaSola = iguales(curva.x, curva.y);
  const Tmax = curva.T[curva.T.length - 1]!;
  const amax = Math.max(...curva.elastico, ...curva.x, ...curva.y);
  const W = Math.max(ancho, 260);
  const conDerecha = ac !== undefined && W >= 340;
  const mDer = conDerecha ? M.der : 12;
  const X = (T: number) => M.izq + (T / Tmax) * (W - M.izq - mDer);
  const Y = (a: number) => ALTO - M.aba - (a / (amax * 1.08)) * (ALTO - M.aba - M.arr);
  const linea = (ys: readonly number[]) => curva.T.map((T, i) => `${i ? "L" : "M"}${X(T).toFixed(1)} ${Y(ys[i]!).toFixed(1)}`).join("");
  const mT = marcas(Tmax, W < 400 ? 3 : 6);
  const mA = marcas(amax * 1.05, 5);
  const mG = conDerecha ? marcas(amax * 1.05 * ac!, 5).filter((g) => g / ac! <= amax * 1.08) : [];
  // Con TA y TB muy juntos (una gráfica estrecha), sólo sus nombres: los números van en las cifras
  const conNumeros = X(TB) - X(TA) >= 64;
  const fondoX = M.izq;
  const fondoW = W - M.izq - mDer;
  const pie = ALTO - M.aba;
  const texto = { fontSize: 11, fontFamily: "var(--font-mono)", fill: "var(--color-text-tertiary)" } as const;
  const modos = periodos.filter((T) => T > 0).map((T, i) => ({ i: i + 1, T, a: valorEn(curva.T, curva.x, Math.min(T, Tmax)), fuera: T > Tmax }));

  return (
    <figure className="espectro" aria-label="Espectro de respuesta">
      <ul className="espectro-leyenda">
        <li>
          <i className="tr-elastico" /> α(T) elástico (art. 2.3)
        </li>
        <li>
          <i className="tr-x" /> αᵢ(T) de los modos{unaSola ? ", según X e Y" : " según X"} (art. 3.6.2.2, con β)
        </li>
        {!unaSola && (
          <li>
            <i className="tr-y" /> αᵢ(T) según Y
          </li>
        )}
        {modos.length > 0 && (
          <li>
            <i className="tr-modo" /> periodos de los modos ({modos.length})
          </li>
        )}
      </ul>
      <div ref={caja} className="espectro-lienzo">
        {ancho > 0 && (
          <svg width={W} height={ALTO} viewBox={`0 0 ${W} ${ALTO}`} role="img" aria-label={`Espectro: TA ${fmt(TA, 2)} s, TB ${fmt(TB, 2)} s, meseta ${fmt(amax, 2)}`}>
            {/* Rejilla y marcas */}
            {mA.map((a) => (
              <g key={`a${a}`}>
                <line x1={fondoX} x2={fondoX + fondoW} y1={Y(a)} y2={Y(a)} stroke="var(--color-border-sub)" />
                <text {...texto} x={fondoX - 6} y={Y(a) + 4} textAnchor="end">
                  {fmt(a, a % 1 ? (a * 10) % 1 ? 2 : 1 : 0)}
                </text>
              </g>
            ))}
            {mT.map((T) => (
              <g key={`t${T}`}>
                <line x1={X(T)} x2={X(T)} y1={pie} y2={pie + 4} stroke="var(--color-border-strong)" />
                <text {...texto} x={X(T)} y={pie + 16} textAnchor="middle">
                  {fmt(T, T % 1 ? 1 : 0)}
                </text>
              </g>
            ))}
            {mG.map((g) => (
              <text key={`g${g}`} {...texto} x={fondoX + fondoW + 6} y={Y(g / ac!) + 4}>
                {fmt(g, 2)}
              </text>
            ))}
            <line x1={fondoX} x2={fondoX + fondoW} y1={pie} y2={pie} stroke="var(--color-border-strong)" />
            <line x1={fondoX} x2={fondoX} y1={M.arr} y2={pie} stroke="var(--color-border-strong)" />
            {conDerecha && <line x1={fondoX + fondoW} x2={fondoX + fondoW} y1={M.arr} y2={pie} stroke="var(--color-border-sub)" />}
            <text {...texto} x={fondoX + fondoW} y={ALTO - 3} textAnchor="end">
              T (s)
            </text>
            <text {...texto} x={4} y={M.arr - 2}>
              α
            </text>
            {conDerecha && (
              <text {...texto} x={W - 2} y={M.arr - 2} textAnchor="end">
                ac·αᵢ (g)
              </text>
            )}
            {/* TA y TB, hasta la curva elástica */}
            {(
              [
                ["TA", TA],
                ["TB", TB],
              ] as const
            ).map(([n, T]) => (
              <g key={n}>
                <line x1={X(T)} x2={X(T)} y1={Y(valorEn(curva.T, curva.elastico, T))} y2={pie} stroke="var(--color-text-tertiary)" strokeDasharray="2 3" />
                <text {...texto} x={X(T) + 4} y={pie - 6}>
                  {conNumeros ? `${n} ${fmt(T, 2)}` : n}
                </text>
              </g>
            ))}
            <path d={linea(curva.elastico)} fill="none" stroke="var(--color-text-tertiary)" strokeWidth={1.4} strokeDasharray="5 4" />
            {!unaSola && <path d={linea(curva.y)} fill="none" stroke="var(--color-uy)" strokeWidth={2} strokeDasharray="7 4" />}
            <path d={linea(curva.x)} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
            {modos.map((m) => (
              <circle key={m.i} cx={X(Math.min(m.T, Tmax))} cy={Y(m.a)} r={3.5} fill="var(--color-bg-primary)" stroke="var(--color-accent)" strokeWidth={1.6}>
                <title>
                  Modo {m.i}: T = {fmt(m.T, 3)} s{m.fuera ? " (fuera de la gráfica)" : ""}, αᵢ = {fmt(m.a, 3)}
                </title>
              </circle>
            ))}
          </svg>
        )}
      </div>
    </figure>
  );
}
