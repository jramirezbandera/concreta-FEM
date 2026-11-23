/**
 * El espacio Comprobación (CO6, `docs/fem3d/comprobaciones.md` §4.6, §8.10 y §8.14): los pilares, las
 * vigas, las losas y su punzonamiento, comprobados con el armado en barras del proyecto.
 *
 * - **El armado viene propuesto** (§8.14): al entrar con un cálculo, lo que no tiene armado recibe el
 *   de las tablas (el primero que cumple), en toda la obra, una vez por cálculo; es un paso de deshacer.
 *   «Proponer» lo vuelve a pedir: en lo que falta, en todo el tipo, en la pieza o en toda la obra.
 * - Abajo, la tabla del tipo elegido: una fila por tramo, vano, losa o unión de pilar y losa, con su
 *   armado, el aprovechamiento, la comprobación que manda y su combinación. Un clic elige la pieza
 *   en las vistas; doble clic (o Intro) abre su armado.
 * - Abajo también, «Armado»: el banco de la pieza elegida, con su dibujo a escala (el despiece del
 *   pórtico de una viga) y su armado como formulario (se cambia y se vuelve a comprobar al momento,
 *   sin recalcular: el armado no entra en el cálculo). Elegir una pieza en la planta lo abre.
 * - En Propiedades, la ficha: el estado, sus datos y todas las filas del módulo de comprobación.
 * - En la planta de las losas (§8.12, `dibujo/refuerzos.ts`): el refuerzo o la zona de cercos elegido
 *   se estira por las asas de sus lados y se mueve por la del centro; «Añadir» pone uno nuevo con dos
 *   clics, y Supr quita el elegido. Cada cambio, un paso de deshacer.
 *
 * - Con una viga elegida (§8.13), el banco dibuja el despiece de su alineación (su pórtico)
 *   entera: cada barra con su marca, sus patillas y su largo, los cercos contados y la tabla de
 *   despiece. Sigue a lo que se escribe en la ficha del vano elegido, y un clic en otro vano lo elige.
 *
 * Todo número sale de los pedidos `comprobaciones`, `comprobacion` y `armar` de la sesión, que
 * llaman a lo que da la orden de comprobar del agente. El armado va en cada pedido.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ArmadoProyecto } from "../../../src/agente/armaduraBase.ts";
import type { TramoEnvolvente } from "../../../src/agente/consultas.ts";
import { reticulaLosa } from "../../../src/compilador/abacos.ts";
import type { ArmadoForjado, ArmadoVanoViga, CercosForjado, DatosArmado, RefuerzoForjado } from "../../../src/comprobaciones/armado.ts";
import { armadoDeBorrador, armadoParcial, borradorArmado, DIAMETROS_BARRA, elementoDeId, gruposArmado, idElemento, ponerArmado, sinElemento, type GrupoArmado } from "../../../src/editor/armadoBarras.ts";
import { conElemento, conZona } from "../../../src/editor/refuerzosPlanta.ts";
import type { CaraDibujada } from "../../../src/visor/armadoPlanta.ts";
import type { DatosArmar, DatosEsfuerzosArmado, FichaComprobacion, FilaModulo, ParteComprobada, TipoComprobacion } from "../../../src/visor/comprobaciones.ts";
import { Chip, Disposicion, Herramienta, Segmentado, Separador } from "../armazon/Disposicion.tsx";
import { Situacion } from "../armazon/Situacion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { IcAbacos, IcComprobacion, IcLosas, IcPilares, IcViga, type Icono } from "../armazon/iconos.tsx";
import { AvisoDesactualizado, Cabecera, Fila, filaElegible, ListaDiagnosticos, Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { fmt, plural, textoApp } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { CroquisLosa, CroquisPilar, CroquisPunzonamiento, CroquisViga } from "../editor/CroquisArmado.tsx";
import { DespiecePortico, type EstadoVano } from "../editor/DespiecePortico.tsx";
import { COLUMNAS_VANO, FILAS_VANO, TablaExtremos } from "./Extremos.tsx";
import { EXTREMOS_TRAMO, TERNAS, TITULO_PESIMOS } from "./Ternas.tsx";
import { Dialogo } from "../editor/Dialogos.tsx";
import { EditorRefuerzos, type NuevoElemento } from "../dibujo/refuerzos.ts";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { Fuente3DModelo, FuenteEscena, repintarVistas, ZonaVistas } from "../vistas/Zona.tsx";

const TIPOS: { id: TipoComprobacion; nombre: string; title: string; icono: Icono }[] = [
  {
    id: "pilares",
    nombre: "Pilares",
    icono: IcPilares,
    title: "Cada tramo de pilar: flexocompresión esviada, cortante y reglas de armado",
  },
  {
    id: "vigas",
    nombre: "Vigas",
    icono: IcViga,
    title: "Cada vano de viga: flexión, cortante, fisuración, flecha y torsión",
  },
  {
    id: "losas",
    nombre: "Losas",
    icono: IcLosas,
    title: "Cada losa maciza o reticular: flexión, fisuración y cortante por franjas",
  },
  {
    id: "punzonamiento",
    nombre: "Punzonamiento",
    icono: IcAbacos,
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
const RETICULA: { id: "si" | "no"; nombre: string; title: string }[] = [
  { id: "si", nombre: "Sí", title: "En un reticular, sus casetones de fondo, en la planta y en el 3D sólido o translúcido: los nervios van entre ellos" },
  { id: "no", nombre: "No", title: "Sin los casetones, en la planta y en el 3D: sólo el armado" },
];
const BASE: { id: "si" | "no"; nombre: string; title: string }[] = [
  { id: "no", nombre: "No", title: "Sólo los refuerzos y los cercos: la armadura base es de toda la losa y va en la leyenda" },
  { id: "si", nombre: "Sí", title: "También la armadura base, barra a barra y más fina, en la planta y en el 3D: en un reticular, una línea por nervio" },
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

/**
 * §8.16: el 3D de Comprobación con las losas a la vista: los refuerzos de las losas barra a barra, en la
 * cota de su cara (los superiores en rojo y los inferiores en azul), sobre el modelo en alámbrico.
 */
function Armado3DLosas({ armado, cara, datos, base, reticula }: { armado: ArmadoProyecto | undefined; cara: CaraDibujada; datos: DatosArmado; base: boolean; reticula: boolean }) {
  const { proyecto } = useVisor();
  const r = usePedido(proyecto.cliente, { tipo: "armado-losas-3d", planta: null, ...(armado ? { armado } : {}), ...(cara !== "todas" ? { cara } : {}), ...(base ? { base } : {}), datos });
  return <Fuente3DModelo casetones={reticula} resultados={{ diagramas: r.datos, leyenda: r.datos ? { leyenda: r.datos.leyenda, tituloLeyenda: "Armado de las losas", notas: r.datos.notas } : null, cargando: r.cargando }} />;
}

function estadoDe(p: ParteComprobada): {
  texto: string;
  tono: "ok" | "fail" | "neu" | "warn";
} {
  if (p.origen === "no-aplica") return { texto: "No se comprueba", tono: "neu" };
  if (p.origen === "sin-armado") return { texto: "Sin armado", tono: "neu" };
  if (p.cumple) return { texto: "Cumple", tono: "ok" };
  if (!p.fallan && p.pendientes.length) return { texto: "Sin comprobar", tono: "warn" };
  return { texto: "No cumple", tono: "fail" };
}

const lugarDe = (f: FilaModulo) => [f.lugar, f.s !== undefined ? `s = ${fmt(f.s, 2)} m` : undefined, f.comb ? `${f.comb}${f.pesimos ? " ±" : ""}` : undefined].filter(Boolean).join(" · ");

/** Lo que resalta un grupo en el croquis: la ruta de su objeto en el armado (o la de su primer campo, si van en la raíz). */
const rutaGrupo = (g: GrupoArmado) => g.ruta || g.campos[0]!.ruta;

/** El croquis del armado de una parte: el del borrador (lo que se está escribiendo), a escala. */
function Croquis({ ficha, armado, activo, grande, esfuerzos }: { ficha: FichaComprobacion; armado: Record<string, unknown> | undefined; activo: string | null; grande?: boolean; esfuerzos?: DatosEsfuerzosArmado | null }) {
  const g = ficha.geometria;
  const rec = ficha.recubrimiento;
  if (g.tipo === "pilares") return <CroquisPilar seccion={g.seccion} armado={armado} recubrimiento={rec} activo={activo} libre={g.libre} solapes={g.solapes} esfuerzos={esfuerzos} {...(grande ? { grande } : {})} />;
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
              <input className="sel text-right" style={{ height: 24, width: c.clase === "mm" ? 62 : 48 }} inputMode="decimal" aria-label={nombre} placeholder={c.defecto} title={c.defecto ? `Vacío, ${c.defecto}` : undefined} value={borrador[c.ruta] ?? ""} onChange={(e) => onCambio(c.ruta, e.target.value)} />
            )}
          </label>
        );
      })}
    </div>
  );
}

/** La fila de un elemento de una losa (un refuerzo o una zona de cercos), en su tabla. */
function FilaElemento({ g, on, borrador, onCambio, onElemento, onQuitar, refFila }: { g: GrupoArmado; on: boolean; borrador: Readonly<Record<string, string>>; onCambio: (ruta: string, v: string) => void; onElemento?: ((e: Elemento) => void) | undefined; onQuitar?: ((e: Elemento) => void) | undefined; refFila?: React.Ref<HTMLTableRowElement> | undefined }) {
  const e = g.elemento!;
  // «R3 · X superior · ábacos», «C1 · nervios X»: su número y lo que es
  const [id, ...que] = g.titulo.split(" · ");
  const cara = e.lista === "cercos" ? "cercos" : /inferior/.test(g.titulo) ? "inferior" : "superior";
  return (
    <tr ref={refFila} className="elemento-armado" data-on={on || undefined} data-cara={cara}>
      <td className="et">
        <button type="button" className="mono" title={`${g.titulo}: elegirlo en la planta`} onClick={() => onElemento?.(e)}>
          <i aria-hidden />
          {id}
        </button>
      </td>
      <td className="txt">{que.join(" · ")}</td>
      <td title="Largo de las barras × ancho que cubren">{g.nota}</td>
      <td className="txt">
        <CamposGrupo g={g} borrador={borrador} onCambio={onCambio} />
      </td>
      <td>
        <button type="button" className="px-1 text-text-tertiary hover:text-state-fail" aria-label={`Quitar: ${g.titulo}`} title="Quitarlo del armado" onClick={() => onQuitar?.(e)}>
          ×
        </button>
      </td>
    </tr>
  );
}

/** El orden de una armadura en las tablas: por cara y, dentro, por dirección. */
const ordenArmadura = (g: GrupoArmado) => (/inferior/.test(g.titulo) ? 0 : 2) + (/ Y /.test(`${g.titulo} `) ? 1 : 0);

/**
 * El formulario del armado de una parte: el borrador, por grupos. En una losa, la armadura base va en
 * una tabla (una fila por dirección; inferior y superior, en columnas) y los refuerzos y las zonas de
 * cercos, en otras dos, una fila cada uno: un clic en su número lo elige en la planta, y la «×» lo quita.
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
  const [verCara, setVerCara] = useState<"todas" | "inferior" | "superior">("todas");
  const refuerzos = grupos.filter((g) => g.elemento?.lista === "refuerzos");
  const cercos = grupos.filter((g) => g.elemento?.lista === "cercos");
  const elegidoRef = useRef<HTMLTableRowElement>(null);
  // Los refuerzos y los cercos, en dos pestañas: una lista a la vez
  const [listaVista, setListaVista] = useState<"refuerzos" | "cercos">("refuerzos");
  const lista = (listaVista === "refuerzos" ? refuerzos.length : cercos.length) ? listaVista : refuerzos.length ? "refuerzos" : "cercos";
  // El elegido en la planta, a la vista (en su pestaña)
  useEffect(() => {
    if (elegido) setListaVista(elegido.lista);
  }, [elegido?.lista, elegido?.indice]); // eslint-disable-line react-hooks/exhaustive-deps -- al cambiar lo elegido
  useEffect(() => {
    elegidoRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [elegido?.lista, elegido?.indice, lista]);
  // Una losa: sus grupos fijos son «base.x-inf», «abacos.y-sup»…: en una tabla, por dirección y cara
  const deLosa = fijos.length > 0 && fijos.every((g) => /^(base|abacos)\.[xy]-(inf|sup)$/.test(g.ruta));
  const esOn = (g: GrupoArmado) => elegido?.lista === g.elemento!.lista && elegido.indice === g.elemento!.indice;
  const tablaElementos = (lista: "refuerzos" | "cercos", gs: readonly GrupoArmado[]) => (
    <div data-lista-armado={lista} className="min-w-0">
      <div className="titulo-lista">
        <span role="tablist" aria-label="Refuerzos y cercos de la losa" className="pestanas-lista">
          {(["refuerzos", "cercos"] as const).map((l) => {
            const n = (l === "refuerzos" ? refuerzos : cercos).length;
            return n ? (
              <button key={l} type="button" role="tab" aria-selected={l === lista} data-on={l === lista || undefined} onClick={() => setListaVista(l)}>
                {l === "refuerzos" ? "Refuerzos" : "Cercos de los nervios"} · {n}
              </button>
            ) : null;
          })}
        </span>
        {lista === "refuerzos" && (
          <span role="group" aria-label="Refuerzos que se ven en la lista" className="filtro-lista">
            {(["todas", "inferior", "superior"] as const).map((c) => (
              <button key={c} type="button" data-on={verCara === c || undefined} onClick={() => setVerCara(c)}>
                {c === "todas" ? "Todos" : c === "inferior" ? "Inferiores" : "Superiores"}
              </button>
            ))}
          </span>
        )}
      </div>
      <table className="tb tabla-armado">
        <thead>
          <tr>
            <th>N.º</th>
            <th>{lista === "refuerzos" ? "Armadura" : "De"}</th>
            <th title="Largo de las barras × ancho que cubren">Zona</th>
            <th>{lista === "refuerzos" ? "Barras" : "Cercos"}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(lista === "refuerzos" ? [...gs].sort((a, b) => ordenArmadura(a) - ordenArmadura(b)).filter((g) => verCara === "todas" || (verCara === "inferior") === /inferior/.test(g.titulo)) : gs).map((g) => (
            <FilaElemento key={g.ruta} g={g} on={esOn(g)} borrador={borrador} onCambio={onCambio} onElemento={onElemento} onQuitar={onQuitar} refFila={esOn(g) ? elegidoRef : undefined} />
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className={`px-3.5 pb-1${deLosa ? " form-losa" : ""}`} data-form-armado onMouseLeave={() => onActivo(null)} onBlur={() => onActivo(null)}>
      {deLosa ? (
        <table className="tb tabla-armado tabla-base" data-base-losa>
          <thead>
            <tr>
              <th>Armadura base</th>
              <th>
                <i data-cara="inferior" aria-hidden /> Inferior
              </th>
              <th>
                <i data-cara="superior" aria-hidden /> Superior
              </th>
            </tr>
          </thead>
          <tbody>
            {[...new Set(fijos.map((g) => g.ruta.split(".")[0]!))].flatMap((raiz) =>
              (["x", "y"] as const).map((dir) => {
                const de = (cara: "inf" | "sup") => fijos.find((g) => g.ruta === `${raiz}.${dir}-${cara}`);
                const primero = de("inf") ?? de("sup");
                if (!primero) return null;
                // «Nervios, X inferior» → «Nervios X»; «Base X inferior» → «Base X»
                const nombre = `${primero.titulo.split(/[ ,]/)[0]} ${dir.toUpperCase()}`;
                return (
                  <tr key={`${raiz}.${dir}`}>
                    <td className="et">
                      {nombre}
                      {primero.opcional && <small>opcional</small>}
                    </td>
                    {(["inf", "sup"] as const).map((cara) => {
                      const g = de(cara);
                      return (
                        <td key={cara} className="txt" onMouseEnter={() => g && onActivo(rutaGrupo(g))} onFocus={() => g && onActivo(rutaGrupo(g))}>
                          {g ? <CamposGrupo g={g} borrador={borrador} onCambio={onCambio} /> : "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      ) : (
        <div className="grupos-armado">
          {fijos.map((g) => (
            <div key={g.titulo} className="mt-1.5" onMouseEnter={() => onActivo(rutaGrupo(g))} onFocus={() => onActivo(rutaGrupo(g))}>
              <div className="text-[11.5px] text-text-secondary">
                {g.titulo}
                {g.opcional && <small className="ml-1 text-text-tertiary">(opcional)</small>}
              </div>
              <CamposGrupo g={g} borrador={borrador} onCambio={onCambio} />
            </div>
          ))}
        </div>
      )}
      {(refuerzos.length > 0 || cercos.length > 0) && (
        <div className="listas-armado">{tablaElementos(lista, lista === "refuerzos" ? refuerzos : cercos)}</div>
      )}
    </div>
  );
}

/**
 * Las filas del módulo de una parte, las que no cumplen primero: la tabla de la ficha y del banco. En
 * el banco (`ancha`), con dónde y con qué combinación en sus columnas y el aprovechamiento dibujado.
 */
function TablaFilas({ ficha, ancha }: { ficha: FichaComprobacion; ancha?: boolean }) {
  // Las que no cumplen, primero; después, por aprovechamiento; al final, los datos
  const peso = (x: FilaModulo) => (x.informativa ? -1 : x.estado === "fail" ? 1e9 : 0) + (x.aprovechamiento ?? 0);
  const filas = [...ficha.filas].sort((a, b) => peso(b) - peso(a));
  if (!filas.length) return null;
  const valor = (f: FilaModulo) => (f.informativa ? "dato" : f.aprovechamiento === null ? (f.estado === "fail" ? "no" : "sí") : aprov(f.aprovechamiento));
  return (
    <table className="tb" data-filas-modulo data-ancha={ancha || undefined}>
      <thead>
        <tr>
          <th>Comprobación</th>
          {ancha && <th>Dónde</th>}
          {ancha && <th>Combinación</th>}
          <th>Aprov.</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f, i) => (
          <tr key={`${f.id}#${i}`} data-manda={ficha.manda?.id === f.id || undefined}>
            <td className="txt et">
              {textoApp(f.descripcion)}
              <small>{ancha ? f.articulo : [f.articulo, lugarDe(f)].filter(Boolean).join(" · ")}</small>
            </td>
            {ancha && <td className="txt">{[f.lugar, f.s !== undefined ? `s = ${fmt(f.s, 2)} m` : undefined].filter(Boolean).join(" · ") || "—"}</td>}
            {ancha && (
              <td className="txt mono">
                {f.comb ?? "—"}
                {f.pesimos ? " ±" : ""}
              </td>
            )}
            <td className={f.estado === "fail" ? "f" : f.estado === "warn" ? "w" : undefined}>
              {ancha && !f.informativa && f.aprovechamiento !== null && (
                <span className="barra-aprov" data-estado={f.estado} aria-hidden>
                  <i style={{ width: `${Math.min(1, Math.max(0, f.aprovechamiento)) * 100}%` }} />
                </span>
              )}
              {valor(f)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Lo que no se ha comprobado de una parte, y las hipótesis de partida de su comprobación (el punzonamiento). */
function Hipotesis({ ficha }: { ficha: FichaComprobacion }) {
  if (!ficha.hipotesis?.length) return null;
  return (
    <ul className="hipotesis" data-hipotesis>
      {ficha.hipotesis.map((x) => (
        <li key={x}>{textoApp(x)}</li>
      ))}
    </ul>
  );
}

/** Los esfuerzos de la terna, [N, Vy, Vz, T, My, Mz], en el orden de la tabla del tramo, y el de cada pésimo. */
const COLUMNAS_TERNA = [
  { c: 0, nombre: "N kN" },
  { c: 1, nombre: "Vy kN" },
  { c: 2, nombre: "Vz kN" },
  { c: 4, nombre: "My kN·m" },
  { c: 5, nombre: "Mz kN·m" },
] as const;
const DE_TERNA: Record<string, number> = { "N-": 0, "N+": 0, My: 4, Mz: 5 };

/**
 * De qué combinación salen los esfuerzos de un tramo de pilar: en la cabeza y en el pie, la que da cada
 * pésimo (en negrita), con los demás esfuerzos de esa misma combinación.
 */
function TernasTramo({ t, combinaciones }: { t: TramoEnvolvente; combinaciones: string }) {
  return (
    <div className="banco-esfuerzos" data-ternas-tramo>
      <h4>
        Esfuerzos del tramo<small> · {combinaciones}: la combinación que da cada pésimo, con sus concomitantes</small>
      </h4>
      <table className="tb">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Dónde</th>
            <th style={{ textAlign: "left" }}>Pésimo</th>
            <th style={{ textAlign: "left" }}>Combinación</th>
            {COLUMNAS_TERNA.map((c) => (
              <th key={c.c}>{c.nombre}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {EXTREMOS_TRAMO.map((ex) =>
            TERNAS.map((p, j) => {
              const x = t[ex.k][p.k];
              return (
                <tr key={`${ex.k}${p.k}`} data-terna={`${ex.k} ${p.k}`}>
                  {j === 0 && (
                    <td className="et" rowSpan={TERNAS.length}>
                      {ex.nombre}
                    </td>
                  )}
                  <td className="et" title={p.title}>
                    {p.nombre}
                  </td>
                  <td className="txt mono">
                    {x?.comb ?? "—"}
                    {x?.pesimos && (
                      <span title={TITULO_PESIMOS} aria-label={`, ${TITULO_PESIMOS.toLowerCase()}`}>
                        {" "}±
                      </span>
                    )}
                  </td>
                  {COLUMNAS_TERNA.map((c) => (
                    <td key={c.c}>{!x ? "—" : c.c === DE_TERNA[p.k] ? <b>{fmt(x.esfuerzos[c.c]!, 1)}</b> : fmt(x.esfuerzos[c.c]!, 1)}</td>
                  ))}
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
      <p className="nota">N &lt; 0, compresión; My y Mz, en los ejes de la sección. Con «±» (el sismo del programa), cada esfuerzo va con su signo pésimo: no es un estado simultáneo.</p>
    </div>
  );
}

const COLUMNAS_VANO_BANCO = [{ c: 0, nombre: "N kN" }, ...COLUMNAS_VANO];

/** Los extremos del vano elegido con su combinación: flexión, cortante, torsor y axil, cada uno con los demás de su combinación. */
function EsfuerzosVano({ ficha, esfuerzos }: { ficha: FichaComprobacion; esfuerzos: DatosEsfuerzosArmado }) {
  const ex = esfuerzos.vanos?.[ficha.clave];
  if (!ex) return null;
  const T = ex.T?.v ?? 0;
  const ns = Object.values(ex).flatMap((x) => (x.esfuerzos ? [x.esfuerzos[0]!] : []));
  const sinAxil = esfuerzos.axilSinValor?.includes(ficha.pieza);
  return (
    <div className="banco-esfuerzos" data-esfuerzos-vano>
      <h4>
        Esfuerzos del vano<small> · {esfuerzos.combinaciones}</small>
      </h4>
      <p className="nota" style={{ color: "var(--color-text-primary)" }}>
        Torsor: {Math.abs(T) < 0.05 ? "sin torsor apreciable" : `|T| máx. = ${fmt(Math.abs(T), 1)} kN·m (${ex.T?.comb ?? ""})`}. Axil:{" "}
        {sinAxil ? "sin valor (la viga va en un forjado con diafragma rígido, que se lo lleva)" : ns.length ? `de ${fmt(Math.min(...ns), 1)} a ${fmt(Math.max(...ns), 1)} kN en sus extremos (negativo, compresión)` : "—"}.
      </p>
      <TablaExtremos grupos={[{ extremos: ex }]} filas={FILAS_VANO} columnas={COLUMNAS_VANO_BANCO} />
      <p className="nota">Cada fila, un extremo del vano (en negrita) con los demás esfuerzos de su combinación en ese punto. Las curvas de T y de N se ven bajo el despiece, marcándolas en «Esfuerzos».</p>
    </div>
  );
}

/**
 * El banco de armado de una parte, en el panel de abajo. Arriba, la pieza, su estado y los botones.
 * Debajo, a lo ancho: su dibujo a escala (el despiece del pórtico de una viga; el croquis de las
 * demás), que sigue a lo que se escribe, con los esfuerzos y su combinación; el armado como
 * formulario; y sus comprobaciones, con dónde y con qué combinación.
 */
function BancoArmado({
  tipo,
  ficha,
  proponer,
  ocupado,
  elegido,
  onElemento,
  alQuitar,
  alDibujar,
  alActivar,
  portico,
  esfuerzos,
  aviso,
}: {
  tipo: TipoComprobacion;
  ficha: FichaComprobacion;
  /** Lo que ha hecho «Proponer» en esta pieza, en palabras (también cuando no cambia nada, y por qué). */
  aviso?: string | null;
  /** §8.14: las envolventes de ELU de la pieza, para dibujarlas con su armado, y sus pésimos con su combinación. */
  esfuerzos?: DatosEsfuerzosArmado | null;
  proponer: () => void;
  ocupado: boolean;
  elegido: Elemento | null;
  onElemento: (e: Elemento) => void;
  alQuitar: () => void;
  /** Lo que se está escribiendo (el armado a medias) y el campo con el foco: los sigue el despiece del pórtico. */
  alDibujar?: (clave: string, armado: Record<string, unknown> | undefined) => void;
  alActivar?: (ruta: string | null) => void;
  /** El despiece del pórtico de la viga (§8.13): el dibujo del banco, en lugar del croquis del vano. */
  portico?: ReactNode;
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
  const e = estadoDe(ficha);
  const sinLosa = tipo === "punzonamiento" && ficha.origen === "sin-armado";
  const noAplica = ficha.origen === "no-aplica";
  const editable = !noAplica && !sinLosa;
  // CO3-k: en una losa de cimentación, la armadura mínima reducida de la obra (un dato de la obra, no de la losa)
  const deCimentacion = ficha.geometria.tipo === "losas" && !!ficha.geometria.cimentacion;
  const reducida = !!ed?.proyecto.obra?.armado?.minimaReducidaCimentacion;
  const ponerReducida = (v: boolean) => {
    if (!ed) return;
    const { minimaReducidaCimentacion: _m, ...armado } = ed.proyecto.obra?.armado ?? {};
    const nuevo = v ? { ...armado, minimaReducidaCimentacion: true } : armado;
    const { armado: _a, ...obra } = ed.proyecto.obra ?? {};
    const r = ed.editar({ op: "obra", obra: { ...obra, ...(Object.keys(nuevo).length ? { armado: nuevo } : {}) } }, v ? "Armadura mínima reducida en las losas de cimentación" : "Armadura mínima del Código en las losas de cimentación");
    setError(r.ok ? null : r.errores.map((x) => textoApp(x.mensaje)).join(" "));
  };
  const deLosaConElementos = tipo === "losas" && ficha.armado.tipo === "losas" && !!(ficha.armado.armado?.refuerzos?.length || ficha.armado.armado?.cercos?.length);
  return (
    <div className="banco-armado" data-banco-armado data-tipo={tipo}>
      <header className="banco-cabecera">
        <strong className="mono text-[13px] text-text-primary">
          {ficha.pieza} · {ficha.parte}
        </strong>
        <span className={`pill ${e.tono}`}>
          {e.texto}
          {ficha.aprovechamiento !== null ? ` · ${aprov(ficha.aprovechamiento)}` : ""}
        </span>
        {ficha.seccion && <small className="text-text-tertiary">Sección {ficha.seccion}</small>}
        {!noAplica && <span className="banco-texto mono">{ficha.texto ?? (ficha.origen === "sin-armadura" ? "Sin armadura de punzonamiento" : "Sin armado")}</span>}
        {editable && (
          <span className="banco-botones">
            {cambiado && <small className="text-state-warn">Cambios sin aplicar</small>}
            <button type="button" className="btn btn-p" style={{ height: 26 }} disabled={!cambiado || !ed} onClick={aplicar} title="Guarda en el proyecto lo escrito y vuelve a comprobar la pieza">
              Aplicar
            </button>
            <button type="button" className="btn" style={{ height: 26 }} disabled={ocupado || !ed} onClick={proponer} title="El primer armado de las tablas con el que todo cumple">
              Proponer
            </button>
            <button type="button" className="btn" style={{ height: 26 }} disabled={!ficha.armado.armado || !ed} onClick={() => escribir(null, `Quitar el armado de ${ficha.clave}`)}>
              Quitar
            </button>
          </span>
        )}
      </header>
      {(error || aviso) && (
        <div className="banco-avisos">
          {error && <p className="nota text-state-fail">{error}</p>}
          {aviso && (
            <p className="nota aviso-proponer" data-aviso-proponer>
              {aviso}
            </p>
          )}
        </div>
      )}
      <div className="banco-dibujo">
        {portico ?? (sinLosa ? null : <Croquis ficha={ficha} armado={dibujado} activo={activo} grande {...(esfuerzos && tipo === "pilares" ? { esfuerzos } : {})} />)}
        {tipo === "pilares" && esfuerzos?.ternas && <TernasTramo t={esfuerzos.ternas} combinaciones={esfuerzos.combinaciones} />}
      </div>
      <div className="banco-form">
        {noAplica ? (
          <p className="nota" data-no-aplica style={{ color: "var(--color-text-primary)" }}>
            {textoApp(ficha.pendientes[0] ?? "No se comprueba.")}.
          </p>
        ) : sinLosa ? (
          <p className="nota">La losa no tiene armado: el punzonamiento depende de su armadura de flexión. Ármela en Losas.</p>
        ) : (
          <>
            <h4>Armado</h4>
            {deCimentacion && (
              <div className="minima-reducida" data-minima-reducida>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={reducida} disabled={!ed} onChange={(x) => ponerReducida(x.target.checked)} />
                  <span>
                    <strong>Armadura mínima reducida</strong> en las losas de cimentación de la obra: donde no se llega a la mínima del Código Estructural, vale 1,2 veces la necesaria en ELU, con un suelo del 0,9 ‰.
                  </span>
                </label>
                <p>
                  Es la alternativa del mismo apartado (Anejo 19 §9.2.1.1), que el Código reserva a elementos en los que se acepta cierto riesgo de rotura frágil: lo decide el proyectista. {reducida ? "Activada: «Proponer» da una base menor, con refuerzos donde hagan falta." : "Sin ella, la base no baja de la mínima del Código y casi nunca hacen falta refuerzos."}
                </p>
              </div>
            )}
            <FormArmado grupos={grupos} borrador={borrador} onCambio={cambiar} onActivo={setActivo} elegido={elegido} onElemento={onElemento} onQuitar={quitarElemento} />
            <p className="nota">
              El dibujo sigue a lo que se escribe; «Aplicar» lo guarda y vuelve a comprobar.
              {deLosaConElementos ? " Un clic en el número de un refuerzo o de unos cercos lo elige en la planta: allí se estira por las asas de sus lados, se mueve por la del centro y Supr lo quita; «Añadir», en la barra, pone uno nuevo con dos clics." : ""}
            </p>
          </>
        )}
      </div>
      <div className="banco-comprobaciones" data-banco-comprobaciones>
        {ficha.filas.length > 0 && (
          <div>
            <h4>
              Comprobaciones{ficha.manda ? <small> · manda: {textoApp(ficha.manda.descripcion)}</small> : null}
            </h4>
            {ficha.pendientes.length > 0 &&
              !noAplica &&
              ficha.pendientes.map((x) => (
                <p key={x} className="nota text-state-warn">
                  Sin comprobar: {textoApp(x)}
                </p>
              ))}
            <TablaFilas ficha={ficha} ancha />
          </div>
        )}
        {!ficha.filas.length && ficha.pendientes.length > 0 && !noAplica && (
          <div>
            <h4>Sin comprobar</h4>
            {ficha.pendientes.map((x) => (
              <p key={x} className="nota text-state-warn">
                {textoApp(x)}
              </p>
            ))}
          </div>
        )}
        {tipo === "vigas" && esfuerzos && <EsfuerzosVano ficha={ficha} esfuerzos={esfuerzos} />}
        {ficha.hipotesis?.length ? (
          <div>
            <h4>Hipótesis de partida</h4>
            <Hipotesis ficha={ficha} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** La ficha de una parte, en Propiedades: su estado, su armado en una línea, sus datos y todas las filas del módulo. El armado se edita abajo, en el banco. */
function Ficha({ tipo, ficha, cargando, editar }: { tipo: TipoComprobacion; ficha: FichaComprobacion; cargando: boolean; editar: () => void }) {
  const e = estadoDe(ficha);
  if (ficha.origen === "no-aplica")
    return (
      <>
        <Cabecera icono={IcComprobacion} tipo={NOMBRE_TIPO[tipo]} titulo={`${ficha.pieza} · ${ficha.parte}`} mono>
          <span className="pill neu" data-estado-ficha>
            {e.texto}
          </span>
        </Cabecera>
        <Seccion titulo="Por qué no se comprueba">
          <p className="nota" style={{ color: "var(--color-text-primary)" }}>
            {textoApp(ficha.pendientes[0] ?? "")}.
          </p>
          <Hipotesis ficha={ficha} />
        </Seccion>
        {ficha.datos.length > 0 && (
          <Seccion titulo="Datos">
            {ficha.datos.map((d) => (
              <Fila key={d.nombre} k={d.nombre} v={typeof d.valor === "number" ? `${fmt(d.valor, Number.isInteger(d.valor) ? 0 : 0)}${d.unidad ? ` ${d.unidad}` : ""}` : d.valor} />
            ))}
          </Seccion>
        )}
      </>
    );
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
        <div className="px-3.5 pb-2 pt-1">
          <button type="button" className="btn" style={{ height: 26 }} onClick={editar} title="Abajo, en «Armado»: el dibujo de la pieza a escala y su armado para cambiarlo">
            Editar el armado
          </button>
        </div>
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
      <Seccion titulo="Comprobaciones" valor={cargando ? "…" : ficha.fallan ? `${ficha.fallan} no cumplen` : `${ficha.filas.length}`}>
        <TablaFilas ficha={ficha} />
      </Seccion>
      {ficha.hipotesis?.length ? (
        <Seccion titulo="Hipótesis de partida">
          <Hipotesis ficha={ficha} />
        </Seccion>
      ) : null}
      {ficha.datos.length > 0 && (
        <Seccion titulo="Datos">
          {ficha.datos.map((d) => (
            <Fila key={d.nombre} k={d.nombre} v={typeof d.valor === "number" ? `${fmt(d.valor, Number.isInteger(d.valor) ? 0 : 2)}${d.unidad ? ` ${d.unidad}` : ""}` : d.valor} />
          ))}
        </Seccion>
      )}
    </>
  );
}

/** Lo que ya se ha propuesto solo en esta sesión de la página: por cálculo (su huella) y tipo, una vez. */
const PROPUESTO_SOLO = new Set<string>();
const TODOS_LOS_TIPOS: readonly TipoComprobacion[] = ["pilares", "vigas", "losas", "punzonamiento"];

export function ModoComprobacion({ automatico = true }: { /** §8.14: proponer solo lo que no tiene armado (por defecto, sí). */ automatico?: boolean }) {
  const { proyecto, setElegidos, elegidos, setPlanta } = useVisor();
  const pan = usePaneles("comprobacion", {
    props: true,
    dock: true,
    pestana: "tabla",
    alto: 440,
  });
  const [tipo, setTipo] = useState<TipoComprobacion>("pilares");
  const [clave, setClave] = useState<string | null>(null);
  const [peores, setPeores] = useState(false);
  const [dibujo, setDibujo] = useState<Dibujo>("armado");
  const [cara, setCara] = useState<CaraDibujada>("todas");
  /** Los casetones de los reticulares, de fondo del armado de las losas. */
  const [reticula, setReticula] = useState(true);
  const [base, setBase] = useState(false);
  const [anadir, setAnadir] = useState<string>("");
  const [anadirEn, setAnadirEn] = useState<"nervios" | "abacos">("nervios");
  const [avisoPlanta, setAvisoPlanta] = useState<string | null>(null);
  const editor = useRef<EditorRefuerzos | null>(null);
  editor.current ??= new EditorRefuerzos();
  const [ocupado, setOcupado] = useState(false);
  const [propuesta, setPropuesta] = useState<{
    datos: DatosArmar | null;
    error: string | null;
    /** La hizo el programa al entrar (§8.14). */
    solo?: boolean;
  } | null>(null);
  /** CO6-b: «Todo» con partes que ya tienen armado espera a que se confirme. */
  const [sustituir, setSustituir] = useState<number | null>(null);
  /** Lo que ha hecho «Proponer» en la pieza del banco (§8.16): también si no cambia nada, y por qué. */
  const [avisoPieza, setAvisoPieza] = useState<{ clave: string; texto: string } | null>(null);
  const ed = proyecto.edicion;
  const entero = ed?.proyecto.armado;
  const armado = useMemo(() => armadoDe(tipo, entero), [tipo, entero?.pilares, entero?.vigas, entero?.forjados, entero?.punzonamiento]); // eslint-disable-line react-hooks/exhaustive-deps -- sólo los bloques del tipo
  const activo = !proyecto.desactualizado;
  // Los datos de armado de la obra (acero, recubrimiento, la mínima reducida…), como el armado: en cada pedido
  const claveDatos = JSON.stringify(ed?.proyecto.obra?.armado ?? {});
  const datosObra = useMemo(() => JSON.parse(claveDatos) as DatosArmado, [claveDatos]);
  const r = usePedido(proyecto.cliente, activo ? { tipo: "comprobaciones", de: tipo, ...(armado ? { armado } : {}), datos: datosObra } : null);
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
          datos: datosObra,
        }
      : null,
  );
  const ficha = f.datos && elegida && f.datos.clave === elegida.clave ? f.datos : null;

  // §8.13: el pórtico de la viga elegida, para su despiece. No depende del armado: se pide una vez por viga
  const pp = usePedido(proyecto.cliente, activo && tipo === "vigas" && elegida ? { tipo: "portico", viga: elegida.pieza, datos: datosObra } : null);
  const portico = tipo === "vigas" && elegida && pp.datos?.portico.vigas.some((v) => v.id === elegida.pieza) ? pp.datos : null;
  // §8.14: las envolventes de ELU de lo que se edita en el banco (el pórtico de la viga, el tramo del pilar), con él abierto
  const enBanco = pan.dock && pan.pestana === "armado";
  const pe = usePedido(
    proyecto.cliente,
    !activo || !elegida || !enBanco ? null : tipo === "vigas" ? { tipo: "esfuerzos-portico", viga: elegida.pieza } : tipo === "pilares" && elegida.planta ? { tipo: "esfuerzos-pilar", pilar: elegida.pieza, planta: elegida.planta } : null,
  );
  const esfuerzos = (tipo === "vigas" || tipo === "pilares") && elegida ? (pe.datos ?? null) : null;
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
    if (suyas.length) {
      setClave((suyas.find((p) => !p.cumple) ?? suyas[0]!).clave);
      // Elegida en una vista: su armado, abajo
      if (pan.pestana !== "avisos") pan.abrirPestana("armado");
    }
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
  er.losas = useMemo(
    () =>
      (losasModelo ?? []).map((l) => {
        // §8.19: en un reticular, lo que va por nervios se engancha a los lindes entre ellos
        const ret = l.reticular ? reticulaLosa(l) : null;
        return { id: l.id, planta: l.planta, eje1: l.eje1, contorno: l.contorno, armado: entero?.forjados?.[l.id], ...(ret ? { nervios: { x: ret.x, y: ret.y } } : {}) };
      }),
    [losasModelo, entero?.forjados],
  );
  er.elegido = editable && elemento ? { losa: elemento.losa, elemento: { lista: elemento.lista, indice: elemento.indice } } : null;
  const nuevoElegido = editable ? (ANADIR.find((x) => x.id === anadir)?.nuevo ?? null) : null;
  er.nuevo = nuevoElegido?.lista === "refuerzos" ? { ...nuevoElegido, en: anadirEn } : nuevoElegido;
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

  /** Pide el armado de las tablas y lo escribe en el proyecto (un paso de deshacer). `solo`: lo propone el programa al entrar; si no cambia nada, no escribe. */
  const proponer = async (tipos: readonly TipoComprobacion[], o: { soloSinArmado?: boolean; ids?: string[] }, etiqueta: string, solo = false) => {
    if (!proyecto.cliente || !ed || ocupado) return;
    setOcupado(true);
    setPropuesta(null);
    try {
      const x = await proyecto.cliente.pedir({
        tipo: "armar",
        tipos,
        ...(entero ? { armado: entero } : {}),
        datos: datosObra,
        ...o,
      });
      if (!x.ok)
        return setPropuesta({
          datos: null,
          error: x.diagnosticos.map((y) => textoApp(y.mensaje)).join(" "),
        });
      const datos = x.valor as DatosArmar;
      if (solo && JSON.stringify(datos.armado ?? {}) === JSON.stringify(entero ?? {})) return;
      const ap = ed.editar({ op: "armado", armado: datos.armado }, etiqueta);
      setPropuesta(
        ap.ok
          ? { datos, error: null, ...(solo ? { solo } : {}) }
          : {
              datos: null,
              // Lo primero que no vale (un armado propuesto que el proyecto rechaza lo repite pieza a pieza)
              error: `El armado propuesto no se pudo escribir en el proyecto. ${ap.errores
                .slice(0, 2)
                .map((y) => textoApp(y.mensaje))
                .join(" ")}${ap.errores.length > 2 ? ` (y ${ap.errores.length - 2} más)` : ""}`,
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

  /**
   * «Proponer» en el banco: el armado de las tablas para la pieza de la ficha, y en palabras lo que ha
   * pasado. Si lo propuesto es lo que ya tenía, no se escribe nada (ni un paso de deshacer) y se dice
   * por qué: en el punzonamiento, que la unión cumple sin armadura.
   */
  const proponerPieza = async (fc: FichaComprobacion) => {
    if (!proyecto.cliente || !ed || ocupado) return;
    setOcupado(true);
    setAvisoPieza(null);
    const decir = (texto: string) => setAvisoPieza({ clave: fc.clave, texto });
    try {
      const x = await proyecto.cliente.pedir({ tipo: "armar", tipos: [tipo], ...(entero ? { armado: entero } : {}), datos: datosObra, ids: [fc.pieza] });
      if (!x.ok) return decir(x.diagnosticos.map((y) => textoApp(y.mensaje)).join(" "));
      const datos = x.valor as DatosArmar;
      const sin = datos.sinPropuesta.find((y) => y.clave === fc.clave) ?? datos.sinPropuesta.find((y) => y.clave.startsWith(`${fc.pieza}/`) || y.clave === fc.pieza);
      const antes = JSON.stringify(entero ?? {});
      const despues = JSON.stringify(datos.armado ?? {});
      if (antes === despues) {
        if (sin) return decir(`Sin propuesta: ${textoApp(sin.motivo)}. Hay que cambiar la sección, el canto o el material.`);
        if (tipo === "punzonamiento") {
          const v = fc.datos.find((y) => y.nombre.startsWith("vEd / vRd,c"))?.valor;
          return decir(`No hace falta armadura de punzonamiento: ${fc.pieza} cumple sin ella${typeof v === "number" ? ` (vEd/vRd,c = ${fmt(v, 2)} ≤ 1)` : ""}. No se ha cambiado nada.`);
        }
        return decir("Lo propuesto es lo que ya tiene: el primer armado de las tablas con el que todo cumple. No se ha cambiado nada.");
      }
      const ap = ed.editar({ op: "armado", armado: datos.armado }, `Armado propuesto: ${fc.pieza}`);
      if (!ap.ok) return decir(`El armado propuesto no se pudo escribir en el proyecto. ${ap.errores.slice(0, 2).map((y) => textoApp(y.mensaje)).join(" ")}`);
      decir(sin ? `Propuesto lo que se ha podido; sin propuesta: ${textoApp(sin.motivo)}. Se deshace con Ctrl+Z.` : `Armado propuesto en ${fc.pieza}: el primero de las tablas con el que todo cumple. Se deshace con Ctrl+Z.`);
    } catch {
      decir("El proyecto cambió mientras se proponía el armado: vuelva a pedirlo.");
    } finally {
      setOcupado(false);
    }
  };

  // §8.14: el armado viene propuesto. Con la tabla del tipo a la vista y partes sin armado, lo que
  // falta en toda la obra, una vez por cálculo (deshecho, no vuelve solo: están los botones)
  const huella = proyecto.estado?.huella ?? "";
  const faltan = d?.resumen.sinArmado ?? 0;
  const propon = useRef(proponer);
  propon.current = proponer;
  useEffect(() => {
    if (!automatico || !activo || !ed || !proyecto.cliente || !d || ocupado) return;
    const marca = (t: TipoComprobacion) => `${huella}/${t}`;
    if (PROPUESTO_SOLO.has(marca(tipo))) return;
    PROPUESTO_SOLO.add(marca(tipo));
    if (!faltan) return;
    for (const t of TODOS_LOS_TIPOS) PROPUESTO_SOLO.add(marca(t));
    void propon.current(TODOS_LOS_TIPOS, { soloSinArmado: true }, "Armado propuesto: lo que falta en la obra", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- al llegar la tabla de un tipo
  }, [automatico, activo, d, tipo, huella, faltan, ocupado]);

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
      <div role="group" aria-label="Qué se comprueba" className="flex items-stretch">
        {TIPOS.map((t) => (
          <Herramienta
            key={t.id}
            icono={t.icono}
            nombre={t.nombre}
            title={t.title}
            activa={tipo === t.id}
            onClick={() => {
              setTipo(t.id);
              setClave(null);
              setPropuesta(null);
            }}
          />
        ))}
      </div>
      <Separador />
      <Segmentado etiqueta="En planta" opciones={DIBUJOS} valor={dibujo} onCambio={setDibujo} />
      {tipo === "losas" && dibujo === "armado" && <Segmentado etiqueta="Se ve" opciones={CARAS} valor={cara} onCambio={setCara} />}
      {tipo === "losas" && dibujo === "armado" && <Segmentado etiqueta="Base" opciones={BASE} valor={base ? "si" : "no"} onCambio={(v) => setBase(v === "si")} />}
      {tipo === "losas" && dibujo === "armado" && hayReticular && <Segmentado etiqueta="Retícula" opciones={RETICULA} valor={reticula ? "si" : "no"} onCambio={(v) => setReticula(v === "si")} />}
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
      <BarraVistas />
    </>
  );

  // §8.16: el armado viene propuesto solo, así que volver a pedirlo no va en la barra: va encima de la tabla
  const barraProponer = (
    <div role="group" aria-label="Proponer armado" className="barra-proponer" data-barra-proponer>
      <span className="text-[11.5px] text-text-secondary">Volver a proponer el armado:</span>
      <button type="button" className="btn" style={{ height: 24 }} disabled={!ed || ocupado || !activo} onClick={proponerFalta} title={tipo === "punzonamiento" ? "La armadura de punzonamiento que haga falta en las uniones que no tienen una escrita" : `El armado de las tablas en los ${varios} que no tienen`}>
        Lo que falta
      </button>
      <button type="button" className="btn" style={{ height: 24 }} disabled={!ed || ocupado || !activo} onClick={pedirTodo} title={`El armado de las tablas en todos los ${varios}: sustituye al que tengan (lo pregunta antes)`}>
        Todo
      </button>
      <button
        type="button"
        className="btn"
        style={{ height: 24 }}
        disabled={!ed || ocupado || !activo}
        onClick={() => void proponer(["pilares", "vigas", "losas", "punzonamiento"], { soloSinArmado: true }, "Armado propuesto: lo que falta en la obra")}
        title="Pilares, vigas, losas y punzonamiento: el armado de las tablas en lo que no lo tiene; lo que ya tiene armado, también la armadura de punzonamiento escrita, se queda"
      >
        Toda la obra
      </button>
      <span className="text-[12px] text-text-secondary" style={{ visibility: ocupado ? "visible" : "hidden" }}>
        Proponiendo…
      </span>
    </div>
  );

  const resumenPropuesta = propuesta && (
    <div className="nota" data-propuesta>
      {propuesta.error ? (
        <span className="text-state-fail">{propuesta.error}</span>
      ) : (
        <>
          {propuesta.solo && <strong className="mr-2 font-medium text-text-primary">Armado propuesto por el programa en lo que no lo tenía.</strong>}
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
          {d.resumen.noAplica ? ` · ${d.resumen.noAplica} no se comprueban` : ""}
          {r.cargando ? " · comprobando…" : ""}
        </span>
      }
    >
      {barraProponer}
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
                  <tr
                    key={p.clave}
                    data-on={p.clave === clave}
                    style={{ cursor: "pointer" }}
                    {...filaElegible(() => elegir(p), p.clave === clave)}
                    onDoubleClick={() => {
                      elegir(p);
                      pan.abrirPestana("armado");
                    }}
                    title="Doble clic: su armado"
                  >
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
            Doble clic en una fila abre su armado. Aprov.: el de la comprobación que manda (la que no cumple, si la hay; si no, la de agotamiento más alta). Con acero B{d.datos.fyk}, recubrimiento de {d.datos.recubrimiento} mm hasta el cerco, φef = {fmt(d.datos.phiEf, 1)}, exposición {d.datos.exposicion} y flecha activa L/{d.datos.flechaActiva}: los datos de la obra. El armado no entra en el cálculo: cambiarlo no recalcula.
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
  const panelPortico = tipo !== "vigas" || !elegida ? null : pp.diagnosticos ? (
    <p className="nota text-state-fail">{pp.diagnosticos.map((x) => textoApp(x.mensaje)).join(" ")}</p>
  ) : !portico ? (
    <p className="nota">Preparando el pórtico…</p>
  ) : (
    <DespiecePortico
      esfuerzos={esfuerzos}
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

  const banco = !activo ? (
    <div className="p-3">
      <AvisoDesactualizado que="este armado" />
    </div>
  ) : !elegida ? (
    <p className="nota">
      Elija {uno === "losa" ? "una losa" : `un ${uno === "unión" ? "pilar" : uno}`} en la planta o en la tabla: aquí se dibuja a escala{tipo === "vigas" ? ", con el despiece de su pórtico (la alineación entera de la que forma parte)," : ""} y se cambia su armado.
    </p>
  ) : !ficha ? (
    <p className="nota">{f.diagnosticos ? f.diagnosticos.map((x) => textoApp(x.mensaje)).join(" ") : "Comprobando…"}</p>
  ) : (
    <BancoArmado
      key={`${tipo}/${ficha.clave}`}
      tipo={tipo}
      ficha={ficha}
      ocupado={ocupado}
      elegido={elemento && elemento.losa === ficha.pieza ? elemento : null}
      onElemento={(x) => setElegidos([idElemento(ficha.pieza, x)])}
      alQuitar={() => setElegidos([ficha.pieza])}
      {...(esfuerzos ? { esfuerzos } : {})}
      {...(tipo === "vigas" ? { alDibujar: (c: string, a: Record<string, unknown> | undefined) => setEscrito({ clave: c, armado: a }), alActivar: setActivoFicha, portico: panelPortico } : {})}
      aviso={avisoPieza?.clave === ficha.clave ? avisoPieza.texto : null}
      proponer={() => void proponerPieza(ficha)}
    />
  );

  const propiedades =
    elegida && ficha ? (
      <Ficha key={`${tipo}/${ficha.clave}`} tipo={tipo} ficha={ficha} cargando={f.cargando} editar={() => pan.abrirPestana("armado")} />
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
          {elegida ? "Comprobando…" : `Elija ${uno === "losa" ? "una losa" : `un ${uno === "unión" ? "pilar" : uno}`} en la tabla o en una vista para ver su armado y todas sus comprobaciones.`} El armado viene propuesto: el primero de las tablas con el que todo cumple. Se cambia abajo, en «Armado», y «Proponer armado» lo vuelve a pedir.
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
        etiquetaHerramientas="Herramientas de Comprobación"
        herramientas={herramientas}
        vista={
          <ZonaVistas
            fuentes={{
              // CO6-d: la planta, con cada parte del color de su aprovechamiento (la escena del worker)
              ...(tipo === "losas" && dibujo === "armado" ? { tresD: () => <Armado3DLosas armado={armado} cara={cara} datos={datosObra} base={base} reticula={reticula} /> } : {}),
              planta: (v) => (v.planta ? <FuenteEscena fuente={{ tipo: "planta", planta: v.planta, vista: { vista: "comprobacion", de: tipo, ...(armado ? { armado } : {}), datos: datosObra, ...(dibujo === "armado" ? { dibujo, ...(tipo === "losas" && cara !== "todas" ? { cara } : {}), ...(tipo === "losas" && !reticula ? { reticula: false } : {}), ...(tipo === "losas" && base ? { base: true } : {}) } : {}) } }} dibujo={editable ? er.adaptador(v.planta) : null} /> : null),
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
        props={{ titulo: "Propiedades", contenido: propiedades, ancho: 330 }}
        dock={[
          {
            id: "tabla",
            titulo: "Comprobaciones",
            insignia: d ? (d.resumen.noCumplen ? `${d.resumen.noCumplen} ✕` : "✓") : undefined,
            contenido: tabla,
          },
          { id: "armado", titulo: tipo === "vigas" ? "Armado · pórtico" : "Armado", contenido: banco },
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
