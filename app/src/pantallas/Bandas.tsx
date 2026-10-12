/**
 * Resultados · Bandas (V2b, `docs/fem3d/visor.md` §7.4 d): las bandas de dimensionado de la planta
 * con el My de cada estación (la escena `bandas` de A4, la de `fem render`), una dirección cada vez
 * o las dos. Abajo, la tabla de las bandas (menor My de las caras, mayor de los vanos) y el reparto
 * entre bandas de pilares y centrales de cada línea (C5-d); en Propiedades, la banda elegida, con
 * sus estaciones, Wood–Armer y el momento por nervio.
 *
 * Cada número es de una consulta (`fem consultar banda`, `Consultas.reparto`), nunca del dibujo.
 */
import { useState } from "react";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { DireccionBanda } from "../../../src/agente/render/bandas.ts";
import type { Eleccion } from "../../../src/visor/escena.ts";
import type { ConComb, DatosBanda } from "../../../src/visor/bandas.ts";
import type { EleccionCombinaciones, FuenteEscena } from "../../../src/visor/sesion.ts";
import { Chip, Desplegable, Disposicion, Separador } from "../armazon/Disposicion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { Aviso, ComboCombinaciones, ListaDiagnosticos, Seccion } from "../componentes/comunes.tsx";
import { BarraModos } from "../espacios/BarraModos.tsx";
import { useVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { useVistas } from "../vistas/estado.ts";
import { Fuente2D, ZonaVistas } from "../vistas/Zona.tsx";
import { useEleccion } from "./useEleccion.ts";

type Direccion = DireccionBanda | "ambas";
const DIRECCIONES: { id: Direccion; nombre: string }[] = [
  { id: "1", nombre: "Dirección 1" },
  { id: "2", nombre: "Dirección 2" },
  { id: "ambas", nombre: "Las dos" },
];

/** Un valor con su combinación (si hay más de una). */
function Valor({ v, n = 1, varias }: { v: ConComb | null; n?: number; varias: boolean }) {
  if (!v || !Number.isFinite(v[0])) return <>—</>;
  return (
    <>
      {fmt(v[0], n)}
      {varias && v[1] ? <small>{v[1]}</small> : null}
    </>
  );
}

/** La escena de las bandas de una planta: un clic elige la banda. */
function EscenaBandas({ fuente, bandas }: { fuente: FuenteEscena | null; bandas: ReadonlySet<string> | null }) {
  const { proyecto, seleccion, setSeleccion } = useVisor();
  const pedido = !fuente || proyecto.desactualizado || fuente.tipo !== "planta" ? null : { tipo: "escena" as const, planta: fuente.planta, vista: fuente.vista };
  const d = usePedido(proyecto.cliente, pedido);
  const resaltado = useEleccion(fuente, seleccion && bandas?.has(seleccion) ? seleccion : null);
  const clic = async (p: Vec2, radio: number) => {
    if (!proyecto.cliente || !fuente) return;
    const r = await proyecto.cliente.pedir({ tipo: "elegir", fuente, punto: p, radio, ...(bandas ? { objetos: [...bandas] } : {}) });
    const o = r.ok ? (r.valor as Eleccion | null)?.objeto : null;
    setSeleccion(o && bandas?.has(o) ? o : null);
  };
  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>Cortando las bandas…</Aviso> : null;
  return <Fuente2D escena={proyecto.desactualizado ? null : d.datos} resaltado={resaltado} eventos={{ clic: (p, r) => void clic(p, r) }} aviso={aviso} cargando={d.cargando} />;
}

/** Las estaciones de la banda elegida, con Wood–Armer y el momento por nervio. */
function DetalleBanda({ d, varias }: { d: DatosBanda; varias: boolean }) {
  const b = d.banda;
  const conNervio = d.estaciones.some((x) => x.nervio);
  return (
    <>
      <Seccion titulo={b.id} valor={`${b.tipo ?? "sin tipo"} · dirección ${d.direccion}`}>
        <div className="px-3.5 py-1.5 text-[12px] text-text-secondary">
          {b.origen === "propuesta" ? "Propuesta" : "Del usuario"} · ancho {fmt(b.ancho, 2)} m · de ({fmt(b.desde[0], 2)}; {fmt(b.desde[1], 2)}) a ({fmt(b.hasta[0], 2)}; {fmt(b.hasta[1], 2)}) · {b.apoyos?.length ?? 0} apoyos
        </div>
        <table className="tb" aria-label={`Estaciones de ${b.id}`}>
          <thead>
            <tr>
              <th>s m</th>
              <th>My máx kN·m</th>
              <th>My mín kN·m</th>
              <th>b m</th>
            </tr>
          </thead>
          <tbody>
            {d.estaciones.map((x) => (
              <tr key={`${x.tipo}${x.s}`} data-invalida={!x.valido || undefined}>
                <td>
                  {fmt(x.s, 3)}
                  <small>{x.tipo}</small>
                </td>
                <td data-my-max={x.max[0]}>{x.valido ? <Valor v={x.max} varias={varias} /> : "—"}</td>
                <td data-my-min={x.min[0]}>{x.valido ? <Valor v={x.min} varias={varias} /> : "—"}</td>
                <td>{fmt(x.anchoEnLosa, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="nota">De «fem consultar banda»: en las caras, exacto (fuerzas nodales); en los vanos, por campos. My &gt; 0 tracciona la cara inferior; b, el ancho de la banda en losa.</p>
      </Seccion>
      <Seccion titulo="Wood–Armer" valor="kN·m/m">
        <table className="tb" aria-label={`Wood–Armer de ${b.id}`}>
          <thead>
            <tr>
              <th>s m</th>
              <th>inf. X</th>
              <th>sup. X</th>
              <th>inf. Y</th>
              <th>sup. Y</th>
            </tr>
          </thead>
          <tbody>
            {d.estaciones.map((x) => (
              <tr key={`${x.tipo}${x.s}`}>
                <td>{fmt(x.s, 3)}</td>
                {x.woodArmer ? (
                  (["inferiorX", "superiorX", "inferiorY", "superiorY"] as const).map((k) => (
                    <td key={k}>
                      <Valor v={x.woodArmer![k]} varias={varias} />
                    </td>
                  ))
                ) : (
                  <td colSpan={4} className="text-text-disabled">
                    sin muestras
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="nota">Con los momentos medios de la banda (C5-c), en sus ejes: X a lo largo de su eje. La envolvente de las combinaciones, cada valor con la suya.</p>
      </Seccion>
      {conNervio && (
        <Seccion titulo="Por nervio" valor="kN·m por nervio">
          <table className="tb" aria-label={`Momento por nervio de ${b.id}`}>
            <thead>
              <tr>
                <th>s m</th>
                <th>máx</th>
                <th>mín</th>
                <th>en ábaco</th>
              </tr>
            </thead>
            <tbody>
              {d.estaciones.map((x) => (
                <tr key={`${x.tipo}${x.s}`}>
                  <td>{fmt(x.s, 3)}</td>
                  {x.nervio ? (
                    <>
                      <td>
                        <Valor v={x.nervio.max} varias={varias} />
                      </td>
                      <td>
                        <Valor v={x.nervio.min} varias={varias} />
                      </td>
                      <td>{fmt(100 * x.nervio.fraccionAbaco, 0)} %</td>
                    </>
                  ) : (
                    <td colSpan={3} className="text-text-disabled">
                      maciza
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="nota">My·s/b, con s el intereje de los nervios (C4-j). Donde la banda pisa un ábaco, esa parte es maciza.</p>
        </Seccion>
      )}
      {d.diagnosticos.length > 0 && (
        <Seccion titulo="Avisos" valor={d.diagnosticos.length}>
          <ListaDiagnosticos ds={d.diagnosticos} />
        </Seccion>
      )}
    </>
  );
}

export function ModoBandas() {
  const { proyecto, planta, seleccion, setSeleccion } = useVisor();
  const pan = usePaneles("resultados:bandas", { props: true, dock: true, pestana: "bandas" });
  const { poner } = useVistas();
  const e = proyecto.estado!;
  const [eleccion, setEleccion] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const [direccion, setDireccion] = useState<Direccion>("1");
  const dir = direccion === "ambas" ? null : direccion;
  const r = usePedido(proyecto.cliente, proyecto.desactualizado || !planta ? null : { tipo: "bandas", planta, combinaciones: eleccion, direccion: dir });
  const d = proyecto.desactualizado ? null : r.datos;
  const ids = d ? new Set(d.filas.map((f) => f.id)) : null;
  // El detalle, de la banda elegida si es de las de la tabla
  const elegida = seleccion && ids?.has(seleccion) ? seleccion : null;
  const rb = usePedido(proyecto.cliente, proyecto.desactualizado || !elegida ? null : { tipo: "banda", id: elegida, combinaciones: eleccion });
  const detalle = rb.datos && rb.datos.banda.id === elegida ? rb.datos : null;
  const varias = (d?.combinaciones.nombres.length ?? 1) > 1;
  const plantasConBandas = d?.plantas ?? [];

  const herramientas = (
    <>
      <ComboCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} etiqueta="esfuerzos" />
      <Desplegable etiqueta="Dirección de las bandas" valor={direccion} onCambio={setDireccion} opciones={DIRECCIONES} />
      <Separador />
      <BarraModos />
      <Separador />
      <BarraVistas />
    </>
  );

  const cabecera = (v: { planta: string | null }, i: number) => (
    <>
      <Chip acento title="Del eje 1 de la losa de cada banda (1) o de la perpendicular (2)">
        Bandas · {direccion === "ambas" ? "las dos direcciones" : `dirección ${direccion}`}
      </Chip>
      {v.planta && !plantasConBandas.includes(v.planta) && (
        <>
          <Chip>Sin bandas aquí</Chip>
          {plantasConBandas.slice(0, 4).map((p) => (
            <button key={p} type="button" className="chip" data-acento onClick={() => poner(i, { planta: p })}>
              Ir a {p}
            </button>
          ))}
        </>
      )}
    </>
  );

  const vista = (
    <ZonaVistas
      fuentes={{
        planta: (v) => <EscenaBandas fuente={v.planta ? { tipo: "planta", planta: v.planta, vista: { vista: "bandas", combinaciones: eleccion, ...(dir ? { direccion: dir } : {}) } } : null} bandas={ids} />,
        cabeceraPlanta: (v, i) => cabecera(v, i),
      }}
    />
  );

  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : r.diagnosticos ? <Aviso tono="fail">{r.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !r.datos && r.cargando ? <Aviso>Cortando las bandas…</Aviso> : null;

  const tabla = d ? (
    <Seccion titulo={`Bandas de ${planta}`} valor={`${d.filas.length} · fem consultar banda`}>
      {d.filas.length === 0 ? (
        <p className="nota">{planta && plantasConBandas.includes(planta) ? "No hay bandas en esta dirección." : "Esta planta no tiene bandas: se proponen en Modelo («Proponer bandas») o se escriben en su tabla."}</p>
      ) : (
        <table className="tb" aria-label="Bandas de la planta">
          <thead>
            <tr>
              <th>Banda</th>
              <th>Ancho m</th>
              <th>My caras kN·m</th>
              <th>My vanos kN·m</th>
            </tr>
          </thead>
          <tbody>
            {d.filas.map((f) => (
              <tr key={f.id} className="clic" data-on={f.id === seleccion} onClick={() => setSeleccion(f.id)}>
                <td>
                  {f.id}
                  <small>
                    {f.tipo ?? "sin tipo"} · {f.origen} · dir. {f.direccion}
                    {f.invalidas ? ` · ${f.invalidas} estaciones sin losa` : ""}
                  </small>
                </td>
                <td>{fmt(f.ancho, 2)}</td>
                <td data-my-cara={f.cara?.[0]}>
                  <Valor v={f.cara} varias={varias} />
                </td>
                <td data-my-vano={f.vano?.[0]}>
                  <Valor v={f.vano} varias={varias} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {aviso}
    </Seccion>
  ) : (
    aviso ?? <p className="nota">…</p>
  );

  const reparto = d ? (
    <Seccion titulo="Reparto pilares / central" valor={d.reparto.length}>
      {d.reparto.length === 0 ? (
        <p className="nota">Sin bandas con tipo (de pilares o central) en esta dirección.</p>
      ) : (
        <table className="tb" aria-label="Reparto entre bandas">
          <thead>
            <tr>
              <th>Línea</th>
              <th>Pilares kN·m</th>
              <th>Centrales kN·m</th>
              <th>Pilares %</th>
              <th>Tabla I.1</th>
            </tr>
          </thead>
          <tbody>
            {d.reparto.map((li) => (
              <tr key={`${li.losa}${li.direccion}${li.tipo}${li.s}`} data-fuera={li.fuera.length > 0 || undefined}>
                <td>
                  {li.tipo === "cara" ? "caras" : "vanos"} s = {fmt(li.s, 2)}
                  <small>
                    {li.losa} · dir. {li.direccion}
                    {varias ? ` · ${li.comb}` : ""}
                  </small>
                </td>
                <td>{fmt(li.pilares, 1)}</td>
                <td>{fmt(li.centrales, 1)}</td>
                <td className={li.fuera.length ? "text-state-warn" : undefined}>{Number.isFinite(li.fraccion) ? `${fmt(100 * li.fraccion, 0)} %` : "—"}</td>
                <td>
                  {fmt(100 * li.rango[0], 0)}–{fmt(100 * li.rango[1], 0)} %{li.fuera.length ? <small className="text-state-warn">fuera en {li.fuera.length} comb.</small> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="nota">Suma de los My de las bandas de pilares y de las centrales en cada línea de caras y de vanos, en la combinación de mayor momento total de la línea. Sale de la tabla I.1 del Anejo I: es el reparto del cálculo, no un error (C5-d).</p>
    </Seccion>
  ) : (
    <p className="nota">…</p>
  );

  const propiedades = detalle ? <DetalleBanda d={detalle} varias={varias} /> : <p className="nota">{rb.cargando && elegida ? "Cortando la banda…" : "Elija una banda (en la planta o en la tabla) para ver sus estaciones, Wood–Armer y el momento por nervio."}</p>;

  return (
    <Disposicion
      paneles={pan}
      etiquetaHerramientas="Herramientas de Resultados"
      herramientas={herramientas}
      vista={vista}
      props={{ titulo: "Propiedades", contenido: propiedades, ancho: 360 }}
      dock={[
        { id: "bandas", titulo: "Bandas", insignia: d?.filas.length, contenido: tabla },
        { id: "reparto", titulo: "Reparto", insignia: d?.reparto.filter((x) => x.fuera.length).length || d?.reparto.length, contenido: reparto },
      ]}
    />
  );
}
