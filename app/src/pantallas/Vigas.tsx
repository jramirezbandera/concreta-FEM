/**
 * Pantalla 4 · Vigas: la planta con los diagramas de A4 (`vistaDiagramas`) y, debajo, el alzado de la
 * pieza elegida con su envolvente (`envolventePieza`) y un cursor por estaciones que da el máximo y
 * el mínimo con su combinación (`estacion`). A la derecha, los vanos de cara a cara de
 * `fem consultar pieza` y las combinaciones.
 *
 * Convenio (cabecera de src/motor/modelo.ts): My > 0 tracciona la cara inferior y se dibuja hacia
 * abajo, del lado de las tracciones; Vz, T y N, positivos hacia arriba.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { DatosEstacion, DatosViga, Esfuerzo } from "../../../src/visor/datos.ts";
import type { Eleccion } from "../../../src/visor/escena.ts";
import type { EleccionCombinaciones, VistaPlanta } from "../../../src/visor/sesion.ts";
import { Aviso, BarraLienzo, ListaPlantas, Panel, Seccion, SelectorCombinaciones, TablaCombinaciones } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { cota, fmt } from "../fmt.ts";
import { Planta2D } from "../lienzo/Planta2D.tsx";
import { usePedido } from "../sesion/usePedido.ts";
import { useEleccion } from "./useEleccion.ts";

const ESFUERZOS: { id: Esfuerzo; unidad: string; abajo: boolean }[] = [
  { id: "My", unidad: "kN·m", abajo: true },
  { id: "Vz", unidad: "kN", abajo: false },
  { id: "T", unidad: "kN·m", abajo: false },
  { id: "N", unidad: "kN", abajo: false },
];

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
  // Dos picos juntos (los de los vanos a cada lado de un apoyo) en el mismo lado: sólo el mayor
  const picos: typeof todos = [];
  for (const p of [...todos].sort((a, b) => Math.abs(b.v) - Math.abs(a.v))) if (!picos.some((q) => Math.abs(X(q.s) - X(p.s)) < 40 && Math.sign(q.v) === Math.sign(p.v))) picos.push(p);
  return (
    <div ref={caja} className="relative shrink-0 border-t border-border-main bg-bg-canvas" style={{ height: H + 34 }}>
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
          <i className="inline-block h-[10px] w-4 bg-bg-elevated" /> apoyo (zona rígida)
        </span>
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

export function PantallaVigas() {
  const { proyecto, planta, setPlanta, seleccion, setSeleccion } = useVisor();
  const e = proyecto.estado!;
  const [esfuerzo, setEsfuerzo] = useState<Esfuerzo>("My");
  const [eleccion, setEleccion] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const [s, setS] = useState(0);
  const piezas = usePedido(proyecto.cliente, planta ? { tipo: "piezas", planta } : null);
  const lista = piezas.datos ?? [];
  const id = lista.some((p) => p.id === seleccion) ? seleccion! : (lista.find((p) => p.tipo === "viga")?.id ?? lista[0]?.id ?? null);
  const vista: VistaPlanta = esfuerzo === "My" || esfuerzo === "Vz" ? { vista: "vigas", esfuerzo, combinaciones: eleccion } : { vista: "modelo" };
  const escena = usePedido(proyecto.cliente, planta ? { tipo: "escena", planta, vista } : null);
  const resaltado = useEleccion(planta, vista, id);
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
  const unidad = ESFUERZOS.find((x) => x.id === esfuerzo)!.unidad;
  const grupos = useMemo(() => {
    const g = new Map<string, typeof lista>();
    for (const p of lista) g.set(p.pano ?? "Vigas", [...(g.get(p.pano ?? "Vigas") ?? []), p]);
    return [...g];
  }, [lista]);

  const clic = async (p: Vec2, radio: number) => {
    if (!proyecto.cliente || !planta) return;
    const r = await proyecto.cliente.pedir({ tipo: "elegir", planta, vista, punto: p, radio });
    const o = r.ok ? (r.valor as Eleccion | null)?.objeto : null;
    if (o && lista.some((x) => x.id === o)) setSeleccion(o);
  };

  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : escena.diagnosticos ? <Aviso tono="fail">{escena.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !escena.datos && escena.cargando ? <Aviso>Preparando los diagramas…</Aviso> : null;

  return (
    <>
      <Panel lado="izq" etiqueta="Plantas y piezas">
        <ListaPlantas estado={e} planta={planta} onPlanta={setPlanta} />
        <Seccion titulo="Esfuerzo" valor={unidad}>
          <div className="px-3.5 py-2">
            <div className="seg grid grid-cols-4" role="group" aria-label="Esfuerzo">
              {ESFUERZOS.map((x) => (
                <button key={x.id} type="button" data-on={esfuerzo === x.id} disabled={x.id === "N" && v?.axilSinValor} title={x.id === "N" && v?.axilSinValor ? "Sin valor: la viga está en un diafragma rígido (C1-d)" : undefined} onClick={() => setEsfuerzo(x.id)}>
                  {x.id}
                </button>
              ))}
            </div>
          </div>
        </Seccion>
        <Seccion titulo="Combinaciones">
          <SelectorCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} etiqueta="Esfuerzos" />
        </Seccion>
        {grupos.map(([g, ps]) => (
          <Seccion key={g} titulo={g === "Vigas" ? "Vigas" : `Viguetas del paño ${g}`} valor={ps.length}>
            {ps.map((p) => (
              <button key={p.id} type="button" className="lista-fila" data-on={p.id === id} style={{ gridTemplateColumns: "1fr auto auto" }} onClick={() => setSeleccion(p.id)}>
                <span className="mono truncate">{p.id}</span>
                <span className="text-[11px]">{p.seccion ?? ""}</span>
                <span className="mono text-[11px]">{fmt(p.longitud, 2)} m</span>
              </button>
            ))}
          </Seccion>
        ))}
        {!lista.length && !piezas.cargando && <p className="nota">La planta no tiene vigas ni viguetas.</p>}
      </Panel>

      <section className="flex min-w-0 flex-1 flex-col" aria-label="Planta y alzado">
        <BarraLienzo>
          {planta} · {cota(e.plantas.find((p) => p.id === planta)?.cota)} m · {vista.vista === "vigas" ? `diagramas de ${esfuerzo}` : "modelo"} · {id ?? "—"}
        </BarraLienzo>
        <Planta2D escena={escena.datos} resaltado={resaltado} onClic={(p, r) => void clic(p, r)} aviso={aviso} titulo={`Vigas de la planta ${planta}`} cargando={escena.cargando || viga.cargando} />
        {v && (
          <>
            <Alzado v={v} s={sValida} onS={setS} />
            <div className="flex h-9 shrink-0 items-center gap-3 border-t border-border-sub bg-bg-surface px-3">
              <label htmlFor="estacion" className="text-[11px] text-text-secondary">
                Estación
              </label>
              <input id="estacion" type="range" min={0} max={v.longitud} step={v.longitud / 400} value={sValida} onChange={(x) => setS(Number(x.target.value))} className="flex-1" style={{ accentColor: "var(--color-accent)" }} />
              <span className="mono w-[90px] text-right text-[12px]">s = {fmt(sValida, 2)} m</span>
            </div>
          </>
        )}
      </section>

      <Panel lado="der" ancho={420} etiqueta="Pieza">
        {viga.diagnosticos && <p className="nota text-state-fail">{viga.diagnosticos.map((x) => x.mensaje).join(" ")}</p>}
        {v && (
          <>
            <Seccion titulo={v.tipo === "vigueta" ? "Vigueta" : "Viga"} valor={v.id}>
              <div className="px-3.5 py-1.5 text-[12px] text-text-secondary">
                {fmt(v.longitud, 2)} m · {v.vanos.length} vano{v.vanos.length === 1 ? "" : "s"} · apoyos {v.apoyos.map((a) => a.objeto).join(", ") || "—"}
                {v.axilSinValor && <div className="mt-1">Axil sin valor: está en el plano de un diafragma rígido (C1-d).</div>}
              </div>
            </Seccion>
            <Seccion titulo="En la estación">{est.datos ? <Estacion d={est.datos} unidad={unidad} /> : <p className="nota">…</p>}</Seccion>
            <Seccion titulo="Vanos de cara a cara" valor="fem consultar pieza">
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
            </Seccion>
            <TablaCombinaciones c={v.combinaciones} />
          </>
        )}
      </Panel>
    </>
  );
}
