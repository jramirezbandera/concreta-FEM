/**
 * Resultados · Reacciones (I4, `docs/fem3d/interfaz.md` §15): las de `fem consultar
 * reacciones`, en las tres vistas:
 * - en el 3D, una flecha por objeto con reacciones (`reacciones3d`): la vertical con Fz y la
 *   horizontal con (Fx, Fy), en el sentido de la fuerza del apoyo sobre la estructura, en el centro
 *   de sus nudos coartados;
 * - en planta, la escena `reacciones` de A4 (la de `fem render`): Fz rotulada y (Fx, Fy) a escala en
 *   los objetos de la planta (los que arrancan de ella y sus apoyos);
 * - en alzado, los objetos del plano con Fz y la componente en el plano, a la escala del 3D.
 * Abajo, la tabla de la consulta y sus totales por combinación; en Propiedades, el objeto elegido.
 *
 * Con varias combinaciones, cada objeto con la de su mayor |Fz| (dicha en su fila). Cada número es
 * de la consulta; bajo el cursor, los de la flecha.
 */
import { useState, type ReactNode } from "react";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { Eleccion } from "../../../src/visor/escena.ts";
import type { Reacciones3D, ReaccionObjeto } from "../../../src/visor/reacciones3d.ts";
import type { EleccionCombinaciones, FuenteEscena } from "../../../src/visor/sesion.ts";
import { Chip, Desplegable, Disposicion, Separador } from "../armazon/Disposicion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { IcReacciones } from "../armazon/iconos.tsx";
import { Aviso, Cabecera, ComboCombinaciones, Equilibrio, Seccion } from "../componentes/comunes.tsx";
import { BarraModos } from "../espacios/BarraModos.tsx";
import { useVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { useVistas } from "../vistas/estado.ts";
import { queCombinaciones, useSonda } from "../vistas/sonda.ts";
import { conMalla, Fuente2D, Fuente3DModelo, planoAlzado, ZonaVistas } from "../vistas/Zona.tsx";
import { useEleccion } from "./useEleccion.ts";

const ESCALAS = ["0.25", "0.5", "1", "2", "4"] as const;
type Escala = (typeof ESCALAS)[number];

/** Las líneas de la sonda de una flecha: sus valores, de la consulta. */
export function lineasReaccion(o: ReaccionObjeto): string[] {
  return [`${o.id} · ${o.tipo} · ${o.comb}`, `Fz ${fmt(o.R[2], 1)} kN · Fx ${fmt(o.R[0], 1)} · Fy ${fmt(o.R[1], 1)}`, `Mx ${fmt(o.R[3], 1)} · My ${fmt(o.R[4], 1)} · Mz ${fmt(o.R[5], 1)} kN·m`];
}

/** Las flechas en un 3D. */
function TresDReacciones({ d, aviso, cargando }: { d: Reacciones3D | null; aviso: ReactNode; cargando: boolean }) {
  const { alPasar, sonda } = useSonda(d ? (o) => (o.tipo === "reaccion" && d.objetos[o.k] ? lineasReaccion(d.objetos[o.k]!) : null) : null, String(!!d && d.objetos.length) + (d?.conjunto.descripcion ?? ""));
  return <Fuente3DModelo resultados={{ reacciones: d, leyenda: d, aviso, cargando, alPasar, sonda }} />;
}

/**
 * Las reacciones en una escena 2D (la planta o el alzado de una vista): un clic elige el objeto (si
 * tiene reacción), y lo elegido se resalta.
 */
function EscenaReacciones({ fuente, objetos }: { fuente: FuenteEscena | null; objetos: ReadonlySet<string> | null }) {
  const { proyecto, seleccion, setSeleccion } = useVisor();
  const pedido = !fuente || proyecto.desactualizado ? null : fuente.tipo === "planta" ? { tipo: "escena" as const, planta: fuente.planta, vista: fuente.vista } : { tipo: "alzado" as const, plano: fuente.plano, ...(fuente.reacciones ? { reacciones: fuente.reacciones } : {}) };
  const d = usePedido(proyecto.cliente, pedido);
  const resaltado = useEleccion(fuente, seleccion && objetos?.has(seleccion) ? seleccion : null);
  const clic = async (p: Vec2, radio: number) => {
    if (!proyecto.cliente || !fuente) return;
    const r = await proyecto.cliente.pedir({ tipo: "elegir", fuente, punto: p, radio });
    const o = r.ok ? (r.valor as Eleccion | null)?.objeto : null;
    setSeleccion(o && objetos?.has(o) ? o : null);
  };
  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>Sumando las reacciones…</Aviso> : null;
  return <Fuente2D escena={proyecto.desactualizado ? null : d.datos} resaltado={resaltado} eventos={{ clic: (p, r) => void clic(p, r) }} aviso={aviso} cargando={d.cargando} />;
}

/** En la cabecera de una planta sin apoyos: a cuáles ir (las plantas con reacciones). */
function PlantasConReacciones({ d, planta, onPlanta }: { d: Reacciones3D | null; planta: string | null; onPlanta: (p: string) => void }) {
  if (!d || !planta || d.objetos.some((o) => o.planta === planta)) return null;
  const n = new Map<string, number>();
  for (const o of d.objetos) n.set(o.planta, (n.get(o.planta) ?? 0) + 1);
  if (!n.size) return <Chip>Sin reacciones</Chip>;
  return (
    <>
      <Chip>Sin apoyos aquí</Chip>
      {[...n].map(([p, k]) => (
        <button key={p} type="button" className="chip" data-acento title={`${k} objetos con reacción`} onClick={() => onPlanta(p)}>
          Ir a {p}
        </button>
      ))}
    </>
  );
}

export function ModoReacciones() {
  const { proyecto, seleccion, setSeleccion } = useVisor();
  const pan = usePaneles("resultados:reacciones", { props: true, dock: true, pestana: "reacciones" });
  const { poner } = useVistas();
  const e = proyecto.estado!;
  const [eleccion, setEleccion] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const [escala, setEscala] = useState<Escala>("1");
  const r = usePedido(proyecto.cliente, proyecto.desactualizado ? null : { tipo: "reacciones3d", combinaciones: eleccion, escala: Number(escala) });
  const d = proyecto.desactualizado ? null : r.datos;
  const elegido = d?.objetos.find((o) => o.id === seleccion) ?? null;
  const ids = d ? new Set(d.objetos.map((o) => o.id)) : null;
  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : r.diagnosticos ? <Aviso tono="fail">{r.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !r.datos && r.cargando ? <Aviso>Sumando las reacciones…</Aviso> : null;

  const herramientas = (
    <>
      <ComboCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} etiqueta="reacciones" />
      <Desplegable etiqueta="Escala de las flechas" prefijo={<span className="text-text-secondary">Escala</span>} valor={escala} onCambio={setEscala} opciones={ESCALAS.map((x) => ({ id: x, nombre: `×${x.replace(".", ",")}` }))} />
      <Separador />
      <BarraModos />
      <Separador />
      <BarraVistas />
    </>
  );

  const cabecera = (
    <Chip acento title={d?.notas[0]}>
      Reacciones · {queCombinaciones(d?.conjunto)}
    </Chip>
  );

  const vista = (
    <ZonaVistas
      fuentes={{
        tresD: () => <TresDReacciones d={d} aviso={aviso} cargando={r.cargando} />,
        planta: (v) => <EscenaReacciones fuente={v.planta ? { tipo: "planta", planta: v.planta, vista: conMalla({ vista: "reacciones" as const, combinaciones: eleccion, escala: Number(escala) }, v) } : null} objetos={ids} />,
        malla: true,
        alzado: (v) => <EscenaReacciones fuente={v.eje ? { tipo: "alzado", plano: planoAlzado(v.eje, v), reacciones: { combinaciones: eleccion, escala: Number(escala) } } : null} objetos={ids} />,
        cabecera3D: () => cabecera,
        cabeceraPlanta: (v, i) => (
          <>
            {cabecera}
            <PlantasConReacciones d={d} planta={v.planta} onPlanta={(p) => poner(i, { planta: p })} />
          </>
        ),
        cabeceraAlzado: () => cabecera,
      }}
    />
  );

  const tabla = d ? (
    <Seccion titulo="Reacciones por objeto" valor={`${d.objetos.length} · fem consultar reacciones`}>
      <table className="tb">
        <thead>
          <tr>
            <th>Objeto</th>
            <th>Fx kN</th>
            <th>Fy kN</th>
            <th>Fz kN</th>
            <th>Mx kN·m</th>
            <th>My kN·m</th>
            <th>Mz kN·m</th>
          </tr>
        </thead>
        <tbody>
          {d.objetos.map((o) => (
            <tr key={o.id} className="clic" data-on={o.id === seleccion} onClick={() => setSeleccion(o.id)}>
              <td>
                {o.id}
                <small>
                  {o.tipo} · {o.planta}
                  {d.conjunto.n > 1 ? ` · ${o.comb}` : ""}
                </small>
              </td>
              {o.R.map((v, i) => (
                <td key={i} data-reaccion={i === 2 ? v : undefined}>
                  {fmt(v, 1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="nota">La resultante de cada objeto respecto al centro de sus nudos coartados, en ejes globales; Fz &gt; 0, hacia arriba (el apoyo empuja la estructura).</p>
    </Seccion>
  ) : (
    <p className="nota">…</p>
  );

  const totales = d ? (
    <Seccion titulo="Totales por combinación" valor={d.totales.length}>
      <table className="tb">
        <thead>
          <tr>
            <th>Combinación</th>
            <th>ΣFx kN</th>
            <th>ΣFy kN</th>
            <th>ΣFz kN</th>
          </tr>
        </thead>
        <tbody>
          {d.totales.map((t) => (
            <tr key={t.comb}>
              <td>{t.comb}</td>
              <td>{fmt(t.F[0], 1)}</td>
              <td>{fmt(t.F[1], 1)}</td>
              <td>{fmt(t.F[2], 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="nota">La suma de todas las reacciones de cada combinación: equilibra sus cargas (ΣF y ΣM se comprueban a 1e-9 en cada cálculo).</p>
    </Seccion>
  ) : (
    <p className="nota">…</p>
  );

  const propiedades = (
    <>
      {elegido ? (
        <>
        <Cabecera icono={IcReacciones} tipo={`Reacción · ${elegido.tipo}`} titulo={elegido.id} mono detalle={`${elegido.comb} · planta ${elegido.planta} · en (${fmt(elegido.punto[0], 2)}; ${fmt(elegido.punto[1], 2)}; ${fmt(elegido.punto[2], 2)}) m`} />
        <Seccion titulo="Reacción">
          <table className="tb">
            <tbody>
              {(["Fx", "Fy", "Fz", "Mx", "My", "Mz"] as const).map((k, i) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>
                    {fmt(elegido.R[i], 2)}
                    <small>{i < 3 ? "kN" : "kN·m"}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Seccion>
        </>
      ) : (
        <Cabecera icono={IcReacciones} tipo="Reacciones" titulo="Nada elegido" detalle="Elija un pilar, un muro o un apoyo (en una vista o en la tabla) para ver su reacción. En el 3D, bajo el cursor, la de cada flecha." />
      )}
      {d && d.extremos.length > 0 && (
        <Seccion titulo="Extremos">
          {d.extremos.map((x) => (
            <div key={x.que} className="fila">
              <span>{x.que}</span>
              <span className="v">
                {fmt(x.valor, 1)} kN · {x.id}
              </span>
            </div>
          ))}
        </Seccion>
      )}
      <Equilibrio estado={e} />
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
        { id: "reacciones", titulo: "Reacciones", insignia: d?.objetos.length, contenido: tabla },
        { id: "totales", titulo: "Totales", insignia: d?.totales.length, contenido: totales },
      ]}
    />
  );
}
