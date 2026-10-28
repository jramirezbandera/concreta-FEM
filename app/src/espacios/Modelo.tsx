/**
 * Espacios Modelo y Cargas (`docs/fem3d/interfaz.md` §4 y §13): lo que era la pantalla Modelo de V1
 * y V2a, repartido en la disposición común.
 *
 * - Barra: en Modelo, las herramientas de dibujo (V2c-1 y V2c-2, `docs/fem3d/dibujo.md`: Ejes, Pilar,
 *   Viga, Forjado, Hueco, Muro, Apoyo y Apoyo lineal se dibujan en la planta, con su plantilla en
 *   Propiedades; `dibujo/controlador.ts`; Forjado y Hueco, con sus zunchos), Ábacos, las de editar con el ratón (V2c-3:
 *   Mover, Copiar, Girar y Simetría, sobre lo elegido), A plantas (copiar a otras plantas) y Borrar
 *   (lo elegido o, sin nada que les sirva, lo que se elija después), las tablas de datos y Planta o
 *   3D; en Cargas, el caso activo, Casos, las herramientas de las cargas (Puntual, Lineal, Superficie,
 *   En barra y Empuje, en el caso activo), las de editar y A plantas (que en Cargas, como Supr y los
 *   pinzamientos, sólo cogen las cargas: el modelo se edita en Modelo) y Combinaciones. Sin proyecto
 *   editable, sólo lo que mira.
 * - Navegador: el proyecto, las plantillas DXF (V2c-4, `docs/fem3d/dibujo.md` §10: «Plantilla DXF» en
 *   la barra de Modelo; se ven detrás de las plantas de Modelo y Cargas y se engancha a ellas) y los
 *   objetos de la planta activa (en Cargas, los casos y las cargas).
 * - Vistas (I2): 1, 2 o 4, de planta (modelo, diagnósticos o malla; en Cargas, las del caso activo),
 *   alzado o 3D (`vistas/Zona.tsx`). En Cargas, el alzado y el 3D también dibujan las del caso activo
 *   (`agente/render/cargas.ts` y `visor/cargas3d.ts`), a la escala de su cabecera. La barra cambia el
 *   tipo de la vista activa y la disposición.
 * - Propiedades: lo elegido (con varios, la lista por tipo) o, sin nada, la planta (resumen, cargas
 *   por caso, equilibrio, hipótesis). En Cargas (`pantallas/CargasPieza.tsx`), una pieza da sus cargas
 *   por caso y añadirle una en el caso activo; una carga, su formulario y la pieza que nombra; sin
 *   nada, el caso activo en la planta.
 * - Panel inferior: las tablas del editor, los diagnósticos y las combinaciones.
 */
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight, ListOrdered, MousePointer2, Trash2 } from "lucide-react";
import { DEF_TABLAS, TABLAS, contexto, objetosTabla, type NombreTabla } from "../../../src/editor/tablas.ts";
import { aplicar, type Operacion } from "../../../src/editor/operaciones.ts";
import { indiceIds } from "../../../src/editor/referencias.ts";
import { Chip, Desplegable, Disposicion, Herramienta, Hueco, Campo, Separador, type Pestana } from "../armazon/Disposicion.tsx";
import { IcAPlantas, IcApoyo, IcApoyoLineal, IcCarga, IcCasos, IcCombinaciones, IcEjes, IcEmpuje, IcEnBarra, IcAbacos, IcHueco, IcLineal, IcLosa, IcMateriales, IcMuro, IcPilar, IcPlanta, IcPlantas, IcPuntual, IcSecciones, IcSuperficie, IcViga, type Icono } from "../armazon/iconos.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { Aviso, Cabecera, Equilibrio, Fila, ListaDiagnosticos, Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { DialogoAbacos, DialogoBorrar, DialogoCopiar, DialogoRenumerar } from "../editor/Dialogos.tsx";
import { FormularioVarios, tablaDe } from "../editor/Formulario.tsx";
import { PanelTablas } from "../editor/Hoja.tsx";
import { cota, fmt } from "../fmt.ts";
import { Inspector } from "../pantallas/Inspector.tsx";
import { PropiedadesCargas, ResumenCaso, SobrePieza } from "../pantallas/CargasPieza.tsx";
import { tipoPieza } from "../../../src/editor/cargasPieza.ts";
import { NavVistas } from "../armazon/VistasGuardadas.tsx";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { useVistas, type DibujoPlanta, type EstadoVista } from "../vistas/estado.ts";
import { Fuente3DModelo, FuenteEscena, planoAlzado, plantaVista, repintarVistas, ZonaVistas } from "../vistas/Zona.tsx";
import { usePedido } from "../sesion/usePedido.ts";
import type { NombreHerramienta, Plantillas } from "../../../src/editor/dibujo/herramientas.ts";
import { ControladorDibujo } from "../dibujo/controlador.ts";
import { CampoTeclado, IcCopiar, IcGirar, IcMover, IcPlantillaDxf, IcSimetria, PlantillaDibujo, plantillasEfectivas } from "../dibujo/Plantilla.tsx";
import type { NombrePlantillaDxf } from "../../../src/editor/dibujo/herramientaPlantilla.ts";
import { nuevaPlantilla } from "../../../src/editor/dibujo/plantilla.ts";
import { importarDxf, nombreLibre, usePlantillasDxf } from "../plantilla/plantillas.ts";
import { NavPlantillas } from "../plantilla/NavPlantillas.tsx";
import { abrirGestor } from "../editor/referencia.tsx";

/** Lo que se puede copiar a otras plantas (los pilares ya van de una planta a otra). */
const COPIABLES: ReadonlySet<NombreTabla> = new Set(["vigas", "forjados", "apoyos", "apoyosLineales", "cargas"]);
/** El icono de cada tipo en el navegador (los de la barra de herramientas). */
const ICONO_TABLA: Partial<Record<NombreTabla, Icono>> = { pilares: IcPilar, vigas: IcViga, forjados: IcLosa, muros: IcMuro, apoyos: IcApoyo, apoyosLineales: IcApoyoLineal, ejes: IcEjes, cargas: IcCarga };
/** La escala de las cargas en el alzado y el 3D (por la que se multiplica la automática). */
const ESCALAS = ["0.25", "0.5", "1", "2", "4"] as const;
type Escala = (typeof ESCALAS)[number];
const IcBorrar: Icono = ({ size }) => <Trash2 size={size} strokeWidth={1.5} aria-hidden="true" />;
const IcRenumerar: Icono = ({ size }) => <ListOrdered size={size} strokeWidth={1.5} aria-hidden="true" />;

let ultimoPedido = 0;

/** Una tecla en un campo, en una tabla o en un diálogo no es de la herramienta. */
const enCampo = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || !!(t as HTMLElement | null)?.closest?.("[role=grid], [role=dialog]");

/** Un caso en el selector de la barra: su id, su nombre y si lleva el peso propio. */
const textoCaso = (c: { id: string; nombre?: string; pesoPropio?: boolean } | undefined) => (c ? `${c.id}${c.nombre ? ` · ${c.nombre}` : ""}${c.pesoPropio ? " · con peso propio" : ""}` : undefined);

export function EspacioModelo({ espacio }: { espacio: "modelo" | "cargas" }) {
  const { proyecto, seleccion, setSeleccion, elegidos, tablaPedida, planta } = useVisor();
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
  const [dialogo, setDialogo] = useState<"borrar" | "copiar" | "renumerar" | "abacos" | null>(null);

  // V2c: la herramienta activa (Elegir por defecto), fuera de React; aquí, lo que cambia la barra y Propiedades
  const [ctrl] = useState(() => new ControladorDibujo());
  const foto = useSyncExternalStore(ctrl.suscribir, ctrl.instantanea);
  const [plantillasDibujo, setPlantillasDibujo] = useState<Plantillas>({ pilar: {}, viga: {} });
  const modeloEd = ed?.proyecto.modelo ?? null;
  const casoValido = e.casos.some((c) => c.id === caso) ? caso! : (e.casos[0]?.id ?? "");
  // Las cargas que se dibujan van al caso activo
  const casoDibujo = cargas ? casoValido : undefined;
  // V2c-4: las plantillas DXF, leídas en su worker; su índice por planta va al controlador
  const origen = proyecto.fuente?.tipo === "origen" ? proyecto.fuente.origen : null;
  const listaDxf = ed?.proyecto.plantillas;
  const dxf = usePlantillasDxf(listaDxf, origen);
  const [dxfActiva, setDxfActiva] = useState<string | null>(null);
  const [errorDxf, setErrorDxf] = useState<string | null>(null);
  const ficheroDxf = useRef<HTMLInputElement>(null);
  const plantillas = useMemo(() => ({ ...plantillasEfectivas(modeloEd, plantillasDibujo, casoDibujo), dxf: { nombre: dxfActiva ?? undefined, lista: listaDxf } }), [modeloEd, plantillasDibujo, casoDibujo, dxfActiva, listaDxf]);
  const indiceDxf = useMemo(() => (pl: string) => dxf.porPlanta(pl).indice(), [dxf.porPlanta]);
  const editarDibujo = (o: Operacion, etiqueta: string): string | null => {
    if (!ed) return "No hay ningún proyecto que editar.";
    const a = ed.editar(o, etiqueta);
    return a.ok ? null : a.errores.map((x) => x.mensaje).join(" ");
  };
  ctrl.aplicar = (h) => editarDibujo(h.operacion, h.etiqueta);
  ctrl.alSalir = () => ctrl.ponerHerramienta("elegir");
  ctrl.repintar = repintarVistas;
  useEffect(() => ctrl.ponerModelo(modeloEd), [ctrl, modeloEd]);
  useEffect(() => ctrl.ponerPlantillas(plantillas), [ctrl, plantillas]);
  // En Cargas, las herramientas de editar (y los pinzamientos) sólo cogen cargas: el modelo, en Modelo
  const elegidosHerr = useMemo(() => (cargas && modeloEd ? elegidos.filter((id) => tablaDe(modeloEd, id) === "cargas") : elegidos), [cargas, modeloEd, elegidos]);
  useEffect(() => ctrl.ponerElegidos(elegidosHerr), [ctrl, elegidosHerr]);
  useEffect(() => ctrl.ponerPlantillasDxf(indiceDxf), [ctrl, indiceDxf]);
  /** Lee un DXF elegido y lo pone de plantilla de la planta activa. */
  const importarPlantilla = async (f: File) => {
    setErrorDxf(null);
    if (!ed) return;
    try {
      const { dibujo, sha256 } = await importarDxf(f, origen);
      const lista = ed.proyecto.plantillas ?? [];
      const t = nuevaPlantilla(dibujo, { nombre: nombreLibre(lista, f.name.replace(/\.dxf$/i, "")), fichero: f.name, sha256, planta: planta ?? ed.proyecto.modelo.plantas[0]?.id ?? "" });
      const a = ed.editar({ op: "plantillas", plantillas: [...lista, t] }, `Plantilla DXF «${t.nombre}»`);
      if (!a.ok) setErrorDxf(a.errores.map((x) => x.mensaje).join(" "));
      else if (!dibujo.extension) setErrorDxf(`${f.name} no tiene nada que dibujar en el espacio modelo.`);
    } catch (e) {
      setErrorDxf(e instanceof Error ? e.message : String(e));
    }
  };
  const herramientaDxf = (h: NombrePlantillaDxf, nombre: string) => {
    setDxfActiva(nombre);
    ctrl.ponerHerramienta(h);
    if (!pan.props) pan.poner({ props: true });
  };
  const dibujando = foto.herramienta !== "elegir";
  const elegirHerramienta = (h: NombreHerramienta) => {
    const n = foto.herramienta === h ? "elegir" : h;
    ctrl.ponerHerramienta(n);
    if (n !== "elegir") {
      setEligiendo(null);
      if (!pan.props) pan.poner({ props: true });
    }
  };
  // CT2: con una cota elegida para estirar, Esc la deja, ← y → cambian de lado y un número abre el campo
  const estirando = !!foto.estirado;
  useEffect(() => {
    if (!estirando || dibujando) return;
    const tecla = (x: KeyboardEvent) => {
      if (x.ctrlKey || x.metaKey || x.altKey || enCampo(x.target)) return;
      if (x.key === "Escape") ctrl.anularEstirado();
      else if (x.key === "ArrowLeft" || x.key === "ArrowRight") {
        if (ctrl.cambiarLado()) x.preventDefault();
      } else if (/^[0-9.,]$/.test(x.key)) {
        x.preventDefault();
        ctrl.abrirCampo(x.key);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ctrl, estirando, dibujando]);
  // V2c-3: con un vértice cogido, Esc lo suelta, F8 el ortogonal, F3 los enganches al DXF y lo que se teclea abre el campo
  const conAsa = !!foto.asa;
  useEffect(() => {
    if (!conAsa || dibujando) return;
    const tecla = (x: KeyboardEvent) => {
      if (x.ctrlKey || x.metaKey || x.altKey || enCampo(x.target)) return;
      if (x.key === "Escape") {
        // Suelta el vértice; lo elegido se queda
        x.preventDefault();
        ctrl.soltarAsa();
      } else if (x.key === "F8") {
        x.preventDefault();
        ctrl.alternarOrto();
      } else if (x.key === "F3") {
        x.preventDefault();
        ctrl.alternarPlantilla();
      } else if (/^[0-9@.,+-]$/.test(x.key)) {
        x.preventDefault();
        ctrl.abrirCampo(x.key);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ctrl, conAsa, dibujando]);
  // CT3: con un pilar elegido, Tab elige una de sus cotas, un número abre su campo y Esc la deja
  const conPilar = !!foto.pilar;
  useEffect(() => {
    if (!conPilar || dibujando || estirando || conAsa) return;
    const tecla = (x: KeyboardEvent) => {
      if (x.ctrlKey || x.metaKey || x.altKey || enCampo(x.target)) return;
      if (x.key === "Tab") {
        if (ctrl.tab(x.shiftKey)) x.preventDefault();
      } else if (x.key === "Escape") ctrl.soltarPilar();
      else if (/^[0-9.,]$/.test(x.key)) {
        x.preventDefault();
        ctrl.abrirCampo(x.key);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ctrl, conPilar, dibujando, estirando, conAsa]);
  // Las teclas de una herramienta: F8, F3, Esc, Intro, Retroceso y lo que abre el campo de teclado
  useEffect(() => {
    if (!dibujando) return;
    const tecla = (x: KeyboardEvent) => {
      if (x.ctrlKey || x.metaKey || x.altKey || enCampo(x.target)) return;
      if (x.key === "F8") {
        x.preventDefault();
        ctrl.alternarOrto();
      } else if (x.key === "F3") {
        x.preventDefault();
        ctrl.alternarPlantilla();
      } else if (x.key === "Escape") {
        // Con un punto en curso de Mover, Copiar, Girar o Simetría, Esc lo anula y lo elegido se queda
        if (ctrl.editando) x.preventDefault();
        ctrl.anular();
      } else if (x.key === "Tab") {
        if (ctrl.tab(x.shiftKey)) x.preventDefault();
      } else if (x.key === "Enter") ctrl.intro();
      else if (x.key === "Backspace") {
        x.preventDefault();
        ctrl.retroceso();
      } else if (/^[0-9@.,+-]$/.test(x.key)) {
        x.preventDefault();
        ctrl.abrirCampo(x.key);
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ctrl, dibujando]);

  // Lo elegido que está en el proyecto (un eje propuesto no lo está; en Cargas, sólo las cargas) y lo que de ello se copia
  const enTablas = ed ? elegidosHerr.filter((id) => tablaDe(ed.proyecto.modelo, id)) : [];
  const copiables = ed ? enTablas.filter((id) => COPIABLES.has(tablaDe(ed.proyecto.modelo, id)!)) : [];

  // Copiar y Borrar sin nada que les sirva elegido esperan a que se elija: un clic (o una ventana)
  // abre su diálogo con lo elegido; con Ctrl se van sumando, e Intro o la herramienta lo abren.
  const [eligiendo, setEligiendo] = useState<"copiar" | "borrar" | null>(null);
  const alEmpezar = useRef(elegidos);
  const conCtrl = useRef(false);
  const paraAccion = (a: "copiar" | "borrar") => (a === "copiar" ? copiables : enTablas);
  const usar = (a: "copiar" | "borrar") => {
    ctrl.ponerHerramienta("elegir");
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
  // Supr borra lo elegido: si nada más lo usa, en el acto (se deshace con Ctrl+Z); si no, el diálogo
  // de Borrar dice qué lo usa. La hoja tiene su Supr (vaciar celdas) y un diálogo abierto, el suyo.
  useEffect(() => {
    if (dibujando || estirando || conAsa || dialogo || !ed || !enTablas.length) return;
    const tecla = (x: KeyboardEvent) => {
      if (x.key !== "Delete" || x.ctrlKey || x.metaKey || x.altKey || x.shiftKey || enCampo(x.target)) return;
      x.preventDefault();
      if (!aplicar(ed.proyecto, { op: "borrar", ids: enTablas }).ok) return setDialogo("borrar");
      const r = ed.editar({ op: "borrar", ids: enTablas }, `Borrar ${enTablas.length > 3 ? `${enTablas.length} objetos` : enTablas.join(", ")}`);
      if (r.ok && seleccion && !indiceIds(r.proyecto.modelo).has(seleccion)) setSeleccion(null);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

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
          <Herramienta icono={IcCasos} nombre="Casos" onClick={() => abrirGestor({ coleccion: "casos" })} title="El gestor de casos: los típicos del CTE con un clic, las hipótesis típicas de una vez, y la tabla desde él (GE2)" />
          <Separador />
          <Herramienta icono={IcPuntual} nombre="Puntual" activa={foto.herramienta === "puntual"} onClick={() => elegirHerramienta("puntual")} title="Dibujar cargas puntuales en el caso activo: un clic donde va (F y M en Propiedades). Esc vuelve a Elegir" />
          <Herramienta icono={IcLineal} nombre="Lineal" activa={foto.herramienta === "lineal"} onClick={() => elegirHerramienta("lineal")} title="Dibujar cargas lineales en el caso activo: clic a clic, doble clic o Intro termina. Esc vuelve a Elegir" />
          <Herramienta icono={IcSuperficie} nombre="Superficie" activa={foto.herramienta === "superficie"} onClick={() => elegirHerramienta("superficie")} title="Dibujar cargas de superficie en el caso activo: un clic en una losa o un paño, o una zona (Propiedades). Esc vuelve a Elegir" />
          <Herramienta icono={IcEnBarra} nombre="En barra" activa={foto.herramienta === "barra"} onClick={() => elegirHerramienta("barra")} title="Dibujar cargas en vigas y pilares en el caso activo: un clic en la pieza, o dos en un tramo de viga (Propiedades). Esc vuelve a Elegir" />
          <Herramienta icono={IcEmpuje} nombre="Empuje" activa={foto.herramienta === "empuje"} onClick={() => elegirHerramienta("empuje")} title="Dibujar empujes en el caso activo: un clic en un muro, del lado del terreno. Esc vuelve a Elegir" />
          <Separador />
          <Herramienta icono={IcMover} nombre="Mover" activa={foto.herramienta === "mover"} onClick={() => elegirHerramienta("mover")} title="Mover las cargas elegidas: punto base y destino. Esc vuelve a Elegir" />
          <Herramienta icono={IcCopiar} nombre="Copiar" activa={foto.herramienta === "copiar"} onClick={() => elegirHerramienta("copiar")} title="Copiar las cargas elegidas: punto base y un destino por copia, en su planta o en las de Propiedades. Esc vuelve a Elegir" />
          <Herramienta icono={IcGirar} nombre="Girar" activa={foto.herramienta === "girar"} onClick={() => elegirHerramienta("girar")} title="Girar las cargas elegidas: el centro y el ángulo (un clic, o los grados). Esc vuelve a Elegir" />
          <Herramienta icono={IcSimetria} nombre="Simetría" activa={foto.herramienta === "simetria"} onClick={() => elegirHerramienta("simetria")} title="La simetría de las cargas elegidas por un eje de dos puntos (conservando lo original, en Propiedades). Esc vuelve a Elegir" />
          <Herramienta icono={IcAPlantas} nombre="A plantas" activa={eligiendo === "copiar"} onClick={() => usar("copiar")} title={copiables.length ? `Copiar ${copiables.length > 1 ? `${copiables.length} cargas` : copiables[0]} a otras plantas` : eligiendo === "copiar" ? "Dejar de elegir (Esc)" : "Copiar cargas a otras plantas: elíjalas después"} />
        </>
      )}
      <Separador />
      <Herramienta icono={IcCombinaciones} nombre="Combinaciones" onClick={() => pan.abrirPestana("combinaciones")} title="Las combinaciones que salen de los casos" />
      <Hueco />
      <BarraVistas />
    </>
  ) : (
    <>
      {ed && (
        <>
          {/* En el orden en que se mete un edificio: plantas y datos, el plano y los ejes, lo vertical, las vigas, los forjados, los apoyos; después, editar */}
          <Herramienta icono={IcPlantas} nombre="Plantas" onClick={() => abrirGestor({ coleccion: "plantas", ...(planta ? { planta } : {}) })} title="Añadir plantas encima o debajo de una, viendo cómo quedan las cotas, y la tabla desde él (GE3)" />
          <Herramienta icono={IcMateriales} nombre="Materiales" onClick={() => abrirGestor({ coleccion: "materiales" })} title="El gestor de materiales: los típicos con un clic, y la tabla desde él (GE)" />
          <Herramienta icono={IcSecciones} nombre="Secciones" onClick={() => abrirGestor({ coleccion: "secciones" })} title="El gestor de secciones: nueva por tipo (hormigón, perfil de catálogo o general), y la tabla desde él (GE)" />
          <Separador />
          <Herramienta icono={IcPlantillaDxf} nombre="Plantilla DXF" onClick={() => ficheroDxf.current?.click()} title="Un plano DXF del arquitecto en gris detrás de la planta activa, para calcar con sus enganches (sus unidades, capas y colocación, en el navegador)" />
          <input ref={ficheroDxf} type="file" accept=".dxf" hidden aria-label="Fichero DXF de la plantilla" onChange={(x) => {
            const f = x.target.files?.[0];
            x.target.value = "";
            if (f) void importarPlantilla(f);
          }} />
          <Herramienta icono={IcEjes} nombre="Ejes" activa={foto.herramienta === "ejes"} onClick={() => elegirHerramienta("ejes")} title="Dibujar ejes de replanteo: dos clics por eje (o «Proponer ejes» en Propiedades). Esc vuelve a Elegir" />
          <Separador />
          <Herramienta icono={IcPilar} nombre="Pilar" activa={foto.herramienta === "pilar"} onClick={() => elegirHerramienta("pilar")} title="Dibujar pilares: un clic en su punto fijo, o una ventana para uno en cada cruce de ejes. Esc vuelve a Elegir" />
          <Herramienta icono={IcMuro} nombre="Muro" activa={foto.herramienta === "muro"} onClick={() => elegirHerramienta("muro")} title="Dibujar muros: clic a clic; doble clic o Intro termina, un clic en el primero lo cierra. Esc vuelve a Elegir" />
          <Herramienta icono={IcViga} nombre="Viga" activa={foto.herramienta === "viga"} onClick={() => elegirHerramienta("viga")} title="Dibujar vigas: clic a clic, doble clic o Intro termina. Esc vuelve a Elegir" />
          <Separador />
          <Herramienta icono={IcLosa} nombre="Forjado" activa={foto.herramienta === "forjado"} onClick={() => elegirHerramienta("forjado")} title="Dibujar forjados (maciza, reticular o unidireccional, en Propiedades): un clic dentro de un recuadro cerrado, o un polígono. Esc vuelve a Elegir" />
          <Herramienta icono={IcHueco} nombre="Hueco" activa={foto.herramienta === "hueco"} onClick={() => elegirHerramienta("hueco")} title="Dibujar huecos: en un forjado, un rectángulo o un polígono; en un muro, dos clics por su eje. Esc vuelve a Elegir" />
          <Herramienta icono={IcAbacos} nombre="Ábacos" onClick={() => setDialogo("abacos")} title="Ábacos macizos en los pilares de un forjado reticular, del tamaño que diga" />
          <Separador />
          <Herramienta icono={IcApoyo} nombre="Apoyo" activa={foto.herramienta === "apoyo"} onClick={() => elegirHerramienta("apoyo")} title="Dibujar apoyos: un clic donde va. Esc vuelve a Elegir" />
          <Herramienta icono={IcApoyoLineal} nombre="Apoyo lineal" activa={foto.herramienta === "apoyoLineal"} onClick={() => elegirHerramienta("apoyoLineal")} title="Dibujar apoyos lineales: clic a clic, doble clic o Intro termina. Esc vuelve a Elegir" />
          <Separador />
          <Herramienta icono={IcMover} nombre="Mover" activa={foto.herramienta === "mover"} onClick={() => elegirHerramienta("mover")} title="Mover lo elegido: punto base y destino (con las vigas que acaban en sus pilares). Esc vuelve a Elegir" />
          <Herramienta icono={IcCopiar} nombre="Copiar" activa={foto.herramienta === "copiar"} onClick={() => elegirHerramienta("copiar")} title="Copiar lo elegido: punto base y un destino por copia, en su planta o en las de Propiedades. Esc vuelve a Elegir" />
          <Herramienta icono={IcGirar} nombre="Girar" activa={foto.herramienta === "girar"} onClick={() => elegirHerramienta("girar")} title="Girar lo elegido: el centro y el ángulo (un clic, o los grados). Esc vuelve a Elegir" />
          <Herramienta icono={IcSimetria} nombre="Simetría" activa={foto.herramienta === "simetria"} onClick={() => elegirHerramienta("simetria")} title="La simetría de lo elegido por un eje de dos puntos (conservando lo original, en Propiedades). Esc vuelve a Elegir" />
          <Separador />
          <Herramienta icono={IcAPlantas} nombre="A plantas" activa={eligiendo === "copiar"} onClick={() => usar("copiar")} title={copiables.length ? `Copiar ${copiables.length > 1 ? `${copiables.length} objetos` : copiables[0]} a otras plantas` : eligiendo === "copiar" ? "Dejar de elegir (Esc)" : "Copiar a otras plantas: elija después las vigas, forjados, apoyos o cargas"} />
          <Herramienta icono={IcBorrar} nombre="Borrar" activa={eligiendo === "borrar"} onClick={() => usar("borrar")} title={enTablas.length ? `Borrar ${enTablas.length > 1 ? `${enTablas.length} objetos` : enTablas[0]}` : eligiendo === "borrar" ? "Dejar de elegir (Esc)" : "Borrar: elija después lo que quiere borrar"} />
          <Herramienta icono={IcRenumerar} nombre="Renumerar" onClick={() => setDialogo("renumerar")} title="Ids cortos como en CYPECAD: P1, P2… por filas de arriba abajo y de izquierda a derecha" />
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
  // La escala sólo cambia el alzado y el 3D: va en su cabecera
  const cabeceraEscala = () => (
    <>
      {chipCaso}
      <Desplegable etiqueta="Escala de las cargas" prefijo={<span className="text-text-secondary">Escala</span>} valor={escala} onCambio={setEscala} opciones={ESCALAS.map((x) => ({ id: x, nombre: `×${x.replace(".", ",")}` }))} />
    </>
  );
  const vista = (
    <ZonaVistas
      fuentes={{
        planta: (v) => {
          if (!v.planta) return null;
          const geo = v.plantilla !== false ? dxf.porPlanta(v.planta).geometria : null;
          return <FuenteEscena fuente={{ tipo: "planta", planta: v.planta, vista: cargas ? { vista: "cargas", caso: casoValido } : plantaVista(v, e.calculado) }} dibujo={ed ? ctrl.adaptador(v.planta, { cotas: !cargas && plantaVista(v, e.calculado).vista === "modelo", plantilla: !!geo }) : null} dibujando={dibujando} plantilla={geo} />;
        },
        plantilla: (pl) => !!listaDxf?.some((t) => t.plantas.includes(pl)),
        ...(cargas && casoValido
          ? {
              alzado: (v: EstadoVista) => <FuenteEscena fuente={v.eje ? { tipo: "alzado", plano: planoAlzado(v.eje, v), cargas: { caso: casoValido, escala: Number(escala) } } : null} />,
              tresD: () => <TresDCargas caso={casoValido} escala={Number(escala)} />,
              cabeceraAlzado: cabeceraEscala,
              cabecera3DModelo: cabeceraEscala,
            }
          : {}),
        ...(ed && !cargas ? { dibujarEjes: () => foto.herramienta !== "ejes" && elegirHerramienta("ejes") } : {}),
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
      insignia: e.compilando ? <span className="text-text-secondary">…</span> : errores ? <span className="text-state-fail">{errores} error{errores === 1 ? "" : "es"}</span> : avisos ? <span className="text-state-warn">{avisos} aviso{avisos === 1 ? "" : "s"}</span> : "0",
      contenido: (
        <>
          <p className="nota">Los de <span className="mono">fem validar</span> y <span className="mono">fem calcular</span>. Un clic en un id lo elige.{e.compilando ? " Compilando: de momento, sólo los que no necesitan la compilación." : ""}</p>
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
        nav={{ titulo: "Navegador", contenido: cargas ? <NavCargas caso={casoValido} setCaso={setCaso} /> : <NavModelo plantillas={<NavPlantillas pl={dxf} herramienta={herramientaDxf} error={errorDxf} />} /> }}
        vista={
          <>
            {vista}
            {dibujando && (
              <span className="chip aviso-herr" data-acento="true" role="status">
                {foto.ayuda}
                {foto.error && <strong className="font-semibold text-state-fail"> {foto.error}</strong>}
                {!foto.error && foto.aviso && <span className="text-state-warn"> {foto.aviso}</span>}
              </span>
            )}
            {!dibujando && (foto.asa || foto.estirado || foto.aviso || foto.pilar) && (
              <span className="chip aviso-herr" data-acento="true" role="status">
                {foto.asa ?? foto.estirado ?? foto.aviso ?? foto.pilar}
                {(foto.estirado || foto.asa) && foto.error && <strong className="font-semibold text-state-fail"> {foto.error}</strong>}
              </span>
            )}
            {foto.campo && <CampoTeclado key={foto.campo.n} ctrl={ctrl} campo={foto.campo} />}
            {eligiendo && (
              <span className="chip aviso-herr" data-acento="true" role="status">
                {eligiendo === "copiar" ? "Copiar a otras plantas: elija las vigas, losas, paños, apoyos o cargas" : "Borrar: elija lo que quiere borrar"} (clic o ventana; con Ctrl+clic, varios e Intro). Esc cancela.
                {paraAccion(eligiendo).length > 0 && <strong className="font-semibold"> {paraAccion(eligiendo).length} elegidos.</strong>}
              </span>
            )}
          </>
        }
        props={{
          titulo: "Propiedades",
          contenido:
            dibujando && modeloEd ? (
              <PlantillaDibujo foto={foto} ctrl={ctrl} modelo={modeloEd} planta={planta} plantillas={plantillas} setPlantillas={setPlantillasDibujo} editar={editarDibujo} abrirTabla={(t) => abrirTabla(t)} />
            ) : elegidos.length > 1 ? (
              <ListaElegidos />
            ) : seleccion && cargas && modeloEd && tipoPieza(modeloEd, seleccion) ? (
              <PropiedadesCargas id={seleccion} caso={casoValido} plantillas={plantillas} setPlantillas={setPlantillasDibujo} editar={editarDibujo} />
            ) : seleccion ? (
              <>
                {cargas && modeloEd && <SobrePieza id={seleccion} />}
                <Inspector id={seleccion} />
              </>
            ) : cargas ? (
              <ResumenCaso caso={casoValido} />
            ) : (
              <ResumenPlanta />
            ),
        }}
        dock={dock}
      />
      {dialogo === "borrar" && enTablas.length > 0 && <DialogoBorrar ids={enTablas} onCerrar={cerrarDialogo} />}
      {dialogo === "copiar" && copiables.length > 0 && <DialogoCopiar ids={copiables} onCerrar={cerrarDialogo} />}
      {dialogo === "renumerar" && ed && <DialogoRenumerar onCerrar={() => setDialogo(null)} />}
      {dialogo === "abacos" && ed && <DialogoAbacos onCerrar={() => setDialogo(null)} />}
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
      {e.compilando && <p className="nota">Compilando: los diagnósticos, la malla y el cálculo salen al terminar.</p>}
      {!e.compila && !e.compilando && <p className="nota text-state-fail">El modelo no compila: se dibuja con sus diagnósticos. {ed ? "Corríjalo en las tablas (los errores, en Diagnósticos, abajo)." : "Corríjalo en el proyecto.json."}</p>}
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
        const I = ICONO_TABLA[t];
        return (
          <div key={t} className="arbol-grupo" data-abierto={abierto}>
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
              <ChevronRight size={14} className="giro" aria-hidden="true" />
              {I && (
                <span className="ico">
                  <I size={15} />
                </span>
              )}
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

function NavModelo({ plantillas }: { plantillas: ReactNode }) {
  return (
    <>
      <Proyecto />
      <NavVistas />
      {plantillas}
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
    <div className="flex flex-col gap-0.5 px-2 pb-2">
      <input className="sel en-sitio w-full" style={{ fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 600 }} aria-label="Nombre del proyecto" title={nombre ?? p.nombre ?? undefined} placeholder="Nombre del proyecto" value={nombre ?? p.nombre ?? ""} onChange={(x) => setNombre(x.target.value)} onBlur={escribir} onKeyDown={(x) => x.key === "Enter" && escribir()} />
      <textarea className="sel en-sitio w-full" style={{ height: 56, padding: "5px 6px", fontFamily: "var(--font-sans)", fontSize: 12, lineHeight: 1.45, resize: "vertical" }} aria-label="Descripción del proyecto" placeholder="Descripción" value={descripcion ?? p.descripcion ?? ""} onChange={(x) => setDescripcion(x.target.value)} onBlur={escribir} />
    </div>
  );
}

// ─── Propiedades con varios elegidos ────────────────────────────────────────────────────────────

/** Lo elegido, por tipo; un clic deja uno solo (el del inspector). */
function ListaElegidos() {
  const { proyecto, elegidos, setSeleccion, setElegidos } = useVisor();
  const ed = proyecto.edicion;
  const porTipo = new Map<string, string[]>();
  const tablaDeTipo = new Map<string, NombreTabla>();
  for (const id of elegidos) {
    const t = ed ? tablaDe(ed.proyecto.modelo, id) : null;
    const nombre = t ? DEF_TABLAS[t].titulo : "Otros";
    if (t) tablaDeTipo.set(nombre, t);
    porTipo.set(nombre, [...(porTipo.get(nombre) ?? []), id]);
  }
  const orden = [...TABLAS.map((t) => DEF_TABLAS[t].titulo), "Otros"].filter((t) => porTipo.has(t));
  return (
    <>
      <Cabecera icono={MousePointer2} tipo="Selección" titulo={`${elegidos.length} objetos`} detalle="Un clic en uno lo deja solo; Ctrl+clic en el dibujo añade o quita; Esc suelta todo.">
        <button type="button" className="btn" onClick={() => setElegidos([])}>
          Soltar todo
        </button>
      </Cabecera>
      {orden.map((t) => (
        <Fragment key={t}>
          <Seccion titulo={t} valor={porTipo.get(t)!.length}>
            <div className="fichas ids">
              {porTipo.get(t)!.map((id) => (
                <button key={id} type="button" title={`Dejar sólo ${id}`} onClick={() => setSeleccion(id)}>
                  {id}
                </button>
              ))}
            </div>
          </Seccion>
          {/* Varios de una tabla: lo que tienen en común, editable en todos a la vez */}
          {ed && tablaDeTipo.has(t) && porTipo.get(t)!.length > 1 && <FormularioVarios ids={porTipo.get(t)!} tabla={tablaDeTipo.get(t)!} />}
        </Fragment>
      ))}
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
      <Cabecera
        icono={IcPlanta}
        tipo="Planta · nada elegido"
        titulo={r?.id ?? planta ?? "—"}
        detalle={r ? `Cota ${cota(r.cota)} m · altura ${r.altura === null ? "—" : `${fmt(r.altura, 2)} m`} · diafragma ${r.diafragma === "rigido" ? "rígido" : "ninguno"}` : undefined}
      />
      {r && (
        <Seccion titulo="En la planta">
          {r.pilares && <Fila k="Pilares (cabeza aquí)" v={Object.entries(r.pilares).map(([s, n]) => `${n}×${s}`).join(" · ")} />}
          {r.vigas && <Fila k="Vigas" v={`${r.vigas.n} · ${fmt(r.vigas.m, 1)} m`} />}
          {r.muros && <Fila k="Muros" v={`${r.muros.n} · ${fmt(r.muros.m, 1)} m`} />}
          {r.losas?.map((l) => <Fila key={l.id} k={`Forjado ${l.id}`} v={`${l.tipo} · ${fmt(l.m2, 1)} m² · ${fmt(l.espesor, 2)} m`} />)}
          {r.panos?.map((l) => <Fila key={l.id} k={`Forjado ${l.id}`} v={`unidireccional · ${fmt(l.m2, 1)} m² · ${fmt(l.direccion, 0)}° · ${fmt(l.intereje, 2)} m`} />)}
        </Seccion>
      )}
      {r && (
        <Seccion titulo="Cargas que recibe" valor="kN">
          <table className="tb">
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
          <p className="nota">Con el peso propio (−ΣFz de sus cargas, de <span className="mono">fem resumen</span>).</p>
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
      <p className="nota">Un clic en el dibujo, en el navegador o en una tabla elige un objeto.</p>
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
