/**
 * Resultados · Comprobación (CO6, `docs/fem3d/comprobaciones.md` §4.6 y §8.10): los pilares, las
 * vigas, las losas y su punzonamiento, comprobados con el armado en barras del proyecto.
 *
 * - Abajo, la tabla del tipo elegido: una fila por tramo, vano, losa o unión de pilar y losa, con su
 *   armado, el aprovechamiento, la comprobación que manda y su combinación. Un clic elige la pieza
 *   en las vistas y abre su ficha.
 * - En Propiedades, la ficha: el armado como formulario (se cambia y se vuelve a comprobar al
 *   momento, sin recalcular: el armado no entra en el cálculo), sus datos y todas las filas del
 *   módulo de comprobación.
 * - «Proponer» pone el armado de las tablas (el primero que cumple): en lo que falta, en todo el
 *   tipo, en la pieza de la ficha o en toda la obra. Es un paso de deshacer.
 *
 * Todo número sale de los pedidos `comprobaciones`, `comprobacion` y `armar` de la sesión, que
 * llaman a lo que da la orden de comprobar del agente. El armado va en cada pedido.
 */
import { useEffect, useMemo, useState } from "react";
import type { ArmadoProyecto } from "../../../src/agente/armaduraBase.ts";
import { armadoDeBorrador, borradorArmado, DIAMETROS_BARRA, gruposArmado, ponerArmado, type GrupoArmado } from "../../../src/editor/armadoBarras.ts";
import type { DatosArmar, FichaComprobacion, FilaModulo, ParteComprobada, TipoComprobacion } from "../../../src/visor/comprobaciones.ts";
import { Chip, Disposicion, Segmentado, Separador } from "../armazon/Disposicion.tsx";
import { Situacion } from "../armazon/Situacion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { IcComprobacion } from "../armazon/iconos.tsx";
import { AvisoDesactualizado, Cabecera, Fila, filaElegible, ListaDiagnosticos, Seccion } from "../componentes/comunes.tsx";
import { BarraModos } from "../espacios/BarraModos.tsx";
import { useVisor } from "../contexto.ts";
import { fmt, plural, textoApp } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { Dialogo } from "../editor/Dialogos.tsx";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { FuenteEscena, ZonaVistas } from "../vistas/Zona.tsx";

const TIPOS: { id: TipoComprobacion; nombre: string; title: string }[] = [
  {
    id: "pilares",
    nombre: "Pilares",
    title: "Cada tramo de pilar: flexocompresión esviada, cortante y reglas de armado",
  },
  {
    id: "vigas",
    nombre: "Vigas",
    title: "Cada vano de viga: flexión, cortante, fisuración, flecha y torsión",
  },
  {
    id: "losas",
    nombre: "Losas",
    title: "Cada losa maciza o reticular: flexión, fisuración y cortante por franjas",
  },
  {
    id: "punzonamiento",
    nombre: "Punzonamiento",
    title: "Cada unión de pilar y losa: lo que la losa pasa al pilar",
  },
];
const PARTE: Record<TipoComprobacion, [string, string]> = {
  pilares: ["tramo", "tramos"],
  vigas: ["vano", "vanos"],
  losas: ["losa", "losas"],
  punzonamiento: ["unión", "uniones"],
};
const NOMBRE_TIPO: Record<TipoComprobacion, string> = {
  pilares: "Tramo de pilar",
  vigas: "Vano de viga",
  losas: "Losa",
  punzonamiento: "Punzonamiento",
};

/** Del armado del proyecto, lo que cuenta en las comprobaciones de un tipo (la clave del pedido no cambia con lo demás). */
function armadoDe(tipo: TipoComprobacion, a: ArmadoProyecto | undefined): ArmadoProyecto | undefined {
  if (!a) return undefined;
  const r: ArmadoProyecto =
    tipo === "pilares"
      ? a.pilares
        ? { pilares: a.pilares }
        : {}
      : tipo === "vigas"
        ? a.vigas
          ? { vigas: a.vigas }
          : {}
        : tipo === "losas"
          ? a.forjados
            ? { forjados: a.forjados }
            : {}
          : {
              ...(a.forjados ? { forjados: a.forjados } : {}),
              ...(a.punzonamiento ? { punzonamiento: a.punzonamiento } : {}),
            };
  return Object.keys(r).length ? r : undefined;
}

const aprov = (x: number | null) => (x === null ? "—" : fmt(x, 2));

function estadoDe(p: ParteComprobada): {
  texto: string;
  tono: "ok" | "fail" | "neu" | "warn";
} {
  if (p.origen === "sin-armado") return { texto: "Sin armado", tono: "neu" };
  if (p.cumple) return { texto: "Cumple", tono: "ok" };
  if (!p.fallan && p.pendientes.length) return { texto: "Sin comprobar", tono: "warn" };
  return { texto: "No cumple", tono: "fail" };
}

const lugarDe = (f: FilaModulo) => [f.lugar, f.s !== undefined ? `s = ${fmt(f.s, 2)} m` : undefined, f.comb ? `${f.comb}${f.pesimos ? " ±" : ""}` : undefined].filter(Boolean).join(" · ");

/** El formulario del armado de una parte: el borrador, por grupos. */
function FormArmado({ grupos, borrador, onCambio }: { grupos: readonly GrupoArmado[]; borrador: Readonly<Record<string, string>>; onCambio: (ruta: string, v: string) => void }) {
  return (
    <div className="px-3.5 pb-1" data-form-armado>
      {grupos.map((g) => (
        <div key={g.titulo} className="mt-1.5">
          <div className="text-[11.5px] text-text-secondary">
            {g.titulo}
            {g.opcional && <small className="ml-1 text-text-tertiary">(opcional)</small>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {g.campos.map((c) => {
              const nombre = `${g.titulo}: ${c.etiqueta}`;
              return (
                <label key={c.ruta} className="flex items-center gap-1 text-[11.5px] text-text-secondary">
                  {c.etiqueta}
                  {c.clase === "diametro" ? (
                    <select className="sel" style={{ height: 24, width: 62 }} aria-label={nombre} value={borrador[c.ruta] ?? ""} onChange={(e) => onCambio(c.ruta, e.target.value)}>
                      <option value="">—</option>
                      {DIAMETROS_BARRA.map((d) => (
                        <option key={d} value={String(d)}>
                          {d}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="sel text-right" style={{ height: 24, width: c.clase === "mm" ? 62 : 48 }} inputMode="decimal" aria-label={nombre} value={borrador[c.ruta] ?? ""} onChange={(e) => onCambio(c.ruta, e.target.value)} />
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** La ficha de una parte: su armado (se edita), sus datos y las filas del módulo. */
function Ficha({ tipo, ficha, cargando, proponer, ocupado }: { tipo: TipoComprobacion; ficha: FichaComprobacion; cargando: boolean; proponer: () => void; ocupado: boolean }) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion;
  // Por su contenido: otra respuesta con el mismo armado (el mismo pedido otra vez) no tira lo escrito
  const claveArmado = JSON.stringify(ficha.armado);
  const grupos = useMemo(() => gruposArmado(JSON.parse(claveArmado) as typeof ficha.armado), [claveArmado]); // eslint-disable-line react-hooks/exhaustive-deps -- por su contenido
  const delProyecto = useMemo(() => borradorArmado((JSON.parse(claveArmado) as typeof ficha.armado).armado, grupos), [claveArmado, grupos]); // eslint-disable-line react-hooks/exhaustive-deps -- por su contenido
  const [borrador, setBorrador] = useState(delProyecto);
  const [error, setError] = useState<string | null>(null);
  // Otra parte, u otro armado de ésta (propuesto, deshecho): el borrador vuelve a ser el del proyecto
  useEffect(() => {
    setBorrador(delProyecto);
    setError(null);
  }, [delProyecto]);
  const cambiado = Object.keys(delProyecto).some((k) => (borrador[k] ?? "") !== delProyecto[k]);
  const escribir = (valor: object | null, etiqueta: string) => {
    if (!ed) return setError("El proyecto no se puede editar.");
    const r = ed.editar(
      {
        op: "armado",
        armado: ponerArmado(ed.proyecto.armado, tipo, ficha, valor),
      },
      etiqueta,
    );
    setError(r.ok ? null : r.errores.map((e) => textoApp(e.mensaje)).join(" "));
  };
  const aplicar = () => {
    const r = armadoDeBorrador(ficha.armado.armado, grupos, borrador);
    if (!r.ok) return setError(r.error);
    escribir(r.armado, `Armado de ${ficha.clave}`);
  };
  const e = estadoDe(ficha);
  // Las que no cumplen, primero; después, por aprovechamiento; al final, los datos
  const peso = (x: FilaModulo) => (x.informativa ? -1 : x.estado === "fail" ? 1e9 : 0) + (x.aprovechamiento ?? 0);
  const filas = [...ficha.filas].sort((a, b) => peso(b) - peso(a));
  return (
    <>
      <Cabecera icono={IcComprobacion} tipo={NOMBRE_TIPO[tipo]} titulo={`${ficha.pieza} · ${ficha.parte}`} mono detalle={ficha.seccion ? `Sección ${ficha.seccion}` : undefined}>
        <span className={`pill ${e.tono}`} data-estado-ficha>
          {e.texto}
        </span>
      </Cabecera>
      <Seccion titulo="Armado" valor={ficha.origen === "sin-armado" && tipo !== "punzonamiento" ? "sin armado" : ficha.origen === "sin-armadura" ? "sin armadura de punzonamiento" : undefined}>
        {ficha.texto && (
          <p className="nota mono" style={{ color: "var(--color-text-primary)" }}>
            {ficha.texto}
          </p>
        )}
        {tipo === "punzonamiento" && ficha.origen === "sin-armado" ? (
          <p className="nota">La losa no tiene armado: el punzonamiento depende de su armadura de flexión. Ármela en Losas.</p>
        ) : (
          <>
            <FormArmado grupos={grupos} borrador={borrador} onCambio={(ruta, v) => setBorrador((b) => ({ ...b, [ruta]: v }))} />
            {tipo === "losas" && ficha.armado.tipo === "losas" && (ficha.armado.armado?.refuerzos?.length || ficha.armado.armado?.cercos?.length) ? (
              <p className="nota">
                Además, {plural(ficha.armado.armado.refuerzos?.length ?? 0, "refuerzo")}
                {ficha.armado.armado.cercos?.length ? ` y ${plural(ficha.armado.armado.cercos.length, "zona", "zonas")} de cercos de nervio` : ""}, que se proponen y aquí se conservan.
              </p>
            ) : null}
            {error && <p className="nota text-state-fail">{error}</p>}
            <div className="flex flex-wrap gap-1.5 px-3.5 pb-2 pt-1">
              <button type="button" className="btn btn-p" style={{ height: 26 }} disabled={!cambiado || !ed} onClick={aplicar}>
                Aplicar
              </button>
              <button type="button" className="btn" style={{ height: 26 }} disabled={ocupado || !ed} onClick={proponer} title="El primer armado de las tablas con el que todo cumple">
                Proponer
              </button>
              <button type="button" className="btn" style={{ height: 26 }} disabled={!ficha.armado.armado || !ed} onClick={() => escribir(null, `Quitar el armado de ${ficha.clave}`)}>
                Quitar
              </button>
            </div>
          </>
        )}
      </Seccion>
      {ficha.pendientes.length > 0 && (
        <Seccion titulo="Sin comprobar" valor={ficha.pendientes.length}>
          {ficha.pendientes.map((x) => (
            <p key={x} className="nota text-state-warn">
              {textoApp(x)}
            </p>
          ))}
        </Seccion>
      )}
      {ficha.datos.length > 0 && (
        <Seccion titulo="Datos">
          {ficha.datos.map((d) => (
            <Fila key={d.nombre} k={d.nombre} v={typeof d.valor === "number" ? `${fmt(d.valor, Number.isInteger(d.valor) ? 0 : 2)}${d.unidad ? ` ${d.unidad}` : ""}` : d.valor} />
          ))}
        </Seccion>
      )}
      <Seccion titulo="Comprobaciones" valor={cargando ? "…" : ficha.fallan ? `${ficha.fallan} no cumplen` : `${ficha.filas.length}`}>
        <table className="tb" data-filas-modulo>
          <thead>
            <tr>
              <th>Comprobación</th>
              <th>Aprov.</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.id}>
                <td className="txt et">
                  {textoApp(f.descripcion)}
                  <small>{[f.articulo, lugarDe(f)].filter(Boolean).join(" · ")}</small>
                </td>
                <td className={f.estado === "fail" ? "f" : f.estado === "warn" ? "w" : undefined}>{f.informativa ? "dato" : f.aprovechamiento === null ? (f.estado === "fail" ? "no" : "sí") : aprov(f.aprovechamiento)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>
    </>
  );
}

export function ModoComprobacion() {
  const { proyecto, setElegidos, elegidos, setPlanta } = useVisor();
  const pan = usePaneles("resultados:comprobacion", {
    props: true,
    dock: true,
    pestana: "tabla",
  });
  const [tipo, setTipo] = useState<TipoComprobacion>("pilares");
  const [clave, setClave] = useState<string | null>(null);
  const [peores, setPeores] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [propuesta, setPropuesta] = useState<{
    datos: DatosArmar | null;
    error: string | null;
  } | null>(null);
  /** CO6-b: «Todo» con partes que ya tienen armado espera a que se confirme. */
  const [sustituir, setSustituir] = useState<number | null>(null);
  const ed = proyecto.edicion;
  const entero = ed?.proyecto.armado;
  const armado = useMemo(() => armadoDe(tipo, entero), [tipo, entero?.pilares, entero?.vigas, entero?.forjados, entero?.punzonamiento]); // eslint-disable-line react-hooks/exhaustive-deps -- sólo los bloques del tipo
  const activo = !proyecto.desactualizado;
  const r = usePedido(proyecto.cliente, activo ? { tipo: "comprobaciones", de: tipo, ...(armado ? { armado } : {}) } : null);
  const d = r.datos && r.datos.tipo === tipo ? r.datos : null;
  const elegida = d?.partes.find((p) => p.clave === clave) ?? null;
  const f = usePedido(
    proyecto.cliente,
    activo && elegida
      ? {
          tipo: "comprobacion",
          de: tipo,
          clave: elegida.clave,
          ...(armado ? { armado } : {}),
        }
      : null,
  );
  const ficha = f.datos && elegida && f.datos.clave === elegida.clave ? f.datos : null;

  // Lo elegido en las vistas: la primera parte de esa pieza que no cumple (o la primera)
  const ultimo = elegidos[elegidos.length - 1];
  useEffect(() => {
    if (!d || !ultimo || elegida?.pieza === ultimo) return;
    const suyas = d.partes.filter((p) => p.pieza === ultimo);
    if (suyas.length) setClave((suyas.find((p) => !p.cumple) ?? suyas[0]!).clave);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cambiar lo elegido o la tabla
  }, [ultimo, d]);

  const elegir = (p: ParteComprobada) => {
    setClave(p.clave);
    setElegidos([p.pieza]);
    // La planta de las vistas, la de la parte (la cabeza del tramo, la losa)
    if (p.planta) setPlanta(p.planta);
  };

  /** Pide el armado de las tablas y lo escribe en el proyecto (un paso de deshacer). */
  const proponer = async (tipos: readonly TipoComprobacion[], o: { soloSinArmado?: boolean; ids?: string[] }, etiqueta: string) => {
    if (!proyecto.cliente || !ed || ocupado) return;
    setOcupado(true);
    setPropuesta(null);
    try {
      const x = await proyecto.cliente.pedir({
        tipo: "armar",
        tipos,
        ...(entero ? { armado: entero } : {}),
        ...o,
      });
      if (!x.ok)
        return setPropuesta({
          datos: null,
          error: x.diagnosticos.map((y) => textoApp(y.mensaje)).join(" "),
        });
      const datos = x.valor as DatosArmar;
      const ap = ed.editar({ op: "armado", armado: datos.armado }, etiqueta);
      setPropuesta(
        ap.ok
          ? { datos, error: null }
          : {
              datos: null,
              error: ap.errores.map((y) => textoApp(y.mensaje)).join(" "),
            },
      );
    } catch {
      // El proyecto cambió mientras se proponía: lo propuesto era de la versión anterior
      setPropuesta({
        datos: null,
        error: "El proyecto cambió mientras se proponía el armado: vuelva a pedirlo.",
      });
    } finally {
      setOcupado(false);
    }
  };

  const [uno, varios] = PARTE[tipo];
  const nombreTipo = TIPOS.find((t) => t.id === tipo)!.nombre.toLowerCase();
  const proponerFalta = () => void proponer([tipo], { soloSinArmado: true }, tipo === "punzonamiento" ? "Armado propuesto: punzonamiento sin armadura escrita" : `Armado propuesto: ${varios} sin armado`);
  const proponerTodo = () => void proponer([tipo], {}, `Armado propuesto: ${nombreTipo}`);
  /** CO6-b: «Todo» pregunta antes de sustituir el armado que ya tengan (escrito a mano o propuesto antes). */
  const pedirTodo = () => {
    const ya = d?.partes.filter((p) => p.origen === "proyecto").length ?? 0;
    if (ya) setSustituir(ya);
    else proponerTodo();
  };
  const partes = useMemo(() => {
    if (!d) return [];
    if (!peores) return d.partes;
    const peso = (p: ParteComprobada) => (p.cumple ? 0 : 1e9) + (p.aprovechamiento ?? 1e6);
    return [...d.partes].sort((a, b) => peso(b) - peso(a));
  }, [d, peores]);

  const herramientas = (
    <>
      <BarraModos />
      <Separador />
      <Segmentado
        etiqueta="Qué se comprueba"
        opciones={TIPOS}
        valor={tipo}
        onCambio={(t) => {
          setTipo(t);
          setClave(null);
          setPropuesta(null);
        }}
      />
      <Separador />
      <div role="group" aria-label="Proponer armado" className="flex items-center gap-1.5">
        <span className="text-[11.5px] text-text-secondary">Proponer armado</span>
        <span className="flex items-center gap-1.5">
          <button type="button" className="btn" style={{ height: 28 }} disabled={!ed || ocupado || !activo} onClick={proponerFalta} title={tipo === "punzonamiento" ? "La armadura de punzonamiento que haga falta en las uniones que no tienen una escrita" : `El armado de las tablas en los ${varios} que no tienen`}>
            Lo que falta
          </button>
          <button type="button" className="btn" style={{ height: 28 }} disabled={!ed || ocupado || !activo} onClick={pedirTodo} title={`El armado de las tablas en todos los ${varios}: sustituye al que tengan (lo pregunta antes)`}>
            Todo
          </button>
          <button
            type="button"
            className="btn"
            style={{ height: 28 }}
            disabled={!ed || ocupado || !activo}
            onClick={() => void proponer(["pilares", "vigas", "losas", "punzonamiento"], { soloSinArmado: true }, "Armado propuesto: lo que falta en la obra")}
            title="Pilares, vigas, losas y punzonamiento: el armado de las tablas en lo que no lo tiene; lo que ya tiene armado, también la armadura de punzonamiento escrita, se queda"
          >
            Toda la obra
          </button>
          {ocupado && <span className="text-[12px] text-text-secondary">Proponiendo…</span>}
        </span>
      </div>
      <Separador />
      <BarraVistas />
    </>
  );

  const resumenPropuesta = propuesta && (
    <div className="nota" data-propuesta>
      {propuesta.error ? (
        <span className="text-state-fail">{propuesta.error}</span>
      ) : (
        <>
          {(Object.entries(propuesta.datos!.resumen) as [TipoComprobacion, NonNullable<DatosArmar["resumen"][TipoComprobacion]>][]).map(([t, x]) => {
            const conservadas = x.conservadas ?? 0;
            const noNecesitan = x.partes - x.propuestas - x.sinPropuesta - conservadas;
            return (
              <span key={t} className="mr-3">
                {TIPOS.find((y) => y.id === t)!.nombre}: {t === "punzonamiento" ? `${x.propuestas} de ${x.partes} con armadura propuesta${noNecesitan ? `, ${noNecesitan} no la necesitan` : ""}` : `${x.propuestas} de ${x.partes} con propuesta`}
                {x.sinPropuesta ? `, ${x.sinPropuesta} sin ella` : ""}
                {conservadas ? `, ${conservadas} con ${t === "punzonamiento" ? "la suya" : "el suyo"}` : ""}.
              </span>
            );
          })}
          {propuesta.datos!.sinPropuesta.length > 0 && (
            <span className="text-state-warn">
              Sin propuesta (hay que cambiar la sección o el material):{" "}
              {propuesta
                .datos!.sinPropuesta.slice(0, 8)
                .map((x) => `${x.clave} (${textoApp(x.motivo)})`)
                .join("; ")}
              {propuesta.datos!.sinPropuesta.length > 8 ? `; y ${propuesta.datos!.sinPropuesta.length - 8} más` : ""}.
            </span>
          )}{" "}
          Se deshace con Ctrl+Z.
        </>
      )}
    </div>
  );

  const tabla = !activo ? (
    <div className="p-3">
      <AvisoDesactualizado que="estas comprobaciones" />
    </div>
  ) : r.diagnosticos ? (
    <p className="nota text-state-fail">{r.diagnosticos.map((x) => textoApp(x.mensaje)).join(" ")}</p>
  ) : !d ? (
    <p className="nota">Comprobando…</p>
  ) : (
    <Seccion
      titulo={TIPOS.find((t) => t.id === tipo)!.nombre}
      valor={
        <span data-resumen-comprobacion>
          {d.resumen.cumplen} de {plural(d.resumen.partes, uno, varios)} cumplen
          {d.resumen.sinArmado ? ` · ${d.resumen.sinArmado} sin armado` : ""}
          {r.cargando ? " · comprobando…" : ""}
        </span>
      }
    >
      {resumenPropuesta}
      {d.partes.length === 0 ? (
        <p className="nota">{tipo === "punzonamiento" ? "Ninguna losa pasa carga a un pilar por su huella (los pilares van dentro del ancho de sus vigas, o no hay losas)." : `No hay ${varios} que comprobar.`}</p>
      ) : (
        <>
          <table className="tb" data-tabla-comprobacion>
            <thead>
              <tr>
                <th>{tipo === "vigas" ? "Viga" : tipo === "losas" ? "Losa" : "Pilar"}</th>
                <th>{tipo === "losas" ? "Tipo" : tipo === "punzonamiento" ? "Planta · losa" : tipo === "vigas" ? "Vano" : "Tramo"}</th>
                {tipo !== "punzonamiento" && <th>{tipo === "losas" ? "Planta" : "Sección"}</th>}
                <th>Armado</th>
                <th>Aprov.</th>
                <th>Manda</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {partes.map((p) => {
                const e = estadoDe(p);
                return (
                  <tr key={p.clave} data-on={p.clave === clave} style={{ cursor: "pointer" }} {...filaElegible(() => elegir(p), p.clave === clave)}>
                    <td>{p.pieza}</td>
                    <td>{p.parte}</td>
                    {tipo !== "punzonamiento" && <td>{(tipo === "losas" ? p.planta : p.seccion) ?? "—"}</td>}
                    <td className="txt">{p.texto ?? "—"}</td>
                    <td className={e.tono === "fail" ? "f" : undefined}>{aprov(p.aprovechamiento)}</td>
                    <td className="txt">
                      {p.manda ? textoApp(p.manda.descripcion) : p.pendientes[0] ? textoApp(p.pendientes[0]) : "—"}
                      {p.manda && <small>{lugarDe(p.manda)}</small>}
                    </td>
                    <td className={e.tono === "fail" ? "f" : e.tono === "warn" ? "w" : undefined}>{e.texto}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="nota">
            <label className="mr-3 inline-flex items-center gap-1.5">
              <input type="checkbox" checked={peores} onChange={(x) => setPeores(x.target.checked)} /> Los peores, primero
            </label>
            Aprov.: el de la comprobación que manda (la que no cumple, si la hay; si no, la de agotamiento más alta). Con acero B{d.datos.fyk}, recubrimiento de {d.datos.recubrimiento} mm hasta el cerco, φef = {fmt(d.datos.phiEf, 1)}, exposición {d.datos.exposicion} y flecha activa L/{d.datos.flechaActiva}: los datos de la obra. El armado no entra en el cálculo: cambiarlo no recalcula.
          </p>
        </>
      )}
    </Seccion>
  );

  const avisos = d && d.diagnosticos.length > 0 ? <ListaDiagnosticos ds={d.diagnosticos} onObjeto={(id) => setElegidos([id])} /> : <p className="nota">Sin avisos.</p>;

  const propiedades =
    elegida && ficha ? (
      <Ficha key={`${tipo}/${ficha.clave}`} tipo={tipo} ficha={ficha} cargando={f.cargando} ocupado={ocupado} proponer={() => void proponer(tipo === "punzonamiento" ? ["punzonamiento"] : [tipo], { ids: [ficha.pieza] }, `Armado propuesto: ${ficha.pieza}`)} />
    ) : (
      <>
        <Cabecera icono={IcComprobacion} tipo="Comprobación" titulo={TIPOS.find((t) => t.id === tipo)!.nombre} detalle={TIPOS.find((t) => t.id === tipo)!.title} />
        {d && (
          <Seccion titulo="Resumen">
            <Fila k={`${varios[0]!.toUpperCase()}${varios.slice(1)}`} v={d.resumen.partes} />
            <Fila k="Cumplen" v={d.resumen.cumplen} />
            <Fila k="No cumplen" v={d.resumen.noCumplen - d.resumen.sinArmado} clase={d.resumen.noCumplen - d.resumen.sinArmado ? "text-state-fail" : ""} />
            <Fila k="Sin armado" v={d.resumen.sinArmado} />
          </Seccion>
        )}
        <p className="nota">
          {elegida ? "Comprobando…" : `Elija un ${uno === "unión" ? "pilar" : uno} en la tabla o en una vista para ver su armado y todas sus comprobaciones.`} Un {uno === "unión" ? "pilar" : uno} sin armado no se da por comprobado: «Proponer armado» pone el primero de las tablas con el que todo cumple, y después se cambia a mano.
        </p>
      </>
    );

  const dialogoSustituir = sustituir !== null && (
    <Dialogo
      titulo="Sustituir el armado"
      onCerrar={() => setSustituir(null)}
      pie={
        <>
          <button type="button" className="btn" onClick={() => setSustituir(null)}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setSustituir(null);
              proponerFalta();
            }}
          >
            Sólo lo que falta
          </button>
          <button
            type="button"
            className="btn btn-peligro"
            autoFocus
            onClick={() => {
              setSustituir(null);
              proponerTodo();
            }}
          >
            Sustituir
          </button>
        </>
      }
    >
      <p data-sustituir>
        {sustituir} de {plural(d?.partes.length ?? 0, uno, varios)} ya {sustituir === 1 ? "tiene" : "tienen"} {tipo === "punzonamiento" ? "armadura de punzonamiento" : "armado"} en el proyecto, escrito a mano o propuesto antes. «Todo» {sustituir === 1 ? "lo" : "los"} sustituye por el de las tablas
        {tipo === "punzonamiento" ? " y quita la armadura que ya no haga falta" : ""}. Se deshace con Ctrl+Z.
      </p>
    </Dialogo>
  );

  return (
    <>
      {dialogoSustituir}
      <Disposicion
        paneles={pan}
        etiquetaHerramientas="Herramientas de Resultados"
        herramientas={herramientas}
        vista={
          <ZonaVistas
            fuentes={{
              // CO6-d: la planta, con cada parte del color de su aprovechamiento (la escena del worker)
              planta: (v) => (v.planta ? <FuenteEscena fuente={{ tipo: "planta", planta: v.planta, vista: { vista: "comprobacion", de: tipo, ...(armado ? { armado } : {}) } }} /> : null),
              cabeceraPlanta: () => <Chip acento>Aprovechamiento · {TIPOS.find((t) => t.id === tipo)!.nombre.toLowerCase()}</Chip>,
            }}
          />
        }
        nav={{ titulo: "Navegador", contenido: <Situacion /> }}
        props={{ titulo: "Propiedades", contenido: propiedades, ancho: 360 }}
        dock={[
          {
            id: "tabla",
            titulo: "Comprobaciones",
            insignia: d ? (d.resumen.noCumplen ? `${d.resumen.noCumplen} ✕` : "✓") : undefined,
            contenido: tabla,
          },
          {
            id: "avisos",
            titulo: "Avisos",
            insignia: d?.diagnosticos.length || undefined,
            contenido: avisos,
          },
        ]}
      />
    </>
  );
}
