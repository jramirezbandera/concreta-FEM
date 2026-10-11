/**
 * Pantalla 1 · Modelo (prototipo v3 «Modelo por plantas», sin lo que es de edición). A la izquierda,
 * el proyecto, las plantas, la vista y el resumen de la planta; en el centro, la planta (la escena de
 * A4: modelo, cargas, diagnósticos o malla) o el edificio en 3D; a la derecha, el objeto elegido con
 * sus datos tal como están en el proyecto, o la lista de diagnósticos.
 */
import { useState } from "react";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { VistaPlanta } from "../../../src/visor/sesion.ts";
import type { Eleccion } from "../../../src/visor/escena.ts";
import { Aviso, BarraLienzo, Equilibrio, Fila, ListaDiagnosticos, ListaPlantas, Panel, Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { cota, fmt } from "../fmt.ts";
import { Planta2D } from "../lienzo/Planta2D.tsx";
import { Vista3D } from "../lienzo/Vista3D.tsx";
import { usePedido } from "../sesion/usePedido.ts";
import { useEleccion } from "./useEleccion.ts";
import { Inspector } from "./Inspector.tsx";

type Vista = "modelo" | "cargas" | "diagnosticos" | "malla";

export function PantallaModelo() {
  const { proyecto, planta, setPlanta, seleccion, setSeleccion } = useVisor();
  const e = proyecto.estado!;
  const [vista, setVista] = useState<Vista>("modelo");
  const [caso, setCaso] = useState<string | null>(null);
  const [tresD, setTresD] = useState(false);
  const casoValido = e.casos.some((c) => c.id === caso) ? caso! : (e.casos[0]?.id ?? "");
  const vistaValida: Vista = vista === "malla" && !e.calculado ? "modelo" : vista;
  const vp: VistaPlanta = vistaValida === "cargas" ? { vista: "cargas", caso: casoValido } : { vista: vistaValida };
  const escena = usePedido(proyecto.cliente, planta && !tresD ? { tipo: "escena", planta, vista: vp } : null);
  const resaltado = useEleccion(planta, vp, seleccion, !tresD);
  const geometria = usePedido(proyecto.cliente, tresD && e.compila ? { tipo: "geometria" } : null);
  const resumenPlanta = e.resumen?.plantas.find((p) => p.id === planta) ?? null;
  const plantaV = e.plantas.find((p) => p.id === planta);

  const clic = async (p: Vec2, radio: number) => {
    if (!proyecto.cliente || !planta) return;
    const r = await proyecto.cliente.pedir({ tipo: "elegir", planta, vista: vp, punto: p, radio });
    setSeleccion(r.ok && r.valor ? (r.valor as Eleccion).objeto : null);
  };

  const aviso = proyecto.desactualizado ? (
    <Aviso tono="warn">El fichero cambió: abriendo la versión nueva…</Aviso>
  ) : escena.diagnosticos ? (
    <Aviso tono="fail">{escena.diagnosticos.map((d) => d.mensaje).join(" ")}</Aviso>
  ) : !escena.datos && escena.cargando ? (
    <Aviso>Preparando la planta…</Aviso>
  ) : null;

  return (
    <>
      <Panel lado="izq" etiqueta="Proyecto y plantas">
        <Seccion titulo="Proyecto" valor={e.huella.slice(0, 12)}>
          <div className="px-3.5 py-2">
            <div className="text-[13px] font-semibold">{e.nombre ?? "Sin nombre"}</div>
            {e.descripcion && <p className="mt-1 text-[11.5px] leading-snug text-text-secondary">{e.descripcion}</p>}
          </div>
          {e.resumen && (
            <div className="grid grid-cols-2 px-0">
              {Object.entries(e.resumen.objetos).map(([k, n]) => (
                <Fila key={k} k={k} v={n} />
              ))}
            </div>
          )}
          {!e.compila && <p className="nota text-state-fail">El modelo no compila: se dibuja con sus diagnósticos. Corríjalo en el proyecto.json.</p>}
          {proyecto.fase === "error" && e.compila && <p className="nota text-state-fail">El cálculo falló: {proyecto.errores.map((d) => d.mensaje).join(" ")}</p>}
        </Seccion>
        <ListaPlantas estado={e} planta={planta} onPlanta={setPlanta} />
        <Seccion titulo="Vista">
          <div className="flex flex-col gap-2 px-3.5 py-2">
            <div className="seg grid grid-cols-4" role="group" aria-label="Vista de la planta">
              {(["modelo", "cargas", "diagnosticos", "malla"] as const).map((v) => (
                <button key={v} type="button" data-on={vistaValida === v} disabled={(v === "malla" && !e.calculado) || tresD} onClick={() => setVista(v)}>
                  {v === "diagnosticos" ? "Diagnósticos" : v[0]!.toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
            {vistaValida === "cargas" && !tresD && (
              <label className="flex items-center gap-2">
                <span className="text-[11px] text-text-secondary">Caso</span>
                <select className="sel flex-1" value={casoValido} onChange={(x) => setCaso(x.target.value)}>
                  {e.casos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id}
                      {c.nombre ? ` · ${c.nombre}` : ""}
                      {c.pesoPropio ? " · con peso propio" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </Seccion>
        {resumenPlanta && (
          <Seccion titulo={`Planta ${resumenPlanta.id}`} valor={`${cota(resumenPlanta.cota)} m`}>
            <Fila k="Altura" v={resumenPlanta.altura === null ? "—" : `${fmt(resumenPlanta.altura, 2)} m`} />
            <Fila k="Diafragma" v={resumenPlanta.diafragma === "rigido" ? "rígido" : "ninguno"} />
            {resumenPlanta.pilares && <Fila k="Pilares (cabeza aquí)" v={Object.entries(resumenPlanta.pilares).map(([s, n]) => `${n}×${s}`).join(" · ")} />}
            {resumenPlanta.vigas && <Fila k="Vigas" v={`${resumenPlanta.vigas.n} · ${fmt(resumenPlanta.vigas.m, 1)} m`} />}
            {resumenPlanta.muros && <Fila k="Muros" v={`${resumenPlanta.muros.n} · ${fmt(resumenPlanta.muros.m, 1)} m`} />}
            {resumenPlanta.losas?.map((l) => <Fila key={l.id} k={`Losa ${l.id}`} v={`${fmt(l.m2, 1)} m² · ${fmt(l.espesor, 2)} m · ${l.tipo}`} />)}
            {resumenPlanta.panos?.map((l) => <Fila key={l.id} k={`Paño ${l.id}`} v={`${fmt(l.m2, 1)} m² · ${fmt(l.direccion, 0)}° · ${fmt(l.intereje, 2)} m`} />)}
            <table className="tb mt-1">
              <thead>
                <tr>
                  <th>Caso</th>
                  <th>Vertical kN</th>
                  <th>Horizontal kN</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(resumenPlanta.cargas).map(([c, v]) => (
                  <tr key={c}>
                    <td>{c}</td>
                    <td>{fmt(v, 1)}</td>
                    <td>{resumenPlanta.horizontales?.[c] ? `${fmt(resumenPlanta.horizontales[c]![0], 1)}; ${fmt(resumenPlanta.horizontales[c]![1], 1)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="nota">Lo que recibe la planta, con el peso propio (−ΣFz de sus cargas, de `fem resumen`).</p>
          </Seccion>
        )}
        <Seccion titulo="Casos" valor={e.casos.length}>
          {e.casos.map((c) => (
            <Fila key={c.id} k={`${c.id}${c.nombre ? ` · ${c.nombre}` : ""}`} v={`${c.accion ?? "sin acción"}${c.pesoPropio ? " · pp" : ""}`} />
          ))}
        </Seccion>
        <Equilibrio estado={e} />
        {e.hipotesis.length > 0 && (
          <Seccion titulo="Hipótesis del compilador" valor={e.hipotesis.length}>
            <ol className="m-0 list-decimal py-1 pl-8 pr-3.5 text-[11.5px] leading-snug text-text-secondary">
              {e.hipotesis.map((h, i) => (
                <li key={i} className="py-0.5">
                  {h}
                </li>
              ))}
            </ol>
          </Seccion>
        )}
      </Panel>

      <section className="flex min-w-0 flex-1 flex-col" aria-label="Lienzo">
        <BarraLienzo
          derecha={
            <div className="seg" role="group" aria-label="Planta o 3D">
              <button type="button" data-on={!tresD} onClick={() => setTresD(false)}>
                Planta
              </button>
              <button type="button" data-on={tresD} disabled={!e.compila} onClick={() => setTresD(true)}>
                3D
              </button>
            </div>
          }
        >
          {tresD ? `Edificio · planta ${planta ?? "—"} resaltada` : `${planta ?? "—"} · ${cota(plantaV?.cota)} m · vista ${vistaValida}${vistaValida === "cargas" ? ` · caso ${casoValido}` : ""}${escena.ms !== null ? ` · ${fmt(escena.ms, 0)} ms` : ""}`}
        </BarraLienzo>
        {tresD ? <Vista3D geometria={geometria.datos} plantaActiva={planta} titulo="Edificio en 3D" /> : <Planta2D escena={escena.datos} resaltado={resaltado} onClic={(p, r) => void clic(p, r)} aviso={aviso} titulo={`Planta ${planta}, vista ${vistaValida}`} />}
      </section>

      <Panel lado="der" etiqueta="Inspector">
        {seleccion ? (
          <Inspector id={seleccion} />
        ) : (
          <Seccion titulo="Diagnósticos" valor={`${e.diagnosticos.filter((d) => d.severidad === "error").length} errores · ${e.diagnosticos.filter((d) => d.severidad !== "error").length} avisos`}>
            <p className="nota">Clic en un objeto del dibujo para ver sus datos. Los diagnósticos son los de `fem validar` y `fem calcular`.</p>
            <ListaDiagnosticos ds={e.diagnosticos} onObjeto={setSeleccion} />
          </Seccion>
        )}
      </Panel>
    </>
  );
}
