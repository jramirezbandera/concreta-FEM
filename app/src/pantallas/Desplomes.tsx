/**
 * Resultados · Deformada (la pantalla 6 de V1, Desplomes): `fem consultar deriva` por planta (el mayor desplome relativo d/h con su
 * pilar y su combinación, y el desplazamiento del maestro de su diafragma), frente al límite de A3,
 * y la deformada 3D en la combinación pésima (o en la elegida, si es una sola).
 */
import { useState } from "react";
import type { EleccionCombinaciones } from "../../../src/visor/sesion.ts";
import type { DatosDesplomes } from "../../../src/visor/datos.ts";
import { CabeceraVista, CarrilPlantas, Campo, Chip, Disposicion, Separador } from "../armazon/Disposicion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { Aviso, ComboCombinaciones, Seccion, TablaCombinaciones } from "../componentes/comunes.tsx";
import { BarraModos } from "../espacios/BarraModos.tsx";
import { useVisor } from "../contexto.ts";
import { cota, fmt, fraccion, mm } from "../fmt.ts";
import { Vista3D } from "../lienzo/Vista3D.tsx";
import { usePedido } from "../sesion/usePedido.ts";

function Perfil({ d, cotas }: { d: DatosDesplomes; cotas: Map<string, number | null> }) {
  const pts = d.plantas.filter((p) => p.maestro && cotas.get(p.planta) !== null).map((p) => ({ z: cotas.get(p.planta)!, ux: p.maestro!.ux.v * 1000, uy: Math.abs(p.maestro!.uy.v * 1000) }));
  if (pts.length < 1) return <p className="nota">Sin diafragmas rígidos: no hay maestro por planta.</p>;
  const [W, H, ml, mb] = [300, 200, 40, 24];
  const zs = pts.map((p) => p.z);
  const [z0, z1] = [Math.min(0, ...zs), Math.max(...zs)];
  const umax = Math.max(1e-9, ...pts.flatMap((p) => [Math.abs(p.ux), p.uy]));
  const X = (u: number) => ml + ((u + umax) / (2 * umax)) * (W - ml - 10);
  const Y = (z: number) => H - mb - ((z - z0) / Math.max(1e-9, z1 - z0)) * (H - mb - 10);
  const linea = (k: "ux" | "uy") => pts.map((p, i) => `${i ? "L" : "M"}${X(p[k]).toFixed(1)} ${Y(p.z).toFixed(1)}`).join("");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Perfil del desplazamiento del maestro por planta">
      <line x1={X(0)} x2={X(0)} y1={8} y2={H - mb} stroke="var(--color-border-main)" />
      <path d={linea("ux")} fill="none" stroke="var(--color-accent)" strokeWidth={1.6} />
      <path d={linea("uy")} fill="none" stroke="var(--color-uy)" strokeWidth={1.6} strokeDasharray="5 3" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={X(p.ux)} cy={Y(p.z)} r={2.5} fill="var(--color-accent)" />
          <circle cx={X(p.uy)} cy={Y(p.z)} r={2.5} fill="var(--color-uy)" />
          <text x={4} y={Y(p.z) + 3} fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--color-text-disabled)">
            {cota(p.z)}
          </text>
        </g>
      ))}
      <text x={X(umax)} y={H - 6} fontSize={9.5} textAnchor="end" fontFamily="var(--font-mono)" fill="var(--color-text-disabled)">
        {fmt(umax, 2)} mm
      </text>
      <text x={X(-umax)} y={H - 6} fontSize={9.5} fontFamily="var(--font-mono)" fill="var(--color-text-disabled)">
        {fmt(-umax, 2)}
      </text>
    </svg>
  );
}

export function ModoDeformada() {
  const { proyecto, planta, setPlanta } = useVisor();
  const pan = usePaneles("resultados:deformada", { props: true, dock: true, pestana: "desplomes" });
  const e = proyecto.estado!;
  const [eleccion, setEleccion] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const [escalaDada, setEscalaDada] = useState<number | null>(null);
  const d = usePedido(proyecto.cliente, { tipo: "desplomes", combinaciones: eleccion });
  const x = d.datos;
  const unaSola = eleccion.tipo === "combinacion" || eleccion.tipo === "caso";
  const def: EleccionCombinaciones | null = unaSola ? eleccion : x?.pesima ? { tipo: "una", de: eleccion, nombre: x.pesima } : null;
  const geometria = usePedido(proyecto.cliente, e.compila ? { tipo: "geometria" } : null);
  const deformada = usePedido(proyecto.cliente, def ? { tipo: "deformada", combinaciones: def } : null);
  const cotas = new Map(e.plantas.map((p) => [p.id, p.cota]));
  const zs = e.plantas.map((p) => p.cota ?? 0);
  const alto = Math.max(1, Math.max(...zs) - Math.min(...zs));
  let umax = 0;
  if (deformada.datos) for (const v of deformada.datos.u) umax = Math.max(umax, Math.abs(v));
  const escalaAuto = umax > 0 ? Math.round((0.05 * alto) / umax / 10) * 10 || 1 : 1;
  const escala = escalaDada ?? escalaAuto;
  const pasan = x?.plantas.filter((p) => p.desplome && p.desplome.v > x.limiteRelativo).length ?? 0;

  const herramientas = (
    <>
      <ComboCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} etiqueta="desplazamientos" />
      <Separador />
      <BarraModos />
      <Separador />
      <Campo etiqueta="Escala de la deformada" ancho={190}>
        <span className="flex items-center gap-1.5">
          <input type="number" min={1} step={10} className="sel w-[90px] text-right" aria-label="Escala de la deformada" value={escala} onChange={(v) => setEscalaDada(Number(v.target.value) || 1)} />
          {escalaDada !== null && (
            <button type="button" className="btn" style={{ height: 28 }} onClick={() => setEscalaDada(null)} title="Volver a la escala automática">
              auto ({fmt(escalaAuto, 0)})
            </button>
          )}
        </span>
      </Campo>
    </>
  );

  const vista = (
    <>
      <CabeceraVista>
        <Chip>
          <strong className="font-semibold">Deformada</strong> ×{fmt(escala, 0)}
        </Chip>
        <Chip acento title={deformada.datos?.etiqueta}>
          <span className="mono">{deformada.datos?.comb ?? "—"}</span> · máx. {mm(umax)} mm{!unaSola && x?.pesima ? " · la del mayor desplome relativo" : ""}
        </Chip>
      </CabeceraVista>
      <CarrilPlantas estado={e} planta={planta} onPlanta={setPlanta} />
      {proyecto.desactualizado ? (
        <div className="lienzo grid place-items-center">
          <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso>
        </div>
      ) : (
        <Vista3D geometria={geometria.datos} plantaActiva={planta} deformada={deformada.datos ? { u: deformada.datos.u, escala } : null} titulo="Deformada del edificio" />
      )}
    </>
  );

  const tabla = x ? (
    <Seccion titulo="Desplome relativo" valor={`límite ${fraccion(x.limiteRelativo)} (A3)`}>
      <table className="tb">
        <thead>
          <tr>
            <th>Planta</th>
            <th>d mm</th>
            <th>d/h</th>
            <th>ux mm</th>
            <th>uy mm</th>
          </tr>
        </thead>
        <tbody>
          {x.plantas.map((p) => {
            const pasa = !!p.desplome && p.desplome.v > x.limiteRelativo;
            return (
              <tr key={p.planta} data-on={p.planta === planta}>
                <td>
                  {p.planta}
                  <small>h {fmt(p.altura, 2)} m</small>
                </td>
                <td>
                  {p.desplome ? mm(p.desplome.d) : "—"}
                  <small>{p.desplome?.pieza ?? ""}</small>
                </td>
                <td className={pasa ? "w" : undefined}>
                  {p.desplome ? fraccion(p.desplome.v) : "—"}
                  <small>{p.desplome?.comb ?? ""}</small>
                </td>
                <td>
                  {p.maestro ? mm(p.maestro.ux.v) : "—"}
                  <small>{p.maestro?.ux.comb ?? ""}</small>
                </td>
                <td>
                  {p.maestro ? mm(p.maestro.uy.v) : "—"}
                  <small>{p.maestro?.uy.comb ?? ""}</small>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="nota">d: el mayor desplome de un pilar respecto a la planta de abajo (su pilar debajo); ux, uy: los del maestro del diafragma, el mayor |·| de cada uno, cada uno con su combinación.</p>
    </Seccion>
  ) : (
    <p className="nota">…</p>
  );

  const propiedades = (
    <>
      {d.diagnosticos && <p className="nota text-state-fail">{d.diagnosticos.map((y) => y.mensaje).join(" ")}</p>}
      <p className="nota">Por defecto, las combinaciones de `fem consultar deriva` (la ELS característica si los casos llevan su acción). Para el viento solo, elija su caso.</p>
      {x && (
        <>
          <Seccion titulo="Desplome relativo" valor={`límite ${fraccion(x.limiteRelativo)} (A3)`}>
            <div className="fila">
              <span>Plantas que lo pasan</span>
              <span className={`v ${pasan ? "text-state-warn" : ""}`}>{pasan}</span>
            </div>
            <p className="nota">La tabla por planta, abajo.</p>
          </Seccion>
          <Seccion titulo="Perfil del maestro">
            <Perfil d={x} cotas={cotas} />
            <div className="flex gap-4 px-3.5 pb-2 text-[12px] text-text-secondary">
              <span className="flex items-center gap-1">
                <i className="inline-block h-[2px] w-4 bg-accent" /> ux
              </span>
              <span className="flex items-center gap-1">
                <i className="inline-block h-[2px] w-4" style={{ background: "var(--color-uy)" }} /> |uy|
              </span>
            </div>
          </Seccion>
        </>
      )}
    </>
  );

  return (
    <Disposicion
      paneles={pan}
      etiquetaHerramientas="Herramientas de Resultados"
      herramientas={herramientas}
      vista={vista}
      props={{ titulo: "Propiedades", contenido: propiedades, ancho: 320 }}
      dock={[
        { id: "desplomes", titulo: "Desplomes por planta", contenido: tabla },
        { id: "combinaciones", titulo: "Combinaciones", insignia: x?.combinaciones.nombres.length, contenido: x ? <TablaCombinaciones c={x.combinaciones} resaltar={x.pesima} /> : <p className="nota">…</p> },
      ]}
    />
  );
}
