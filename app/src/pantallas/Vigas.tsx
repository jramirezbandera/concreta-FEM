/**
 * Resultados · Diagramas (la pantalla 4 de V1, Vigas): la planta con los diagramas de A4
 * (`vistaDiagramas`) y, en el panel inferior, el alzado de la pieza elegida con su envolvente
 * (`envolventePieza`) y un cursor por estaciones que da el máximo y el mínimo con su combinación
 * (`estacion`). En Propiedades, la estación y los vanos de cara a cara de `fem consultar pieza`; en el
 * navegador, las vigas de la planta.
 *
 * Convenio (cabecera de src/motor/modelo.ts): My > 0 tracciona la cara inferior y se dibuja hacia
 * abajo, del lado de las tracciones; Vz, T y N, positivos hacia arriba.
 *
 * I4: un 3D dibuja los diagramas de todas las barras (o los de la planta elegida en su cabecera) en
 * sus ejes locales (`diagramas3d`), y un alzado, los de las barras de su plano con el esfuerzo en el
 * plano (`vistaAlzadoDiagramas`: My y Mz dan M; Vz y Vy, V). Un clic en una pieza la elige; bajo el
 * cursor, en el 3D, el máximo y el mínimo de la estación más cercana de la barra (`estacion`). Se puede
 * elegir cualquier viga, vigueta o pilar, de cualquier planta: el de un pilar es su alzado a lo largo
 * de su altura y, en Propiedades, su cuadro por tramos.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { EsfuerzoPlano } from "../../../src/agente/render/index.ts";
import type { DatosEstacion, DatosViga, Esfuerzo, FilaPilar } from "../../../src/visor/datos.ts";
import type { PiezasDiagrama } from "../../../src/visor/diagramas3d.ts";
import type { Eleccion } from "../../../src/visor/escena.ts";
import type { EleccionCombinaciones, VistaPlanta } from "../../../src/visor/sesion.ts";
import { Chip, Desplegable, Disposicion, Segmentado, Separador } from "../armazon/Disposicion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { Aviso, ComboCombinaciones, Seccion, TablaCombinaciones } from "../componentes/comunes.tsx";
import { BarraModos } from "../espacios/BarraModos.tsx";
import { useVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { queCombinaciones, useSonda } from "../vistas/sonda.ts";
import { Fuente2D, Fuente3DModelo, FuenteEscena, ZonaVistas } from "../vistas/Zona.tsx";
import { useEleccion } from "./useEleccion.ts";

/** Los diagramas de las vigas de una planta, en una vista: un clic elige la viga o la vigueta. */
function PlantaDiagramas({ planta, vista, id, cargando }: { planta: string; vista: VistaPlanta; id: string | null; cargando: boolean }) {
  const { proyecto, setSeleccion } = useVisor();
  const fuente = { tipo: "planta" as const, planta, vista };
  const escena = usePedido(proyecto.cliente, { tipo: "escena", planta, vista });
  const resaltado = useEleccion(fuente, id);
  const clic = async (p: Vec2, radio: number) => {
    if (!proyecto.cliente) return;
    const r = await proyecto.cliente.pedir({ tipo: "elegir", fuente, punto: p, radio });
    const o = r.ok ? (r.valor as Eleccion | null)?.objeto : null;
    // Sólo las piezas con diagrama: vigas y viguetas
    if (o && ((proyecto.edicion?.proyecto.modelo.vigas ?? []).some((v) => v.id === o) || o.includes(":v") || !proyecto.edicion)) setSeleccion(o);
  };
  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : escena.diagnosticos ? <Aviso tono="fail">{escena.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !escena.datos && escena.cargando ? <Aviso>Preparando los diagramas…</Aviso> : null;
  return <Fuente2D escena={proyecto.desactualizado ? null : escena.datos} resaltado={resaltado} eventos={{ clic: (p, r) => void clic(p, r) }} aviso={aviso} cargando={escena.cargando || cargando} />;
}

const ESFUERZOS: { id: Esfuerzo; unidad: string; abajo: boolean; plano: EsfuerzoPlano; title: string }[] = [
  { id: "My", unidad: "kN·m", abajo: true, plano: "M", title: "My: flexión en el plano x-z de la barra (la vertical de las vigas)" },
  { id: "Mz", unidad: "kN·m", abajo: true, plano: "M", title: "Mz: flexión en el plano x-y de la barra (la otra de los pilares)" },
  { id: "Vz", unidad: "kN", abajo: false, plano: "V", title: "Vz: cortante según z (el vertical de las vigas)" },
  { id: "Vy", unidad: "kN", abajo: false, plano: "V", title: "Vy: cortante según y" },
  { id: "T", unidad: "kN·m", abajo: false, plano: "T", title: "T: torsor" },
  { id: "N", unidad: "kN", abajo: false, plano: "N", title: "N: axil; positivo, tracción" },
];

const PIEZAS: { id: PiezasDiagrama; nombre: string }[] = [
  { id: "todas", nombre: "Vigas y pilares" },
  { id: "vigas", nombre: "Vigas" },
  { id: "pilares", nombre: "Pilares" },
];
const ESCALAS = ["0.25", "0.5", "1", "2", "4"] as const;
type Escala = (typeof ESCALAS)[number];

/** Los diagramas en un 3D (I4): los de la planta de su cabecera, o los de todas. */
function TresDDiagramas({ planta, esfuerzo, eleccion, piezas, escala }: { planta: string | null; esfuerzo: Esfuerzo; eleccion: EleccionCombinaciones; piezas: PiezasDiagrama; escala: number }) {
  const { proyecto } = useVisor();
  const d = usePedido(proyecto.cliente, proyecto.desactualizado ? null : { tipo: "diagramas3d", esfuerzo, combinaciones: eleccion, planta, piezas, escala });
  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>Preparando los diagramas…</Aviso> : null;
  const datos = proyecto.desactualizado ? null : d.datos;
  const cliente = proyecto.cliente;
  const unidad = ESFUERZOS.find((x) => x.id === esfuerzo)!.unidad;
  // Bajo el cursor: la estación más cercana de la barra, con la consulta del cursor del alzado
  const { alPasar, sonda } = useSonda(
    cliente && datos
      ? async (o) => {
          if (o.tipo !== "barra") return null;
          const r = await cliente.pedir({ tipo: "estacion", id: o.pieza, esfuerzo, combinaciones: eleccion, s: o.s });
          return r.ok ? lineasEstacion(o.pieza, r.valor as DatosEstacion, esfuerzo, unidad) : null;
        }
      : null,
    JSON.stringify([planta, esfuerzo, eleccion, piezas, !!datos]),
  );
  return <Fuente3DModelo resultados={{ diagramas: datos, leyenda: datos, aviso, cargando: d.cargando, alPasar, sonda }} />;
}

/** Las líneas de la sonda de una estación: su máximo y su mínimo con su combinación (los dos lados, si saltan). */
export function lineasEstacion(pieza: string, d: DatosEstacion, esfuerzo: Esfuerzo, unidad: string): string[] {
  const r = [`${pieza} · s = ${fmt(d.s, 2)} m`];
  if (d.rigida) return [...r, "En un apoyo (zona rígida): sin esfuerzos de la barra"];
  const lado = (t: string, x: DatosEstacion["izquierda"]) => (x ? [`${t}${esfuerzo} máx. ${fmt(x.max.v, 1)} ${unidad} · ${x.max.comb}`, `${t}${esfuerzo} mín. ${fmt(x.min.v, 1)} ${unidad} · ${x.min.comb}`] : []);
  const iguales = JSON.stringify(d.izquierda) === JSON.stringify(d.derecha);
  return [...r, ...(iguales ? lado("", d.derecha) : [...lado("izq. ", d.izquierda), ...lado("der. ", d.derecha)])];
}

function Alzado({ v, s, onS }: { v: DatosViga; s: number; onS: (s: number) => void }) {
  const caja = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 190;
  const [ml, mr, mt, mb] = [44, 20, 18, 26];
  const L = Math.max(v.longitud, 1e-6);
  const abajo = ESFUERZOS.find((x) => x.id === v.esfuerzo)!.abajo;
  const vmax = Math.max(1e-9, ...v.envolvente.flatMap((p) => [Math.abs(p.max), Math.abs(p.min)]));
  const X = (x: number) => ml + (x / L) * (w - ml - mr);
  const y0 = mt + (H - mt - mb) / 2;
  const Y = (val: number) => y0 + ((abajo ? 1 : -1) * val * (H - mt - mb)) / 2 / vmax;
  const camino = (k: "max" | "min") => {
    if (!v.envolvente.length) return "";
    let d = "";
    let previo: number | null = null;
    for (const p of v.envolvente) {
      // Una zona rígida corta el diagrama
      const corte = previo !== null && !v.flexibles.some(([a, b]) => previo! >= a - 1e-9 && p.s <= b + 1e-9);
      d += `${d && !corte ? "L" : "M"}${X(p.s).toFixed(1)} ${Y(p[k]).toFixed(1)}`;
      previo = p.s;
    }
    return d;
  };
  const area = (k: "max" | "min") => {
    const segs: string[] = [];
    for (const [a, b] of v.flexibles) {
      const ps = v.envolvente.filter((p) => p.s >= a - 1e-9 && p.s <= b + 1e-9);
      if (ps.length < 2) continue;
      segs.push(`M${X(ps[0]!.s).toFixed(1)} ${y0}${ps.map((p) => `L${X(p.s).toFixed(1)} ${Y(p[k]).toFixed(1)}`).join("")}L${X(ps[ps.length - 1]!.s).toFixed(1)} ${y0}Z`);
    }
    return segs.join("");
  };
  const todos = v.vanos.flatMap((va) => {
    const r: { s: number; v: number; comb: string }[] = [];
    const ex = va.extremos;
    if (v.esfuerzo === "My") for (const k of ["My+", "My-"]) if (ex[k]) r.push({ s: ex[k].s!, v: ex[k].v, comb: ex[k].comb });
    if (v.esfuerzo === "Vz" && ex.Vz) r.push({ s: ex.Vz.s!, v: ex.Vz.v, comb: ex.Vz.comb });
    return r;
  });
  // En un pilar no hay vanos: su máximo y su mínimo
  if (v.tipo === "pilar" && v.envolvente.length) {
    const mx = v.envolvente.reduce((a, b) => (b.max > a.max ? b : a));
    const mn = v.envolvente.reduce((a, b) => (b.min < a.min ? b : a));
    if (mx.max > 0) todos.push({ s: mx.s, v: mx.max, comb: "" });
    if (mn.min < 0) todos.push({ s: mn.s, v: mn.min, comb: "" });
  }
  // Dos picos juntos (los de los vanos a cada lado de un apoyo) en el mismo lado: sólo el mayor
  const picos: typeof todos = [];
  for (const p of [...todos].sort((a, b) => Math.abs(b.v) - Math.abs(a.v))) if (!picos.some((q) => Math.abs(X(q.s) - X(p.s)) < 40 && Math.sign(q.v) === Math.sign(p.v))) picos.push(p);
  return (
    <div ref={caja} className="relative shrink-0 bg-bg-canvas" style={{ height: H + 34 }}>
      <div className="flex h-[30px] items-center gap-4 border-b border-border-sub px-3 text-[11px] text-text-secondary">
        <span className="font-mono text-text-primary">
          {v.id} · {v.esfuerzo} · envolvente de {v.combinaciones.nombres.length}
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-[3px] w-4 bg-[var(--color-env-max)]" /> máximo
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-[3px] w-4 bg-[var(--color-env-min)]" /> mínimo
        </span>
        <span className="flex items-center gap-1">
          <i className="inline-block h-[10px] w-4 bg-bg-elevated" /> {v.tipo === "pilar" ? "planta (zona rígida)" : "apoyo (zona rígida)"}
        </span>
        {v.tipo === "pilar" && <span>desde la base, hacia arriba a la derecha</span>}
        {v.esfuerzo === "My" && <span>positivo hacia abajo (tracciones)</span>}
      </div>
      <svg width={w} height={H} role="img" aria-label={`Envolvente de ${v.esfuerzo} de ${v.id}`}
        onClick={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          onS(Math.min(L, Math.max(0, ((e.clientX - r.left - ml) / (w - ml - mr)) * L)));
        }}
      >
        {v.apoyos.map((a, i) => (
          <g key={i}>
            <rect x={X(a.caras[0])} y={mt - 6} width={Math.max(1, X(a.caras[1]) - X(a.caras[0]))} height={H - mt - mb + 12} fill="var(--color-bg-elevated)" />
            <text x={X(a.s)} y={H - 6} fontSize={10.5} textAnchor="middle" fill="var(--color-text-disabled)" fontFamily="var(--font-mono)">
              {a.objeto}
            </text>
          </g>
        ))}
        {(v.plantas ?? []).map((p) => (
          <g key={p.planta}>
            <line x1={X(p.s)} x2={X(p.s)} y1={mt - 6} y2={H - mb + 4} stroke="var(--color-border-main)" strokeDasharray="3 3" />
            <text x={X(p.s)} y={H - 6} fontSize={10.5} textAnchor="middle" fill="var(--color-text-disabled)" fontFamily="var(--font-mono)">
              {p.planta}
            </text>
          </g>
        ))}
        <path d={area("max")} fill="var(--color-env-max-f)" opacity={0.9} />
        <path d={area("min")} fill="var(--color-env-min-f)" opacity={0.9} />
        <line x1={ml} x2={w - mr} y1={y0} y2={y0} stroke="var(--color-text-disabled)" strokeWidth={1} />
        <path d={camino("max")} fill="none" stroke="var(--color-env-max)" strokeWidth={1.4} />
        <path d={camino("min")} fill="none" stroke="var(--color-env-min)" strokeWidth={1.4} />
        {picos.map((p, i) => (
          <text key={i} x={X(p.s)} y={Y(p.v) + (Y(p.v) > y0 ? 13 : -5)} fontSize={10.5} textAnchor="middle" fontFamily="var(--font-mono)" fill="var(--color-text-primary)" className="halo">
            {fmt(p.v, 1)}
          </text>
        ))}
        <line x1={X(s)} x2={X(s)} y1={mt - 8} y2={H - mb + 4} stroke="var(--color-accent)" strokeDasharray="4 3" />
        <text x={ml - 6} y={y0 + 4} fontSize={10} textAnchor="end" fill="var(--color-text-disabled)" fontFamily="var(--font-mono)">
          0
        </text>
      </svg>
    </div>
  );
}

function Estacion({ d, unidad }: { d: DatosEstacion; unidad: string }) {
  if (d.rigida) return <p className="nota">s = {fmt(d.s, 2)} m cae dentro de un apoyo (zona rígida): no hay esfuerzos de la barra.</p>;
  const lado = (t: string, x: DatosEstacion["izquierda"]) =>
    x && (
      <>
        <tr>
          <td>{t} máx.</td>
          <td data-estacion={x.max.v}>
            {fmt(x.max.v, 2)}
            <small>
              {x.max.comb}
              {x.max.etiqueta !== x.max.comb ? ` · ${x.max.etiqueta}` : ""}
            </small>
          </td>
        </tr>
        <tr>
          <td>{t} mín.</td>
          <td>
            {fmt(x.min.v, 2)}
            <small>
              {x.min.comb}
              {x.min.etiqueta !== x.min.comb ? ` · ${x.min.etiqueta}` : ""}
            </small>
          </td>
        </tr>
      </>
    );
  const iguales = JSON.stringify(d.izquierda) === JSON.stringify(d.derecha);
  return (
    <table className="tb">
      <thead>
        <tr>
          <th>s = {fmt(d.s, 2)} m</th>
          <th>{unidad}</th>
        </tr>
      </thead>
      <tbody>
        {iguales ? lado("", d.derecha) : [lado("Izq.", d.izquierda), lado("Der.", d.derecha)]}
      </tbody>
    </table>
  );
}

/** El cuadro de un pilar por tramos (el de la pantalla Pilares): N, |My| y |Mz| en la base y la cabeza, con su combinación. */
function CuadroPilar({ filas }: { filas: FilaPilar[] | null }) {
  if (!filas) return <p className="nota">…</p>;
  const ext = (f: FilaPilar, k: "N-" | "My" | "Mz") => {
    const c = k === "My" ? 4 : k === "Mz" ? 5 : 0;
    const xs = [f.tramo.base[k], f.tramo.cabeza[k]].filter((x): x is { comb: string; esfuerzos: number[] } => !!x);
    if (!xs.length) return null;
    // Los empates, la base (como el cuadro de Pilares)
    return xs.reduce((a, b) => (k === "N-" ? (b.esfuerzos[0]! < a.esfuerzos[0]! ? b : a) : Math.abs(b.esfuerzos[c]!) > Math.abs(a.esfuerzos[c]!) ? b : a));
  };
  const celda = (f: FilaPilar, k: "N-" | "My" | "Mz") => {
    const x = ext(f, k);
    const c = k === "My" ? 4 : k === "Mz" ? 5 : 0;
    return x ? (
      <>
        {fmt(x.esfuerzos[c], 1)}
        <small>{x.comb}</small>
      </>
    ) : (
      "—"
    );
  };
  return (
    <Seccion titulo="Tramos" valor="fem consultar pieza">
      <table className="tb">
        <thead>
          <tr>
            <th>Tramo</th>
            <th>N kN</th>
            <th>|My| kN·m</th>
            <th>|Mz| kN·m</th>
            <th className="nu">ν</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.planta}>
              <td>
                bajo {f.planta}
                <small>
                  {f.tramo.seccion} · {fmt(f.tramo.longitud, 2)} m
                </small>
              </td>
              <td>{celda(f, "N-")}</td>
              <td>{celda(f, "My")}</td>
              <td>{celda(f, "Mz")}</td>
              <td>
                {f.nu ? fmt(f.nu.nu, 2) : "—"}
                <small>{f.nu?.comb ?? ""}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="nota">N: la mayor compresión de la base y la cabeza; |My| y |Mz|: el mayor de las dos, con su signo. Como el cuadro de Pilares.</p>
    </Seccion>
  );
}

export function ModoDiagramas() {
  const { proyecto, planta, seleccion, setSeleccion } = useVisor();
  const pan = usePaneles("resultados:diagramas", { nav: true, props: true, dock: true, pestana: "alzado", alto: 300 });
  const e = proyecto.estado!;
  const [esfuerzo, setEsfuerzo] = useState<Esfuerzo>("My");
  const [piezas3D, setPiezas3D] = useState<PiezasDiagrama>("todas");
  const [escala, setEscala] = useState<Escala>("1");
  const plano = ESFUERZOS.find((x) => x.id === esfuerzo)!.plano;
  const [eleccion, setEleccion] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const [s, setS] = useState(0);
  const piezas = usePedido(proyecto.cliente, planta ? { tipo: "piezas", planta } : null);
  const lista = piezas.datos ?? [];
  // Cualquier viga, vigueta o pilar elegido (en el 3D o en un alzado), de cualquier planta
  const obj = usePedido(proyecto.cliente, seleccion && !lista.some((p) => p.id === seleccion) ? { tipo: "objeto", id: seleccion } : null);
  const otra = obj.datos?.id === seleccion && ["viga", "vigueta", "pilar"].includes(obj.datos.tipo) ? seleccion : null;
  const id = lista.some((p) => p.id === seleccion) ? seleccion! : (otra ?? lista.find((p) => p.tipo === "viga")?.id ?? lista[0]?.id ?? null);
  const vista: VistaPlanta = esfuerzo === "My" || esfuerzo === "Vz" ? { vista: "vigas", esfuerzo, combinaciones: eleccion } : { vista: "modelo" };
  const viga = usePedido(proyecto.cliente, id ? { tipo: "viga", id, esfuerzo, combinaciones: eleccion } : null);
  const v = viga.datos && viga.datos.id === id ? viga.datos : null;
  // Otra pieza: el cursor, en el centro de su primer vano (no en un apoyo)
  const [sDe, setSDe] = useState<string | null>(null);
  if (v && sDe !== v.id) {
    setSDe(v.id);
    setS(v.vanos[0] ? (v.vanos[0].desde + v.vanos[0].hasta) / 2 : 0);
  }
  const sValida = v ? Math.min(s, v.longitud) : 0;
  // El cursor pide la estación cuando se queda quieto
  const [sPedida, setSPedida] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setSPedida(sValida), 60);
    return () => window.clearTimeout(t);
  }, [sValida]);
  const est = usePedido(proyecto.cliente, id && v ? { tipo: "estacion", id, esfuerzo, combinaciones: eleccion, s: sPedida } : null);
  const cuadro = usePedido(proyecto.cliente, v?.tipo === "pilar" ? { tipo: "pilar", id: v.id, combinaciones: eleccion } : null);
  const unidad = ESFUERZOS.find((x) => x.id === esfuerzo)!.unidad;
  const grupos = useMemo(() => {
    const g = new Map<string, typeof lista>();
    for (const p of lista) g.set(p.pano ?? "Vigas", [...(g.get(p.pano ?? "Vigas") ?? []), p]);
    return [...g];
  }, [lista]);

  const herramientas = (
    <>
      <ComboCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} etiqueta="esfuerzos" />
      <Separador />
      <BarraModos />
      <Separador />
      <Segmentado
        etiqueta="Esfuerzo"
        opciones={ESFUERZOS.map((x) => ({ id: x.id, nombre: x.id, title: x.id === "N" && v?.axilSinValor ? `${x.title}. En ${v.id}, sin valor: está en un diafragma rígido (C1-d)` : x.title }))}
        valor={esfuerzo}
        onCambio={setEsfuerzo}
      />
      <Separador />
      <BarraVistas />
    </>
  );

  const navegador = (
    <>
      {grupos.map(([g, ps]) => (
        <Seccion key={g} titulo={g === "Vigas" ? `Vigas de ${planta}` : `Viguetas del paño ${g}`} valor={ps.length}>
          {ps.map((p) => (
            <button key={p.id} type="button" className="lista-fila" data-on={p.id === id} style={{ gridTemplateColumns: "1fr auto auto" }} onClick={() => setSeleccion(p.id)}>
              <span className="mono truncate">{p.id}</span>
              <span className="text-[11.5px]">{p.seccion ?? ""}</span>
              <span className="mono text-[11.5px]">{fmt(p.longitud, 2)} m</span>
            </button>
          ))}
        </Seccion>
      ))}
      {!lista.length && !piezas.cargando && <p className="nota">La planta no tiene vigas ni viguetas.</p>}
    </>
  );

  const vistaPlanta = (
    <ZonaVistas
      fuentes={{
        planta: (x) => (x.planta ? <PlantaDiagramas planta={x.planta} vista={vista} id={id} cargando={x.planta === planta && viga.cargando} /> : null),
        cabeceraPlanta: () => <Chip acento>{vista.vista === "vigas" ? `Diagramas de ${esfuerzo}` : `${esfuerzo}: en el 3D, el alzado y el de la pieza`}</Chip>,
        tresD: (x) => <TresDDiagramas planta={x.planta} esfuerzo={esfuerzo} eleccion={eleccion} piezas={piezas3D} escala={Number(escala)} />,
        alzado: (x) => <FuenteEscena fuente={x.eje ? { tipo: "alzado", plano: { eje: x.eje }, diagramas: { esfuerzo: plano, combinaciones: eleccion, escala: Number(escala) } } : null} />,
        cabecera3D: () => (
          <>
            <Chip acento title={v ? v.combinaciones.etiquetas.join("\n") : undefined}>
              {esfuerzo} · {queCombinaciones(v ? { descripcion: v.combinaciones.descripcion, n: v.combinaciones.nombres.length } : undefined, v?.combinaciones.nombres[0])}
            </Chip>
            <Desplegable etiqueta="Piezas con diagrama" valor={piezas3D} onCambio={setPiezas3D} opciones={PIEZAS} />
            <Desplegable etiqueta="Escala de los diagramas" prefijo={<span className="text-text-secondary">Escala</span>} valor={escala} onCambio={setEscala} opciones={ESCALAS.map((x) => ({ id: x, nombre: `×${x.replace(".", ",")}` }))} />
          </>
        ),
        cabeceraAlzado: () => (
          <>
            <Chip acento title={plano === "M" ? "El momento de eje normal al plano: My en las vigas del plano; My o Mz en los pilares, según su giro" : plano === "V" ? "El cortante en el plano: Vz en las vigas del plano" : undefined}>
              {plano === "M" || plano === "V" ? `${plano} en el plano` : plano}
            </Chip>
            <Desplegable etiqueta="Escala de los diagramas" prefijo={<span className="text-text-secondary">Escala</span>} valor={escala} onCambio={setEscala} opciones={ESCALAS.map((x) => ({ id: x, nombre: `×${x.replace(".", ",")}` }))} />
          </>
        ),
      }}
    />
  );

  const alzado = v ? (
    <>
      <Alzado v={v} s={sValida} onS={setS} />
      <div className="flex h-9 shrink-0 items-center gap-3 border-t border-border-sub bg-bg-surface px-3">
        <label htmlFor="estacion" className="text-[12px] text-text-secondary">
          Estación
        </label>
        <input id="estacion" type="range" min={0} max={v.longitud} step={v.longitud / 400} value={sValida} onChange={(x) => setS(Number(x.target.value))} className="flex-1" style={{ accentColor: "var(--color-accent)" }} />
        <span className="mono w-[90px] text-right text-[12px]">s = {fmt(sValida, 2)} m</span>
      </div>
    </>
  ) : (
    <p className="nota">Elija una viga en la planta o en el navegador.</p>
  );

  const propiedades = (
    <>
        {viga.diagnosticos && <p className="nota text-state-fail">{viga.diagnosticos.map((x) => x.mensaje).join(" ")}</p>}
        {v && (
          <>
            <Seccion titulo={v.tipo === "vigueta" ? "Vigueta" : v.tipo === "pilar" ? "Pilar" : "Viga"} valor={v.id}>
              <div className="px-3.5 py-1.5 text-[12px] text-text-secondary">
                {v.tipo === "pilar" ? (
                  <>
                    {fmt(v.longitud, 2)} m · {(v.plantas ?? []).map((p) => p.planta).join(", ")}
                  </>
                ) : (
                  <>
                    {fmt(v.longitud, 2)} m · {v.vanos.length} vano{v.vanos.length === 1 ? "" : "s"} · apoyos {v.apoyos.map((a) => a.objeto).join(", ") || "—"}
                  </>
                )}
                {v.axilSinValor && <div className="mt-1">Axil sin valor: está en el plano de un diafragma rígido (C1-d).</div>}
              </div>
            </Seccion>
            <Seccion titulo="En la estación">{est.datos ? <Estacion d={est.datos} unidad={unidad} /> : <p className="nota">…</p>}</Seccion>
            {v.tipo === "pilar" && <CuadroPilar filas={cuadro.datos?.filas ?? null} />}
            {v.tipo !== "pilar" && <Seccion titulo="Vanos de cara a cara" valor="fem consultar pieza">
              <table className="tb">
                <thead>
                  <tr>
                    <th>Vano</th>
                    <th>My+ kN·m</th>
                    <th>My− kN·m</th>
                    <th>|Vz| kN</th>
                  </tr>
                </thead>
                <tbody>
                  {v.vanos.map((va, i) => {
                    const c = (k: string) =>
                      va.extremos[k] ? (
                        <>
                          {fmt(va.extremos[k].v, 1)}
                          <small>{va.extremos[k].comb}</small>
                        </>
                      ) : (
                        "—"
                      );
                    return (
                      <tr key={i} className="clic" onClick={() => setS((va.desde + va.hasta) / 2)}>
                        <td>
                          {i + 1}
                          <small>
                            {fmt(va.desde, 2)}–{fmt(va.hasta, 2)} m{va.torsionEquilibrio ? " · torsión de equilibrio" : ""}
                          </small>
                          <small>{va.apoyos.map((a) => a ?? "libre").join(" – ")}</small>
                        </td>
                        <td>{c("My+")}</td>
                        <td>{c("My-")}</td>
                        <td>{c("Vz")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="nota">Máximos exactos del diagrama combinado dentro de cada vano, de cara a cara de sus apoyos.</p>
            </Seccion>}
          </>
        )}
    </>
  );

  return (
    <Disposicion
      paneles={pan}
      etiquetaHerramientas="Herramientas de Resultados"
      herramientas={herramientas}
      nav={{ titulo: "Piezas", contenido: navegador }}
      vista={vistaPlanta}
      props={{ titulo: "Propiedades", contenido: propiedades, ancho: 400 }}
      dock={[
        { id: "alzado", titulo: v ? `Alzado · ${v.id}` : "Alzado", contenido: alzado },
        { id: "combinaciones", titulo: "Combinaciones", insignia: v?.combinaciones.nombres.length, contenido: v ? <TablaCombinaciones c={v.combinaciones} /> : <p className="nota">…</p> },
      ]}
    />
  );
}
