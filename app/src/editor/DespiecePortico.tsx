/**
 * El despiece de un pórtico (CO6, `docs/fem3d/comprobaciones.md` §8.13): el alzado de la alineación
 * entera, con sus apoyos y sus vanos a escala a lo largo; cada barra, sacada de la viga a su fila
 * (las superiores arriba, las inferiores abajo) con su marca, sus patillas y su largo; los cercos de
 * cada tramo, contados; las luces, acotadas; las secciones del vano elegido y la tabla de despiece
 * con el acero.
 *
 * Qué barras hay y dónde lo dice `src/comprobaciones/despieceVigas.ts` con el armado de cada vano
 * (el del proyecto y, en el vano elegido, lo que se está escribiendo); aquí sólo se pinta. Un clic en
 * un vano lo elige.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ramasDe, type ArmadoVanoViga, type CercosViga } from "../../../src/comprobaciones/armado.ts";
import { despiecePortico, filasBarras, type BarraDespiece, type OrigenBarra } from "../../../src/comprobaciones/despieceVigas.ts";
import { armadoDeZona, seccionVigaArmada, type ZonaVano } from "../../../src/comprobaciones/dibujoArmado.ts";
import type { VanoPortico } from "../../../src/comprobaciones/porticos.ts";
import type { DatosPortico } from "../../../src/visor/comprobaciones.ts";
import { fmt } from "../fmt.ts";
import { SeccionDibujada } from "./CroquisArmado.tsx";

export interface EstadoVano {
  texto: string;
  tono: "ok" | "fail" | "neu" | "warn";
  aprovechamiento: number | null;
}

interface Props {
  datos: DatosPortico;
  /** El armado de cada vano, por su clave (el dato del proyecto, en el sentido de su viga). */
  armados: Readonly<Record<string, Partial<ArmadoVanoViga> | null | undefined>>;
  estados?: Readonly<Record<string, EstadoVano>>;
  /** El vano elegido (su clave) y el campo de su armado con el foco. */
  elegida: string | null;
  activo: string | null;
  onVano?: (clave: string) => void;
}

/** Margen a los lados, px. */
const M = 18;
/** Alto de la fila de una barra sacada (su rótulo encima), px; con su cota debajo (las superiores de los apoyos), más. */
const FILA = 24;
const FILA_ACOTADA = 32;
/** Lo que ocupa el rótulo de una barra, px: con menos, su fila no admite otra al lado. */
const ROTULO = 108;
/** La escala a lo largo no baja de esto, px/m: con un pórtico más largo, el dibujo se desplaza. */
const PX_M = 26;
/** px por mm de canto. */
const KV = 0.085;

const textoCercos = (c: CercosViga) => `cØ${c.diametro}/${c.separacion}${ramasDe(c) !== 2 ? ` (${ramasDe(c)}R)` : ""}`;
const NOMBRE_PAPEL: Record<BarraDespiece["papel"], string> = { vano: "inferior", corrida: "superior corrida", apoyo: "superior de apoyo", piel: "de piel (las dos caras)" };

/** La fila de cada intervalo [x0, x1] (px) para que ninguno pise a otro. */
function repartir(xs: readonly (readonly [number, number])[]): number[] {
  const filas: [number, number][][] = [];
  return xs.map((o) => {
    let f = filas.findIndex((fila) => fila.every((y) => o[1] <= y[0] || o[0] >= y[1]));
    if (f < 0) f = filas.push([]) - 1;
    filas[f]!.push([o[0], o[1]]);
    return f;
  });
}

export function DespiecePortico({ datos, armados, estados, elegida, activo, onVano }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  const [sobre, setSobre] = useState<string | null>(null);
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    setAncho(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setAncho(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const p = datos.portico;
  const d = useMemo(() => despiecePortico(p, armados, datos.despiece), [p, armados, datos.despiece]);
  const largo = Math.max(p.x[1] - p.x[0], 0.1);
  const W = Math.round(Math.max(ancho || 900, 480, 2 * M + largo * PX_M));
  const kx = (W - 2 * M) / largo;
  const X = (x: number) => M + (x - p.x[0]) * kx;
  const filas = useMemo(() => filasBarras(d.barras, ROTULO / kx), [d.barras, kx]);
  const nFilas = (cara: BarraDespiece["cara"]) => 1 + Math.max(-1, ...d.barras.filter((b) => b.cara === cara).map((b) => filas.get(b.marca) ?? 0));
  const [nSup, nInf, nPiel] = [nFilas("superior"), nFilas("inferior"), nFilas("piel")];

  const vanoDe = (clave: string | undefined) => p.vanos.find((v) => v.clave === clave);
  const canto = (v: VanoPortico | undefined) => Math.min(Math.max((v?.geometria?.h ?? 350) * KV, 20), 62);
  const hMax = Math.max(20, ...p.vanos.map(canto));
  // De arriba abajo: los nombres, las superiores, la viga con sus apoyos, las inferiores y las de piel, los cercos y las cotas
  const yNombres = 13;
  // Una superior de apoyo con un solo eje dentro se acota a cada lado de él, bajo su línea
  const acotada = (b: BarraDespiece) => b.papel === "apoyo" && b.ejes.length === 1;
  const filaSup = d.barras.some(acotada) ? FILA_ACOTADA : FILA;
  const yTop = 22 + Math.max(nSup, 1) * filaSup + 10;
  const yPie = yTop + hMax + 14;
  const ySup = (f: number) => yTop - (filaSup - 11) - f * filaSup;
  /** El centro de un rótulo de `n` letras, sin salirse del dibujo. */
  const centrado = (x: number, n: number) => Math.min(Math.max(x, n * 3.4 + 4), W - n * 3.4 - 4);
  const yInf = (f: number) => yPie + 22 + f * FILA;
  const yPiel = (f: number) => yInf(nInf + f);
  const cercosPx = d.cercos.map((c) => {
    const [a, b] = [X(c.x[0]), X(c.x[1])];
    const medio = Math.max((b - a) / 2, (`${c.n}${textoCercos(c.cercos)}`.length * 6.7) / 2 + 4);
    return [(a + b) / 2 - medio, (a + b) / 2 + medio] as const;
  });
  const filaCercos = repartir(cercosPx);
  const nCer = d.cercos.length ? 1 + Math.max(...filaCercos) : 0;
  const yCer = (f: number) => yInf(nInf + nPiel) + 4 + f * 22;
  const yCota = yCer(nCer) + 8;
  const H = yCota + 20;

  /** Lo que resalta: el campo con el foco del vano elegido, o lo que está bajo el ratón. */
  const resalta = (o: readonly OrigenBarra[], id: string) => sobre === id || (activo !== null && elegida !== null && o.some((x) => x.clave === elegida && x.ruta === activo)) || undefined;
  const deOtro = (o: readonly OrigenBarra[]) => (elegida !== null && !o.some((x) => x.clave === elegida)) || undefined;
  const vigasVarias = new Set(p.vanos.filter((v, _, t) => t.filter((y) => y.viga === v.viga).length > 1).map((v) => v.viga));

  const el = vanoDe(elegida ?? undefined);
  const armadoEl = el ? armados[el.clave] : undefined;
  // Las secciones del vano elegido, en el sentido del pórtico: la de la izquierda es su inicio si la viga no va invertida
  const zonas: { zona: ZonaVano; titulo: string }[] = useMemo(() => {
    if (!el || !el.geometria || !armadoEl) return [];
    const propias = (["inicio", "fin"] as const).some((z) => armadoDeZona(armadoEl, z).superiorPropia || armadoDeZona(armadoEl, z).cercosPropios);
    if (!propias) return [{ zona: "centro", titulo: "Sección" }];
    const nombre = (i: 0 | 1) => (el.apoyos[i] !== null ? `Junto a ${p.apoyos[el.apoyos[i]!]!.objeto}` : "Extremo libre");
    const [izq, der]: [ZonaVano, ZonaVano] = el.invertida ? ["fin", "inicio"] : ["inicio", "fin"];
    return [
      { zona: izq, titulo: nombre(0) },
      { zona: "centro", titulo: "Centro" },
      { zona: der, titulo: nombre(1) },
    ];
  }, [el, armadoEl, p.apoyos]);
  const WS = 150;

  return (
    <div className="despiece" data-despiece-portico={p.id}>
      <div className="despiece-titulo">
        <b>Pórtico {p.nombre}</b>
        <span>
          {p.planta} · {p.vigas.length === 1 ? `viga ${p.vigas[0]!.id}` : `vigas ${p.vigas.map((v) => v.id).join(", ")}`} · {fmt(largo, 2)} m
        </span>
        {d.barras.length > 0 && (
          <span data-acero-portico>
            Acero: {fmt(d.acero.total, 0)} kg ({d.acero.porDiametro.map((x) => `Ø${x.diametro} ${fmt(x.kg, 0)}`).join(" · ")})
          </span>
        )}
      </div>
      <div ref={caja} className="despiece-alzado">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Despiece del pórtico ${p.nombre}`}>
          {/* Los vanos: la banda del elegido, y dónde se hace clic */}
          {p.vanos.map((v) => {
            const e = estados?.[v.clave];
            // En un vano estrecho, sin el nombre de la viga (va en los de al lado) o sólo con su número
            const ap = e && e.aprovechamiento !== null ? ` · ${fmt(e.aprovechamiento, 2)}` : "";
            const cabe = (t: string) => t.length * 6.7 <= X(v.hasta) - X(v.desde) - 6;
            const largoN = `${vigasVarias.has(v.viga) ? `${v.viga} · ${v.vano + 1}` : v.viga}${ap}`;
            const cortoN = vigasVarias.has(v.viga) ? `${v.vano + 1}${ap}` : largoN;
            const nombre = cabe(largoN) ? largoN : cabe(cortoN) || !vigasVarias.has(v.viga) ? cortoN : String(v.vano + 1);
            const xm = centrado((X(v.desde) + X(v.hasta)) / 2, nombre.length);
            return (
              <g key={v.clave} className="dp-vano" data-vano={v.clave} data-on={v.clave === elegida || undefined} onClick={onVano ? () => onVano(v.clave) : undefined}>
                <rect x={X(v.desde)} y={0} width={Math.max(X(v.hasta) - X(v.desde), 1)} height={H} />
                <text x={xm} y={yNombres} textAnchor="middle" className="dp-nombre-vano" data-tono={e?.tono}>
                  {nombre}
                </text>
                <title>{`${v.clave}: ${e ? e.texto : "no se comprueba"} · luz ${fmt(v.hasta - v.desde, 2)} m`}</title>
              </g>
            );
          })}
          {/* Los apoyos, por debajo de la viga */}
          {p.apoyos.map((a, i) => {
            const [x0, x1] = [X(a.caras[0]), X(a.caras[1])];
            return (
              <g key={i} className="dp-apoyo" data-tipo={a.tipo}>
                <rect x={Math.min(x0, (x0 + x1) / 2 - 1.5)} y={a.tipo === "viga" ? yTop : yTop - 5} width={Math.max(x1 - x0, 3)} height={a.tipo === "viga" ? hMax : yPie - yTop + 5} className="cq-hormigon" />
                <text x={centrado(X(a.eje), a.objeto.length)} y={yPie + 11} textAnchor="middle" className="dp-nombre-apoyo">
                  {a.objeto}
                </text>
              </g>
            );
          })}
          {/* La viga: cada vano, hasta el eje de sus apoyos */}
          {p.vanos.map((v) => {
            const [a, b] = [v.apoyos[0] !== null ? p.apoyos[v.apoyos[0]]!.eje : v.desde, v.apoyos[1] !== null ? p.apoyos[v.apoyos[1]]!.eje : v.hasta];
            return <rect key={v.clave} x={X(a)} y={yTop} width={Math.max(X(b) - X(a), 1)} height={canto(v)} className="cq-hormigon dp-viga" />;
          })}
          {p.quiebros.map((x, i) => (
            <line key={i} x1={X(x)} x2={X(x)} y1={yTop - 8} y2={yTop + hMax + 8} className="cq-eje">
              <title>Aquí la viga cambia de dirección en planta: se dibuja estirada</title>
            </line>
          ))}
          {/* Los cercos, en su sitio */}
          {d.cercos.map((c, i) => {
            const v = vanoDe(c.origen[0]!.clave);
            const paso = c.n > 1 ? (c.x[1] - c.x[0]) / (c.n - 1) : 0;
            const salto = Math.max(1, Math.ceil(3 / Math.max(paso * kx, 1e-9)));
            return (
              <g key={i} className="ca-cerco dp-cercos" data-fino data-activo={resalta(c.origen, `c${i + 1}`)} data-otro={deOtro(c.origen)}>
                {Array.from({ length: c.n }, (_, k) => k)
                  .filter((k) => k % salto === 0)
                  .map((k) => (
                    <line key={k} x1={X(c.x[0] + k * paso)} x2={X(c.x[0] + k * paso)} y1={yTop + 3} y2={yTop + canto(v) - 3} />
                  ))}
              </g>
            );
          })}
          {/* Las barras, en su sitio (finas) y sacadas a su fila con su marca y su largo */}
          {d.barras.map((b) => {
            const f = filas.get(b.marca) ?? 0;
            const [x0, x1] = [X(b.x[0]), X(b.x[1])];
            const arriba = b.cara === "superior";
            const y = arriba ? ySup(f) : b.cara === "inferior" ? yInf(f) : yPiel(f);
            const v = vanoDe(b.origen[0]!.clave);
            const dentro = arriba ? yTop + 3.5 + 2.4 * f : b.cara === "inferior" ? yTop + canto(v) - 3.5 - 2.4 * f : yTop + canto(v) / 2;
            const pata = arriba ? 8 : -8;
            const xm = Math.min(Math.max((x0 + x1) / 2, ROTULO / 2), W - ROTULO / 2);
            const id = String(b.marca);
            const patillas = b.patillas.some((x) => x > 0) ? ` · patilla${b.patillas.every((x) => x > 0) ? "s" : ""} de ${[...new Set(b.patillas.filter((x) => x > 0).map((x) => Math.round(x * 100)))].join(" y ")} cm` : "";
            return (
              <g key={b.marca} className="dp-barra" data-barra={b.marca} data-grupo={b.cara} data-papel={b.papel} data-activo={resalta(b.origen, id)} data-otro={deOtro(b.origen)} onMouseEnter={() => setSobre(id)} onMouseLeave={() => setSobre(null)}>
                <line x1={x0} x2={x1} y1={dentro} y2={dentro} className="dp-en-sitio" />
                <path d={`M${x0} ${y + (b.patillas[0] ? pata : 0)}V${y}H${x1}V${y + (b.patillas[1] ? pata : 0)}`} className="dp-linea" />
                <path d={`M${x0} ${y - 12}H${x1}V${y + 12}H${x0}Z`} className="cq-clic" />
                <circle cx={x0} cy={y} r={7.5} className="dp-marca" />
                <text x={x0} y={y + 3.5} textAnchor="middle" className="dp-marca-numero">
                  {b.marca}
                </text>
                <text x={xm} y={y - 6} textAnchor="middle" className="dp-rotulo">
                  {b.n}Ø{b.diametro} L={fmt(b.largo, 2)}
                </text>
                {acotada(b) && (
                  <g className="dp-cota-barra">
                    <line x1={X(b.ejes[0]!)} x2={X(b.ejes[0]!)} y1={y - 3} y2={y + 4} />
                    <text x={centrado(X(b.ejes[0]!), 11)} y={y + 13} textAnchor="middle">
                      {fmt(b.ejes[0]! - b.x[0], 2)} | {fmt(b.x[1] - b.ejes[0]!, 2)}
                    </text>
                  </g>
                )}
                <title>{`Barra ${b.marca}: ${b.n}Ø${b.diametro} de ${fmt(b.largo, 2)} m, ${NOMBRE_PAPEL[b.papel]}${patillas}${acotada(b) ? ` · ${fmt(b.ejes[0]! - b.x[0], 2)} m a un lado del eje del apoyo y ${fmt(b.x[1] - b.ejes[0]!, 2)} m al otro` : ""}`}</title>
              </g>
            );
          })}
          {/* Los cercos, contados: cada tramo del mismo cerco */}
          {d.cercos.map((c, i) => {
            const [x0, x1] = [X(c.x[0]), X(c.x[1])];
            const y = yCer(filaCercos[i]!) + 14;
            const id = `c${i + 1}`;
            return (
              <g key={i} className="dp-tramo-cercos" data-cercos={id} data-activo={resalta(c.origen, id)} data-otro={deOtro(c.origen)} onMouseEnter={() => setSobre(id)} onMouseLeave={() => setSobre(null)}>
                <path d={`M${x0} ${y - 3}V${y + 3}M${x0} ${y}H${x1}M${x1} ${y - 3}V${y + 3}`} />
                <text x={Math.min(Math.max((x0 + x1) / 2, 40), W - 40)} y={y - 5} textAnchor="middle">
                  {c.n}
                  {textoCercos(c.cercos)}
                </text>
                <title>{`${c.n} cercos Ø${c.cercos.diametro} cada ${c.cercos.separacion} mm${ramasDe(c.cercos) !== 2 ? `, de ${ramasDe(c.cercos)} ramas` : ""}, en ${fmt(c.x[1] - c.x[0], 2)} m`}</title>
              </g>
            );
          })}
          {/* Las cotas: la luz de cada vano entre las caras de sus apoyos, y el ancho de cada apoyo */}
          <g className="cq-cota dp-cotas">
            <line x1={X(p.x[0])} x2={X(p.x[1])} y1={yCota} y2={yCota} />
            {[...new Set([...p.apoyos.flatMap((a) => a.caras), ...p.vanos.flatMap((v) => [v.desde, v.hasta])].map((x) => Math.round(x * 1000) / 1000))].map((x) => (
              <line key={x} x1={X(x)} x2={X(x)} y1={yCota - 4} y2={yCota + 4} />
            ))}
            {p.vanos.map((v) => (
              <text key={v.clave} x={(X(v.desde) + X(v.hasta)) / 2} y={yCota + 14} textAnchor="middle">
                {fmt(v.hasta - v.desde, 2)}
              </text>
            ))}
            {p.apoyos.map((a, i) =>
              (a.caras[1] - a.caras[0]) * kx >= 20 ? (
                <text key={i} x={(X(a.caras[0]) + X(a.caras[1])) / 2} y={yCota + 14} textAnchor="middle" className="dp-cota-apoyo">
                  {fmt(a.caras[1] - a.caras[0], 2)}
                </text>
              ) : null,
            )}
          </g>
          {p.vanos.map((v) =>
            armados[v.clave] ? null : (
              <text key={v.clave} x={(X(v.desde) + X(v.hasta)) / 2} y={yTop + canto(v) / 2 + 4} textAnchor="middle" className="ca-falta">
                {v.geometria ? "sin armado" : "no se arma"}
              </text>
            ),
          )}
        </svg>
      </div>
      <div className="despiece-pie">
        {el && zonas.length > 0 && (
          <figure className="despiece-secciones" data-secciones-vano={el.clave}>
            <svg viewBox={`0 0 ${WS * zonas.length} 176`} width={WS * zonas.length} height={176} role="img" aria-label={`Secciones del vano ${el.clave}`}>
              {zonas.map((z, i) => (
                <SeccionDibujada key={z.zona} s={seccionVigaArmada(el.geometria!, armadoEl!, z.zona, datos.despiece.recubrimiento)} w={WS} h={176} x0={i * WS} activo={activo} titulo={z.titulo} cotaY={i === 0} />
              ))}
            </svg>
            <figcaption>
              {el.clave} · {el.seccion}
            </figcaption>
          </figure>
        )}
        {d.medicion.length > 0 ? (
          <table className="tb despiece-tabla" data-tabla-despiece>
            <thead>
              <tr>
                <th>Pos.</th>
                <th>Armadura</th>
                <th>Nº</th>
                <th>Ø</th>
                <th>Largo (m)</th>
                <th>Total (m)</th>
                <th>kg</th>
              </tr>
            </thead>
            <tbody>
              {d.medicion.map((f) => (
                <tr key={f.marca} data-on={sobre === f.marca || undefined} onMouseEnter={() => setSobre(f.marca)} onMouseLeave={() => setSobre(null)}>
                  <td>{f.marca}</td>
                  <td className="txt">{f.que}</td>
                  <td>{f.n}</td>
                  <td>{f.diametro}</td>
                  <td>{fmt(f.largo, 2)}</td>
                  <td>{fmt(f.total, 2)}</td>
                  <td>{fmt(f.kg, 1)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="txt">
                  Total
                </td>
                <td>{fmt(d.acero.total, 1)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <p className="nota">Ningún vano de este pórtico tiene armado: «Proponer armado» pone el de las tablas.</p>
        )}
      </div>
      {d.avisos.map((a) => (
        <p key={a} className="nota text-state-warn" data-aviso-despiece>
          {a}
        </p>
      ))}
      <p className="nota">
        Cada barra cubre el tramo en que la comprobación cuenta con ella y sigue su anclaje (el básico, a 5 cm); las superiores de los apoyos cubren el cuarto de la luz y siguen además el decalaje, y bajo cada una va lo que sale a cada lado del eje de su apoyo. En un apoyo extremo, rectas si caben y, si no, con patilla. El largo es lo recto más las patillas, sin descontar los doblados; el desarrollo de los cercos es estimado. Un clic en un vano lo elige: su armado se cambia en Propiedades y el dibujo lo sigue.
      </p>
    </div>
  );
}
