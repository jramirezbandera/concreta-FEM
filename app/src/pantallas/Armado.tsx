/**
 * Resultados · Armado (fase F, `docs/fem3d/franjas.md` §2.6): las franjas de armado de las losas de
 * la planta, coloreadas por la demanda de Wood–Armer de una armadura (X o Y, inferior o superior;
 * la escena `armado-…` de A4, la de `fem render`). Abajo, la tabla de las franjas de esa dirección
 * con su mayor demanda; en Propiedades, la franja elegida: su diagrama a lo largo y sus estaciones.
 *
 * Cada número es de una consulta (`fem consultar franjas`, `fem consultar franja`), nunca del dibujo.
 */
import { useState } from "react";
import type { Armadura } from "../../../src/agente/render/armado.ts";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { DemandaFranja, EstacionFranjaEnvolvente } from "../../../src/agente/consultas.ts";
import type { Eleccion } from "../../../src/visor/escena.ts";
import type { DatosFranja } from "../../../src/visor/franjas.ts";
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

const ARMADURAS: { id: Armadura; nombre: string }[] = [
  { id: "x-inf", nombre: "X inferior" },
  { id: "x-sup", nombre: "X superior" },
  { id: "y-inf", nombre: "Y inferior" },
  { id: "y-sup", nombre: "Y superior" },
];

/** Una demanda con su estación y su combinación (si hay más de una). */
function Demanda({ v, varias }: { v: DemandaFranja | null; varias: boolean }) {
  if (!v) return <>0</>;
  return (
    <>
      {fmt(v.v, 1)}
      <small>
        s = {fmt(v.s, 2)}
        {varias && v.comb ? ` · ${v.comb}` : ""}
      </small>
    </>
  );
}

/** Un valor con su combinación (si hay más de una). */
function Valor({ v, varias }: { v: [number, string]; varias: boolean }) {
  if (!Number.isFinite(v[0])) return <>—</>;
  return (
    <>
      {fmt(v[0], 1)}
      {varias && v[1] ? <small>{v[1]}</small> : null}
    </>
  );
}

/** La escena del armado de una planta: un clic elige la franja. */
function EscenaArmado({ fuente, franjas }: { fuente: FuenteEscena | null; franjas: ReadonlySet<string> | null }) {
  const { proyecto, seleccion, setSeleccion } = useVisor();
  const pedido = !fuente || proyecto.desactualizado || fuente.tipo !== "planta" ? null : { tipo: "escena" as const, planta: fuente.planta, vista: fuente.vista };
  const d = usePedido(proyecto.cliente, pedido);
  const resaltado = useEleccion(fuente, seleccion && franjas?.has(seleccion) ? seleccion : null);
  const clic = async (p: Vec2, radio: number) => {
    if (!proyecto.cliente || !fuente) return;
    const r = await proyecto.cliente.pedir({ tipo: "elegir", fuente, punto: p, radio, ...(franjas ? { objetos: [...franjas] } : {}) });
    const o = r.ok ? (r.valor as Eleccion | null)?.objeto : null;
    setSeleccion(o && franjas?.has(o) ? o : null);
  };
  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>Cortando las franjas…</Aviso> : null;
  return <Fuente2D escena={proyecto.desactualizado ? null : d.datos} resaltado={resaltado} eventos={{ clic: (p, r) => void clic(p, r) }} aviso={aviso} cargando={d.cargando} />;
}

/**
 * El diagrama de una franja a lo largo: mx máximo y mínimo (líneas) y las demandas inferior y
 * superior de Wood–Armer (áreas), con el eje de los momentos positivos hacia abajo, como el de una
 * viga. Sólo dibuja los valores de la tabla.
 */
function DiagramaFranja({ d }: { d: DatosFranja }) {
  const es = d.estaciones.filter((x) => x.valido !== false);
  if (!es.length) return null;
  const [W, H, m] = [320, 150, 8];
  const s0 = d.franja.s[0];
  const s1 = d.franja.s[1];
  const vmax = Math.max(1e-9, ...es.flatMap((x) => [Math.abs(x.max[0]), Math.abs(x.min[0]), x.inferior[0], x.superior[0]]));
  const X = (s: number) => m + ((s - s0) / (s1 - s0 || 1)) * (W - 2 * m);
  // Positivos hacia abajo (tracción abajo), como los diagramas de las vigas
  const Y = (v: number) => H / 2 + (v / vmax) * (H / 2 - m);
  const linea = (v: (x: EstacionFranjaEnvolvente) => number) => es.map((x, i) => `${i ? "L" : "M"}${X(x.s).toFixed(1)},${Y(v(x)).toFixed(1)}`).join(" ");
  const area = (v: (x: EstacionFranjaEnvolvente) => number) => `${linea(v)} L${X(es[es.length - 1]!.s).toFixed(1)},${Y(0).toFixed(1)} L${X(es[0]!.s).toFixed(1)},${Y(0).toFixed(1)} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Diagrama de ${d.franja.id}`}>
      <path d={area((x) => x.inferior[0])} fill="#d6604d" fillOpacity={0.25} />
      <path d={area((x) => -x.superior[0])} fill="#4393c3" fillOpacity={0.25} />
      <line x1={m} x2={W - m} y1={Y(0)} y2={Y(0)} stroke="currentColor" strokeOpacity={0.5} />
      <path d={linea((x) => x.max[0])} fill="none" stroke="#b2182b" strokeWidth={1.2} />
      <path d={linea((x) => x.min[0])} fill="none" stroke="#2166ac" strokeWidth={1.2} />
      {es
        .filter((x) => x.tipo !== "paso")
        .map((x) => (
          <line key={`${x.s}${x.lado}`} x1={X(x.s)} x2={X(x.s)} y1={m} y2={H - m} stroke="currentColor" strokeOpacity={0.15} />
        ))}
    </svg>
  );
}

/** La franja elegida: su diagrama y sus estaciones. */
function DetalleFranja({ d, varias }: { d: DatosFranja; varias: boolean }) {
  const f = d.franja;
  const exactas = d.estaciones.filter((x) => x.tipo !== "paso");
  const reticular = f.intereje !== null;
  return (
    <>
      <Seccion titulo={f.id} valor={`dirección ${f.direccion === 1 ? "X (1)" : "Y (2)"}`}>
        <div className="px-3.5 py-1.5 text-[12px] text-text-secondary">
          {f.losa} · ancho {fmt(f.ancho, 3)} m{reticular ? ` (el intereje)` : ""} · t de {fmt(f.t[0], 2)} a {fmt(f.t[1], 2)} m · s de {fmt(f.s[0], 2)} a {fmt(f.s[1], 2)} m
        </div>
        <DiagramaFranja d={d} />
        <p className="nota">Líneas: mx máximo (rojo) y mínimo (azul). Áreas: demanda de Wood–Armer inferior (abajo) y superior (arriba). Positivos hacia abajo; las verticales, las caras y las líneas de apoyo.</p>
      </Seccion>
      <Seccion titulo="Caras y apoyos" valor="kN·m/m">
        <table className="tb" aria-label={`Caras y apoyos de ${f.id}`}>
          <thead>
            <tr>
              <th>s m</th>
              <th>mx mín</th>
              <th>inf.</th>
              <th>sup.</th>
            </tr>
          </thead>
          <tbody>
            {exactas.map((x) => (
              <tr key={`${x.s}${x.lado}`} data-invalida={x.valido === false || undefined}>
                <td>
                  {fmt(x.s, 3)}
                  <small>
                    {x.tipo} {x.lado === -1 ? "←" : "→"} {x.piezas?.join(", ") ?? ""}
                  </small>
                </td>
                <td data-mx-min={x.min[0]}>
                  <Valor v={x.min} varias={varias} />
                </td>
                <td data-inferior={x.inferior[0]}>
                  <Valor v={x.inferior} varias={varias} />
                </td>
                <td data-superior={x.superior[0]}>
                  <Valor v={x.superior} varias={varias} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="nota">De «fem consultar franja»: exactas, por fuerzas nodales, del lado de la flecha. Momento medio por metro de la franja; mx &gt; 0 tracciona la cara inferior.</p>
      </Seccion>
      <Seccion titulo="Todas las estaciones" valor={d.estaciones.length}>
        <table className="tb" aria-label={`Estaciones de ${f.id}`}>
          <thead>
            <tr>
              <th>s m</th>
              <th>mx máx</th>
              <th>mx mín</th>
              <th>inf.</th>
              <th>sup.</th>
            </tr>
          </thead>
          <tbody>
            {d.estaciones.map((x) => (
              <tr key={`${x.tipo}${x.s}${x.lado ?? 0}`} data-invalida={x.valido === false || undefined}>
                <td>
                  {fmt(x.s, 2)}
                  {x.tipo !== "paso" ? <small>{x.tipo}</small> : null}
                </td>
                <td>{fmt(x.max[0], 1)}</td>
                <td>{fmt(x.min[0], 1)}</td>
                <td>{fmt(x.inferior[0], 1)}</td>
                <td>{fmt(x.superior[0], 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {reticular && <p className="nota">Reticular: el momento por nervio es el medio por el intereje ({fmt(f.intereje!, 2)} m), fuera de los ábacos.</p>}
      </Seccion>
      {d.diagnosticos.length > 0 && (
        <Seccion titulo="Avisos" valor={d.diagnosticos.length}>
          <ListaDiagnosticos ds={d.diagnosticos} />
        </Seccion>
      )}
    </>
  );
}

export function ModoArmado() {
  const { proyecto, planta, seleccion, setSeleccion } = useVisor();
  const pan = usePaneles("resultados:armado", { props: true, dock: true, pestana: "franjas" });
  const { poner } = useVistas();
  const e = proyecto.estado!;
  const [eleccion, setEleccion] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const [armadura, setArmadura] = useState<Armadura>("x-sup");
  const r = usePedido(proyecto.cliente, proyecto.desactualizado || !planta ? null : { tipo: "armado", planta, combinaciones: eleccion, armadura });
  const d = proyecto.desactualizado ? null : r.datos;
  const ids = d ? new Set(d.filas.map((f) => f.id)) : null;
  // El detalle, de la franja elegida si es de las de la tabla
  const elegida = seleccion && ids?.has(seleccion) ? seleccion : null;
  const rf = usePedido(proyecto.cliente, proyecto.desactualizado || !elegida ? null : { tipo: "franja", id: elegida, combinaciones: eleccion });
  const detalle = rf.datos && rf.datos.franja.id === elegida ? rf.datos : null;
  const varias = (d?.combinaciones.nombres.length ?? 1) > 1;
  const conFranjas = d?.plantas ?? [];
  const inferior = armadura.endsWith("inf");

  const herramientas = (
    <>
      <ComboCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} etiqueta="esfuerzos" />
      <Desplegable etiqueta="Armadura" valor={armadura} onCambio={setArmadura} opciones={ARMADURAS} />
      <Separador />
      <BarraModos />
      <Separador />
      <BarraVistas />
    </>
  );

  const cabecera = (v: { planta: string | null }, i: number) => (
    <>
      <Chip acento title="X es la dirección 1 de cada losa (su eje 1) e Y, la perpendicular">
        Armado · {ARMADURAS.find((a) => a.id === armadura)!.nombre}
      </Chip>
      {v.planta && d && !conFranjas.includes(v.planta) && (
        <>
          <Chip>Sin losas aquí</Chip>
          {conFranjas.slice(0, 4).map((p) => (
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
        planta: (v) => <EscenaArmado fuente={v.planta ? { tipo: "planta", planta: v.planta, vista: { vista: "armado", combinaciones: eleccion, armadura } } : null} franjas={ids} />,
        cabeceraPlanta: (v, i) => cabecera(v, i),
      }}
    />
  );

  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : r.diagnosticos ? <Aviso tono="fail">{r.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !r.datos && r.cargando ? <Aviso>Cortando las franjas…</Aviso> : null;

  const tabla = d ? (
    <Seccion titulo={`Franjas de ${planta}`} valor={`${d.filas.length} · fem consultar franjas`}>
      {d.filas.length === 0 ? (
        <p className="nota">Esta planta no tiene losas macizas ni reticulares.</p>
      ) : (
        <table className="tb" aria-label="Franjas de la planta">
          <thead>
            <tr>
              <th>Franja</th>
              <th>Ancho m</th>
              <th>Inferior kN·m/m</th>
              <th>Superior kN·m/m</th>
            </tr>
          </thead>
          <tbody>
            {d.filas.map((f) => (
              <tr key={f.id} className="clic" data-on={f.id === seleccion} onClick={() => setSeleccion(f.id)}>
                <td>
                  {f.id}
                  <small>
                    t de {fmt(f.t[0], 2)} a {fmt(f.t[1], 2)}
                  </small>
                </td>
                <td>{fmt(f.ancho, 2)}</td>
                <td data-inferior={f.inferior?.v ?? 0} className={inferior ? "font-medium" : undefined}>
                  <Demanda v={f.inferior} varias={varias} />
                </td>
                <td data-superior={f.superior?.v ?? 0} className={inferior ? undefined : "font-medium"}>
                  <Demanda v={f.superior} varias={varias} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="nota">Mayor momento de dimensionado de Wood–Armer de cada franja (por metro), por combinación con los momentos medios de su ancho, y dónde está (s, a lo largo).</p>
      {aviso}
    </Seccion>
  ) : (
    aviso ?? <p className="nota">…</p>
  );

  const propiedades = detalle ? <DetalleFranja d={detalle} varias={varias} /> : <p className="nota">{rf.cargando && elegida ? "Cortando la franja…" : "Elija una franja (en la planta o en la tabla) para ver su diagrama y sus estaciones."}</p>;

  return (
    <Disposicion
      paneles={pan}
      etiquetaHerramientas="Herramientas de Resultados"
      herramientas={herramientas}
      vista={vista}
      props={{ titulo: "Propiedades", contenido: propiedades, ancho: 360 }}
      dock={[{ id: "franjas", titulo: "Franjas", insignia: d?.filas.length, contenido: tabla }]}
    />
  );
}
