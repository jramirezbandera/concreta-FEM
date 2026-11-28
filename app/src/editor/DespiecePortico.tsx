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
import { capacidadEn, capacidadPortico, type CapacidadPortico, type PuntoCapacidad } from "../../../src/comprobaciones/capacidadVigas.ts";
import { armadoDeZona, seccionVigaArmada, type ZonaVano } from "../../../src/comprobaciones/dibujoArmado.ts";
import type { VanoPortico } from "../../../src/comprobaciones/porticos.ts";
import type { DatosEsfuerzosArmado, DatosPortico, PuntoEsfuerzo } from "../../../src/visor/comprobaciones.ts";
import { fmt } from "../fmt.ts";
import { SeccionDibujada } from "./CroquisArmado.tsx";

export interface EstadoVano {
  texto: string;
  tono: "ok" | "fail" | "neu" | "warn";
  aprovechamiento: number | null;
}

interface Props {
  /** §8.14: las envolventes de ELU de My y Vz en la x del pórtico; se dibujan bajo el despiece. */
  esfuerzos?: DatosEsfuerzosArmado | null | undefined;
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

/** Alto de la banda de un esfuerzo bajo el despiece, px. */
const ALTO_ESFUERZO = 108;
/** Con el área capaz, más alta: lo resistido suele ser varias veces la envolvente. */
const ALTO_ESFUERZO_CAPAZ = 176;
const valorEsfuerzo = (v: number) => fmt(v, Math.abs(v) < 9.95 ? 1 : 0);

/** Un pico rotulado de una envolvente: dónde, su valor y si el rótulo va debajo. */
interface Pico {
  x: number;
  y: number;
  texto: string;
  signo: "pos" | "neg";
  abajo: boolean;
  peso: number;
}

/**
 * La banda de un esfuerzo: sus tramos unidos en una curva continua (entre las caras de un apoyo, recta),
 * la escala según lo que hay a cada lado del cero y los picos de cada tramo, sin los que pisarían a
 * otro mayor.
 */
function bandaEsfuerzo(
  ts: readonly (readonly PuntoEsfuerzo[])[],
  X: (x: number) => number,
  yArriba: number,
  alto: number,
  abajo: boolean,
  capaz?: readonly (readonly PuntoCapacidad[])[],
  /** §8.26: las caras de cada apoyo. Dentro de ellos no se rotulan picos (la viga se comprueba en la cara): se rotula el valor de la cara. */
  apoyos: readonly (readonly [number, number])[] = [],
  /** §8.26: el MRd dentro de los apoyos (la armadura que los atraviesa): una línea, sin relleno. */
  capazApoyos?: readonly (readonly PuntoCapacidad[])[],
) {
  const todo = ts.flat();
  // La escala, también con el área capaz (que no se salga de la banda)
  let [pos, neg] = [0, 0];
  for (const q of todo) [pos, neg] = [Math.max(pos, q.max), Math.max(neg, -q.min)];
  // Los picos que se rotulan, respecto a la envolvente (no al área capaz)
  const tope = Math.max(pos, neg, 1e-9);
  for (const q of [...(capaz?.flat() ?? []), ...(capazApoyos?.flat() ?? [])]) [pos, neg] = [Math.max(pos, q.max), Math.max(neg, -q.min)];
  const k = alto / Math.max(pos + neg, 1e-9);
  const sg = abajo ? 1 : -1;
  const y0 = yArriba + (abajo ? neg : pos) * k;
  const Y = (v: number) => y0 + sg * v * k;
  const area = (de: (q: PuntoEsfuerzo) => number) => (todo.length ? `M ${X(todo[0]!.x)} ${y0} ${todo.map((q) => `L ${X(q.x)} ${Y(de(q))}`).join(" ")} L ${X(todo[todo.length - 1]!.x)} ${y0} Z` : "");
  const linea = (c: "max" | "min") => (todo.length ? `M ${todo.map((q) => `${X(q.x)} ${Y(q[c])}`).join(" L ")}` : "");
  const candidatos: Pico[] = [];
  const enApoyo = (x: number) => apoyos.some(([a, b]) => x > a + 1e-9 && x < b - 1e-9);
  for (const tramo of ts) {
    if (!tramo.length) continue;
    // Lo de dentro de un apoyo no cuenta: en su lugar, el valor en cada cara (interpolado)
    const t: PuntoEsfuerzo[] = tramo.filter((q) => !enApoyo(q.x));
    for (const x of apoyos.flat()) {
      for (let i = 0; i + 1 < tramo.length; i++) {
        const [a, b] = [tramo[i]!, tramo[i + 1]!];
        if (x < a.x || x > b.x || b.x - a.x < 1e-9) continue;
        const f = (x - a.x) / (b.x - a.x);
        t.push({ x, max: a.max + f * (b.max - a.max), min: a.min + f * (b.min - a.min) });
        break;
      }
    }
    if (!t.length) continue;
    const mas = t.reduce((a, q) => (q.max > a.max ? q : a), t[0]!);
    const menos = t.reduce((a, q) => (q.min < a.min ? q : a), t[0]!);
    if (mas.max > 0.03 * tope) candidatos.push({ x: X(mas.x), y: Y(mas.max), texto: valorEsfuerzo(mas.max), signo: "pos", abajo: sg > 0, peso: mas.max });
    if (menos.min < -0.03 * tope) candidatos.push({ x: X(menos.x), y: Y(menos.min), texto: valorEsfuerzo(menos.min), signo: "neg", abajo: sg < 0, peso: -menos.min });
  }
  // De mayor a menor: un pico no se rotula si pisa el rótulo de otro mayor (los dos lados de un apoyo)
  const picos: Pico[] = [];
  for (const c of candidatos.sort((a, b) => b.peso - a.peso)) if (!picos.some((o) => Math.abs(o.x - c.x) < (o.texto.length + c.texto.length) * 3.4 + 6 && Math.abs(o.y + (o.abajo ? 13 : -6) - (c.y + (c.abajo ? 13 : -6))) < 12)) picos.push(c);
  /** El máximo y el mínimo en una x (interpolados en su tramo); null fuera de la curva. */
  const en = (x: number): { max: number; min: number } | null => {
    for (let i = 0; i + 1 < todo.length; i++) {
      const [a, b] = [todo[i]!, todo[i + 1]!];
      if (x < a.x || x > b.x || b.x - a.x < 1e-9) continue;
      const f = (x - a.x) / (b.x - a.x);
      return { max: a.max + f * (b.max - a.max), min: a.min + f * (b.min - a.min) };
    }
    return null;
  };
  /** El área capaz: su contorno por cada vano (arriba y abajo del cero) y su relleno. */
  const tramosCapaz = (capaz ?? []).filter((t) => t.length > 1);
  const capazLinea = (c: "max" | "min") => tramosCapaz.map((t) => `M ${t.map((q) => `${X(q.x)} ${Y(q[c])}`).join(" L ")}`).join(" ");
  const capazArea = tramosCapaz.map((t) => `M ${t.map((q) => `${X(q.x)} ${Y(q.max)}`).join(" L ")} ${[...t].reverse().map((q) => `L ${X(q.x)} ${Y(q.min)}`).join(" ")} Z`).join(" ");
  /** Donde la envolvente pasa de lo que resiste la sección: sus puntos (para marcarlos). */
  const fuera: { x: number; y: number }[] = [];
  if (tramosCapaz.length) {
    const tol = 1e-6 * Math.max(1, tope);
    for (const q of todo) {
      const c = capacidadEn(tramosCapaz, q.x);
      if (!c) continue;
      if (q.max > 0 && q.max > c.max + tol) fuera.push({ x: X(q.x), y: Y(q.max) });
      if (q.min < 0 && q.min < c.min - tol) fuera.push({ x: X(q.x), y: Y(q.min) });
    }
  }
  const tramosApoyos = (capazApoyos ?? []).filter((t) => t.length > 1);
  const capazApoyosLinea = (c: "max" | "min") => tramosApoyos.map((t) => `M ${t.map((q) => `${X(q.x)} ${Y(q[c])}`).join(" L ")}`).join(" ");
  return { y0, Y, area, linea, picos, en, capazLinea, capazArea, capazApoyosLinea, fuera, yArriba, alto };
}
const ESFUERZOS_PORTICO = [
  { id: "My", nombre: "M", titulo: "M (kN·m): envolvente de ELU, lo positivo (tracción abajo) hacia abajo", abajo: true },
  { id: "Vz", nombre: "V", titulo: "V (kN): envolvente de ELU", abajo: false },
  { id: "T", nombre: "T", titulo: "T (kN·m): envolvente de ELU del torsor", abajo: false },
  { id: "N", nombre: "N", titulo: "N (kN): envolvente de ELU del axil (negativo, compresión). En un diafragma rígido no tiene valor: se lo lleva el forjado", abajo: false },
] as const;
const ROTULO_ESFUERZO = { My: "M (kN·m)", Vz: "V (kN)", T: "T (kN·m)", N: "N (kN)" } as const;
/** Qué es el área capaz de cada esfuerzo (en su ayuda). */
const QUE_CAPAZ = {
  My: "MRd de cada sección con las barras que hay en ella (las ancladas, enteras; desde cada punta, crecen a lo largo de su anclaje)",
  Vz: "VRd de cada sección con sus cercos (el menor de las dos caras traccionadas)",
  T: "TRd de cada sección con sus cercos, con la torsión sola (la interacción con el cortante la mira la comprobación)",
} as const;

export function DespiecePortico({ datos, armados, estados, elegida, activo, onVano, esfuerzos }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  const [verEsfuerzo, setVerEsfuerzo] = useState<Record<"My" | "Vz" | "T" | "N", boolean>>({ My: true, Vz: false, T: false, N: false });
  /** §8.24: el área capaz (lo que resiste cada sección con el armado que se dibuja) con las envolventes. */
  const [verCapaz, setVerCapaz] = useState(true);
  const [sobre, setSobre] = useState<string | null>(null);
  /** La x del pórtico bajo el cursor (m): la sección que se lee en las envolventes. */
  const [cursor, setCursor] = useState<number | null>(null);
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
  const capaz = useMemo<CapacidadPortico | null>(() => (esfuerzos ? capacidadPortico(p, d, datos.despiece) : null), [esfuerzos, p, d, datos.despiece]);
  const capazDe = (id: "My" | "Vz" | "T" | "N") => (verCapaz && capaz && id !== "N" ? capaz[id] : undefined);
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
  const curvas = ESFUERZOS_PORTICO.filter((e) => verEsfuerzo[e.id] && esfuerzos?.esfuerzos[e.id]?.length);
  const altoEsf = verCapaz && capaz ? ALTO_ESFUERZO_CAPAZ : ALTO_ESFUERZO;
  const yEsfuerzo = (i: number) => yCota + 30 + i * altoEsf;
  const H = yCota + 20 + (curvas.length ? 10 + curvas.length * altoEsf : 0);
  const carasApoyos = useMemo(() => p.apoyos.filter((a) => a.caras[1] - a.caras[0] > 1e-6).map((a) => [a.caras[0], a.caras[1]] as const), [p.apoyos]);
  const bandas = curvas.map((e, i) => bandaEsfuerzo(esfuerzos!.esfuerzos[e.id]!, X, yEsfuerzo(i) + 30, altoEsf - 62, e.abajo, capazDe(e.id), carasApoyos, e.id === "My" && verCapaz && capaz ? capaz.MyApoyos : undefined));
  /** El apoyo en cuyo ancho cae una x (entre sus caras); null, en un vano. */
  const apoyoEn = (x: number) => p.apoyos.find((a) => x > a.caras[0] + 1e-9 && x < a.caras[1] - 1e-9) ?? null;
  /** Lo que resiste la sección del cursor (el área capaz), para su lectura. */
  const resiste = (id: "My" | "Vz" | "T" | "N", x: number) => {
    const cz = capazDe(id);
    const r = cz ? capacidadEn(cz, x) : null;
    return r ? ` · resiste ${valorEsfuerzo(r.min)} … ${valorEsfuerzo(r.max)}` : "";
  };
  /** El cursor sobre el dibujo: su x en el pórtico, si cae dentro. */
  const alMover = (ev: { clientX: number; currentTarget: SVGSVGElement }) => {
    const caja = ev.currentTarget.getBoundingClientRect();
    if (!(caja.width > 0)) return;
    const x = p.x[0] + ((ev.clientX - caja.left) * (W / caja.width) - M) / kx;
    setCursor(x >= p.x[0] && x <= p.x[1] ? x : null);
  };

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
        {esfuerzos && (
          <span role="group" aria-label="Esfuerzos bajo el despiece" className="despiece-capas">
            Esfuerzos
            {ESFUERZOS_PORTICO.map((e) => (
              <label key={e.id} title={e.titulo}>
                <input type="checkbox" checked={verEsfuerzo[e.id]} onChange={(x) => setVerEsfuerzo((v) => ({ ...v, [e.id]: x.target.checked }))} /> {e.nombre}
              </label>
            ))}
            <label title="El área capaz: lo que resiste cada sección con el armado que se dibuja (MRd, VRd y TRd), para ver que la envolvente no pasa nunca de ella. Sigue a lo que se escribe, sin aplicarlo." className="despiece-capaz">
              <input type="checkbox" checked={verCapaz} onChange={(x) => setVerCapaz(x.target.checked)} /> Área capaz
            </label>
          </span>
        )}
      </div>
      <div ref={caja} className="despiece-alzado">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Despiece del pórtico ${p.nombre}`} onMouseMove={curvas.length ? alMover : undefined} onMouseLeave={() => setCursor(null)}>
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
          {/* El eje de cada apoyo, de arriba abajo: une el alzado, las barras, las cotas y las envolventes */}
          {p.apoyos.map((a, i) => (
            <line key={i} x1={X(a.eje)} x2={X(a.eje)} y1={yTop - 14} y2={H - 6} className="dp-eje-apoyo" />
          ))}
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
          {/* §8.14: las envolventes de ELU, bajo el despiece y a su misma escala a lo largo */}
          {curvas.map((e, i) => {
            const g = bandas[i]!;
            const signo = (s: "pos" | "neg") => (e.id === "My" ? s : "v");
            return (
              <g key={e.id} className="dp-esfuerzo" data-esfuerzo={e.id}>
                <rect x={M - 8} y={yEsfuerzo(i) - 4} width={W - 2 * M + 16} height={altoEsf - 6} rx={6} className="dp-esf-fondo" />
                <text x={M} y={yEsfuerzo(i) + 10} className="dp-esf-titulo">
                  {ROTULO_ESFUERZO[e.id]}
                  <tspan className="dp-esf-combinaciones"> · envolvente de {esfuerzos!.combinaciones}</tspan>
                  {capazDe(e.id) && (
                    <tspan className="dp-capaz-titulo" data-pasa={g.fuera.length > 0 || undefined}>
                      {g.fuera.length ? " · la envolvente pasa del área capaz" : " · área capaz (discontinua)"}
                    </tspan>
                  )}
                  {carasApoyos.length > 0 && (
                    <tspan className="dp-esf-combinaciones" data-nota-apoyos>
                      {" "}
                      · en gris, dentro de los apoyos: se comprueba en la cara
                    </tspan>
                  )}
                </text>
                {capazDe(e.id) && (
                  <g className="dp-capaz" data-capaz={e.id}>
                    <path d={g.capazArea} className="dp-capaz-area" />
                    <path d={g.capazLinea("max")} className="dp-capaz-linea" />
                    <path d={g.capazLinea("min")} className="dp-capaz-linea" />
                    <title>{`Área capaz: ${QUE_CAPAZ[e.id as "My" | "Vz" | "T"]}`}</title>
                  </g>
                )}
                <line x1={X(p.x[0])} x2={X(p.x[1])} y1={g.y0} y2={g.y0} className="dp-esf-eje" />
                <path d={g.area((q) => Math.max(q.max, 0))} className="dp-esf-area" data-signo={signo("pos")} />
                <path d={g.area((q) => Math.min(q.min, 0))} className="dp-esf-area" data-signo={signo("neg")} />
                <path d={g.linea("max")} className="dp-esf-linea" data-signo={signo("pos")} />
                <path d={g.linea("min")} className="dp-esf-linea" data-signo={signo("neg")} />
                {/* §8.26: dentro de cada apoyo la viga no se comprueba (se comprueba en su cara): la envolvente, atenuada, y la armadura que lo atraviesa */}
                {p.apoyos.map((a, k) =>
                  a.caras[1] - a.caras[0] > 1e-6 ? (
                    <rect key={`a${k}`} x={X(a.caras[0])} y={yEsfuerzo(i) + 16} width={X(a.caras[1]) - X(a.caras[0])} height={altoEsf - 34} className="dp-esf-apoyo" data-esf-apoyo={a.objeto}>
                      <title>{`Dentro de ${a.objeto}: la viga se comprueba en la cara del apoyo, no aquí. Lo que se dibuja dentro es la ley del modelo de barras, con la reacción concentrada en el eje.${e.id === "My" ? " La línea de puntos es lo que resiste la sección con las barras que atraviesan el apoyo: la armadura de la cara tiene que seguir entera." : ""}`}</title>
                    </rect>
                  ) : null,
                )}
                {e.id === "My" && capazDe(e.id) && (
                  <g className="dp-capaz-apoyos" data-capaz-apoyos>
                    <path d={g.capazApoyosLinea("max")} />
                    <path d={g.capazApoyosLinea("min")} />
                  </g>
                )}
                {capazDe(e.id) && g.fuera.map((q, k) => <circle key={`f${k}`} cx={q.x} cy={q.y} r={3} className="dp-capaz-fuera" data-capaz-fuera />)}
                {g.picos.map((c, k) => (
                  <g key={k}>
                    <circle cx={c.x} cy={c.y} r={2.2} className="dp-esf-pico" data-signo={signo(c.signo)} />
                    <text x={centrado(c.x, c.texto.length)} y={c.y + (c.abajo ? 13 : -6)} textAnchor="middle" className="dp-esf-valor" data-signo={signo(c.signo)}>
                      {c.texto}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
          {/* Bajo el cursor: la sección del pórtico y lo que valen en ella las envolventes */}
          {cursor !== null && curvas.length > 0 && (
            <g className="dp-cursor" data-cursor-portico>
              <line x1={X(cursor)} x2={X(cursor)} y1={yTop - 8} y2={H - 6} />
              <text x={X(cursor) + (X(cursor) > W - 120 ? -6 : 6)} y={yCota - 8} textAnchor={X(cursor) > W - 120 ? "end" : "start"} className="dp-cursor-valor">
                x = {fmt(cursor - p.x[0], 2)} m
              </text>
              {curvas.map((e, i) => {
                const v = bandas[i]!.en(cursor);
                if (!v) return null;
                const izq = X(cursor) > W - 120;
                return (
                  <g key={e.id}>
                    <circle cx={X(cursor)} cy={bandas[i]!.Y(v.max)} r={2.6} />
                    <circle cx={X(cursor)} cy={bandas[i]!.Y(v.min)} r={2.6} />
                    <text x={X(cursor) + (izq ? -6 : 6)} y={yEsfuerzo(i) + 10} textAnchor={izq ? "end" : "start"} className="dp-cursor-valor">
                      {Math.abs(v.max - v.min) < 0.05 ? valorEsfuerzo(v.max) : `${valorEsfuerzo(v.min)} … ${valorEsfuerzo(v.max)}`}
                      {resiste(e.id, cursor)}
                      {apoyoEn(cursor) ? ` · dentro de ${apoyoEn(cursor)!.objeto}: se comprueba en la cara` : ""}
                    </text>
                  </g>
                );
              })}
            </g>
          )}
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
        <p key={a} className="msj warn" data-aviso-despiece>
          {a}
        </p>
      ))}
      <p className="nota">
        Cada barra cubre el tramo en que la comprobación cuenta con ella y sigue su anclaje (el básico, a 5 cm); las superiores de los apoyos cubren el cuarto de la luz y siguen además el decalaje, y bajo cada una va lo que sale a cada lado del eje de su apoyo. En un apoyo extremo, rectas si caben y, si no, con patilla. El largo es lo recto más las patillas, sin descontar los doblados; el desarrollo de los cercos es estimado. Un clic en un vano lo elige: su armado se cambia en Propiedades y el dibujo lo sigue.
      </p>
    </div>
  );
}
