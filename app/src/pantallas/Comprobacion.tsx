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
 * - En la planta de las losas (§8.12, `dibujo/refuerzos.ts`): el refuerzo o la zona de cercos elegido
 *   se estira por las asas de sus lados y se mueve por la del centro; «Añadir» pone uno nuevo con dos
 *   clics, y Supr quita el elegido. Cada cambio, un paso de deshacer.
 *
 * - Con una viga elegida (§8.13), la pestaña «Pórtico» de abajo dibuja el despiece de su alineación
 *   entera: cada barra con su marca, sus patillas y su largo, los cercos contados y la tabla de
 *   despiece. Sigue a lo que se escribe en la ficha del vano elegido, y un clic en otro vano lo elige.
 *
 * Todo número sale de los pedidos `comprobaciones`, `comprobacion` y `armar` de la sesión, que
 * llaman a lo que da la orden de comprobar del agente. El armado va en cada pedido.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArmadoProyecto } from "../../../src/agente/armaduraBase.ts";
import type { ArmadoForjado, ArmadoVanoViga, CercosForjado, RefuerzoForjado } from "../../../src/comprobaciones/armado.ts";
import { armadoDeBorrador, armadoParcial, borradorArmado, DIAMETROS_BARRA, elementoDeId, gruposArmado, idElemento, ponerArmado, sinElemento, type GrupoArmado } from "../../../src/editor/armadoBarras.ts";
import { conElemento, conZona } from "../../../src/editor/refuerzosPlanta.ts";
import type { CaraDibujada } from "../../../src/visor/armadoPlanta.ts";
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
import { CroquisLosa, CroquisPilar, CroquisPunzonamiento, CroquisViga } from "../editor/CroquisArmado.tsx";
import { DespiecePortico, type EstadoVano } from "../editor/DespiecePortico.tsx";
import { Dialogo } from "../editor/Dialogos.tsx";
import { EditorRefuerzos, type NuevoElemento } from "../dibujo/refuerzos.ts";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { FuenteEscena, repintarVistas, ZonaVistas } from "../vistas/Zona.tsx";

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

/** Lo que dibuja la planta: cada pieza con su armado en barras, o sólo el color de su aprovechamiento. */
type Dibujo = "armado" | "aprovechamiento";
const DIBUJOS: { id: Dibujo; nombre: string; title: string }[] = [
  { id: "armado", nombre: "Armado", title: "La planta con el armado dibujado: los refuerzos y los cercos de las losas, las barras de los pilares, el armado de cada vano y los perímetros de punzonamiento" },
  { id: "aprovechamiento", nombre: "Aprovechamiento", title: "La planta con cada pieza del color de su aprovechamiento, sin el armado" },
];
const CARAS: { id: CaraDibujada; nombre: string; title: string }[] = [
  { id: "todas", nombre: "Todo", title: "Los refuerzos de las dos caras (los inferiores en azul y los superiores en rojo) y los cercos de los nervios" },
  { id: "inferior", nombre: "Inferior", title: "Sólo los refuerzos de la cara inferior" },
  { id: "superior", nombre: "Superior", title: "Sólo los refuerzos de la cara superior" },
  { id: "cercos", nombre: "Cercos", title: "Sólo las zonas de cercos de los nervios" },
];

/** Lo que se puede añadir a una losa en la planta (§8.12): su clave en el desplegable. */
const ANADIR: { id: string; nombre: string; nuevo: NuevoElemento }[] = [
  { id: "x-inf", nombre: "Refuerzo X inferior", nuevo: { lista: "refuerzos", armadura: "x-inf" } },
  { id: "x-sup", nombre: "Refuerzo X superior", nuevo: { lista: "refuerzos", armadura: "x-sup" } },
  { id: "y-inf", nombre: "Refuerzo Y inferior", nuevo: { lista: "refuerzos", armadura: "y-inf" } },
  { id: "y-sup", nombre: "Refuerzo Y superior", nuevo: { lista: "refuerzos", armadura: "y-sup" } },
  { id: "cercos-x", nombre: "Cercos de nervios X", nuevo: { lista: "cercos", direccion: "x" } },
  { id: "cercos-y", nombre: "Cercos de nervios Y", nuevo: { lista: "cercos", direccion: "y" } },
];
const enFoco = () => {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement || (a instanceof HTMLElement && a.isContentEditable);
};

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

/** Lo que resalta un grupo en el croquis: la ruta de su objeto en el armado (o la de su primer campo, si van en la raíz). */
const rutaGrupo = (g: GrupoArmado) => g.ruta || g.campos[0]!.ruta;

/** El croquis del armado de una parte: el del borrador (lo que se está escribiendo), a escala. */
function Croquis({ ficha, armado, activo, grande }: { ficha: FichaComprobacion; armado: Record<string, unknown> | undefined; activo: string | null; grande?: boolean }) {
  const g = ficha.geometria;
  const rec = ficha.recubrimiento;
  if (g.tipo === "pilares") return <CroquisPilar seccion={g.seccion} armado={armado} recubrimiento={rec} activo={activo} {...(grande ? { grande } : {})} />;
  if (g.tipo === "vigas") return <CroquisViga g={g} armado={armado} recubrimiento={rec} activo={activo} {...(grande ? { grande } : {})} />;
  if (g.tipo === "losas") return <CroquisLosa g={g} armado={armado} recubrimiento={rec} activo={activo} />;
  return <CroquisPunzonamiento g={g} armado={armado} activo={activo} />;
}

type Elemento = NonNullable<GrupoArmado["elemento"]>;

/** Los campos de un grupo del armado. */
function CamposGrupo({ g, borrador, onCambio }: { g: GrupoArmado; borrador: Readonly<Record<string, string>>; onCambio: (ruta: string, v: string) => void }) {
  return (
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
  );
}

/**
 * El formulario del armado de una parte: el borrador, por grupos. Los refuerzos y las zonas de cercos
 * de una losa van aparte, uno por fila: un clic en su nombre lo elige en la planta, y la «×» lo quita.
 */
function FormArmado({
  grupos,
  borrador,
  onCambio,
  onActivo,
  elegido = null,
  onElemento,
  onQuitar,
}: {
  grupos: readonly GrupoArmado[];
  borrador: Readonly<Record<string, string>>;
  onCambio: (ruta: string, v: string) => void;
  onActivo: (grupo: string | null) => void;
  elegido?: Elemento | null;
  onElemento?: (e: Elemento) => void;
  onQuitar?: (e: Elemento) => void;
}) {
  const fijos = grupos.filter((g) => !g.elemento);
  const listas = (["refuerzos", "cercos"] as const).map((lista) => ({ lista, grupos: grupos.filter((g) => g.elemento?.lista === lista) })).filter((x) => x.grupos.length);
  const elegidoRef = useRef<HTMLDivElement>(null);
  // El elegido en la planta, a la vista
  useEffect(() => {
    elegidoRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [elegido?.lista, elegido?.indice]);
  return (
    <div className="px-3.5 pb-1" data-form-armado onMouseLeave={() => onActivo(null)} onBlur={() => onActivo(null)}>
      {fijos.map((g) => (
        <div key={g.titulo} className="mt-1.5" onMouseEnter={() => onActivo(rutaGrupo(g))} onFocus={() => onActivo(rutaGrupo(g))}>
          <div className="text-[11.5px] text-text-secondary">
            {g.titulo}
            {g.opcional && <small className="ml-1 text-text-tertiary">(opcional)</small>}
          </div>
          <CamposGrupo g={g} borrador={borrador} onCambio={onCambio} />
        </div>
      ))}
      {listas.map(({ lista, grupos: gs }) => (
        <div key={lista} className="mt-3" data-lista-armado={lista}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
            {lista === "refuerzos" ? "Refuerzos" : "Cercos de los nervios"} · {gs.length}
          </div>
          {gs.map((g) => {
            const e = g.elemento!;
            const on = elegido?.lista === e.lista && elegido.indice === e.indice;
            return (
              <div key={g.ruta} ref={on ? elegidoRef : undefined} className="elemento-armado" data-on={on || undefined} data-cara={lista === "refuerzos" ? (/inferior/.test(g.titulo) ? "inferior" : "superior") : "cercos"}>
                <div className="flex items-baseline gap-1.5">
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-[11.5px] text-text-primary" title={`${g.titulo}: elegirlo en la planta`} onClick={() => onElemento?.(e)}>
                    {g.titulo}
                  </button>
                  <small className="shrink-0 text-text-tertiary" title="Largo de las barras × ancho que cubren">{g.nota}</small>
                  <button type="button" className="shrink-0 px-1 text-text-tertiary hover:text-state-fail" aria-label={`Quitar: ${g.titulo}`} title="Quitarlo del armado" onClick={() => onQuitar?.(e)}>
                    ×
                  </button>
                </div>
                <CamposGrupo g={g} borrador={borrador} onCambio={onCambio} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** La ficha de una parte: su armado (se edita), sus datos y las filas del módulo. */
function Ficha({
  tipo,
  ficha,
  cargando,
  proponer,
  ocupado,
  elegido,
  onElemento,
  alQuitar,
  alDibujar,
  alActivar,
  verPortico,
}: {
  tipo: TipoComprobacion;
  ficha: FichaComprobacion;
  cargando: boolean;
  proponer: () => void;
  ocupado: boolean;
  elegido: Elemento | null;
  onElemento: (e: Elemento) => void;
  alQuitar: () => void;
  /** Lo que se está escribiendo (el armado a medias) y el campo con el foco: los sigue el despiece del pórtico. */
  alDibujar?: (clave: string, armado: Record<string, unknown> | undefined) => void;
  alActivar?: (ruta: string | null) => void;
  verPortico?: () => void;
}) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion;
  // Por su contenido: otra respuesta con el mismo armado (el mismo pedido otra vez) no tira lo escrito
  const claveArmado = JSON.stringify(ficha.armado);
  const grupos = useMemo(() => gruposArmado(JSON.parse(claveArmado) as typeof ficha.armado), [claveArmado]); // eslint-disable-line react-hooks/exhaustive-deps -- por su contenido
  const delProyecto = useMemo(() => borradorArmado((JSON.parse(claveArmado) as typeof ficha.armado).armado, grupos), [claveArmado, grupos]); // eslint-disable-line react-hooks/exhaustive-deps -- por su contenido
  const [borrador, setBorrador] = useState(delProyecto);
  const [error, setError] = useState<string | null>(null);
  const [activo, ponerActivo] = useState<string | null>(null);
  const setActivo = (r: string | null) => {
    ponerActivo(r);
    alActivar?.(r);
  };
  const [ampliado, setAmpliado] = useState(false);
  // Lo que se dibuja: lo escrito, aunque esté a medias (sin nada escrito ni en el proyecto, nada)
  const dibujado = useMemo(() => (Object.values(borrador).some((v) => v.trim() !== "") || ficha.armado.armado ? armadoParcial(ficha.armado.armado, grupos, borrador) : undefined), [borrador, grupos, claveArmado]); // eslint-disable-line react-hooks/exhaustive-deps -- el armado, por su contenido
  // Otra parte, u otro armado de ésta (propuesto, deshecho): el borrador vuelve a ser el del proyecto
  useEffect(() => {
    setBorrador(delProyecto);
    setError(null);
  }, [delProyecto]);
  useEffect(() => {
    alDibujar?.(ficha.clave, dibujado);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cambiar lo dibujado
  }, [dibujado, ficha.clave]);
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
  const quitarElemento = (x: Elemento) => {
    if (ficha.armado.tipo !== "losas" || !ficha.armado.armado) return;
    escribir(sinElemento(ficha.armado.armado, x), `Quitar ${x.lista === "refuerzos" ? "el refuerzo" : "los cercos"} ${x.indice + 1} de ${ficha.clave}`);
    // Los de detrás cambian de número: lo elegido deja de ser uno de ellos
    alQuitar();
  };
  const cambiar = (ruta: string, v: string) => setBorrador((b) => ({ ...b, [ruta]: v }));
  const botones = (
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
  );
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
            <Croquis ficha={ficha} armado={dibujado} activo={activo} />
            {(tipo === "pilares" || tipo === "vigas") && (
              <div className="-mt-1 flex justify-end gap-3 px-3.5">
                {tipo === "vigas" && verPortico && (
                  <button type="button" className="enlace-armado" onClick={verPortico} title="El despiece de la alineación entera, abajo: cada barra con su largo y sus patillas, los cercos contados y el acero">
                    Ver el pórtico
                  </button>
                )}
                <button type="button" className="enlace-armado" onClick={() => setAmpliado(true)} title="El armado en grande, con su formulario al lado">
                  Ampliar el dibujo
                </button>
              </div>
            )}
            <FormArmado grupos={grupos} borrador={borrador} onCambio={cambiar} onActivo={setActivo} elegido={elegido} onElemento={onElemento} onQuitar={quitarElemento} />
            {tipo === "losas" && ficha.armado.tipo === "losas" && (ficha.armado.armado?.refuerzos?.length || ficha.armado.armado?.cercos?.length) ? <p className="nota">Cada refuerzo y cada zona de cercos se elige también en la planta. Elegido, se estira por las asas de sus lados y se mueve por la del centro (a 5 cm), y Supr lo quita; «Añadir», en la barra, pone uno nuevo con dos clics. Aquí se cambian sus barras.</p> : null}
            {error && <p className="nota text-state-fail">{error}</p>}
            {botones}
          </>
        )}
      </Seccion>
      {ampliado && (
        <Dialogo
          titulo={`Armado de ${ficha.pieza} · ${ficha.parte}`}
          clase="dialogo-armado"
          onCerrar={() => setAmpliado(false)}
          pie={
            <button type="button" className="btn" onClick={() => setAmpliado(false)}>
              Cerrar
            </button>
          }
        >
          <div className="editor-armado" data-editor-armado>
            <div className="min-w-0">
              <Croquis ficha={ficha} armado={dibujado} activo={activo} grande />
            </div>
            <div>
              <p className="nota mono" style={{ color: "var(--color-text-primary)" }}>
                {ficha.texto ?? "Sin armado"} ·{" "}
                <span className={`pill ${e.tono}`}>
                  {e.texto}
                  {ficha.aprovechamiento !== null ? ` · ${aprov(ficha.aprovechamiento)}` : ""}
                </span>
              </p>
              <FormArmado grupos={grupos} borrador={borrador} onCambio={cambiar} onActivo={setActivo} />
              {error && <p className="nota text-state-fail">{error}</p>}
              {botones}
              <p className="nota">
                El dibujo sigue a lo que se escribe; «Aplicar» lo guarda en el proyecto y vuelve a comprobar la pieza.{ficha.manda ? ` Manda: ${textoApp(ficha.manda.descripcion)}.` : ""}
              </p>
            </div>
          </div>
        </Dialogo>
      )}
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
            {filas.map((f, i) => (
              <tr key={`${f.id}#${i}`}>
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
  const [dibujo, setDibujo] = useState<Dibujo>("armado");
  const [cara, setCara] = useState<CaraDibujada>("todas");
  const [anadir, setAnadir] = useState<string>("");
  const [anadirEn, setAnadirEn] = useState<"nervios" | "abacos">("nervios");
  const [avisoPlanta, setAvisoPlanta] = useState<string | null>(null);
  const editor = useRef<EditorRefuerzos | null>(null);
  editor.current ??= new EditorRefuerzos();
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

  // §8.13: el pórtico de la viga elegida, para su despiece. No depende del armado: se pide una vez por viga
  const pp = usePedido(proyecto.cliente, activo && tipo === "vigas" && elegida ? { tipo: "portico", viga: elegida.pieza } : null);
  const portico = tipo === "vigas" && elegida && pp.datos?.portico.vigas.some((v) => v.id === elegida.pieza) ? pp.datos : null;
  const [escrito, setEscrito] = useState<{ clave: string; armado: Record<string, unknown> | undefined } | null>(null);
  const [activoFicha, setActivoFicha] = useState<string | null>(null);
  const vigasArmadas = entero?.vigas;
  const armadosPortico = useMemo(() => {
    const r: Record<string, Partial<ArmadoVanoViga> | null | undefined> = {};
    for (const v of portico?.portico.vanos ?? []) r[v.clave] = escrito && escrito.clave === v.clave && v.clave === clave ? (escrito.armado as Partial<ArmadoVanoViga> | undefined) : vigasArmadas?.[v.viga]?.[v.vano];
    return r;
  }, [portico, vigasArmadas, escrito, clave]);

  // Lo elegido en las vistas: la primera parte de esa pieza que no cumple (o la primera). Un refuerzo
  // o una zona de cercos de una losa («L1/R3»), su losa
  const elegidoVista = elegidos[elegidos.length - 1];
  const elemento = tipo === "losas" && elegidoVista ? elementoDeId(elegidoVista) : null;
  const ultimo = elemento?.losa ?? elegidoVista;
  useEffect(() => {
    if (!d || !ultimo || elegida?.pieza === ultimo) return;
    const suyas = d.partes.filter((p) => p.pieza === ultimo);
    if (suyas.length) setClave((suyas.find((p) => !p.cumple) ?? suyas[0]!).clave);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cambiar lo elegido o la tabla
  }, [ultimo, d]);

  // §8.12: los refuerzos y los cercos de las losas, con el ratón en la planta
  const losasModelo = ed?.proyecto.modelo.losas;
  const hayReticular = !!losasModelo?.some((l) => l.reticular);
  const editable = tipo === "losas" && dibujo === "armado" && !!ed && activo;
  const er = editor.current;
  const escribirLosa = (losa: string, a: ArmadoForjado, etiqueta: string): boolean => {
    if (!ed) return false;
    const x = ed.editar({ op: "armado", armado: { ...entero, forjados: { ...entero?.forjados, [losa]: a } } }, etiqueta);
    setAvisoPlanta(x.ok ? null : x.errores.map((y) => textoApp(y.mensaje)).join(" "));
    return x.ok;
  };
  er.losas = useMemo(() => (losasModelo ?? []).map((l) => ({ id: l.id, planta: l.planta, eje1: l.eje1, contorno: l.contorno, armado: entero?.forjados?.[l.id] })), [losasModelo, entero?.forjados]);
  er.elegido = editable && elemento ? { losa: elemento.losa, elemento: { lista: elemento.lista, indice: elemento.indice } } : null;
  er.nuevo = editable ? (ANADIR.find((x) => x.id === anadir)?.nuevo ?? null) : null;
  er.alAvisar = setAvisoPlanta;
  er.alMover = (losa, e, zona) => {
    const a = entero?.forjados?.[losa];
    if (a) escribirLosa(losa, conZona(a, e, zona), `Zona de ${idElemento(losa, e)}`);
  };
  er.alAnadir = (losa, n, zona) => {
    const a = entero?.forjados?.[losa];
    const reticular = !!losasModelo?.find((l) => l.id === losa)?.reticular;
    if (!a) return;
    if (n.lista === "cercos" && !reticular) return setAvisoPlanta(`La losa ${losa} es maciza: los cercos son de los nervios de un reticular.`);
    const en = reticular ? anadirEn : undefined;
    const nuevo: RefuerzoForjado | CercosForjado = n.lista === "cercos" ? { direccion: n.direccion, ...zona, cercos: { diametro: 6, separacion: 150 } } : { armadura: n.armadura, ...zona, barras: en === "nervios" ? { diametro: 12, n: 1 } : { diametro: 12, separacion: 200 }, ...(en ? { en } : {}) };
    const r = conElemento(a, nuevo);
    if (!escribirLosa(losa, r.armado, `Añadir ${idElemento(losa, r.elemento)}`)) return;
    setAnadir("");
    setElegidos([idElemento(losa, r.elemento)]);
  };
  const quitarElegido = () => {
    const a = elemento && entero?.forjados?.[elemento.losa];
    if (!elemento || !a || !a[elemento.lista]?.[elemento.indice]) return;
    if (escribirLosa(elemento.losa, sinElemento(a, elemento), `Quitar ${idElemento(elemento.losa, elemento)}`)) setElegidos([elemento.losa]);
  };
  const quitar = useRef(quitarElegido);
  quitar.current = quitarElegido;
  useEffect(() => {
    if (!editable) return;
    const tecla = (ev: KeyboardEvent) => {
      if (enFoco() || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === "Escape") {
        // Primero lo que está a medias; después, la herramienta de añadir
        if (er.cancelar()) repintarVistas();
        else if (er.nuevo) setAnadir("");
        else return;
        setAvisoPlanta(null);
        ev.stopPropagation();
        ev.preventDefault();
      } else if ((ev.key === "Delete" || ev.key === "Backspace") && er.elegido && !er.ocupado) {
        quitar.current();
        ev.preventDefault();
      }
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [editable, er]);
  // Al cambiar de herramienta o al dejar de poder editar, nada a medias
  useEffect(() => {
    er.cancelar();
    setAvisoPlanta(null);
    repintarVistas();
  }, [anadir, editable, er]);

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
      <Segmentado etiqueta="En planta" opciones={DIBUJOS} valor={dibujo} onCambio={setDibujo} />
      {tipo === "losas" && dibujo === "armado" && <Segmentado etiqueta="Se ve" opciones={CARAS} valor={cara} onCambio={setCara} />}
      {editable && (
        <div role="group" aria-label="Añadir a una losa" className="flex items-center gap-1.5">
          <select className="sel" style={{ height: 28 }} value={anadir} onChange={(x) => setAnadir(x.target.value)} aria-label="Añadir a una losa" title="Un refuerzo o una zona de cercos nuevos: elija cuál y dé en la planta dos esquinas opuestas de su zona">
            <option value="">Añadir…</option>
            {ANADIR.filter((x) => hayReticular || x.nuevo.lista === "refuerzos").map((x) => (
              <option key={x.id} value={x.id}>
                {x.nombre}
              </option>
            ))}
          </select>
          {hayReticular && anadir !== "" && er.nuevo?.lista === "refuerzos" && (
            <select className="sel" style={{ height: 28 }} value={anadirEn} onChange={(x) => setAnadirEn(x.target.value as "nervios" | "abacos")} aria-label="En un reticular, el refuerzo es de" title="En un reticular: el refuerzo es de los nervios (barras por nervio) o de los ábacos (una parrilla)">
              <option value="nervios">en los nervios</option>
              <option value="abacos">en los ábacos</option>
            </select>
          )}
        </div>
      )}
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

  const estadosPortico = useMemo(() => {
    const r: Record<string, EstadoVano> = {};
    if (tipo === "vigas") for (const x of d?.partes ?? []) r[x.clave] = { ...estadoDe(x), aprovechamiento: x.aprovechamiento };
    return r;
  }, [d, tipo]);
  const panelPortico = !activo ? (
    <div className="p-3">
      <AvisoDesactualizado que="este despiece" />
    </div>
  ) : !elegida ? (
    <p className="nota">Elija una viga en la planta o en la tabla: aquí se dibuja el despiece de su pórtico, la alineación entera de la que forma parte.</p>
  ) : pp.diagnosticos ? (
    <p className="nota text-state-fail">{pp.diagnosticos.map((x) => textoApp(x.mensaje)).join(" ")}</p>
  ) : !portico ? (
    <p className="nota">Preparando el pórtico…</p>
  ) : (
    <DespiecePortico
      datos={portico}
      armados={armadosPortico}
      estados={estadosPortico}
      elegida={clave}
      activo={activoFicha}
      onVano={(c) => {
        const x = d?.partes.find((y) => y.clave === c);
        if (x) elegir(x);
      }}
    />
  );

  const avisos = d && d.diagnosticos.length > 0 ? <ListaDiagnosticos ds={d.diagnosticos} onObjeto={(id) => setElegidos([id])} /> : <p className="nota">Sin avisos.</p>;

  const propiedades =
    elegida && ficha ? (
      <Ficha
        key={`${tipo}/${ficha.clave}`}
        tipo={tipo}
        ficha={ficha}
        cargando={f.cargando}
        ocupado={ocupado}
        elegido={elemento && elemento.losa === ficha.pieza ? elemento : null}
        onElemento={(x) => setElegidos([idElemento(ficha.pieza, x)])}
        alQuitar={() => setElegidos([ficha.pieza])}
        {...(tipo === "vigas" ? { alDibujar: (c: string, a: Record<string, unknown> | undefined) => setEscrito({ clave: c, armado: a }), alActivar: setActivoFicha, verPortico: () => pan.abrirPestana("portico") } : {})}
        proponer={() => void proponer(tipo === "punzonamiento" ? ["punzonamiento"] : [tipo], { ids: [ficha.pieza] }, `Armado propuesto: ${ficha.pieza}`)} />
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
              planta: (v) => (v.planta ? <FuenteEscena fuente={{ tipo: "planta", planta: v.planta, vista: { vista: "comprobacion", de: tipo, ...(armado ? { armado } : {}), ...(dibujo === "armado" ? { dibujo, ...(tipo === "losas" && cara !== "todas" ? { cara } : {}) } : {}) } }} dibujo={editable ? er.adaptador(v.planta) : null} /> : null),
              cabeceraPlanta: () => (
                <>
                  <Chip acento>
                    {dibujo === "armado" ? "Armado" : "Aprovechamiento"} · {TIPOS.find((t) => t.id === tipo)!.nombre.toLowerCase()}
                  </Chip>
                  {editable && (avisoPlanta || anadir !== "") && (
                    <Chip>
                      <span data-aviso-planta className={avisoPlanta ? "text-state-fail" : undefined}>
                        {avisoPlanta ?? `${ANADIR.find((x) => x.id === anadir)!.nombre}: dos clics, las esquinas opuestas de su zona · Esc`}
                      </span>
                    </Chip>
                  )}
                </>
              ),
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
          ...(tipo === "vigas" ? [{ id: "portico", titulo: "Pórtico", contenido: panelPortico }] : []),
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
