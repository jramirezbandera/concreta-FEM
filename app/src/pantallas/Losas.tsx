/**
 * Pantalla 3 · Losas: uz, M11, M22, M12, V13 y V23 por planta (la escena `vistaCampo` de A4, en la
 * combinación de mayor |valor| de las elegidas). Un clic da el valor del punto interpolado como las
 * bandas (la consulta `valor-punto`, no el color); a la derecha, los extremos, las flechas de
 * `fem consultar flechas` y las combinaciones.
 */
import { useEffect, useState } from "react";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { Campo } from "../../../src/agente/render/resultados.ts";
import type { EleccionCombinaciones } from "../../../src/visor/sesion.ts";
import type { ValorPunto } from "../../../src/visor/datos.ts";
import { Aviso, BarraLienzo, Equilibrio, ListaPlantas, Panel, Seccion, SelectorCombinaciones, TablaCombinaciones } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { cota, fmt, mm } from "../fmt.ts";
import { Planta2D, type MarcaExtra } from "../lienzo/Planta2D.tsx";
import { usePedido } from "../sesion/usePedido.ts";

const CAMPOS: { id: Campo; nombre: string; dec: number }[] = [
  { id: "uz", nombre: "uz", dec: 2 },
  { id: "m11", nombre: "M11", dec: 1 },
  { id: "m22", nombre: "M22", dec: 1 },
  { id: "m12", nombre: "M12", dec: 1 },
  { id: "v13", nombre: "V13", dec: 1 },
  { id: "v23", nombre: "V23", dec: 1 },
];

export function PantallaLosas() {
  const { proyecto, planta, setPlanta } = useVisor();
  const e = proyecto.estado!;
  const [campo, setCampo] = useState<Campo>("uz");
  const [elDesp, setElDesp] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const [elEsf, setElEsf] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const [punto, setPunto] = useState<{ p: Vec2; v: ValorPunto | null; planta: string; clave: string } | null>(null);
  const eleccion = campo === "uz" ? elDesp : elEsf;
  const setEleccion = campo === "uz" ? setElDesp : setElEsf;
  const dec = CAMPOS.find((c) => c.id === campo)!.dec;
  const d = usePedido(proyecto.cliente, planta ? { tipo: "losas", planta, campo, combinaciones: eleccion } : null);
  const x = d.datos;
  const clave = JSON.stringify([planta, campo, eleccion, proyecto.version]);
  // Con uz en pantalla, el worker adelanta el SPR de la planta: M11, M22… salen luego sin esperarlo
  const listo = !!x && !d.cargando;
  useEffect(() => {
    if (listo && planta && proyecto.cliente) void proyecto.cliente.pedir({ tipo: "precalentar", planta }).catch(() => {});
  }, [listo, planta, proyecto.cliente]);
  const puntoValido = punto && punto.clave === clave ? punto : null;

  const clic = async (p: Vec2) => {
    if (!proyecto.cliente || !planta) return;
    const r = await proyecto.cliente.pedir({ tipo: "valor-punto", planta, campo, combinaciones: eleccion, x: p[0], y: p[1] });
    setPunto({ p, v: r.ok ? (r.valor as ValorPunto | null) : null, planta, clave });
  };

  const unidad = campo === "uz" ? "mm" : campo.startsWith("m") ? "kN·m/m" : "kN/m";
  const marcas: MarcaExtra[] = puntoValido ? [{ p: puntoValido.p, texto: puntoValido.v ? `${fmt(puntoValido.v.valor, dec)} ${unidad}` : "sin mapa" }] : [];
  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !x && d.cargando ? <Aviso>Recuperando los campos (SPR)…</Aviso> : null;

  return (
    <>
      <Panel lado="izq" etiqueta="Plantas y magnitud">
        <ListaPlantas estado={e} planta={planta} onPlanta={setPlanta} />
        <Seccion titulo="Magnitud" valor={unidad}>
          <div className="grid grid-cols-3 gap-1 px-3.5 py-2" role="group" aria-label="Magnitud">
            {CAMPOS.map((c) => (
              <button key={c.id} type="button" className="btn mono" data-on={campo === c.id} style={campo === c.id ? { background: "var(--color-tint-accent)", color: "var(--color-accent)", borderColor: "var(--color-accent)" } : undefined} aria-pressed={campo === c.id} onClick={() => setCampo(c.id)}>
                {c.nombre}
              </button>
            ))}
          </div>
          <p className="nota">uz de los nudos; momentos y cortantes recuperados por SPR (E5) en los ejes de cada losa. Bandas sin interpolar el color (H43): el número de un punto, con un clic.</p>
        </Seccion>
        <Seccion titulo="Combinaciones">
          <SelectorCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} etiqueta={campo === "uz" ? "Desplazamientos" : "Esfuerzos"} />
          {x && (
            <p className="nota">
              Se dibuja <b className="mono">{x.dibujada?.nombre ?? "—"}</b>
              {x.combinaciones.nombres.length > 1 ? `: la de mayor |valor| en la planta de las ${x.combinaciones.nombres.length} de ${x.combinaciones.descripcion}.` : "."}
            </p>
          )}
        </Seccion>
      </Panel>

      <section className="flex min-w-0 flex-1 flex-col" aria-label="Mapa">
        <BarraLienzo>
          {planta} · {cota(e.plantas.find((p) => p.id === planta)?.cota)} m · {CAMPOS.find((c) => c.id === campo)!.nombre} · {x?.dibujada ? `${x.dibujada.nombre} = ${x.dibujada.etiqueta}` : "—"}
          {d.ms !== null ? ` · ${fmt(d.ms, 0)} ms` : ""}
        </BarraLienzo>
        <Planta2D escena={x?.escena ?? null} marcas={marcas} onClic={(p) => void clic(p)} aviso={aviso} titulo={`Mapa de ${campo} en la planta ${planta}`} cargando={d.cargando} />
      </section>

      <Panel lado="der" etiqueta="Valores">
        <Seccion titulo="Valor en el punto">
          {puntoValido ? (
            puntoValido.v ? (
              <div className="px-3.5 py-2">
                <div className="mono text-[11px] text-text-disabled">
                  {puntoValido.v.losa} · ({fmt(puntoValido.p[0], 2)}; {fmt(puntoValido.p[1], 2)}) m
                </div>
                <div className="mono text-[17px] font-medium" data-valor-punto={puntoValido.v.valor}>
                  {fmt(puntoValido.v.valor, dec)} {unidad}
                </div>
                {puntoValido.v.otros && (
                  <div className="mono text-[12px] text-state-warn">
                    salto: también {puntoValido.v.otros.map((o) => fmt(o, dec)).join(" · ")} {unidad}
                  </div>
                )}
                <div className="text-[11px] text-text-secondary">
                  {puntoValido.v.comb} · {puntoValido.v.lamina >= 0 ? `interpolado en la lámina ${puntoValido.v.lamina}, como las bandas` : "el extremo rotulado"}
                  {puntoValido.v.otros ? ". En el borde de dos regiones (pliegue, ábaco) el campo salta y no se promedia (E5-7)." : ""}
                </div>
              </div>
            ) : (
              <p className="nota">Fuera de las losas, o en una lámina sin mapa (las rígidas de las huellas de los pilares).</p>
            )
          ) : (
            <p className="nota">Clic en el mapa para leer el valor de un punto.</p>
          )}
        </Seccion>
        {x && (
          <>
            <Seccion titulo="Extremos de la planta" valor={x.dibujada?.nombre}>
              {x.escena.extremos.map((ex, i) => (
                <button key={i} type="button" className="lista-fila" style={{ gridTemplateColumns: "1fr auto", height: "auto", padding: "6px 14px" }} onClick={() => ex.punto && setPunto({ p: ex.punto, v: ex.punto ? { valor: ex.valor, unidad: ex.unidad, losa: ex.objeto ?? "", lamina: -1, comb: ex.comb ?? "" } : null, planta: planta!, clave })} title="Marcar el punto">
                  <span>
                    <span className="block text-text-primary">{ex.que}</span>
                    <span className="mono text-[11px] text-text-disabled">
                      {ex.objeto} · {ex.punto ? `(${fmt(ex.punto[0], 2)}; ${fmt(ex.punto[1], 2)})` : ""}
                    </span>
                  </span>
                  <span className="mono text-[13px] text-text-primary" data-extremo={ex.valor}>
                    {fmt(ex.valor, dec)} {ex.unidad}
                  </span>
                </button>
              ))}
              {!x.escena.extremos.length && <p className="nota">{x.escena.notas.join(" ")}</p>}
            </Seccion>
            <Seccion titulo="Flechas" valor={x.combinacionesFlechas.descripcion}>
              {x.flechas.length ? (
                <table className="tb">
                  <thead>
                    <tr>
                      <th>Losa</th>
                      <th>Máxima mm</th>
                      <th>Relativa mm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.flechas.map((f) => (
                      <tr key={f.id}>
                        <td>
                          {f.id}
                          <small>{f.tipo === "pano" ? "paño" : "losa"}</small>
                        </td>
                        <td>
                          {mm(f.maxima.v)}
                          <small>{f.maxima.comb}</small>
                        </td>
                        <td>
                          {f.relativa ? mm(f.relativa.v) : "—"}
                          <small>{f.relativa ? `${f.relativa.comb}${f.relativa.pilares ? ` · ${f.relativa.pilares.join(", ")}` : ""}` : ""}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="nota">La planta no tiene losas ni paños.</p>
              )}
              <p className="nota">Hacia abajo, positivas. Relativa: a las esquinas de su recuadro de pilares (losas) o a los extremos del vano (paños), como `fem consultar flechas`.</p>
            </Seccion>
            <TablaCombinaciones c={x.combinaciones} resaltar={x.dibujada?.nombre} />
          </>
        )}
        <Equilibrio estado={e} />
      </Panel>
    </>
  );
}
