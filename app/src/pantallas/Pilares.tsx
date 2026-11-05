/**
 * Resultados · Pilares (la pantalla 5 de V1): en planta, el axil de cada tramo que llega (escena
 * `pilares-n` de A4); en el panel inferior, el cuadro de los tramos de la planta, y en Propiedades,
 * el del pilar elegido en toda su altura. Cada tramo, con sus ternas concomitantes (UI-10): en la
 * cabeza y en el pie, la combinación del N mínimo (la mayor compresión), del N máximo, del mayor |My|
 * y del mayor |Mz|, cada una con sus N, My y Mz (los extremos de `fem consultar pieza`, que ya llevan
 * sus concomitantes; antes, cada columna era de otra combinación). Y el axil reducido ν de A3 (un
 * aviso de orden de magnitud, no la comprobación de norma, que hace el módulo de pilares de Concreta).
 * Se abre en la planta más baja con pilares, la del mayor axil (UI-16).
 *
 * I4: un 3D pinta cada tramo del color de su N o su ν (`pilares3d`, los valores del cuadro), los de
 * todas las plantas o los de la de su cabecera; bajo el cursor, los del tramo. Se puede elegir
 * cualquier pilar, en el 3D o en un alzado, aunque no llegue a la planta activa.
 */
import { useEffect, useRef, useState } from "react";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { FilaPilar } from "../../../src/visor/datos.ts";
import type { MagnitudPilares, Pilares3D } from "../../../src/visor/pilares3d.ts";
import type { Eleccion } from "../../../src/visor/escena.ts";
import type { EleccionCombinaciones, VistaPlanta } from "../../../src/visor/sesion.ts";
import { Chip, Desplegable, Disposicion, Separador } from "../armazon/Disposicion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { IcPilares } from "../armazon/iconos.tsx";
import { Aviso, Cabecera, ComboCombinaciones, Seccion, TablaCombinaciones, TITULO_COMBINACIONES, AvisoDesactualizado } from "../componentes/comunes.tsx";
import { BarraModos } from "../espacios/BarraModos.tsx";
import { useVisor } from "../contexto.ts";
import { fmt, plural } from "../fmt.ts";
import { sinObsoleto, usePedido } from "../sesion/usePedido.ts";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { useVistas, vistasDe } from "../vistas/estado.ts";
import { queCombinaciones, useSonda } from "../vistas/sonda.ts";
import { Fuente2D, Fuente3DModelo, ZonaVistas } from "../vistas/Zona.tsx";
import { LIMITE_NU, NOTA_TERNAS, TablaTernas } from "./Ternas.tsx";
import { useEleccion } from "./useEleccion.ts";

/** El axil de los tramos que llegan a una planta, en una vista: un clic elige el pilar. */
function PlantaPilares({ planta, eleccion, id, malla }: { planta: string; eleccion: EleccionCombinaciones; id: string | null; malla?: boolean }) {
  const { proyecto, setSeleccion } = useVisor();
  const d = usePedido(proyecto.cliente, { tipo: "pilares", planta, combinaciones: eleccion, ...(malla ? { malla } : {}) });
  const vista: VistaPlanta = { vista: "pilares-n", combinaciones: eleccion };
  const fuente = { tipo: "planta" as const, planta, vista };
  const resaltado = useEleccion(fuente, id);
  const filas = d.datos?.filas;
  const clic = async (p: Vec2, radio: number) => {
    if (!proyecto.cliente) return;
    // C-12: con el cliente cerrado por una edición, el clic no hace nada (sin rechazo en la consola)
    const r = await sinObsoleto(proyecto.cliente.pedir({ tipo: "elegir", fuente, punto: p, radio }));
    if (!r) return;
    const o = r.ok ? (r.valor as Eleccion | null)?.objeto : null;
    setSeleccion(o && filas?.some((f) => f.pilar === o) ? o : null);
  };
  const aviso = proyecto.desactualizado ? <AvisoDesactualizado /> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>Buscando los extremos de cada tramo…</Aviso> : null;
  return <Fuente2D escena={proyecto.desactualizado ? null : (d.datos?.escena ?? null)} resaltado={resaltado} eventos={{ clic: (p, r) => void clic(p, r) }} aviso={aviso} cargando={d.cargando} />;
}

const MAGNITUDES: { id: MagnitudPilares; nombre: string; title: string }[] = [
  { id: "N", nombre: "N", title: "La mayor compresión de cada tramo (la columna N del cuadro)" },
  { id: "nu", nombre: "ν", title: "El axil reducido de A3 en los tramos de hormigón" },
];

/** Las líneas de la sonda de un tramo: sus valores, los del cuadro. */
export function lineasTramo(d: Pilares3D, k: number): string[] | null {
  const t = d.tramos[k];
  if (!t) return null;
  const v = t.valor === null ? "sin ν: no es de hormigón" : d.magnitud === "nu" ? `ν ${fmt(t.valor, 3)} · ${t.comb}` : `N ${fmt(t.valor, 1)} kN · ${t.comb}${t.donde ? ` (en la ${t.donde})` : ""}`;
  return [`${t.pilar} · de ${t.plantaBase} a ${t.planta}`, v, t.seccion];
}

/** Los tramos por colores en un 3D (I4): los de todas las plantas o los de la de su cabecera. */
function TresDPilares({ planta, magnitud, eleccion }: { planta: string | null; magnitud: MagnitudPilares; eleccion: EleccionCombinaciones }) {
  const { proyecto } = useVisor();
  const d = usePedido(proyecto.cliente, proyecto.desactualizado ? null : { tipo: "pilares3d", magnitud, combinaciones: eleccion, planta });
  const datos = proyecto.desactualizado ? null : d.datos;
  const aviso = proyecto.desactualizado ? <AvisoDesactualizado /> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>Buscando los extremos de cada tramo…</Aviso> : null;
  const { alPasar, sonda } = useSonda(datos ? (o) => (o.tipo === "pilar" ? lineasTramo(datos, o.k) : null) : null, JSON.stringify([planta, magnitud, eleccion, !!datos]));
  return <Fuente3DModelo resultados={{ pilares: datos, leyenda: datos, aviso, cargando: d.cargando, alPasar, sonda }} />;
}

type Extremos = FilaPilar["tramo"]["base"];

/** El valor de un extremo (N+, N-, My, Mz) en la base o la cabeza: su componente y su combinación. */
function extremo(x: Extremos, k: "N+" | "N-" | "My" | "Mz"): { v: number; comb: string } | null {
  const e = x[k];
  if (!e) return null;
  const c = k === "My" ? 4 : k === "Mz" ? 5 : 0;
  return { v: e.esfuerzos[c]!, comb: e.comb };
}

/** La mayor compresión (el N más negativo) de la base y la cabeza. */
function compresion(f: FilaPilar): { v: number; comb: string } | null {
  const a = extremo(f.tramo.base, "N-");
  const b = extremo(f.tramo.cabeza, "N-");
  return !b || (a && a.v <= b.v) ? a : b;
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
            <text x={44} y={11} fontSize={11} textAnchor="end" fontFamily="var(--font-mono)" fill="var(--color-text-secondary)">
              {f.planta}
            </text>
            <rect x={50} y={2} width={w} height={11} fill={pasa ? "var(--color-tint-warn)" : "var(--color-bg-elevated)"} stroke={pasa ? "var(--color-state-warn)" : "var(--color-border-main)"} />
            <text x={54 + w} y={11} fontSize={11} fontFamily="var(--font-mono)" fill="var(--color-text-primary)">
              {/* R-21: con un decimal, como el rótulo de la planta y las ternas */}
              {fmt(ns[i]!, 1)}
              {/* C-22: el aviso de ν, también escrito (no sólo el color de la barra) */}
              {pasa ? ` · ν > ${fmt(LIMITE_NU, 2)}` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Los proyectos abiertos (por su fuente) en los que ya se entró en Pilares. */
const YA_ABIERTOS = new WeakSet<object>();

export function ModoPilares() {
  const { proyecto, planta, setPlanta, seleccion, setSeleccion } = useVisor();
  const pan = usePaneles("resultados:pilares", { props: true, dock: true, pestana: "cuadro" });
  const vistas = useVistas();
  const sinPlanta = !vistas.vistas.slice(0, vistasDe(vistas.disposicion)).some((v) => v.tipo === "planta" || v.tipo === "3d");
  useEffect(() => {
    if (sinPlanta) vistas.irATipo("planta");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al entrar
  }, []);
  const e = proyecto.estado!;
  // Se abre en la planta más baja a la que llegan pilares: la del mayor axil (UI-16). Sólo la primera
  // vez con cada proyecto abierto: al recalcular tras un cambio del fichero el modo se vuelve a montar,
  // y pisaba la planta elegida (el banco de V1, criterio 5)
  const abierta = useRef(false);
  useEffect(() => {
    if (abierta.current) return;
    abierta.current = true;
    const fuente = proyecto.fuente;
    if (fuente) {
      if (YA_ABIERTOS.has(fuente)) return;
      YA_ABIERTOS.add(fuente);
    }
    const f = proyecto.edicion?.proyecto.modelo;
    if (!f) return;
    const ids = f.plantas.map((p) => p.id);
    const llegan = new Set((f.pilares ?? []).flatMap((p) => {
      const [a, b] = [ids.indexOf(p.hasta), ids.indexOf(p.desde)];
      return a < 0 || b < 0 ? [] : ids.slice(a, b);
    }));
    const baja = [...ids].reverse().find((p) => llegan.has(p));
    if (baja && baja !== planta) setPlanta(baja);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al entrar
  }, []);
  const [eleccion, setEleccion] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const [magnitud, setMagnitud] = useState<MagnitudPilares>("N");
  const d = usePedido(proyecto.cliente, planta ? { tipo: "pilares", planta, combinaciones: eleccion } : null);
  const filas = d.datos?.filas ?? [];
  // Cualquier pilar elegido (en el 3D o en un alzado), aunque no llegue a la planta activa
  const obj = usePedido(proyecto.cliente, seleccion && !filas.some((f) => f.pilar === seleccion) ? { tipo: "objeto", id: seleccion } : null);
  const id = filas.some((f) => f.pilar === seleccion) || (obj.datos?.id === seleccion && obj.datos.tipo === "pilar") ? seleccion : null;
  const pilar = usePedido(proyecto.cliente, id ? { tipo: "pilar", id, combinaciones: eleccion } : null);
  const pasan = filas.filter((f) => (f.nu?.nu ?? 0) > LIMITE_NU).length;

  const herramientas = (
    <>
      {/* Los modos, siempre en el mismo sitio (UI-51); detrás, lo de cada modo */}
      <BarraModos />
      <Separador />
      <ComboCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} proposito="esfuerzos" />
      <Separador />
      <BarraVistas />
    </>
  );

  const vistaPlanta = (
    <ZonaVistas
      fuentes={{
        planta: (v) => (v.planta ? <PlantaPilares planta={v.planta} eleccion={eleccion} id={id} malla={!!v.malla} /> : null),
        malla: true,
        cabeceraPlanta: (v) => (
          <Chip acento title={v.planta === planta ? d.datos?.combinaciones.descripcion : undefined}>
            Axil de los tramos que llegan
          </Chip>
        ),
        tresD: (v) => <TresDPilares planta={v.planta} magnitud={magnitud} eleccion={eleccion} />,
        cabecera3D: () => (
          <>
            <Desplegable etiqueta="Magnitud de los pilares" valor={magnitud} onCambio={setMagnitud} opciones={MAGNITUDES} />
            <Chip acento>{queCombinaciones(d.datos ? { descripcion: d.datos.combinaciones.descripcion, n: d.datos.combinaciones.nombres.length } : undefined, d.datos?.combinaciones.nombres[0])}</Chip>
          </>
        ),
      }}
    />
  );

  const cuadro = (
    <Seccion titulo={`Cuadro bajo ${planta}`} valor={`${plural(filas.length, "tramo")} · ternas concomitantes`}>
      <TablaTernas
        filas={filas}
        cabecera="Pilar"
        titulo={(f) => (
          <>
            {f.pilar}
            <small>{f.tramo.seccion}</small>
          </>
        )}
        activa={(f) => f.pilar === id}
        onFila={(f) => setSeleccion(f.pilar)}
      />
      <p className="nota">{NOTA_TERNAS}</p>
    </Seccion>
  );

  const propiedades = (
    <>
      <Cabecera icono={IcPilares} tipo={`Pilares · bajo ${planta ?? "—"}`} titulo={id ?? plural(filas.length, "tramo")} mono={!!id} detalle={id ? "Todos sus tramos, abajo." : "Elija un pilar para ver todos sus tramos."} />
      <Seccion titulo={`Tramos bajo ${planta}`} valor={filas.length}>
        <div className="fila">
          <span>ν &gt; {fmt(LIMITE_NU, 2)}</span>
          <span className={`v ${pasan ? "text-state-warn" : ""}`}>{pasan}</span>
        </div>
        <p className="nota">ν = Nd/(Ac·fcd), fcd = fck/1,5, en los tramos de hormigón: el aviso de A3 (orden de magnitud). La comprobación de norma es la del módulo de pilares de Concreta. El cuadro de la planta, abajo.</p>
      </Seccion>
      {id && pilar.datos && (
            <Seccion titulo={`Pilar ${id}`} valor={plural(pilar.datos.filas.length, "tramo")}>
              {!filas.some((f) => f.pilar === id) && <p className="nota">No llega a {planta}: su cuadro completo, aquí.</p>}
              <GraficoAxil filas={pilar.datos.filas} />
              <TablaTernas
                compacta
                filas={pilar.datos.filas}
                cabecera="Tramo"
                titulo={(f) => (
                  <>
                    Tramo bajo {f.planta}
                    <small>
                      {f.tramo.seccion} · {fmt(f.tramo.longitud, 2)} m · {fmt(f.giro, 0)}°
                    </small>
                  </>
                )}
                activa={(f) => f.planta === planta}
              />
              <p className="nota">{NOTA_TERNAS} Ejes de la sección: giro desde +X.</p>
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
        { id: "combinaciones", titulo: TITULO_COMBINACIONES, insignia: d.datos?.combinaciones.nombres.length, contenido: d.datos ? <TablaCombinaciones c={d.datos.combinaciones} /> : <p className="nota">…</p> },
      ]}
    />
  );
}
