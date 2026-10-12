/**
 * Resultados · Pilares (la pantalla 5 de V1): en planta, el axil de cada tramo que llega (escena
 * `pilares-n` de A4); en el panel inferior, el cuadro de los tramos de la planta, y en Propiedades,
 * el del pilar elegido en toda su altura, con los
 * extremos de `fem consultar pieza` (N, |My|, |Mz| en la base y en la cabeza de cada tramo, cada uno
 * con su combinación) y el axil reducido ν de A3 (un aviso de orden de magnitud, no la comprobación
 * de norma, que hace el módulo de pilares de Concreta).
 */
import { useEffect, useState } from "react";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { FilaPilar } from "../../../src/visor/datos.ts";
import type { Eleccion } from "../../../src/visor/escena.ts";
import type { EleccionCombinaciones, VistaPlanta } from "../../../src/visor/sesion.ts";
import { Chip, Disposicion, Separador } from "../armazon/Disposicion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { Aviso, ComboCombinaciones, Seccion, TablaCombinaciones } from "../componentes/comunes.tsx";
import { BarraModos } from "../espacios/BarraModos.tsx";
import { useVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { useVistas, vistasDe } from "../vistas/estado.ts";
import { Fuente2D, ZonaVistas } from "../vistas/Zona.tsx";
import { useEleccion } from "./useEleccion.ts";

/** El axil de los tramos que llegan a una planta, en una vista: un clic elige el pilar. */
function PlantaPilares({ planta, eleccion, id }: { planta: string; eleccion: EleccionCombinaciones; id: string | null }) {
  const { proyecto, setSeleccion } = useVisor();
  const d = usePedido(proyecto.cliente, { tipo: "pilares", planta, combinaciones: eleccion });
  const vista: VistaPlanta = { vista: "pilares-n", combinaciones: eleccion };
  const fuente = { tipo: "planta" as const, planta, vista };
  const resaltado = useEleccion(fuente, id);
  const filas = d.datos?.filas;
  const clic = async (p: Vec2, radio: number) => {
    if (!proyecto.cliente) return;
    const r = await proyecto.cliente.pedir({ tipo: "elegir", fuente, punto: p, radio });
    const o = r.ok ? (r.valor as Eleccion | null)?.objeto : null;
    setSeleccion(o && filas?.some((f) => f.pilar === o) ? o : null);
  };
  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>Buscando los extremos de cada tramo…</Aviso> : null;
  return <Fuente2D escena={proyecto.desactualizado ? null : (d.datos?.escena ?? null)} resaltado={resaltado} eventos={{ clic: (p, r) => void clic(p, r) }} aviso={aviso} cargando={d.cargando} />;
}

const LIMITE_NU = 0.65;

type Extremos = FilaPilar["tramo"]["base"];

/** El valor de un extremo (N+, N-, My, Mz) en la base o la cabeza: su componente y su combinación. */
function extremo(x: Extremos, k: "N+" | "N-" | "My" | "Mz"): { v: number; comb: string } | null {
  const e = x[k];
  if (!e) return null;
  const c = k === "My" ? 4 : k === "Mz" ? 5 : 0;
  return { v: e.esfuerzos[c]!, comb: e.comb };
}

/** El mayor |·| de la base y la cabeza. */
function peor(f: FilaPilar, k: "My" | "Mz"): { v: number; comb: string; donde: string } | null {
  const a = extremo(f.tramo.base, k);
  const b = extremo(f.tramo.cabeza, k);
  if (!a && !b) return null;
  return !b || (a && Math.abs(a.v) >= Math.abs(b.v)) ? { ...a!, donde: "base" } : { ...b, donde: "cabeza" };
}

/** La mayor compresión (el N más negativo) de la base y la cabeza. */
function compresion(f: FilaPilar): { v: number; comb: string } | null {
  const a = extremo(f.tramo.base, "N-");
  const b = extremo(f.tramo.cabeza, "N-");
  return !b || (a && a.v <= b.v) ? a : b;
}

function Celda({ x, dec = 1 }: { x: { v: number; comb: string } | null; dec?: number }) {
  return x ? (
    <>
      {fmt(x.v, dec)}
      <small>{x.comb}</small>
    </>
  ) : (
    <>—</>
  );
}

function CeldaNu({ f }: { f: FilaPilar }) {
  if (!f.nu) return <td>—</td>;
  return (
    <td className={f.nu.nu > LIMITE_NU ? "w" : undefined}>
      {fmt(f.nu.nu, 2)}
      <small>{f.nu.comb}</small>
    </td>
  );
}

function GraficoAxil({ filas }: { filas: FilaPilar[] }) {
  const ns = filas.map((f) => -(compresion(f)?.v ?? 0));
  const max = Math.max(1, ...ns);
  return (
    <svg width="100%" height={filas.length * 18 + 8} viewBox={`0 0 300 ${filas.length * 18 + 8}`} role="img" aria-label="Compresión máxima por tramo">
      {filas.map((f, i) => {
        const w = (Math.max(0, ns[i]!) / max) * 200;
        const pasa = (f.nu?.nu ?? 0) > LIMITE_NU;
        return (
          <g key={i} transform={`translate(0 ${4 + i * 18})`}>
            <text x={44} y={11} fontSize={10.5} textAnchor="end" fontFamily="var(--font-mono)" fill="var(--color-text-secondary)">
              {f.planta}
            </text>
            <rect x={50} y={2} width={w} height={11} fill={pasa ? "var(--color-tint-warn)" : "var(--color-bg-elevated)"} stroke={pasa ? "var(--color-state-warn)" : "var(--color-border-main)"} />
            <text x={54 + w} y={11} fontSize={10.5} fontFamily="var(--font-mono)" fill="var(--color-text-primary)">
              {fmt(ns[i]!, 0)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ModoPilares() {
  const { proyecto, planta, seleccion, setSeleccion } = useVisor();
  const pan = usePaneles("resultados:pilares", { props: true, dock: true, pestana: "cuadro" });
  const vistas = useVistas();
  const sinPlanta = !vistas.vistas.slice(0, vistasDe(vistas.disposicion)).some((v) => v.tipo === "planta");
  useEffect(() => {
    if (sinPlanta) vistas.irATipo("planta");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al entrar
  }, []);
  const e = proyecto.estado!;
  const [eleccion, setEleccion] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const d = usePedido(proyecto.cliente, planta ? { tipo: "pilares", planta, combinaciones: eleccion } : null);
  const filas = d.datos?.filas ?? [];
  const id = filas.some((f) => f.pilar === seleccion) ? seleccion : null;
  const pilar = usePedido(proyecto.cliente, id ? { tipo: "pilar", id, combinaciones: eleccion } : null);
  const pasan = filas.filter((f) => (f.nu?.nu ?? 0) > LIMITE_NU).length;

  const herramientas = (
    <>
      <ComboCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} etiqueta="esfuerzos" />
      <Separador />
      <BarraModos />
      <Separador />
      <BarraVistas />
    </>
  );

  const vistaPlanta = (
    <ZonaVistas
      fuentes={{
        planta: (v) => (v.planta ? <PlantaPilares planta={v.planta} eleccion={eleccion} id={id} /> : null),
        cabeceraPlanta: (v) => (
          <Chip acento title={v.planta === planta ? d.datos?.combinaciones.descripcion : undefined}>
            Axil de los tramos que llegan
          </Chip>
        ),
      }}
    />
  );

  const cuadro = (
    <Seccion titulo={`Cuadro bajo ${planta}`} valor={filas.length}>
          <table className="tb">
            <thead>
              <tr>
                <th>Pilar</th>
                <th>N kN</th>
                <th>|My|</th>
                <th>|Mz|</th>
                <th className="nu">ν</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.pilar} className="clic" data-on={f.pilar === id} onClick={() => setSeleccion(f.pilar)}>
                  <td>
                    {f.pilar}
                    <small>{f.tramo.seccion}</small>
                  </td>
                  <td>
                    <Celda x={compresion(f)} dec={0} />
                  </td>
                  <td>
                    <Celda x={peor(f, "My")} />
                  </td>
                  <td>
                    <Celda x={peor(f, "Mz")} />
                  </td>
                  <CeldaNu f={f} />
                </tr>
              ))}
            </tbody>
          </table>
        </Seccion>
  );

  const propiedades = (
    <>
      <Seccion titulo={`Tramos bajo ${planta}`} valor={filas.length}>
        <div className="fila">
          <span>ν &gt; {fmt(LIMITE_NU, 2)}</span>
          <span className={`v ${pasan ? "text-state-warn" : ""}`}>{pasan}</span>
        </div>
        <p className="nota">ν = Nd/(Ac·fcd), fcd = fck/1,5, en los tramos de hormigón: el aviso de A3 (orden de magnitud). La comprobación de norma es la del módulo de pilares de Concreta. El cuadro de la planta, abajo; elija un pilar para ver todos sus tramos.</p>
      </Seccion>
      {id && pilar.datos && (
            <Seccion titulo={`Pilar ${id}`} valor={`${pilar.datos.filas.length} tramos`}>
              <GraficoAxil filas={pilar.datos.filas} />
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
                  {pilar.datos.filas.map((f) => (
                    <tr key={f.planta} data-on={f.planta === planta}>
                      <td>
                        bajo {f.planta}
                        <small>
                          {f.tramo.seccion} · {fmt(f.tramo.longitud, 2)} m · {fmt(f.giro, 0)}°
                        </small>
                      </td>
                      <td>
                        <Celda x={compresion(f)} />
                      </td>
                      <td>
                        <Celda x={peor(f, "My")} />
                      </td>
                      <td>
                        <Celda x={peor(f, "Mz")} />
                      </td>
                      <CeldaNu f={f} />
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="nota">N: la mayor compresión (negativa) de la base y la cabeza; |My| y |Mz|: el mayor de las dos, con su signo. Ejes de la sección (giro desde +X).</p>
            </Seccion>
      )}
    </>
  );

  return (
    <Disposicion
      paneles={pan}
      etiquetaHerramientas="Herramientas de Resultados"
      herramientas={herramientas}
      vista={vistaPlanta}
      props={{ titulo: "Propiedades", contenido: propiedades, ancho: 400 }}
      dock={[
        { id: "cuadro", titulo: `Cuadro bajo ${planta ?? ""}`, insignia: filas.length, contenido: cuadro },
        { id: "combinaciones", titulo: "Combinaciones", insignia: d.datos?.combinaciones.nombres.length, contenido: d.datos ? <TablaCombinaciones c={d.datos.combinaciones} /> : <p className="nota">…</p> },
      ]}
    />
  );
}
