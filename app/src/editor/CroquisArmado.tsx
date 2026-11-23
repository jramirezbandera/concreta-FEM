/**
 * El armado en barras, dibujado (CO6, `docs/fem3d/comprobaciones.md` §8.11): la sección a escala de un
 * tramo de pilar, el alzado de un vano de viga con sus tres zonas y la sección de cada una, y la
 * sección de una losa maciza o de los nervios de un reticular. Sigue a lo que se escribe en el
 * formulario del armado (el borrador, aunque esté a medias) y resalta el grupo del campo con el foco
 * o bajo el ratón.
 *
 * Dónde va cada barra lo dice `src/comprobaciones/dibujoArmado.ts`, con el recubrimiento de las
 * comprobaciones; aquí sólo se pinta.
 */
import type { CSSProperties, ReactNode } from "react";
import { areaDe, barrasDe, ramasDe, textoBarrasForjado, textoCercosPilar, type ArmadoForjado, type ArmadoTramoPilar, type ArmadoVanoViga, type ArmaduraForjado, type ArmaduraPunzonamiento, type BarrasCara, type BarrasForjado, type CercosViga } from "../../../src/comprobaciones/armado.ts";
import { alzadoPilar, alzadoVano, seccionPilarArmada, seccionVigaArmada, ZONAS_VANO, type AlzadoPilar, type GrupoBarras, type SeccionArmada, type ZonaVano } from "../../../src/comprobaciones/dibujoArmado.ts";
import type { DatosEsfuerzosArmado, GeometriaParte, PuntoEsfuerzo } from "../../../src/visor/comprobaciones.ts";
import { fmt } from "../fmt.ts";
import { useLetra } from "./CroquisForjado.tsx";

/** mm → cm, con un decimal si lo tiene. */
const cm = (mm: number) => String(Math.round(mm) / 10).replace(".", ",");
const barras = (b: BarrasCara) => `${b.n}Ø${b.diametro}`;
const cercos = (c: CercosViga) => `cØ${c.diametro}/${c.separacion}${ramasDe(c) !== 2 ? ` (${ramasDe(c)}R)` : ""}`;

/** El grupo del formulario (la ruta de su objeto en el armado) que resalta cada cosa dibujada. */
const RUTA_GRUPO: Record<GrupoBarras, readonly string[]> = {
  esquinas: ["esquinas"],
  caraB: ["caraB"],
  caraH: ["caraH"],
  anillo: ["anillo"],
  inferior: ["inferior"],
  superior: ["superior", "superiorInicio", "superiorFin"],
  piel: ["piel"],
};
const RUTAS_CERCOS = ["cercos", "cercosInicio", "cercosFin", "cercosPie", "cercosCabeza"];
const es = (activo: string | null, rutas: readonly string[]) => (activo !== null && rutas.includes(activo)) || undefined;

/** Una sección con su armado, a escala, en una caja de w × h px con sus cotas. */
export { Seccion as SeccionDibujada };
function Seccion({ s, w, h, x0 = 0, y0 = 0, activo, titulo, cotaY = true }: { s: SeccionArmada; w: number; h: number; x0?: number; y0?: number; activo: string | null; titulo?: string; cotaY?: boolean }) {
  const [mx, my] = [26, titulo ? 24 : 18];
  const k = Math.min((w - 2 * mx) / s.ancho, (h - 2 * my) / s.alto);
  const X = (x: number) => x0 + w / 2 + x * k;
  const Y = (y: number) => y0 + h / 2 - y * k + (titulo ? 5 : 0);
  const [a, b] = [s.ancho * k, s.alto * k];
  const c = s.cerco;
  return (
    <g data-seccion-armada>
      {titulo && (
        <text x={x0 + w / 2} y={y0 + 11} textAnchor="middle" className="ca-titulo">
          {titulo}
        </text>
      )}
      {s.forma === "circular" ? <circle cx={X(0)} cy={Y(0)} r={a / 2} className="cq-hormigon" /> : <rect x={X(-s.ancho / 2)} y={Y(s.alto / 2)} width={a} height={b} className="cq-hormigon" />}
      {c &&
        (s.forma === "circular" ? (
          <circle cx={X(0)} cy={Y(0)} r={(c.ancho * k) / 2} className="ca-cerco" data-activo={es(activo, RUTAS_CERCOS)} style={{ strokeWidth: Math.max(c.diametro * k, 1.1) }} />
        ) : (
          <rect x={X(-c.ancho / 2)} y={Y(c.alto / 2)} width={c.ancho * k} height={c.alto * k} rx={Math.min(2 * c.diametro * k, 6)} className="ca-cerco" data-activo={es(activo, RUTAS_CERCOS)} style={{ strokeWidth: Math.max(c.diametro * k, 1.1) }} />
        ))}
      {c && s.ramas.map((x, i) => <line key={i} x1={X(x)} x2={X(x)} y1={Y(c.alto / 2)} y2={Y(-c.alto / 2)} className="ca-cerco" data-activo={es(activo, RUTAS_CERCOS)} style={{ strokeWidth: Math.max(c.diametro * k, 1.1) }} />)}
      {s.barras.map((q, i) => (
        <circle key={i} cx={X(q.x)} cy={Y(q.y)} r={Math.max((q.diametro * k) / 2, 2.2)} className="ca-barra" data-grupo={q.grupo} data-activo={es(activo, RUTA_GRUPO[q.grupo])} />
      ))}
      <text x={X(0)} y={Y(-s.alto / 2) + 13} textAnchor="middle">
        {s.cotas.x} {cm(s.ancho)}
      </text>
      {cotaY && (
        <text x={X(-s.ancho / 2) - 5} y={Y(0) + 4} textAnchor="end">
          {s.cotas.y} {cm(s.alto)}
        </text>
      )}
    </g>
  );
}

/** Una entrada de la leyenda del croquis: el punto de su grupo y su texto. */
function Entrada({ grupo, children, activo }: { grupo: GrupoBarras | "cercos"; children: ReactNode; activo?: boolean | undefined }) {
  return (
    <span className="ca-entrada" data-activo={activo}>
      <i data-grupo={grupo} />
      {children}
    </span>
  );
}

function Avisos({ avisos }: { avisos: readonly string[] }) {
  return avisos.length ? <span className="ca-aviso">{avisos.join(" ")}</span> : null;
}

const SIN_SECCION = <div className="croquis croquis-vacio">La sección no es rectangular ni circular: su armado no se dibuja.</div>;

const ZONA_PILAR = { pie: { nombre: "Pie", ruta: "cercosPie" }, centro: { nombre: "Centro", ruta: "cercos" }, cabeza: { nombre: "Cabeza", ruta: "cercosCabeza" } } as const;

/**
 * El tramo de un pilar en alzado (CO1-f): entre las caras de sus dos nudos, con cada cerco en su sitio
 * y sus zonas (pie, centro y cabeza) acotadas y rotuladas con los cercos que llevan.
 */
function AlzadoTramo({ al, lado, x0, h, activo }: { al: AlzadoPilar; lado: number; x0: number; h: number; activo: string | null }) {
  const [yt, yb] = [34, h - 28];
  const k = (yb - yt) / Math.max(al.libre, 1e-9);
  const Y = (s: number) => yb - s * k;
  const ancho = Math.min(Math.max((lado / 1000) * k, 22), 60);
  const xc = x0 + 54;
  const [xa, xb] = [xc - ancho / 2, xc + ancho / 2];
  return (
    <g data-alzado-pilar>
      <text x={xc} y={11} textAnchor="middle" className="ca-titulo">
        Tramo · {fmt(al.libre, 2)} m libres
      </text>
      {/* Los nudos de arriba y de abajo, y el tramo entre sus caras */}
      <rect x={xa - 18} y={yt - 12} width={ancho + 36} height={12} className="cq-hormigon" />
      <rect x={xa - 18} y={yb} width={ancho + 36} height={12} className="cq-hormigon" />
      <rect x={xa} y={yt} width={ancho} height={yb - yt} className="cq-hormigon" />
      {al.zonas.map((z) => {
        if (!z.cercos || !z.posiciones.length) return null;
        const px = (k * z.cercos.separacion) / 1000;
        const salto = Math.max(1, Math.ceil(2.5 / Math.max(px, 1e-9)));
        return (
          <g key={z.zona} className="ca-cerco" data-fino data-zona={z.zona} data-activo={es(activo, [z.propios ? ZONA_PILAR[z.zona].ruta : "cercos"])}>
            {z.posiciones.filter((_, i) => i % salto === 0).map((s, i) => (
              <line key={i} x1={xa + 2.5} x2={xb - 2.5} y1={Y(s)} y2={Y(s)} />
            ))}
          </g>
        );
      })}
      {/* Las barras, por dentro de los cercos, entrando en los nudos */}
      <line x1={xa + 4} x2={xa + 4} y1={yt - 9} y2={yb + 9} className="ca-linea" />
      <line x1={xb - 4} x2={xb - 4} y1={yt - 9} y2={yb + 9} className="ca-linea" />
      {/* Cada zona: su llave, lo que mide y sus cercos contados */}
      {al.zonas.map((z) => {
        const [y1, y2] = [Y(z.hasta), Y(z.desde)];
        const ym = (y1 + y2) / 2;
        const on = es(activo, [z.propios ? ZONA_PILAR[z.zona].ruta : "cercos"]);
        return (
          <g key={z.zona} data-zona-pilar={z.zona}>
            <path d={`M ${xb + 7} ${y1 + 1.5} h 5 V ${y2 - 1.5} h -5`} className="cq-guia" fill="none" />
            <text x={xb + 18} y={ym - 2}>
              {ZONA_PILAR[z.zona].nombre} · {fmt(z.hasta - z.desde, 2)} m
            </text>
            <text x={xb + 18} y={ym + 11} className="ca-rotulo" data-activo={on}>
              {z.cercos ? `${z.posiciones.length} cØ${z.cercos.diametro}/${z.cercos.separacion}` : "sin cercos"}
            </text>
          </g>
        );
      })}
    </g>
  );
}

const ESFUERZOS_PILAR = [
  { id: "N", titulo: "N", unidad: "kN" },
  { id: "My", titulo: "My", unidad: "kN·m" },
  { id: "Mz", titulo: "Mz", unidad: "kN·m" },
] as const;

/** La envolvente de ELU de un esfuerzo a lo largo del tramo, junto a su alzado y a su misma altura: el máximo y el mínimo, con sus valores en el pie y en la cabeza. */
function EsfuerzoTramo({ titulo, unidad, tramos, libre, x0, w, h }: { titulo: string; unidad: string; tramos: PuntoEsfuerzo[][]; libre: number; x0: number; w: number; h: number }) {
  const [yt, yb] = [34, h - 28];
  const k = (yb - yt) / Math.max(libre, 1e-9);
  const Y = (s: number) => yb - s * k;
  const todos = tramos.flat();
  const tope = Math.max(1e-9, ...todos.flatMap((p) => [Math.abs(p.max), Math.abs(p.min)]));
  const xc = x0 + w / 2;
  const medio = w / 2 - 12;
  const X = (v: number) => xc + (v / tope) * medio;
  const valor = (v: number) => fmt(v, Math.abs(v) < 9.95 ? 1 : 0);
  const [pie, cabeza] = [todos[0], todos[todos.length - 1]];
  return (
    <g data-esfuerzo-pilar={titulo}>
      <text x={xc} y={11} textAnchor="middle" className="ca-titulo">
        {titulo} <tspan className="ca-unidad">{unidad}</tspan>
      </text>
      <line x1={xc} x2={xc} y1={yt} y2={yb} className="cq-eje" />
      {tramos.map((t, i) => {
        const banda = `M ${X(t[0]!.min)} ${Y(t[0]!.x)} ${t.map((p) => `L ${X(p.min)} ${Y(p.x)}`).join(" ")} ${[...t].reverse().map((p) => `L ${X(p.max)} ${Y(p.x)}`).join(" ")} Z`;
        return (
          <g key={i}>
            <path d={banda} className="ca-esf-banda" />
            <path d={`M ${t.map((p) => `${X(p.max)} ${Y(p.x)}`).join(" L ")}`} className="ca-esf-linea" />
            <path d={`M ${t.map((p) => `${X(p.min)} ${Y(p.x)}`).join(" L ")}`} className="ca-esf-linea" />
          </g>
        );
      })}
      {cabeza && (
        <text x={xc} y={yt - 5} textAnchor="middle" className="ca-esf-valor">
          {valor(cabeza.min)} … {valor(cabeza.max)}
        </text>
      )}
      {pie && (
        <text x={xc} y={yb + 13} textAnchor="middle" className="ca-esf-valor">
          {valor(pie.min)} … {valor(pie.max)}
        </text>
      )}
    </g>
  );
}

/**
 * La sección de un tramo de pilar con su armado. Con `libre` (el tramo entre las caras de sus nudos),
 * además su alzado con las zonas de cercos (CO1-f) y, con `esfuerzos`, las envolventes de ELU de N, My
 * y Mz a su misma altura (§8.14).
 */
export function CroquisPilar({
  seccion,
  armado,
  recubrimiento,
  activo,
  grande,
  libre,
  solapes,
  esfuerzos,
}: {
  seccion: { b: number; h: number } | { D: number } | undefined;
  armado: Partial<ArmadoTramoPilar> | undefined;
  recubrimiento: number;
  activo: string | null;
  grande?: boolean;
  libre?: number | undefined;
  solapes?: Readonly<Record<number, number>> | undefined;
  esfuerzos?: DatosEsfuerzosArmado | null | undefined;
}) {
  const [WS, H] = grande ? [340, 310] : [300, 210];
  const al = seccion && libre !== undefined && libre > 0 ? alzadoPilar(seccion, libre, armado, solapes) : null;
  const curvas = al && esfuerzos ? ESFUERZOS_PILAR.flatMap((e) => (esfuerzos.esfuerzos[e.id]?.length ? [{ ...e, tramos: esfuerzos.esfuerzos[e.id]! }] : [])) : [];
  const [WA, WE] = [al ? 236 : 0, 104];
  const W = WS + WA + curvas.length * WE;
  const [svg, letra] = useLetra(W);
  if (!seccion) return SIN_SECCION;
  const s = seccionPilarArmada(seccion, armado, recubrimiento);
  const completo = !!armado && s.barras.length > 0 && !!armado.cercos && (armado.anillo ? true : armado.esquinas !== undefined);
  const As = completo ? areaDe(armado as ArmadoTramoPilar) : 0;
  const Ac = "D" in seccion ? (Math.PI * seccion.D ** 2) / 4 : seccion.b * seccion.h;
  const a = armado ?? {};
  return (
    <figure className="croquis" data-croquis-armado="pilar">
      <svg ref={svg} style={letra} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`Sección del pilar con ${s.barras.length} barras${al ? ", su tramo en alzado con las zonas de cercos" : ""}${curvas.length ? " y sus esfuerzos" : ""}`}>
        <Seccion s={s} w={WS} h={H} activo={activo} />
        {!s.barras.length && (
          <text x={WS / 2} y={H / 2 + 4} textAnchor="middle" className="ca-falta">
            sin armado
          </text>
        )}
        {al && <AlzadoTramo al={al} lado={"D" in seccion ? seccion.D : seccion.h} x0={WS} h={H} activo={activo} />}
        {al && curvas.map((e, i) => <EsfuerzoTramo key={e.id} titulo={e.titulo} unidad={e.unidad} tramos={e.tramos} libre={al.libre} x0={WS + WA + i * WE} w={WE} h={H} />)}
      </svg>
      <figcaption>
        {a.anillo?.n ? <Entrada grupo="anillo" activo={es(activo, ["anillo"])}>{barras(a.anillo)} en el anillo</Entrada> : null}
        {a.esquinas ? <Entrada grupo="esquinas" activo={es(activo, ["esquinas"])}>4Ø{a.esquinas} en las esquinas</Entrada> : null}
        {a.caraB?.n && a.caraB.diametro ? <Entrada grupo="caraB" activo={es(activo, ["caraB"])}>{2 * a.caraB.n}Ø{a.caraB.diametro} en las caras b</Entrada> : null}
        {a.caraH?.n && a.caraH.diametro ? <Entrada grupo="caraH" activo={es(activo, ["caraH"])}>{2 * a.caraH.n}Ø{a.caraH.diametro} en las caras h</Entrada> : null}
        {a.cercos?.diametro && a.cercos.separacion ? (
          <Entrada grupo="cercos" activo={es(activo, RUTAS_CERCOS)}>
            cercos {textoCercosPilar(a as ArmadoTramoPilar)}
            {al ? ` · ${al.cercos} en el tramo` : ""}
          </Entrada>
        ) : null}
        {curvas.length > 0 && <span className="ca-dato">Esfuerzos: el mínimo y el máximo de {esfuerzos!.combinaciones}, a la altura del tramo; arriba, los de la cabeza y abajo, los del pie.</span>}
        {completo && (
          <span className="ca-dato" data-as>
            {barrasDe(armado as ArmadoTramoPilar)} barras · As = {fmt(As / 100, 2)} cm² · ρ = {fmt((100 * As) / Ac, 2)} %
          </span>
        )}
        <Avisos avisos={s.avisos} />
      </figcaption>
    </figure>
  );
}

const NOMBRE_ZONA: Record<ZonaVano, string> = { inicio: "Apoyo de inicio", centro: "Centro", fin: "Apoyo del fin" };

/** El alzado de un vano de viga con sus tres zonas, y la sección de cada una. */
export function CroquisViga({ g, armado, recubrimiento, activo, grande }: { g: Extract<GeometriaParte, { tipo: "vigas" }>; armado: Partial<ArmadoVanoViga> | undefined; recubrimiento: number; activo: string | null; grande?: boolean }) {
  const W = grande ? 720 : 330;
  const [HA, HS] = grande ? [170, 250] : [140, 140];
  const [svg, letra] = useLetra(W);
  const al = alzadoVano(g.luz, armado);
  // El alzado: la viga entre sus apoyos, con el canto exagerado (la luz no cabe a su escala)
  const ap = 16;
  const [x0, x1] = [ap + 8, W - ap - 8];
  // De arriba abajo: la superior de cada zona, la viga, la inferior, los cercos de cada zona y la luz
  const [yt, yb] = [26, HA - 74];
  const X = (s: number) => x0 + (g.luz > 0 ? s / g.luz : 0) * (x1 - x0);
  const variasSup = al.zonas.some((z) => z.superiorPropia);
  const variosCercos = al.zonas.some((z) => z.cercosPropios);
  const distintas = variasSup || variosCercos;
  const zonasSeccion: ZonaVano[] = distintas ? [...ZONAS_VANO] : ["centro"];
  const ws = W / (grande ? Math.max(zonasSeccion.length, 2) : 3);
  const off = (W - ws * zonasSeccion.length) / 2;
  const secciones = g.seccion ? zonasSeccion.map((z) => seccionVigaArmada(g.seccion!, armado, z, recubrimiento)) : [];
  const avisos = [...new Set(secciones.flatMap((s) => s.avisos))];
  const rutaSup = (z: ZonaVano) => (z === "inicio" ? "superiorInicio" : z === "fin" ? "superiorFin" : "superior");
  const rutaCer = (z: ZonaVano) => (z === "inicio" ? "cercosInicio" : z === "fin" ? "cercosFin" : "cercos");
  return (
    <figure className="croquis" data-croquis-armado="viga">
      <svg ref={svg} style={letra} viewBox={`0 0 ${W} ${HA + (g.seccion ? HS : 0)}`} width={W} height={HA + (g.seccion ? HS : 0)} role="img" aria-label="Alzado del vano con su armado y sus secciones">
        {/* Los apoyos: el pilar o la viga de cada extremo; un extremo libre, sin él */}
        {g.apoyos.map((a, i) => {
          const x = i === 0 ? x0 - ap : x1;
          return a ? (
            <g key={i}>
              <rect x={x} y={yt} width={ap} height={yb - yt + 10} className="cq-hormigon" />
              <text x={i === 0 ? 2 : W - 2} y={HA - 8} textAnchor={i === 0 ? "start" : "end"}>
                {a}
              </text>
            </g>
          ) : (
            <text key={i} x={i === 0 ? 2 : W - 2} y={HA - 8} textAnchor={i === 0 ? "start" : "end"}>
              libre
            </text>
          );
        })}
        <rect x={x0} y={yt} width={x1 - x0} height={yb - yt} className="cq-hormigon" />
        {/* Las zonas: los cuartos de la luz junto a los apoyos */}
        {distintas && [g.luz / 4, (3 * g.luz) / 4].map((s, i) => <line key={i} x1={X(s)} x2={X(s)} y1={yt - 6} y2={yb + 44} className="cq-eje" />)}
        {al.zonas.map((z) => {
          if (!z.cercos || !z.posiciones.length) return null;
          const px = ((x1 - x0) * z.cercos.separacion) / 1000 / Math.max(g.luz, 1e-9);
          const salto = Math.max(1, Math.ceil(3 / Math.max(px, 1e-9)));
          return (
            <g key={z.zona} className="ca-cerco" data-fino data-activo={es(activo, [z.cercosPropios ? rutaCer(z.zona) : "cercos"])}>
              {z.posiciones.filter((_, i) => i % salto === 0).map((s, i) => (
                <line key={i} x1={X(s)} x2={X(s)} y1={yt + 4} y2={yb - 4} />
              ))}
            </g>
          );
        })}
        {/* La superior corrida y, en las zonas de apoyo con la suya, otra línea debajo */}
        {al.zonas[1].superior && <line x1={x0 - (g.apoyos[0] ? ap - 4 : 0)} x2={x1 + (g.apoyos[1] ? ap - 4 : 0)} y1={yt + 5} y2={yt + 5} className="ca-linea" data-grupo="superior" data-activo={es(activo, ["superior"])} />}
        {al.zonas.map((z) =>
          z.superiorPropia ? (
            <line key={z.zona} x1={z.zona === "inicio" ? x0 - (g.apoyos[0] ? ap - 4 : 0) : X(z.desde) - 8} x2={z.zona === "fin" ? x1 + (g.apoyos[1] ? ap - 4 : 0) : X(z.hasta) + 8} y1={yt + 10} y2={yt + 10} className="ca-linea" data-grupo="superior" data-grueso data-activo={es(activo, [rutaSup(z.zona)])} />
          ) : null,
        )}
        {al.inferior && <line x1={x0 - (g.apoyos[0] ? ap - 4 : 0)} x2={x1 + (g.apoyos[1] ? ap - 4 : 0)} y1={yb - 5} y2={yb - 5} className="ca-linea" data-grupo="inferior" data-activo={es(activo, ["inferior"])} />}
        {al.piel && <line x1={x0} x2={x1} y1={(yt + yb) / 2} y2={(yt + yb) / 2} className="ca-linea" data-grupo="piel" data-activo={es(activo, ["piel"])} />}
        {/* Los rótulos: arriba, la superior de cada zona; abajo, la inferior y los cercos */}
        {al.zonas.map((z) => {
          const xm = (X(z.desde) + X(z.hasta)) / 2;
          const sup = z.zona === "centro" ? z.superior : z.superiorPropia ? z.superior : undefined;
          const cer = z.zona === "centro" ? z.cercos : z.cercosPropios ? z.cercos : undefined;
          return (
            <g key={z.zona}>
              {sup && (
                <text x={xm} y={yt - 8} textAnchor="middle" className="ca-rotulo" data-grupo="superior" data-activo={es(activo, [rutaSup(z.zona)])}>
                  {z.zona === "centro" ? "sup " : ""}
                  {barras(sup)}
                </text>
              )}
              {cer && (
                <text x={xm} y={yb + 38} textAnchor="middle" className="ca-rotulo" data-grupo="cercos" data-activo={es(activo, [rutaCer(z.zona)])}>
                  {cercos(cer)}
                </text>
              )}
            </g>
          );
        })}
        {al.inferior && (
          <text x={(x0 + x1) / 2} y={yb + 20} textAnchor="middle" className="ca-rotulo" data-grupo="inferior" data-activo={es(activo, ["inferior"])}>
            inf {barras(al.inferior)}
          </text>
        )}
        <text x={(x0 + x1) / 2} y={HA - 8} textAnchor="middle">
          luz {fmt(g.luz, 2)} m{distintas ? " · apoyos: L/4" : ""}
        </text>
        {!al.inferior && !al.zonas[1].superior && (
          <text x={(x0 + x1) / 2} y={(yt + yb) / 2 + 4} textAnchor="middle" className="ca-falta">
            sin armado
          </text>
        )}
        {secciones.map((s, i) => (
          <Seccion key={zonasSeccion[i]} s={s} w={ws} h={HS} x0={off + i * ws} y0={HA} activo={activo} titulo={distintas ? NOMBRE_ZONA[zonasSeccion[i]!] : "Sección"} cotaY={i === 0} />
        ))}
      </svg>
      <figcaption>
        {al.inferior && <Entrada grupo="inferior" activo={es(activo, ["inferior"])}>inferior {barras(al.inferior)}</Entrada>}
        {al.zonas[1].superior && (
          <Entrada grupo="superior" activo={es(activo, RUTA_GRUPO.superior)}>
            superior {barras(al.zonas[1].superior)}
            {variasSup ? ` (${al.zonas.filter((z) => z.superiorPropia).map((z) => `${z.zona} ${barras(z.superior!)}`).join(", ")})` : ""}
          </Entrada>
        )}
        {al.zonas[1].cercos && (
          <Entrada grupo="cercos" activo={es(activo, RUTAS_CERCOS)}>
            {cercos(al.zonas[1].cercos)}
            {variosCercos ? ` (${al.zonas.filter((z) => z.cercosPropios).map((z) => `${z.zona} ${cercos(z.cercos!)}`).join(", ")})` : ""}
          </Entrada>
        )}
        {al.piel && <Entrada grupo="piel" activo={es(activo, ["piel"])}>piel {barras(al.piel)} por cara</Entrada>}
        {!g.seccion && <span className="ca-dato">La sección no es rectangular: no se dibuja.</span>}
        <Avisos avisos={avisos} />
      </figcaption>
    </figure>
  );
}

const ARMADURAS: readonly ArmaduraForjado[] = ["x-inf", "x-sup", "y-inf", "y-sup"];
const NOMBRE_ARMADURA: Record<ArmaduraForjado, string> = { "x-inf": "X inferior", "x-sup": "X superior", "y-inf": "Y inferior", "y-sup": "Y superior" };
const vale = (b: Partial<BarrasForjado> | undefined): b is BarrasForjado => !!b && typeof b.diametro === "number" && b.diametro > 0 && ((typeof b.separacion === "number" && b.separacion > 0) || (typeof b.n === "number" && b.n > 0));

/**
 * La sección de una losa con su armadura base. Maciza (y los ábacos de un reticular): un metro de
 * losa cortado por un plano perpendicular a las barras X, que se ven de punta, con las Y por dentro
 * (como las toma la comprobación). Reticular: el nervio de cada dirección, con sus barras de punta.
 */
export function CroquisLosa({ g, armado, recubrimiento, activo }: { g: Extract<GeometriaParte, { tipo: "losas" }>; armado: Partial<ArmadoForjado> | undefined; recubrimiento: number; activo: string | null }) {
  const W = 330;
  const [svg, letra] = useLetra(W);
  const base = (armado?.base ?? {}) as Partial<Record<ArmaduraForjado, Partial<BarrasForjado>>>;
  const abacos = (armado?.abacos ?? {}) as Partial<Record<ArmaduraForjado, Partial<BarrasForjado>>>;
  const ret = g.reticular;
  const t = g.espesor;
  const act = (raiz: string, k: ArmaduraForjado) => es(activo, [`${raiz}.${k}`]);
  /** Un metro de losa maciza (o de ábaco) con su parrilla, en (x0, y0) con w px de ancho. */
  const parrilla = (r: typeof base, raiz: string, x0: number, y0: number, w: number, titulo: string | null) => {
    const k = w / 1000;
    const h = t * k;
    const Y = (desdeAbajo: number) => y0 + h - desdeAbajo * k;
    const [xi, xs, yi, ys] = [r["x-inf"], r["x-sup"], r["y-inf"], r["y-sup"]];
    const puntos = (b: Partial<BarrasForjado> | undefined, y: number, a: ArmaduraForjado) =>
      vale(b) && b.separacion
        ? Array.from({ length: Math.min(200, Math.max(1, Math.floor(1000 / b.separacion))) }, (_, i) => <circle key={`${a}${i}`} cx={x0 + (b.separacion! / 2 + i * b.separacion!) * k} cy={y} r={Math.max((b.diametro * k) / 2, 2)} className="ca-barra" data-grupo={a.endsWith("inf") ? "inferior" : "superior"} data-activo={act(raiz, a)} />)
        : null;
    const linea = (b: Partial<BarrasForjado> | undefined, y: number, a: ArmaduraForjado) => (vale(b) ? <line x1={x0 + 3} x2={x0 + w - 3} y1={y} y2={y} className="ca-linea" data-grupo={a.endsWith("inf") ? "inferior" : "superior"} data-activo={act(raiz, a)} /> : null);
    const [oxi, oxs] = [vale(xi) ? xi.diametro : 0, vale(xs) ? xs.diametro : 0];
    return (
      <g>
        {titulo && (
          <text x={x0 + w / 2} y={y0 - 6} textAnchor="middle" className="ca-titulo">
            {titulo}
          </text>
        )}
        <rect x={x0} y={y0} width={w} height={h} className="cq-hormigon" />
        {puntos(xi, Y(recubrimiento + oxi / 2), "x-inf")}
        {linea(yi, Y(recubrimiento + oxi + (vale(yi) ? yi.diametro : 0) / 2) - 1, "y-inf")}
        {puntos(xs, Y(t - recubrimiento - oxs / 2), "x-sup")}
        {linea(ys, Y(t - recubrimiento - oxs - (vale(ys) ? ys.diametro : 0) / 2) + 1, "y-sup")}
      </g>
    );
  };
  /** El nervio de una dirección (un intereje de ancho), con sus barras de punta. */
  const nervio = (dir: "x" | "y", x0: number, y0: number, w: number) => {
    const r = ret!;
    const k = w / r.intereje;
    const h = t * k;
    const [bw, hf] = [r.nervio * k, r.capa * k];
    const xm = x0 + w / 2;
    const fila = (a: ArmaduraForjado, y: number) => {
      const b = base[a];
      if (!vale(b) || !b.n) return null;
      const medio = Math.max(0, r.nervio / 2 - recubrimiento - b.diametro / 2) * k;
      const xs = b.n === 1 ? [0] : Array.from({ length: b.n }, (_, i) => -medio + (2 * medio * i) / (b.n! - 1));
      return xs.map((x, i) => <circle key={`${a}${i}`} cx={xm + x} cy={y} r={Math.max((b.diametro * k) / 2, 2)} className="ca-barra" data-grupo={a.endsWith("inf") ? "inferior" : "superior"} data-activo={act("base", a)} />);
    };
    const [inf, sup] = [`${dir}-inf` as ArmaduraForjado, `${dir}-sup` as ArmaduraForjado];
    const d = (a: ArmaduraForjado) => (vale(base[a]) ? base[a]!.diametro! : 0);
    return (
      <g>
        <text x={xm} y={y0 - 6} textAnchor="middle" className="ca-titulo">
          Nervio {dir.toUpperCase()}
        </text>
        <path d={`M${x0} ${y0}H${x0 + w}V${y0 + hf}H${xm + bw / 2}V${y0 + h}H${xm - bw / 2}V${y0 + hf}H${x0}Z`} className="cq-hormigon" />
        {fila(inf, y0 + h - (recubrimiento + d(inf) / 2) * k)}
        {fila(sup, y0 + (recubrimiento + d(sup) / 2) * k)}
        <text x={xm} y={y0 + h + 13} textAnchor="middle">
          {cm(r.nervio)} · cada {cm(r.intereje)}
        </text>
      </g>
    );
  };
  const hayAbacos = ARMADURAS.some((a) => vale(abacos[a]));
  const wn = 118;
  const hn = ret ? (t * wn) / ret.intereje : 0;
  const hp = (t * 300) / 1000;
  const H = ret ? 20 + hn + 22 + (hayAbacos ? 22 + hp + 8 : 0) : 14 + hp + 22;
  const texto = (r: typeof base, a: ArmaduraForjado) => (vale(r[a]) ? `${textoBarrasForjado(r[a] as BarrasForjado)}${r[a]!.n !== undefined ? " por nervio" : ""}` : "—");
  return (
    <figure className="croquis" data-croquis-armado="losa">
      <svg ref={svg} style={letra} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Sección de la losa con su armadura base">
        {ret ? (
          <>
            {nervio("x", 30, 20, wn)}
            {nervio("y", W - 30 - wn, 20, wn)}
            {hayAbacos && parrilla(abacos, "abacos", 15, 20 + hn + 22 + 22, 300, "Ábacos: un metro de losa")}
          </>
        ) : (
          <>
            {parrilla(base, "base", 15, 8, 300, null)}
            <text x={15 + 300 + 6} y={8 + hp / 2 + 4}>
              {cm(t)}
            </text>
            <text x={15 + 150} y={8 + hp + 14} textAnchor="middle">
              1 m de losa · las X, de punta; las Y, por dentro
            </text>
          </>
        )}
      </svg>
      <figcaption>
        {ARMADURAS.map((a) => (
          <Entrada key={a} grupo={a.endsWith("inf") ? "inferior" : "superior"} activo={act("base", a)}>
            {NOMBRE_ARMADURA[a]} {texto(base, a)}
          </Entrada>
        ))}
        {hayAbacos && <span className="ca-dato">Ábacos: {ARMADURAS.map((a) => `${NOMBRE_ARMADURA[a]} ${texto(abacos, a)}`).join(" · ")}</span>}
      </figcaption>
    </figure>
  );
}

/**
 * La armadura de punzonamiento de una unión: la planta del pilar con el perímetro crítico (a 2·d) y
 * los perímetros de cercos, sólo en un pilar interior (en uno de borde o de esquina, lo que hay
 * depende del borde de la losa: se ve en la planta).
 */
export function CroquisPunzonamiento({ g, armado, activo }: { g: Extract<GeometriaParte, { tipo: "punzonamiento" }>; armado: Partial<ArmaduraPunzonamiento> | undefined; activo: string | null }) {
  const [W, H] = [300, 220];
  const [svg, letra] = useLetra(W);
  const sc = g.seccion;
  if (!sc || !g.d) return null;
  const d = g.d;
  // En planta, como el pilar con giro 0: el canto h según x
  const [a, b] = "D" in sc ? [sc.D, sc.D] : [sc.h, sc.b];
  const fuera = Math.max(2 * d, g.alcance ?? 0);
  const k = Math.min((W - 30) / (a + 2 * fuera), (H - 34) / (b + 2 * fuera));
  const [cx, cy] = [W / 2, H / 2 - 6];
  /** El contorno a una distancia r de la cara del pilar (esquinas redondeadas; de un circular, otro círculo). */
  const contorno = (r: number, props: { className: string; style?: CSSProperties; "data-activo"?: boolean | undefined }, key?: number) =>
    "D" in sc ? <circle key={key} cx={cx} cy={cy} r={(sc.D / 2 + r) * k} {...props} /> : <rect key={key} x={cx - (a / 2 + r) * k} y={cy - (b / 2 + r) * k} width={(a + 2 * r) * k} height={(b + 2 * r) * k} rx={r * k} {...props} />;
  const sr = armado?.separacion;
  const n = g.perimetros ?? 0;
  const radios = sr && n ? Array.from({ length: n }, (_, i) => (g.alcance ?? 0) - (n - 1 - i) * sr).filter((r) => r > 0) : [];
  const interior = g.posicion === "interior";
  return (
    <figure className="croquis" data-croquis-armado="punzonamiento">
      <svg ref={svg} style={letra} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Planta del pilar con el perímetro crítico y los perímetros de cercos">
        {contorno(2 * d, { className: "ca-critico" })}
        {radios.map((r, i) => contorno(r, { className: "ca-cerco", "data-activo": es(activo, ["diametro", "ramas", "separacion"]) }, i))}
        {contorno(0, { className: "cq-hormigon" })}
        <text x={cx} y={cy + (b / 2 + 2 * d) * k + 14} textAnchor="middle">
          perímetro crítico, a 2·d = {cm(2 * d)}
        </text>
      </svg>
      <figcaption>
        {radios.length > 0 && armado?.diametro ? (
          <Entrada grupo="cercos" activo={es(activo, ["diametro", "ramas", "separacion"])}>
            {radios.length} perímetros de cercos Ø{armado.diametro}, cada {sr} mm, hasta {cm(g.alcance ?? 0)} cm de la cara
          </Entrada>
        ) : (
          <span className="ca-dato">Sin armadura de punzonamiento.</span>
        )}
        {!interior && <span className="ca-dato">Pilar de {g.posicion}: los perímetros se cortan en el borde de la losa (aquí, enteros).</span>}
      </figcaption>
    </figure>
  );
}
