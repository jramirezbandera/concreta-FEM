/**
 * Espacios Modelo y Cargas (`docs/fem3d/interfaz.md` §4 y §13): lo que era la pantalla Modelo de V1
 * y V2a, repartido en la disposición común.
 *
 * - Barra: en Modelo, las herramientas de los objetos (abren su tabla en la fila nueva), Copiar (a
 *   otras plantas) y Borrar (lo elegido o, sin nada que les sirva, lo que se elija después), las tablas de datos y Planta o 3D; en Cargas, el caso activo, Nueva carga y
 *   Casos. Sin proyecto editable, sólo lo que mira.
 * - Navegador: el proyecto y los objetos de la planta activa (en Cargas, los casos y las cargas).
 * - Vistas (I2): 1, 2 o 4, de planta (modelo, diagnósticos o malla; en Cargas, las del caso activo),
 *   alzado o 3D (`vistas/Zona.tsx`). En Cargas, el alzado y el 3D también dibujan las del caso activo
 *   (`agente/render/cargas.ts` y `visor/cargas3d.ts`), a la escala de la barra. La barra cambia el
 *   tipo de la vista activa y la disposición.
 * - Propiedades: lo elegido (con varios, la lista por tipo) o, sin nada, la planta (resumen, cargas
 *   por caso, equilibrio, hipótesis).
 * - Panel inferior: las tablas del editor, los diagnósticos y las combinaciones.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ListOrdered, Trash2 } from "lucide-react";
import { DEF_TABLAS, TABLAS, contexto, objetosTabla, type NombreTabla } from "../../../src/editor/tablas.ts";
import { Chip, Desplegable, Disposicion, Herramienta, Hueco, Campo, Separador, type Pestana } from "../armazon/Disposicion.tsx";
import { IcAPlantas, IcApoyo, IcApoyoLineal, IcCarga, IcCasos, IcCombinaciones, IcEjes, IcEmpuje, IcLosa, IcMateriales, IcMuro, IcPilar, IcPlantas, IcSecciones, IcViga, type Icono } from "../armazon/iconos.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { Aviso, Equilibrio, Fila, ListaDiagnosticos, Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { DialogoBorrar, DialogoCopiar, DialogoRenumerar } from "../editor/Dialogos.tsx";
import { tablaDe } from "../editor/Formulario.tsx";
import { PanelTablas } from "../editor/Hoja.tsx";
import { cota, fmt } from "../fmt.ts";
import { Inspector } from "../pantallas/Inspector.tsx";
import { NavVistas } from "../armazon/VistasGuardadas.tsx";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { useVistas, type DibujoPlanta, type EstadoVista } from "../vistas/estado.ts";
import { Fuente3DModelo, FuenteEscena, planoAlzado, plantaVista, ZonaVistas } from "../vistas/Zona.tsx";
import { usePedido } from "../sesion/usePedido.ts";

/** Lo que se puede copiar a otras plantas (los pilares ya van de una planta a otra). */
const COPIABLES: ReadonlySet<NombreTabla> = new Set(["vigas", "forjados", "apoyos", "apoyosLineales", "cargas"]);
/** La escala de las cargas en el alzado y el 3D (por la que se multiplica la automática). */
const ESCALAS = ["0.25", "0.5", "1", "2", "4"] as const;
type Escala = (typeof ESCALAS)[number];
const IcBorrar: Icono = ({ size }) => <Trash2 size={size} strokeWidth={1.5} aria-hidden="true" />;
const IcRenumerar: Icono = ({ size }) => <ListOrdered size={size} strokeWidth={1.5} aria-hidden="true" />;

let ultimoPedido = 0;

/** Un caso en el selector de la barra: su id, su nombre y si lleva el peso propio. */
const textoCaso = (c: { id: string; nombre?: string; pesoPropio?: boolean } | undefined) => (c ? `${c.id}${c.nombre ? ` · ${c.nombre}` : ""}${c.pesoPropio ? " · con peso propio" : ""}` : undefined);

export function EspacioModelo({ espacio }: { espacio: "modelo" | "cargas" }) {
  const { proyecto, seleccion, setSeleccion, elegidos, tablaPedida } = useVisor();
  const vistas = useVistas();
  const e = proyecto.estado!;
  const ed = proyecto.edicion;
  // Un proyecto sin pilares abre las tablas; se decide al entrar, no con cada objeto que se mete
  const [vacio] = useState(() => !!ed && !(ed.proyecto.modelo.pilares?.length ?? 0));
  const pan = usePaneles(espacio, { nav: true, props: false, dock: vacio, pestana: ed ? "tablas" : "diagnosticos" });
  const cargas = espacio === "cargas";

  const [caso, setCaso] = useState<string | null>(null);
  const [escala, setEscala] = useState<Escala>("1");
  const [tabla, setTabla] = useState<NombreTabla>(cargas ? "cargas" : "pilares");
  const [nueva, setNueva] = useState(0);
  const [plantilla, setPlantilla] = useState<Record<string, string> | undefined>(undefined);
  const [dialogo, setDialogo] = useState<"borrar" | "copiar" | "renumerar" | null>(null);

  const casoValido = e.casos.some((c) => c.id === caso) ? caso! : (e.casos[0]?.id ?? "");
  // Lo elegido que está en el proyecto (un eje propuesto no lo está) y lo que de ello se copia
  const enTablas = ed ? elegidos.filter((id) => tablaDe(ed.proyecto.modelo, id)) : [];
  const copiables = ed ? enTablas.filter((id) => COPIABLES.has(tablaDe(ed.proyecto.modelo, id)!)) : [];

  // Copiar y Borrar sin nada que les sirva elegido esperan a que se elija: un clic (o una ventana)
  // abre su diálogo con lo elegido; con Ctrl se van sumando, e Intro o la herramienta lo abren.
  const [eligiendo, setEligiendo] = useState<"copiar" | "borrar" | null>(null);
  const alEmpezar = useRef(elegidos);
  const conCtrl = useRef(false);
  const paraAccion = (a: "copiar" | "borrar") => (a === "copiar" ? copiables : enTablas);
  const usar = (a: "copiar" | "borrar") => {
    if (paraAccion(a).length) return setDialogo(a);
    if (eligiendo === a) return setEligiendo(null);
    alEmpezar.current = elegidos;
    setEligiendo(a);
  };
  const cerrarDialogo = () => {
    setDialogo(null);
    setEligiendo(null);
  };
  useEffect(() => {
    if (!eligiendo) return;
    const puntero = (x: PointerEvent) => void (conCtrl.current = x.ctrlKey || x.metaKey);
    const tecla = (x: KeyboardEvent) => {
      if (x.key === "Escape") setEligiendo(null);
      else if (x.key === "Enter" && !(x.target as HTMLElement | null)?.closest?.("input, textarea, select, [role=grid], [role=dialog]") && paraAccion(eligiendo).length) setDialogo(eligiendo);
    };
    window.addEventListener("pointerdown", puntero, true);
    window.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("pointerdown", puntero, true);
      window.removeEventListener("keydown", tecla);
    };
  });
  useEffect(() => {
    if (eligiendo && elegidos !== alEmpezar.current && !conCtrl.current && paraAccion(eligiendo).length) setDialogo(eligiendo);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo cuando cambia lo elegido
  }, [elegidos]);

  const abrirTabla = (t: NombreTabla, filaNueva = false, celdas?: Record<string, string>) => {
    setTabla(t);
    pan.abrirPestana("tablas");
    setPlantilla(celdas);
    if (filaNueva) setNueva((n) => n + 1);
  };

  // La paleta pide una tabla (cada pedido, una vez: no al volver a este espacio)
  const pedido = tablaPedida?.n ?? 0;
  useEffect(() => {
    if (!pedido || !tablaPedida || pedido === ultimoPedido) return;
    ultimoPedido = pedido;
    abrirTabla(tablaPedida.tabla);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo con cada pedido
  }, [pedido]);

  const herramientas = cargas ? (
    <>
      <Campo etiqueta="Caso activo" ancho={300}>
        <select className="sel w-full" value={casoValido} onChange={(x) => setCaso(x.target.value)} aria-label="Caso activo" title={textoCaso(e.casos.find((c) => c.id === casoValido))}>
          {e.casos.map((c) => (
            <option key={c.id} value={c.id}>
              {textoCaso(c)}
            </option>
          ))}
        </select>
      </Campo>
      {ed && (
        <>
          <Separador />
          <Herramienta icono={IcCarga} nombre="Nueva carga" onClick={() => abrirTabla("cargas", true)} title="Una carga nueva en la tabla de cargas" />
          <Herramienta icono={IcEmpuje} nombre="Empuje" onClick={() => abrirTabla("cargas", true, { tipo: "empuje", caso: casoValido })} title="Un empuje nuevo sobre un muro (terreno o agua), en la tabla de cargas" />
          <Herramienta icono={IcCasos} nombre="Casos" onClick={() => abrirTabla("casos")} title="La tabla de casos de carga" />
        </>
      )}
      <Separador />
      <Desplegable etiqueta="Escala de las cargas en el alzado y el 3D" prefijo={<span className="text-text-secondary">Escala</span>} valor={escala} onCambio={setEscala} opciones={ESCALAS.map((x) => ({ id: x, nombre: `×${x.replace(".", ",")}` }))} />
      <Separador />
      <Herramienta icono={IcCombinaciones} nombre="Combinaciones" onClick={() => pan.abrirPestana("combinaciones")} title="Las combinaciones que salen de los casos" />
      <Hueco />
      <BarraVistas />
    </>
  ) : (
    <>
      {ed && (
        <>
          <Herramienta icono={IcEjes} nombre="Ejes" onClick={() => abrirTabla("ejes")} title="La tabla de ejes de replanteo (sin ejes en el proyecto, los propuestos)" />
          <Herramienta icono={IcPilar} nombre="Pilar" onClick={() => abrirTabla("pilares", true)} title="Un pilar nuevo en la tabla de pilares" />
          <Herramienta icono={IcViga} nombre="Viga" onClick={() => abrirTabla("vigas", true)} title="Una viga nueva en la tabla de vigas" />
          <Herramienta icono={IcLosa} nombre="Forjado" onClick={() => abrirTabla("forjados", true, { tipo: "maciza" })} title="Un forjado nuevo en la tabla de forjados: losa maciza, reticular o unidireccional, según su columna «tipo»" />
          <Herramienta icono={IcMuro} nombre="Muro" onClick={() => abrirTabla("muros", true)} title="Un muro nuevo en la tabla de muros" />
          <Herramienta icono={IcApoyo} nombre="Apoyo" onClick={() => abrirTabla("apoyos", true)} title="Un apoyo nuevo en la tabla de apoyos" />
          <Herramienta icono={IcApoyoLineal} nombre="Apoyo lineal" onClick={() => abrirTabla("apoyosLineales", true)} title="Un apoyo lineal nuevo en la tabla de apoyos lineales" />
          <Separador />
          <Herramienta icono={IcAPlantas} nombre="Copiar" activa={eligiendo === "copiar"} onClick={() => usar("copiar")} title={copiables.length ? `Copiar ${copiables.length > 1 ? `${copiables.length} objetos` : copiables[0]} a otras plantas` : eligiendo === "copiar" ? "Dejar de elegir (Esc)" : "Copiar a otras plantas: elija después las vigas, losas, paños, apoyos o cargas"} />
          <Herramienta icono={IcBorrar} nombre="Borrar" activa={eligiendo === "borrar"} onClick={() => usar("borrar")} title={enTablas.length ? `Borrar ${enTablas.length > 1 ? `${enTablas.length} objetos` : enTablas[0]}` : eligiendo === "borrar" ? "Dejar de elegir (Esc)" : "Borrar: elija después lo que quiere borrar"} />
          <Herramienta icono={IcRenumerar} nombre="Renumerar" onClick={() => setDialogo("renumerar")} title="Ids cortos como en CYPECAD: P1, P2… por filas de arriba abajo y de izquierda a derecha" />
          <Separador />
          <Herramienta icono={IcPlantas} nombre="Plantas" onClick={() => abrirTabla("plantas")} />
          <Herramienta icono={IcMateriales} nombre="Materiales" onClick={() => abrirTabla("materiales")} />
          <Herramienta icono={IcSecciones} nombre="Secciones" onClick={() => abrirTabla("secciones")} />
        </>
      )}
      <Hueco />
      <BarraVistas />
    </>
  );

  const chipCaso = (
    <Chip acento>
      Cargas del caso <strong className="font-semibold">{casoValido || "—"}</strong>
    </Chip>
  );
  const vista = (
    <ZonaVistas
      fuentes={{
        planta: (v) => (v.planta ? <FuenteEscena fuente={{ tipo: "planta", planta: v.planta, vista: cargas ? { vista: "cargas", caso: casoValido } : plantaVista(v, e.calculado) }} /> : null),
        ...(cargas && casoValido
          ? {
              alzado: (v: EstadoVista) => <FuenteEscena fuente={v.eje ? { tipo: "alzado", plano: planoAlzado(v.eje, v), cargas: { caso: casoValido, escala: Number(escala) } } : null} />,
              tresD: () => <TresDCargas caso={casoValido} escala={Number(escala)} />,
              cabeceraAlzado: () => chipCaso,
              cabecera3DModelo: () => chipCaso,
            }
          : {}),
        cabeceraPlanta: (v, i) =>
          cargas ? (
            chipCaso
          ) : (
            <Desplegable
              etiqueta="Qué se dibuja"
              valor={v.dibujo === "malla" && !e.calculado ? "modelo" : v.dibujo}
              onCambio={(d) => vistas.poner(i, { dibujo: d })}
              opciones={(["modelo", "diagnosticos", "malla"] as DibujoPlanta[]).map((d) => ({
                id: d,
                nombre: d === "diagnosticos" ? "Diagnósticos" : d === "malla" ? "Malla" : "Modelo",
                disabled: d === "malla" && !e.calculado,
                title: d === "malla" && !e.calculado ? "Necesita el cálculo" : undefined,
              }))}
            />
          ),
      }}
    />
  );

  const errores = e.diagnosticos.filter((d) => d.severidad === "error").length;
  const avisos = e.diagnosticos.length - errores;
  const dock: Pestana[] = [
    ...(ed ? [{ id: "tablas", titulo: "Tablas", contenido: <PanelTablas tabla={tabla} setTabla={setTabla} nueva={nueva} plantilla={plantilla} /> }] : []),
    {
      id: "diagnosticos",
      titulo: "Diagnósticos",
      insignia: errores ? <span className="text-state-fail">{errores} errores</span> : avisos ? <span className="text-state-warn">{avisos} avisos</span> : "0",
      contenido: (
        <>
          <p className="nota">Los de `fem validar` y `fem calcular`. Un clic en un id lo elige.</p>
          <ListaDiagnosticos ds={e.diagnosticos} onObjeto={setSeleccion} />
        </>
      ),
    },
    { id: "combinaciones", titulo: "Combinaciones", insignia: e.combinaciones.length, contenido: <ListaCombinaciones /> },
  ];

  return (
    <>
      <Disposicion
        paneles={pan}
        etiquetaHerramientas={cargas ? "Herramientas de Cargas" : "Herramientas de Modelo"}
        herramientas={herramientas}
        nav={{ titulo: "Navegador", contenido: cargas ? <NavCargas caso={casoValido} setCaso={setCaso} /> : <NavModelo /> }}
        vista={
          <>
            {vista}
            {eligiendo && (
              <span className="chip aviso-herr" data-acento="true" role="status">
                {eligiendo === "copiar" ? "Copiar a otras plantas: elija las vigas, losas, paños, apoyos o cargas" : "Borrar: elija lo que quiere borrar"} (clic o ventana; con Ctrl+clic, varios e Intro). Esc cancela.
                {paraAccion(eligiendo).length > 0 && <strong className="font-semibold"> {paraAccion(eligiendo).length} elegidos.</strong>}
              </span>
            )}
          </>
        }
        props={{ titulo: "Propiedades", contenido: elegidos.length > 1 ? <ListaElegidos /> : seleccion ? <Inspector id={seleccion} /> : <ResumenPlanta /> }}
        dock={dock}
      />
      {dialogo === "borrar" && enTablas.length > 0 && <DialogoBorrar ids={enTablas} onCerrar={cerrarDialogo} />}
      {dialogo === "copiar" && copiables.length > 0 && <DialogoCopiar ids={copiables} onCerrar={cerrarDialogo} />}
      {dialogo === "renumerar" && ed && <DialogoRenumerar onCerrar={() => setDialogo(null)} />}
    </>
  );
}

// ─── Navegador ──────────────────────────────────────────────────────────────────────────────────

function Proyecto() {
  const { proyecto } = useVisor();
  const e = proyecto.estado!;
  const ed = proyecto.edicion;
  return (
    <Seccion titulo="Proyecto" valor={e.huella.slice(0, 12)}>
      {ed ? (
        <DatosProyecto />
      ) : (
        <div className="px-3.5 py-2">
          <div className="text-[13px] font-semibold">{e.nombre ?? "Sin nombre"}</div>
          {e.descripcion && <p className="mt-1 text-[12px] leading-snug text-text-secondary">{e.descripcion}</p>}
        </div>
      )}
      {!e.compila && <p className="nota text-state-fail">El modelo no compila: se dibuja con sus diagnósticos. {ed ? "Corríjalo en las tablas (los errores, en Diagnósticos, abajo)." : "Corríjalo en el proyecto.json."}</p>}
      {proyecto.fase === "error" && e.compila && <p className="nota text-state-fail">El cálculo falló: {proyecto.errores.map((d) => d.mensaje).join(" ")}</p>}
    </Seccion>
  );
}

/** Los objetos por tipo; desplegando un tipo, los de la planta activa (o todos, si no van por plantas). */
function Objetos({ tablas }: { tablas: NombreTabla[] }) {
  const { proyecto, planta, elegidos, setSeleccion, setElegidos } = useVisor();
  const e = proyecto.estado!;
  const ed = proyecto.edicion;
  const [abiertos, setAbiertos] = useState<Set<NombreTabla>>(() => new Set());
  const m = ed?.proyecto.modelo;
  const porTabla = useMemo(() => {
    if (!m) return null;
    const ctx = contexto(m);
    return tablas.map((t) => {
      const def = DEF_TABLAS[t];
      const todos = objetosTabla(m, t);
      const aqui = todos.filter((o) => {
        const ps = def.plantas(o, ctx);
        return ps === null || (planta !== null && ps.includes(planta));
      });
      return { t, total: todos.length, aqui };
    });
  }, [m, tablas, planta]);

  if (!porTabla)
    return e.resumen ? (
      <Seccion titulo="Objetos">
        {Object.entries(e.resumen.objetos).map(([k, n]) => (
          <Fila key={k} k={k} v={n} />
        ))}
      </Seccion>
    ) : null;

  return (
    <Seccion titulo="Objetos" valor={planta ? `en ${planta}` : undefined}>
      {porTabla.map(({ t, total, aqui }) => {
        const abierto = abiertos.has(t);
        return (
          <div key={t}>
            <button
              type="button"
              className="arbol-fila"
              aria-expanded={abierto}
              onClick={() =>
                setAbiertos((s) => {
                  const n = new Set(s);
                  if (abierto) n.delete(t);
                  else n.add(t);
                  return n;
                })
              }
            >
              <span className="w-3 text-text-disabled" aria-hidden="true">
                {abierto ? "▾" : "▸"}
              </span>
              {DEF_TABLAS[t].titulo}
              <span className="n">{aqui.length === total ? total : `${aqui.length} de ${total}`}</span>
            </button>
            {abierto &&
              aqui.slice(0, 300).map((o) => (
                <button key={o.id} type="button" className="arbol-fila sub" data-on={elegidos.includes(o.id)} onClick={(x) => (x.ctrlKey || x.metaKey ? setElegidos(elegidos.includes(o.id) ? elegidos.filter((y) => y !== o.id) : [...elegidos, o.id]) : setSeleccion(o.id))}>
                  <span className="truncate">{o.id}</span>
                  {"seccion" in o && typeof o.seccion === "string" && <span className="n">{o.seccion}</span>}
                  {"caso" in o && typeof o.caso === "string" && <span className="n">{o.caso}</span>}
                </button>
              ))}
            {abierto && aqui.length > 300 && <p className="nota">… y {aqui.length - 300} más: búsquelos con Ctrl+K o en su tabla.</p>}
          </div>
        );
      })}
    </Seccion>
  );
}

function NavModelo() {
  return (
    <>
      <Proyecto />
      <NavVistas />
      <Objetos tablas={["pilares", "vigas", "forjados", "muros", "apoyos", "apoyosLineales", "ejes"]} />
    </>
  );
}

/** Las cargas del caso en un 3D, sobre el modelo (también en sólido): sólo necesitan el modelo físico. */
function TresDCargas({ caso, escala }: { caso: string; escala: number }) {
  const { proyecto } = useVisor();
  const r = usePedido(proyecto.cliente, { tipo: "cargas3d", caso, escala });
  const aviso = proyecto.desactualizado ? (
    <Aviso tono="warn">{proyecto.edicion?.pendiente ? "Compilando la versión editada…" : "El fichero cambió: abriendo la versión nueva…"}</Aviso>
  ) : r.diagnosticos ? (
    <Aviso tono="fail">{r.diagnosticos.map((d) => d.mensaje).join(" ")}</Aviso>
  ) : null;
  return <Fuente3DModelo cargas={{ datos: r.datos, aviso, cargando: r.cargando }} />;
}

function NavCargas({ caso, setCaso }: { caso: string; setCaso: (c: string) => void }) {
  const { proyecto } = useVisor();
  const e = proyecto.estado!;
  return (
    <>
      <Proyecto />
      <Seccion titulo="Casos" valor={e.casos.length}>
        {e.casos.map((c) => (
          <button key={c.id} type="button" className="arbol-fila" data-on={c.id === caso} onClick={() => setCaso(c.id)}>
            <span className="mono">{c.id}</span>
            <span className="truncate text-text-secondary">{c.nombre ?? ""}</span>
            <span className="n">
              {c.accion ?? "sin acción"}
              {c.pesoPropio ? " · pp" : ""}
            </span>
          </button>
        ))}
      </Seccion>
      <Objetos tablas={["cargas"]} />
      <NavVistas />
    </>
  );
}

/** Nombre y descripción del proyecto, editables (no entran en la huella). */
function DatosProyecto() {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion!;
  const p = ed.proyecto;
  const [nombre, setNombre] = useState<string | null>(null);
  const [descripcion, setDescripcion] = useState<string | null>(null);
  const escribir = () => {
    const cambio: { nombre?: string; descripcion?: string } = {};
    if (nombre !== null && nombre !== (p.nombre ?? "")) cambio.nombre = nombre.trim();
    if (descripcion !== null && descripcion !== (p.descripcion ?? "")) cambio.descripcion = descripcion.trim();
    if (Object.keys(cambio).length) ed.editar({ op: "datos", ...cambio }, "Datos del proyecto");
    setNombre(null);
    setDescripcion(null);
  };
  return (
    <div className="flex flex-col gap-1.5 px-3.5 py-2">
      <input className="sel w-full" style={{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 600 }} aria-label="Nombre del proyecto" placeholder="Nombre del proyecto" value={nombre ?? p.nombre ?? ""} onChange={(x) => setNombre(x.target.value)} onBlur={escribir} onKeyDown={(x) => x.key === "Enter" && escribir()} />
      <textarea className="sel w-full" style={{ height: 52, padding: 6, fontFamily: "var(--font-sans)", fontSize: 12, resize: "vertical" }} aria-label="Descripción del proyecto" placeholder="Descripción" value={descripcion ?? p.descripcion ?? ""} onChange={(x) => setDescripcion(x.target.value)} onBlur={escribir} />
    </div>
  );
}

// ─── Propiedades con varios elegidos ────────────────────────────────────────────────────────────

/** Lo elegido, por tipo; un clic deja uno solo (el del inspector). */
function ListaElegidos() {
  const { proyecto, elegidos, setSeleccion, setElegidos } = useVisor();
  const ed = proyecto.edicion;
  const porTipo = new Map<string, string[]>();
  for (const id of elegidos) {
    const t = ed ? tablaDe(ed.proyecto.modelo, id) : null;
    const nombre = t ? DEF_TABLAS[t].titulo : "Otros";
    porTipo.set(nombre, [...(porTipo.get(nombre) ?? []), id]);
  }
  const orden = [...TABLAS.map((t) => DEF_TABLAS[t].titulo), "Otros"].filter((t) => porTipo.has(t));
  return (
    <>
      <p className="nota">
        {elegidos.length} objetos elegidos. Un clic en uno lo deja solo; Ctrl+clic en el dibujo añade o quita; Esc suelta todo.
      </p>
      {orden.map((t) => (
        <Seccion key={t} titulo={t} valor={porTipo.get(t)!.length}>
          {porTipo.get(t)!.map((id) => (
            <button key={id} type="button" className="arbol-fila sub" onClick={() => setSeleccion(id)}>
              <span className="truncate mono">{id}</span>
            </button>
          ))}
        </Seccion>
      ))}
      <div className="px-3.5 py-2">
        <button type="button" className="btn" onClick={() => setElegidos([])}>
          Soltar todo
        </button>
      </div>
    </>
  );
}

// ─── Propiedades sin nada elegido: la planta ────────────────────────────────────────────────────

function ResumenPlanta() {
  const { proyecto, planta } = useVisor();
  const e = proyecto.estado!;
  const r = e.resumen?.plantas.find((p) => p.id === planta) ?? null;
  return (
    <>
      <p className="nota">Nada elegido: un clic en el dibujo, en el navegador o en una tabla elige un objeto.</p>
      {r && (
        <Seccion titulo={`Planta ${r.id}`} valor={`${cota(r.cota)} m`}>
          <Fila k="Altura" v={r.altura === null ? "—" : `${fmt(r.altura, 2)} m`} />
          <Fila k="Diafragma" v={r.diafragma === "rigido" ? "rígido" : "ninguno"} />
          {r.pilares && <Fila k="Pilares (cabeza aquí)" v={Object.entries(r.pilares).map(([s, n]) => `${n}×${s}`).join(" · ")} />}
          {r.vigas && <Fila k="Vigas" v={`${r.vigas.n} · ${fmt(r.vigas.m, 1)} m`} />}
          {r.muros && <Fila k="Muros" v={`${r.muros.n} · ${fmt(r.muros.m, 1)} m`} />}
          {r.losas?.map((l) => <Fila key={l.id} k={`Losa ${l.id}`} v={`${fmt(l.m2, 1)} m² · ${fmt(l.espesor, 2)} m · ${l.tipo}`} />)}
          {r.panos?.map((l) => <Fila key={l.id} k={`Paño ${l.id}`} v={`${fmt(l.m2, 1)} m² · ${fmt(l.direccion, 0)}° · ${fmt(l.intereje, 2)} m`} />)}
          <table className="tb mt-1">
            <thead>
              <tr>
                <th>Caso</th>
                <th>Vertical kN</th>
                <th>Horizontal kN</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.cargas).map(([c, v]) => (
                <tr key={c}>
                  <td>{c}</td>
                  <td>{fmt(v, 1)}</td>
                  <td>{r.horizontales?.[c] ? `${fmt(r.horizontales[c]![0], 1)}; ${fmt(r.horizontales[c]![1], 1)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="nota">Lo que recibe la planta, con el peso propio (−ΣFz de sus cargas, de `fem resumen`).</p>
        </Seccion>
      )}
      <Equilibrio estado={e} />
      {e.hipotesis.length > 0 && (
        <Seccion titulo="Hipótesis del compilador" valor={e.hipotesis.length}>
          <ol className="m-0 list-decimal py-1 pl-8 pr-3.5 text-[12px] leading-snug text-text-secondary">
            {e.hipotesis.map((h, i) => (
              <li key={i} className="py-0.5">
                {h}
              </li>
            ))}
          </ol>
        </Seccion>
      )}
    </>
  );
}

// ─── Panel inferior: combinaciones ──────────────────────────────────────────────────────────────

function ListaCombinaciones() {
  const { proyecto } = useVisor();
  const e = proyecto.estado!;
  if (!e.combinaciones.length) return <p className="nota">Sin combinaciones: los casos no llevan su acción (tipo, ψ y familia), así que no hay combinaciones CTE/NCSE. Se pueden ver los casos sueltos.</p>;
  return (
    <table className="tb">
      <thead>
        <tr>
          <th>Situación</th>
          <th>Nombre</th>
          <th style={{ textAlign: "left" }}>Expresión</th>
        </tr>
      </thead>
      <tbody>
        {e.combinaciones.map((c) => (
          <tr key={`${c.situacion}·${c.nombre}`}>
            <td>{c.situacion}</td>
            <td>{c.nombre}</td>
            <td className="txt" style={{ textAlign: "left" }}>
              {c.etiqueta}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
