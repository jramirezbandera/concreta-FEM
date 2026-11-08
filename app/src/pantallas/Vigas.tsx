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
import { GraficaEnvolvente } from "./GraficaEnvolvente.tsx";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { EsfuerzoPlano } from "../../../src/agente/render/index.ts";
import type { DatosEstacion, Esfuerzo, FilaPilar } from "../../../src/visor/datos.ts";
import type { PiezasDiagrama } from "../../../src/visor/diagramas3d.ts";
import type { Eleccion } from "../../../src/visor/escena.ts";
import type { EleccionCombinaciones, VistaPlanta } from "../../../src/visor/sesion.ts";
import { Chip, Desplegable, Disposicion, Segmentado, Separador } from "../armazon/Disposicion.tsx";
import { Situacion } from "../armazon/Situacion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { IcDiagramas, IcPilar, IcViga } from "../armazon/iconos.tsx";
import { Aviso, Cabecera, ComboCombinaciones, Seccion, TablaCombinaciones, TITULO_COMBINACIONES, AvisoDesactualizado } from "../componentes/comunes.tsx";
import { BarraModos } from "../espacios/BarraModos.tsx";
import { useVisor } from "../contexto.ts";
import { fmt, coma } from "../fmt.ts";
import { sinObsoleto, usePedido } from "../sesion/usePedido.ts";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { queCombinaciones, useSonda } from "../vistas/sonda.ts";
import { conMalla, Fuente2D, Fuente3DModelo, FuenteEscena, planoAlzado, ZonaVistas } from "../vistas/Zona.tsx";
import { COLUMNAS_BARRA, COLUMNAS_VANO, FILAS_BARRA, FILAS_VANO, NOTA_EXTREMOS, TablaExtremos } from "./Extremos.tsx";
import { NOTA_TERNAS, TablaTernas } from "./Ternas.tsx";
import { useEleccion } from "./useEleccion.ts";

/** Los diagramas de las vigas de una planta, en una vista: un clic elige la viga o la vigueta. */
function PlantaDiagramas({ planta, vista, id, cargando }: { planta: string; vista: VistaPlanta; id: string | null; cargando: boolean }) {
  const { proyecto, setSeleccion } = useVisor();
  const fuente = { tipo: "planta" as const, planta, vista };
  const escena = usePedido(proyecto.cliente, { tipo: "escena", planta, vista });
  const resaltado = useEleccion(fuente, id);
  const clic = async (p: Vec2, radio: number) => {
    if (!proyecto.cliente) return;
    // C-12: con el cliente cerrado por una edición, el clic no hace nada (sin rechazo en la consola)
    const r = await sinObsoleto(proyecto.cliente.pedir({ tipo: "elegir", fuente, punto: p, radio }));
    if (!r) return;
    const o = r.ok ? (r.valor as Eleccion | null)?.objeto : null;
    // Sólo las piezas con diagrama: vigas, viguetas y barras
    const m = proyecto.edicion?.proyecto.modelo;
    if (o && ((m?.vigas ?? []).some((v) => v.id === o) || (m?.barras ?? []).some((b) => b.id === o) || o.includes(":v") || !proyecto.edicion)) setSeleccion(o);
  };
  const aviso = proyecto.desactualizado ? <AvisoDesactualizado /> : escena.diagnosticos ? <Aviso tono="fail">{escena.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !escena.datos && escena.cargando ? <Aviso>Preparando los diagramas…</Aviso> : null;
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
  { id: "todas", nombre: "Vigas, barras y pilares" },
  { id: "vigas", nombre: "Vigas y barras" },
  { id: "pilares", nombre: "Pilares" },
];
const ESCALAS = ["0.25", "0.5", "1", "2", "4"] as const;
type Escala = (typeof ESCALAS)[number];

/** Los diagramas en un 3D (I4): los de la planta de su cabecera, o los de todas. */
function TresDDiagramas({ planta, esfuerzo, eleccion, piezas, escala }: { planta: string | null; esfuerzo: Esfuerzo; eleccion: EleccionCombinaciones; piezas: PiezasDiagrama; escala: number }) {
  const { proyecto } = useVisor();
  const d = usePedido(proyecto.cliente, proyecto.desactualizado ? null : { tipo: "diagramas3d", esfuerzo, combinaciones: eleccion, planta, piezas, escala });
  const aviso = proyecto.desactualizado ? <AvisoDesactualizado /> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>Preparando los diagramas…</Aviso> : null;
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
              {x.max.etiqueta !== x.max.comb ? ` · ${coma(x.max.etiqueta)}` : ""}
            </small>
          </td>
        </tr>
        <tr>
          <td>{t} mín.</td>
          <td>
            {fmt(x.min.v, 2)}
            <small>
              {x.min.comb}
              {x.min.etiqueta !== x.min.comb ? ` · ${coma(x.min.etiqueta)}` : ""}
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
        {iguales ? lado("", d.derecha) : (
          <>
            {lado("Izq.", d.izquierda)}
            {lado("Der.", d.derecha)}
          </>
        )}
      </tbody>
    </table>
  );
}

/** El cuadro de un pilar por tramos (el de la pantalla Pilares): N, |My| y |Mz| en la base y la cabeza, con su combinación. */
function CuadroPilar({ filas }: { filas: FilaPilar[] | null }) {
  if (!filas) return <p className="nota">…</p>;
  // Las ternas concomitantes de cada tramo, como en Pilares (UI-10)
  return (
    <Seccion titulo="Tramos" valor="ternas concomitantes">
      <TablaTernas
        compacta
        filas={filas}
        cabecera="Tramo"
        titulo={(f) => (
          <>
            Tramo bajo {f.planta}
            <small>
              {f.tramo.seccion} · {fmt(f.tramo.longitud, 2)} m
            </small>
          </>
        )}
      />
      <p className="nota">{NOTA_TERNAS}</p>
    </Seccion>
  );
}

export function ModoDiagramas() {
  const { proyecto, planta, seleccion, setSeleccion } = useVisor();
  // UI-46: el panel inferior (el alzado de la pieza) se abre al elegir una pieza, no al entrar: en un
  // portátil se comía la mitad de la planta antes de que hubiera nada que enseñar
  const pan = usePaneles("resultados:diagramas", { nav: true, props: true, dock: false, pestana: "alzado", alto: 300 });
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
  const otra = obj.datos?.id === seleccion && ["viga", "vigueta", "pilar", "barra"].includes(obj.datos.tipo) ? seleccion : null;
  const id = lista.some((p) => p.id === seleccion) ? seleccion! : (otra ?? lista.find((p) => p.tipo === "viga")?.id ?? lista[0]?.id ?? null);
  const elegida = lista.some((p) => p.id === seleccion) ? seleccion : otra;
  const { poner: ponerPaneles } = pan;
  const abiertaPor = useRef<string | null>(null);
  useEffect(() => {
    if (!elegida || abiertaPor.current === elegida) return;
    abiertaPor.current = elegida;
    ponerPaneles({ dock: true, pestana: "alzado" });
  }, [elegida, ponerPaneles]);
  const vista = { vista: "vigas", esfuerzo, combinaciones: eleccion } satisfies VistaPlanta;
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
    for (const p of lista) {
      const k = p.pano ?? (p.tipo === "barra" ? "Barras" : "Vigas");
      g.set(k, [...(g.get(k) ?? []), p]);
    }
    return [...g];
  }, [lista]);

  const herramientas = (
    <>
      {/* Los modos, siempre en el mismo sitio (UI-51); detrás, lo de cada modo */}
      <BarraModos />
      <Separador />
      <ComboCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} proposito="esfuerzos" />
      <Separador />
      <Segmentado
        etiqueta="Esfuerzo"
        opciones={ESFUERZOS.map((x) => ({ id: x.id, nombre: x.id, title: x.id === "N" && v?.axilSinValor ? `${x.title}. En ${v.id}, sin valor: está en un diafragma rígido` : x.title }))}
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
        <Seccion key={g} titulo={g === "Vigas" ? `Vigas de ${planta}` : g === "Barras" ? `Barras que llegan a ${planta}` : `Viguetas del paño ${g}`} valor={ps.length}>
          {ps.map((p) => (
            <button key={p.id} type="button" className="lista-fila" data-on={p.id === id} style={{ gridTemplateColumns: "1fr auto auto" }} onClick={() => setSeleccion(p.id)}>
              <span className="mono truncate">{p.id}</span>
              <span className="text-[12px]">{p.seccion ?? ""}</span>
              <span className="mono text-[12px]">{fmt(p.longitud, 2)} m</span>
            </button>
          ))}
        </Seccion>
      ))}
      {!lista.length && !piezas.cargando && <p className="nota">La planta no tiene vigas, viguetas ni barras.</p>}
    </>
  );

  const vistaPlanta = (
    <ZonaVistas
      fuentes={{
        planta: (x) => (x.planta ? <PlantaDiagramas planta={x.planta} vista={conMalla(vista, x)} id={id} cargando={x.planta === planta && viga.cargando} /> : null),
        malla: true,
        cabeceraPlanta: () => (
          <Chip acento title={esfuerzo === "My" || esfuerzo === "Vz" || esfuerzo === "T" || esfuerzo === "N" ? "Abatido sobre la planta, como en el alzado" : "En el plano de la planta, donde está"}>
            Diagramas de {esfuerzo}
          </Chip>
        ),
        tresD: (x) => <TresDDiagramas planta={x.planta} esfuerzo={esfuerzo} eleccion={eleccion} piezas={piezas3D} escala={Number(escala)} />,
        alzado: (x) => <FuenteEscena fuente={x.eje ? { tipo: "alzado", plano: planoAlzado(x.eje, x), diagramas: { esfuerzo: plano, combinaciones: eleccion, escala: Number(escala) } } : null} />,
        cabecera3D: () => (
          <>
            <Chip acento title={v ? coma(v.combinaciones.etiquetas.join("\n")) : undefined}>
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
      <GraficaEnvolvente v={v} s={sValida} onS={setS} estacion={est.datos ?? null} unidad={unidad} abajo={ESFUERZOS.find((x) => x.id === v.esfuerzo)!.abajo} />
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
        {!v && <Cabecera icono={IcDiagramas} tipo="Diagramas" titulo="Ninguna pieza elegida" detalle="Elija una viga, una vigueta, un pilar o una barra en una vista o en el navegador." />}
        {viga.diagnosticos && <p className="nota text-state-fail">{viga.diagnosticos.map((x) => x.mensaje).join(" ")}</p>}
        {v && (
          <>
            <Cabecera
              icono={v.tipo === "pilar" ? IcPilar : IcViga}
              tipo={v.tipo === "vigueta" ? "Vigueta" : v.tipo === "pilar" ? "Pilar" : v.tipo === "barra" ? "Barra" : "Viga"}
              titulo={v.id}
              mono
              detalle={
                <>
                  {v.tipo === "pilar" ? `${fmt(v.longitud, 2)} m · ${(v.plantas ?? []).map((p) => p.planta).join(", ")}` : v.tipo === "barra" ? `${fmt(v.longitud, 2)} m · de ${v.plantas?.[0]?.planta ?? "—"} a ${v.plantas?.[1]?.planta ?? "—"}` : `${fmt(v.longitud, 2)} m · ${v.vanos.length} vano${v.vanos.length === 1 ? "" : "s"} · apoyos ${v.apoyos.map((a) => a.objeto).join(", ") || "—"}`}
                  {v.axilSinValor && <div className="mt-1">Axil sin valor: está en el plano de un diafragma rígido.</div>}
                </>
              }
            />
            <Seccion titulo="En la estación">{est.datos ? <Estacion d={est.datos} unidad={unidad} /> : <p className="nota">…</p>}</Seccion>
            {v.tipo === "pilar" && <CuadroPilar filas={cuadro.datos?.filas ?? null} />}
            {v.tipo === "barra" && v.extremos && (
              <Seccion titulo="Extremos a lo largo de la barra">
                <TablaExtremos grupos={[{ extremos: v.extremos }]} filas={FILAS_BARRA} columnas={COLUMNAS_BARRA} />
                <p className="nota">{NOTA_EXTREMOS}</p>
              </Seccion>
            )}
            {v.tipo !== "pilar" && v.tipo !== "barra" && (
              <Seccion titulo="Vanos de cara a cara">
                <TablaExtremos
                  grupos={v.vanos.map((va, i) => ({
                    titulo: (
                      <>
                        Vano {i + 1}
                        <small>
                          {fmt(va.desde, 2)}–{fmt(va.hasta, 2)} m · {va.apoyos.map((a) => a ?? "libre").join(" – ")}
                          {va.torsionEquilibrio ? " · torsión de equilibrio" : ""}
                        </small>
                      </>
                    ),
                    extremos: va.extremos,
                    onGrupo: () => setS((va.desde + va.hasta) / 2),
                    activo: sValida >= va.desde && sValida <= va.hasta,
                  }))}
                  filas={FILAS_VANO}
                  columnas={COLUMNAS_VANO}
                />
                <p className="nota">Máximos exactos del diagrama combinado dentro de cada vano, de cara a cara de sus apoyos. {NOTA_EXTREMOS}</p>
              </Seccion>
            )}
          </>
        )}
    </>
  );

  return (
    <Disposicion
      paneles={pan}
      etiquetaHerramientas="Herramientas de Resultados"
      herramientas={herramientas}
      nav={{ titulo: "Navegador", contenido: (
        <>
          <Situacion />
          {navegador}
        </>
      ) }}
      vista={vistaPlanta}
      props={{ titulo: "Propiedades", contenido: propiedades, ancho: 400 }}
      dock={[
        { id: "alzado", titulo: v ? `Alzado · ${v.id}` : "Alzado", contenido: alzado },
        { id: "combinaciones", titulo: TITULO_COMBINACIONES, insignia: v?.combinaciones.nombres.length, contenido: v ? <TablaCombinaciones c={v.combinaciones} /> : <p className="nota">…</p> },
      ]}
    />
  );
}
