/**
 * Espacios Modelo y Cargas (`docs/fem3d/interfaz.md` §4 y §13): lo que era la pantalla Modelo de V1
 * y V2a, repartido en la disposición común.
 *
 * - Barra: en Modelo, las herramientas de dibujo (V2c-1 y V2c-2, `docs/fem3d/dibujo.md`: Ejes, Pilar,
 *   Viga, Forjado, Hueco, Muro, Apoyo y Apoyo lineal se dibujan en la planta, con su plantilla en
 *   Propiedades; `dibujo/controlador.ts`; Forjado y Hueco, con sus zunchos; Barra, de BN3, en un
 *   alzado o en planta, `docs/fem3d/barras.md` §6), Ábacos, las de editar con el ratón (V2c-3:
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
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, ChevronRight, ListOrdered, Magnet, MousePointer2, Trash2 } from "lucide-react";
import { DEF_TABLAS, TABLAS, contexto, objetosTabla, type NombreTabla } from "../../../src/editor/tablas.ts";
import { objetosVisibles } from "../../../src/editor/edicion.ts";
import { aplicar, type Operacion } from "../../../src/editor/operaciones.ts";
import { indiceIds } from "../../../src/editor/referencias.ts";
import { Chip, Desplegable, Disposicion, GrupoPlegable, Herramienta, Hueco, Campo, Separador, type Pestana } from "../armazon/Disposicion.tsx";
import { FichaAcciones } from "../editor/FichaAcciones.tsx";
import { IcNieve, IcSismo, IcViento } from "../armazon/iconos.tsx";
import { IcAPlantas, IcApoyo, IcApoyoLineal, IcBarra, IcCarga, IcCasos, IcCombinaciones, IcEjes, IcEmpuje, IcEnBarra, IcAbacos, IcHueco, IcLineal, IcLosa, IcMateriales, IcMuro, IcObra, IcPilar, IcPlanta, IcPlantas, IcPuntual, IcSecciones, IcSuperficie, IcViga, type Icono } from "../armazon/iconos.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { eleccionLista } from "../armazon/eleccionLista.ts";
import { Aviso, Cabecera, Equilibrio, Fila, ListaDiagnosticos, Seccion, AvisoDesactualizado } from "../componentes/comunes.tsx";
import { PasarACargasMuertas } from "../pantallas/PesoPropio.tsx";
import { useVisor } from "../contexto.ts";
import { DialogoAbacos, DialogoAlinear, DialogoBorrar, DialogoCopiar, DialogoRenumerar } from "../editor/Dialogos.tsx";
import { FormularioVarios, tablaDe } from "../editor/Formulario.tsx";
import { PanelTablas } from "../editor/Hoja.tsx";
import { cota, fmt, textoApp, coma, plural, NOMBRE_ACCION, textoCaso as textoCasoFmt } from "../fmt.ts";
import { Inspector } from "../pantallas/Inspector.tsx";
import { PropiedadesCargas, ResumenCaso, SobrePieza } from "../pantallas/CargasPieza.tsx";
import { tipoPieza } from "../../../src/editor/cargasPieza.ts";
import { NavVistas } from "../armazon/VistasGuardadas.tsx";
import { Situacion } from "../armazon/Situacion.tsx";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { useVistas, type DibujoPlanta, type EstadoVista } from "../vistas/estado.ts";
import { Fuente3DModelo, FuenteEscena, planoAlzado, plantaVista, repintarVistas, ZonaVistas } from "../vistas/Zona.tsx";
import { usePedido } from "../sesion/usePedido.ts";
import type { NombreHerramienta, Plantillas } from "../../../src/editor/dibujo/herramientas.ts";
import { ControladorDibujo } from "../dibujo/controlador.ts";
import { BarraEnganches } from "../dibujo/Enganches.tsx";
import { esEditar } from "../../../src/editor/dibujo/editar.ts";
import { CampoTeclado, IcCopiar, IcGirar, IcMover, IcPlantillaDxf, IcSimetria, PlantillaDibujo, plantillasEfectivas } from "../dibujo/Plantilla.tsx";
import type { NombrePlantillaDxf } from "../../../src/editor/dibujo/herramientaPlantilla.ts";
import { nuevaPlantilla } from "../../../src/editor/dibujo/plantilla.ts";
import { importarDxf, nombreLibre, usePlantillasDxf } from "../plantilla/plantillas.ts";
import { NavPlantillas } from "../plantilla/NavPlantillas.tsx";
import { abrirGestor } from "../editor/referencia.tsx";
import { provinciaPorIne } from "../../../src/normas/provincias.ts";
import { FichaAbacos } from "../editor/FichaAbaco.tsx";
import { borrarAbacos, esIdAbaco, leerIdAbaco, nombreAbaco, toleranciaAbacos } from "../../../src/editor/abacos.ts";

/** Lo que se puede copiar a otras plantas (los pilares ya van de una planta a otra). */
const COPIABLES: ReadonlySet<NombreTabla> = new Set(["vigas", "forjados", "apoyos", "apoyosLineales", "cargas"]);
/** El icono de cada tipo en el navegador (los de la barra de herramientas). */
const ICONO_TABLA: Partial<Record<NombreTabla, Icono>> = { pilares: IcPilar, vigas: IcViga, barras: IcBarra, forjados: IcLosa, muros: IcMuro, apoyos: IcApoyo, apoyosLineales: IcApoyoLineal, ejes: IcEjes, cargas: IcCarga };
/** La escala de las cargas en el alzado y el 3D (por la que se multiplica la automática). */
const ESCALAS = ["0.25", "0.5", "1", "2", "4"] as const;
type Escala = (typeof ESCALAS)[number];
const IcBorrar: Icono = ({ size }) => <Trash2 size={size} strokeWidth={1.5} aria-hidden="true" />;
const IcRenumerar: Icono = ({ size }) => <ListOrdered size={size} strokeWidth={1.5} aria-hidden="true" />;
const IcAlinear: Icono = ({ size }) => <Magnet size={size} strokeWidth={1.5} aria-hidden="true" />;

let ultimoPedido = 0;

/** Una tecla en un campo, en una tabla o en un diálogo no es de la herramienta. */
const enCampo = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || !!(t as HTMLElement | null)?.closest?.("[role=grid], [role=dialog]");

/** Un caso en el selector de la barra: su id, su nombre y si lleva el peso propio. */
// R-32: sin nombre, lo que es su acción («Q · uso»; antes, «Q» solo)
const textoCaso = (c: { id: string; nombre?: string; accion?: string; pesoPropio?: boolean } | undefined) => (c ? textoCasoFmt(c) : undefined);

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
  // UI-41 (M-14): elegir en el dibujo lleva la hoja a la tabla de lo elegido (y la hoja, a su fila)
  const tablaElegido = ed && seleccion ? tablaDe(ed.proyecto.modelo, seleccion) : null;
  useEffect(() => {
    if (tablaElegido && (!cargas || tablaElegido === "cargas")) setTabla(tablaElegido);
  }, [tablaElegido, cargas]);
  const [plantilla, setPlantilla] = useState<Record<string, string> | undefined>(undefined);
  const [dialogo, setDialogo] = useState<"borrar" | "copiar" | "renumerar" | "abacos" | "alinear" | "viento" | "sismo" | "nieve" | null>(null);

  // V2c: la herramienta activa (Elegir por defecto), fuera de React; aquí, lo que cambia la barra y Propiedades
  const [ctrl] = useState(() => new ControladorDibujo());
  const foto = useSyncExternalStore(ctrl.suscribir, ctrl.instantanea);
  const [plantillasDibujo, setPlantillasDibujo] = useState<Plantillas>({ pilar: {}, viga: {} });
  const modeloEd = ed?.proyecto.modelo ?? null;
  const obraEd = ed?.proyecto.obra;
  // Por defecto, el primero que no es el del peso propio (que es del programa: lo del usuario va aparte)
  const casoValido = e.casos.some((c) => c.id === caso) ? caso! : ((e.casos.find((c) => !c.pesoPropio) ?? e.casos[0])?.id ?? "");
  // Las cargas que se dibujan van al caso activo
  const casoDibujo = cargas ? casoValido : undefined;
  // V2c-4: las plantillas DXF, leídas en su worker; su índice por planta va al controlador
  const origen = proyecto.fuente?.tipo === "origen" ? proyecto.fuente.origen : null;
  const listaDxf = ed?.proyecto.plantillas;
  const dxf = usePlantillasDxf(listaDxf, origen);
  const [dxfActiva, setDxfActiva] = useState<string | null>(null);
  const [errorDxf, setErrorDxf] = useState<string | null>(null);
  const ficheroDxf = useRef<HTMLInputElement>(null);
  const plantillas = useMemo(() => ({ ...plantillasEfectivas(modeloEd, plantillasDibujo, casoDibujo, obraEd), dxf: { nombre: dxfActiva ?? undefined, lista: listaDxf } }), [modeloEd, plantillasDibujo, casoDibujo, obraEd, dxfActiva, listaDxf]);
  const indiceDxf = useMemo(() => (pl: string) => dxf.porPlanta(pl).indice(), [dxf.porPlanta]);
  const editarDibujo = (o: Operacion, etiqueta: string): string | null => {
    if (!ed) return "No hay ningún proyecto que editar.";
    const a = ed.editar(o, etiqueta);
    return a.ok ? null : a.errores.map((x) => x.mensaje).join(" ");
  };
  // M-31: la herramienta sigue en el acto con el modelo editado; esperaba al render siguiente, y dos
  // clics en la misma tarea (dos forjados) calculaban el mismo id siguiente («L2» ya es de losa)
  ctrl.aplicar = (h) => {
    if (!ed) return "No hay ningún proyecto que editar.";
    const a = ed.editar(h.operacion, h.etiqueta);
    if (!a.ok) return a.errores.map((x) => x.mensaje).join(" ");
    ctrl.ponerModelo(a.proyecto.modelo);
    // AC: un ábaco unido con otro cambia de id de selección
    if (h.elegir) setElegidos(h.elegir);
    return null;
  };
  ctrl.toleranciaAbacos = toleranciaAbacos(ed?.proyecto.opciones);
  ctrl.alSalir = () => ctrl.ponerHerramienta("elegir");
  ctrl.repintar = repintarVistas;
  {
    const va = vistas.vistas[vistas.activa];
    ctrl.plantaVista = va?.tipo === "planta" ? planta : null;
  }
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
      const t = nuevaPlantilla(dibujo, { nombre: nombreLibre(lista, f.name.replace(/\.(dxf|dwg)$/i, "")), fichero: f.name, sha256, planta: planta ?? ed.proyecto.modelo.plantas[0]?.id ?? "" });
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
  // UI-37: Ctrl+A elige lo que se ve en la planta activa (en Cargas, las cargas del caso activo); antes
  // seleccionaba el texto de la página
  const { setElegidos } = useVisor();
  // M-30: al cambiar de planta se suelta lo elegido que no pasa por ella (lo que no va por plantas,
  // como un eje, se queda): Propiedades seguía con la V2 de N3 estando en N1
  const plantaAntes = useRef(planta);
  useEffect(() => {
    if (plantaAntes.current === planta) return;
    plantaAntes.current = planta;
    if (!ed || !planta || !elegidos.length) return;
    const m = ed.proyecto.modelo;
    const ctx = contexto(m);
    const queda = elegidos.filter((id) => {
      // AC: un ábaco, con la planta de su losa
      const ab = leerIdAbaco(m, id);
      if (ab) return ab.losa.planta === planta;
      const t = tablaDe(m, id);
      const o = t ? objetosTabla(m, t).find((x) => x.id === id) : undefined;
      const ps = t && o ? DEF_TABLAS[t].plantas(o, ctx) : null;
      return ps === null || ps.includes(planta);
    });
    if (queda.length !== elegidos.length) setElegidos(queda);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cambiar de planta
  }, [planta]);
  useEffect(() => {
    if (!ed || dibujando) return;
    const tecla = (x: KeyboardEvent) => {
      if (!(x.ctrlKey || x.metaKey) || x.altKey || x.shiftKey || x.key.toLowerCase() !== "a" || enCampo(x.target)) return;
      if ((x.target as HTMLElement | null)?.closest?.("[role=grid], [role=dialog]") || document.querySelector("[role=dialog]")) return;
      const va = vistas.vistas[vistas.activa];
      if (!planta || va?.tipo !== "planta") return;
      x.preventDefault();
      setElegidos(objetosVisibles(ed.proyecto.modelo, planta, cargas ? { soloCargas: true, caso: casoValido } : {}));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ed, dibujando, vistas, planta, cargas, casoValido, setElegidos]);
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
  // AC: los ábacos elegidos (por su id de selección, que no está en ninguna tabla)
  const abacosElegidos = ed && !cargas ? elegidosHerr.filter((id) => esIdAbaco(ed.proyecto.modelo, id)) : [];
  const copiables = ed ? enTablas.filter((id) => COPIABLES.has(tablaDe(ed.proyecto.modelo, id)!)) : [];

  // Copiar y Borrar sin nada que les sirva elegido esperan a que se elija: un clic (o una ventana)
  // abre su diálogo con lo elegido; con Ctrl se van sumando, e Intro o la herramienta lo abren.
  const [eligiendo, setEligiendo] = useState<"copiar" | "borrar" | null>(null);
  // El botón «Editar» de una barra estrecha se enciende si lo que hay plegado en él está en uso
  const editando = esEditar(foto.herramienta) || eligiendo !== null;
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
  // Lo que acaba de hacer algo que no es una herramienta de dibujo (Supr, Borrar, A plantas, estirar),
  // unos segundos en la vista: antes no decían nada (`auditoria-ui.md`, UI-33)
  const [hecho, setHecho] = useState<string | null>(null);
  useEffect(() => {
    if (!dibujando && foto.hecho) setHecho(foto.hecho);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo cuando el controlador dice algo nuevo
  }, [foto.hecho]);
  // Deshacer y rehacer lo dicen, y quitan lo que decía lo de antes: lo que mueve centímetros (Alinear)
  // no se ve al deshacerlo, y con «N puntos alineados» aún en la vista parecía que no se deshacía
  const mov = ed?.movimiento;
  useEffect(() => {
    if (mov) setHecho(`${mov.tipo === "deshacer" ? "Deshecho" : "Rehecho"}: ${mov.etiqueta}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo en cada deshacer o rehacer
  }, [mov?.n]);
  useEffect(() => {
    if (!hecho) return;
    const t = window.setTimeout(() => setHecho(null), 6000);
    return () => window.clearTimeout(t);
  }, [hecho]);
  const cerrarDialogo = (h?: string) => {
    setDialogo(null);
    setEligiendo(null);
    if (h) setHecho(h);
  };
  // C-40: los oyentes de la ventana se ponen al cambiar lo que los activa, no en cada render; lo que
  // leen y cambia en cada uno (lo elegido, la selección), de esta ref
  const ultimo = useRef({ paraAccion, enTablas, seleccion, abacosElegidos });
  useLayoutEffect(() => {
    ultimo.current = { paraAccion, enTablas, seleccion, abacosElegidos };
  });
  useEffect(() => {
    if (!eligiendo) return;
    const puntero = (x: PointerEvent) => void (conCtrl.current = x.ctrlKey || x.metaKey);
    const tecla = (x: KeyboardEvent) => {
      if (x.key === "Escape") setEligiendo(null);
      else if (x.key === "Enter" && !(x.target as HTMLElement | null)?.closest?.("input, textarea, select, [role=grid], [role=dialog]") && ultimo.current.paraAccion(eligiendo).length) setDialogo(eligiendo);
    };
    window.addEventListener("pointerdown", puntero, true);
    window.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("pointerdown", puntero, true);
      window.removeEventListener("keydown", tecla);
    };
  }, [eligiendo]);
  useEffect(() => {
    if (eligiendo && elegidos !== alEmpezar.current && !conCtrl.current && paraAccion(eligiendo).length) setDialogo(eligiendo);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo cuando cambia lo elegido
  }, [elegidos]);
  // Supr borra lo elegido: si nada más lo usa, en el acto (se deshace con Ctrl+Z); si no, el diálogo
  // de Borrar dice qué lo usa. La hoja tiene su Supr (vaciar celdas) y un diálogo abierto, el suyo.
  // También con una herramienta activa (ninguna usa Supr): lo elegido en el navegador se borra igual,
  // salvo con un punto en curso de Mover, Copiar, Girar o Simetría, que trabajan sobre lo elegido.
  const hayEnTablas = enTablas.length > 0 || abacosElegidos.length > 0;
  useEffect(() => {
    if (estirando || conAsa || dialogo || !ed || !hayEnTablas) return;
    const tecla = (x: KeyboardEvent) => {
      if (x.key !== "Delete" || x.ctrlKey || x.metaKey || x.altKey || x.shiftKey || enCampo(x.target)) return;
      if (ctrl.editando) return;
      const { enTablas, seleccion, abacosElegidos } = ultimo.current;
      x.preventDefault();
      // AC: los ábacos elegidos (no los de una losa que también se borra), en el mismo paso
      const abacos = abacosElegidos.filter((id) => !enTablas.includes(leerIdAbaco(ed.proyecto.modelo, id)?.losa.id ?? ""));
      if (abacos.length && !enTablas.length) {
        const r = borrarAbacos(ed.proyecto.modelo, abacos);
        if (!r.ok || !ed.editar(r.operacion, `Borrar ${abacos.length > 1 ? `${abacos.length} ábacos` : `el ábaco ${nombreAbaco(abacos[0]!)}`}`).ok) return;
        setElegidos([]);
        return setHecho(abacos.length > 1 ? `Borrados ${abacos.length} ábacos.` : `Borrado el ábaco ${nombreAbaco(abacos[0]!)}.`);
      }
      if (!aplicar(ed.proyecto, { op: "borrar", ids: enTablas }).ok) return setDialogo("borrar");
      const r = ed.editar({ op: "borrar", ids: enTablas }, `Borrar ${enTablas.length > 3 ? `${enTablas.length} objetos` : enTablas.join(", ")}`);
      if (!r.ok) return;
      if (seleccion && !indiceIds(r.proyecto.modelo).has(seleccion)) setSeleccion(null);
      setHecho(enTablas.length > 3 ? `Borrados ${enTablas.length} objetos.` : `Borrado ${enTablas.join(", ")}.`);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [ctrl, estirando, conAsa, dialogo, ed, hayEnTablas, setSeleccion]);

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
          {/* VS4: los casos del programa (el viento y el sismo de las acciones), detrás, en su grupo */}
          {e.casos.filter((c) => !c.programa).map((c) => (
            <option key={c.id} value={c.id}>
              {textoCaso(c)}
            </option>
          ))}
          {e.casos.some((c) => c.programa) && (
            <optgroup label="Del programa (viento y sismo)">
              {e.casos.filter((c) => c.programa).map((c) => (
                <option key={c.id} value={c.id}>
                  {textoCaso(c)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Campo>
      {ed && (
        <>
          <Herramienta icono={IcCasos} nombre="Casos" onClick={() => abrirGestor({ coleccion: "casos" })} title="El gestor de casos: los típicos del CTE con un clic, los casos típicos de una vez, y la tabla desde él" />
          <Herramienta icono={IcViento} nombre="Viento" activa={e.casos.some((c) => c.programa === "viento")} onClick={() => setDialogo("viento")} title="El viento del programa (DB SE-AE): zona, aspereza y rasante; da 8 casos con una fuerza por planta" />
          <Herramienta icono={IcNieve} nombre="Nieve" activa={(modeloEd?.casos ?? []).some((c) => c.accion?.tipo === "S")} onClick={() => setDialogo("nieve")} title="La nieve de la obra (DB SE-AE 3.5): sk del emplazamiento y el caso de nieve; las cargas, en las cubiertas, las pone usted" />
          <Herramienta icono={IcSismo} nombre="Sismo" activa={e.casos.some((c) => c.programa === "sismo")} onClick={() => setDialogo("sismo")} title="El sismo del programa (NCSE-02): el municipio, el terreno y la ductilidad; masas, modos y el análisis por espectros de respuesta" />
          <Separador />
          <Herramienta icono={IcPuntual} nombre="Puntual" activa={foto.herramienta === "puntual"} onClick={() => elegirHerramienta("puntual")} title="Dibujar cargas puntuales en el caso activo: un clic donde va (F y M en Propiedades). Esc vuelve a Elegir" />
          <Herramienta icono={IcLineal} nombre="Lineal" activa={foto.herramienta === "lineal"} onClick={() => elegirHerramienta("lineal")} title="Dibujar cargas lineales en el caso activo: clic a clic, doble clic o Intro termina. Esc vuelve a Elegir" />
          <Herramienta icono={IcSuperficie} nombre="Superficie" activa={foto.herramienta === "superficie"} onClick={() => elegirHerramienta("superficie")} title="Dibujar cargas de superficie en el caso activo: un clic en un forjado, o una zona (Propiedades). Esc vuelve a Elegir" />
          <Herramienta icono={IcEnBarra} nombre="En barra" activa={foto.herramienta === "barra"} onClick={() => elegirHerramienta("barra")} title="Dibujar cargas en vigas y pilares en el caso activo: un clic en la pieza, o dos en un tramo de viga (Propiedades). Esc vuelve a Elegir" />
          <Herramienta icono={IcEmpuje} nombre="Empuje" activa={foto.herramienta === "empuje"} onClick={() => elegirHerramienta("empuje")} title="Dibujar empujes en el caso activo: un clic en un muro, del lado del terreno. Esc vuelve a Elegir" />
          <Separador />
          <GrupoPlegable icono={IcMover} nombre="Editar" activa={editando}>
          <Herramienta icono={IcMover} nombre="Mover" activa={foto.herramienta === "mover"} onClick={() => elegirHerramienta("mover")} title="Mover las cargas elegidas: punto base y destino. Esc vuelve a Elegir" />
          <Herramienta icono={IcCopiar} nombre="Copiar" activa={foto.herramienta === "copiar"} onClick={() => elegirHerramienta("copiar")} title="Copiar las cargas elegidas: punto base y un destino por copia, en su planta o en las de Propiedades. Esc vuelve a Elegir" />
          <Herramienta icono={IcGirar} nombre="Girar" activa={foto.herramienta === "girar"} onClick={() => elegirHerramienta("girar")} title="Girar las cargas elegidas: el centro y el ángulo (un clic, o los grados). Esc vuelve a Elegir" />
          <Herramienta icono={IcSimetria} nombre="Simetría" activa={foto.herramienta === "simetria"} onClick={() => elegirHerramienta("simetria")} title="La simetría de las cargas elegidas por un eje de dos puntos (conservando lo original, en Propiedades). Esc vuelve a Elegir" />
          <Herramienta icono={IcAPlantas} nombre="A plantas" activa={eligiendo === "copiar"} onClick={() => usar("copiar")} title={copiables.length ? `Copiar ${copiables.length > 1 ? `${copiables.length} cargas` : copiables[0]} a otras plantas` : eligiendo === "copiar" ? "Dejar de elegir (Esc)" : "Copiar cargas a otras plantas: elíjalas después"} />
          </GrupoPlegable>
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
          <Herramienta icono={IcObra} nombre="Obra" onClick={() => abrirGestor({ coleccion: "obra" })} title="Datos de la obra: nombre, emplazamiento (viento, nieve y sismo), uso del edificio y materiales de lo que se crea" />
          <Herramienta icono={IcPlantas} nombre="Plantas" onClick={() => abrirGestor({ coleccion: "plantas", ...(planta ? { planta } : {}) })} title="Añadir plantas encima o debajo de una, viendo cómo quedan las cotas, y la tabla desde él" />
          <Herramienta icono={IcMateriales} nombre="Materiales" onClick={() => abrirGestor({ coleccion: "materiales" })} title="El gestor de materiales: los típicos con un clic, y la tabla desde él" />
          <Herramienta icono={IcSecciones} nombre="Secciones" onClick={() => abrirGestor({ coleccion: "secciones" })} title="El gestor de secciones: nueva por tipo (hormigón, perfil de catálogo o general), y la tabla desde él" />
          <Separador />
          <Herramienta icono={IcPlantillaDxf} nombre="Plantilla" onClick={() => ficheroDxf.current?.click()} title="Un plano DXF o DWG del arquitecto en gris detrás de la planta activa, para calcar con sus enganches (sus unidades, capas y colocación, en el navegador)" />
          <input ref={ficheroDxf} type="file" accept=".dxf,.dwg" hidden aria-label="Fichero DXF o DWG de la plantilla" onChange={(x) => {
            const f = x.target.files?.[0];
            x.target.value = "";
            if (f) void importarPlantilla(f);
          }} />
          <Herramienta icono={IcEjes} nombre="Ejes" activa={foto.herramienta === "ejes"} onClick={() => elegirHerramienta("ejes")} title="Dibujar ejes de replanteo: dos clics por eje (o «Proponer ejes» en Propiedades). Esc vuelve a Elegir" />
          <Separador />
          <Herramienta icono={IcPilar} nombre="Pilar" activa={foto.herramienta === "pilar"} onClick={() => elegirHerramienta("pilar")} title="Dibujar pilares: un clic en su punto fijo, o una ventana para uno en cada cruce de ejes. Esc vuelve a Elegir" />
          <Herramienta icono={IcMuro} nombre="Muro" activa={foto.herramienta === "muro"} onClick={() => elegirHerramienta("muro")} title="Dibujar muros: clic a clic; doble clic o Intro termina, un clic en el primero lo cierra. Esc vuelve a Elegir" />
          <Herramienta icono={IcViga} nombre="Viga" activa={foto.herramienta === "viga"} onClick={() => elegirHerramienta("viga")} title="Dibujar vigas: clic a clic, doble clic o Intro termina. Esc vuelve a Elegir" />
          <Herramienta icono={IcBarra} nombre="Barra" activa={foto.herramienta === "barraNiveles"} onClick={() => elegirHerramienta("barraNiveles")} title="Dibujar barras entre dos plantas (diagonales, tornapuntas): dos clics en un alzado, en los nudos de los pilares o en las líneas de nivel de las plantas, o en planta (la planta del fin, en Propiedades). Esc vuelve a Elegir" />
          <Separador />
          <Herramienta icono={IcLosa} nombre="Forjado" activa={foto.herramienta === "forjado"} onClick={() => elegirHerramienta("forjado")} title="Dibujar forjados (maciza, reticular o unidireccional, en Propiedades): un clic dentro de un recuadro cerrado, o un polígono. Esc vuelve a Elegir" />
          <Herramienta icono={IcHueco} nombre="Hueco" activa={foto.herramienta === "hueco"} onClick={() => elegirHerramienta("hueco")} title="Dibujar huecos: en un forjado, un rectángulo o un polígono; en un muro, dos clics por su eje. Esc vuelve a Elegir" />
          <Herramienta icono={IcAbacos} nombre="Ábaco" activa={foto.herramienta === "abaco"} onClick={() => elegirHerramienta("abaco")} title="Dibujar ábacos en un forjado reticular: un clic en un pilar, o un rectángulo (o en todos los pilares, en Propiedades). Si solapa con otro, se unen. Esc vuelve a Elegir" />
          <Separador />
          <Herramienta icono={IcApoyo} nombre="Apoyo" activa={foto.herramienta === "apoyo"} onClick={() => elegirHerramienta("apoyo")} title="Dibujar apoyos: un clic donde va. Esc vuelve a Elegir" />
          <Herramienta icono={IcApoyoLineal} nombre="Apoyo lineal" activa={foto.herramienta === "apoyoLineal"} onClick={() => elegirHerramienta("apoyoLineal")} title="Dibujar apoyos lineales: clic a clic, doble clic o Intro termina. Esc vuelve a Elegir" />
          <Separador />
          <GrupoPlegable icono={IcMover} nombre="Editar" activa={editando}>
          <Herramienta icono={IcMover} nombre="Mover" activa={foto.herramienta === "mover"} onClick={() => elegirHerramienta("mover")} title="Mover lo elegido: punto base y destino (con las vigas que acaban en sus pilares). Esc vuelve a Elegir" />
          <Herramienta icono={IcCopiar} nombre="Copiar" activa={foto.herramienta === "copiar"} onClick={() => elegirHerramienta("copiar")} title="Copiar lo elegido: punto base y un destino por copia, en su planta o en las de Propiedades. Esc vuelve a Elegir" />
          <Herramienta icono={IcGirar} nombre="Girar" activa={foto.herramienta === "girar"} onClick={() => elegirHerramienta("girar")} title="Girar lo elegido: el centro y el ángulo (un clic, o los grados). Esc vuelve a Elegir" />
          <Herramienta icono={IcSimetria} nombre="Simetría" activa={foto.herramienta === "simetria"} onClick={() => elegirHerramienta("simetria")} title="La simetría de lo elegido por un eje de dos puntos (conservando lo original, en Propiedades). Esc vuelve a Elegir" />
          <Separador />
          <Herramienta icono={IcAPlantas} nombre="A plantas" activa={eligiendo === "copiar"} onClick={() => usar("copiar")} title={copiables.length ? `Copiar ${copiables.length > 1 ? `${copiables.length} objetos` : copiables[0]} a otras plantas` : eligiendo === "copiar" ? "Dejar de elegir (Esc)" : "Copiar a otras plantas: elija después las vigas, forjados, apoyos o cargas"} />
          <Herramienta icono={IcBorrar} nombre="Borrar" activa={eligiendo === "borrar"} onClick={() => usar("borrar")} title={enTablas.length ? `Borrar ${enTablas.length > 1 ? `${enTablas.length} objetos` : enTablas[0]}` : eligiendo === "borrar" ? "Dejar de elegir (Esc)" : "Borrar: elija después lo que quiere borrar"} />
          <Herramienta icono={IcRenumerar} nombre="Renumerar" onClick={() => setDialogo("renumerar")} title="Ids cortos: P1, P2… por filas de arriba abajo y de izquierda a derecha" />
          <Herramienta icono={IcAlinear} nombre="Alinear" onClick={() => setDialogo("alinear")} title="Pilares y vértices casi alineados (a menos de 3 cm sin coincidir): dice cuáles y los lleva al valor de la mayoría" />
          </GrupoPlegable>
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
          return <FuenteEscena fuente={{ tipo: "planta", planta: v.planta, vista: cargas ? { vista: "cargas", caso: casoValido } : plantaVista(v, e.calculado) }} dibujo={ed ? ctrl.adaptador(v.planta, { cotas: !cargas && v.ejes !== false && plantaVista(v, e.calculado).vista === "modelo", plantilla: !!geo }) : null} dibujando={dibujando} plantilla={geo} />;
        },
        plantilla: (pl) => !!listaDxf?.some((t) => t.plantas.includes(pl)),
        ...(ed
          ? {
              enganches: () => <BarraEnganches ctrl={ctrl} />,
              // La última importada que esté en alguna planta (la de la planta de al lado suele ser la que se calca)
              plantillaEnOtras: (pl: string) => [...(listaDxf ?? [])].reverse().find((t) => t.plantas.length && !t.plantas.includes(pl)) ?? null,
              verPlantillaAqui: (pl: string, nombre: string) => {
                const lista = ed.proyecto.plantillas ?? [];
                const orden = ed.proyecto.modelo.plantas.map((p) => p.id);
                ed.editar({ op: "plantillas", plantillas: lista.map((t) => (t.nombre === nombre ? { ...t, plantas: orden.filter((id) => id === pl || t.plantas.includes(id)) } : t)) }, `Plantas de la plantilla «${nombre}»`);
              },
            }
          : {}),
        // BN3: en Modelo, el alzado también dibuja (con Barra)
        ...(ed && !cargas ? { alzado: (v: EstadoVista) => <FuenteEscena fuente={v.eje ? { tipo: "alzado", plano: planoAlzado(v.eje, v) } : null} dibujo={v.eje ? ctrl.adaptadorAlzado(v.eje, planoAlzado(v.eje, v).profundidad) : null} dibujando={dibujando} /> } : {}),
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
            <>
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
            {/* UI-39: en una planta vacía, por dónde empezar (antes, un lienzo en blanco sin ninguna pista) */}
            {ed && !dibujando && v.planta && objetosVisibles(ed.proyecto.modelo, v.planta).length === 0 && (
              <>
                <Chip>Planta vacía: empiece por</Chip>
                <button type="button" className="chip" data-acento onClick={() => elegirHerramienta("ejes")}>
                  Ejes
                </button>
                <button type="button" className="chip" data-acento onClick={() => elegirHerramienta("pilar")}>
                  Pilares
                </button>
                <button type="button" className="chip" data-acento onClick={() => ficheroDxf.current?.click()}>
                  Calcar un DXF o DWG
                </button>
              </>
            )}
            </>
          ),
      }}
    />
  );

  // UI-27: por qué falló el cálculo (un mecanismo, el equilibrio, la memoria) va también aquí
  const diagnosticos = proyecto.fase === "error" && proyecto.errores.length ? [...proyecto.errores, ...e.diagnosticos] : e.diagnosticos;
  const errores = diagnosticos.filter((d) => d.severidad === "error").length;
  const avisos = diagnosticos.filter((d) => d.severidad === "aviso").length;
  // R-29: los de sensatez aparte, como los cuenta el informe de Revisión (que suma los que necesitan los resultados)
  const avisosSensatez = diagnosticos.filter((d) => d.severidad === "aviso" && d.codigo.startsWith("sensatez/")).length;
  const desglose = `${avisos - avisosSensatez} del compilador y del cálculo, ${avisosSensatez} de sensatez del modelo`;
  const dock: Pestana[] = [
    ...(ed ? [{ id: "tablas", titulo: "Tablas", contenido: <PanelTablas tabla={tabla} setTabla={setTabla} nueva={nueva} plantilla={plantilla} /> }] : []),
    {
      id: "diagnosticos",
      titulo: "Diagnósticos",
      insignia: e.compilando ? <span className="text-text-secondary">…</span> : errores ? <span className="text-state-fail">{errores} error{errores === 1 ? "" : "es"}</span> : avisos ? <span className="text-state-warn" title={`Avisos: ${desglose}`}>{avisos} aviso{avisos === 1 ? "" : "s"}</span> : "0",
      contenido: (
        <>
          <p className="nota">
            Lo que se comprueba del modelo al compilarlo y al calcularlo. Un clic en un id lo elige.{e.compilando ? " Compilando: de momento, sólo lo que no necesita la compilación." : ""}
            {avisos > 0 && ` Avisos: ${desglose}; las comprobaciones de sensatez que necesitan los resultados, en Revisión.`}
          </p>
          <ListaDiagnosticos ds={diagnosticos} onObjeto={setSeleccion} acciones={ed ? { "sensatez/cargas-en-peso-propio": <PasarACargasMuertas compacto alHacer={setCaso} /> } : undefined} />
        </>
      ),
    },
    // UI-13: sin calcular no hay combinaciones que contar (salían «0», con un motivo falso)
    { id: "combinaciones", titulo: "Combinaciones", insignia: e.calculado ? e.combinaciones.length : "—", contenido: <ListaCombinaciones /> },
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
            {/* El pie de la vista: la línea de lo que se teclea encima de lo que pide la herramienta, abajo en
                el centro (en vez de una caja junto al cursor, que tapaba lo que se dibuja) */}
            <div className="pie-vista">
              {foto.campo && <CampoTeclado key={foto.campo.n} ctrl={ctrl} campo={foto.campo} />}
              {dibujando && (
                // M-17: una línea (la primera frase); la ayuda entera, en su título y en la plantilla de Propiedades
                <span className="chip aviso-herr" data-acento="true" role="status" title={foto.ayuda}>
                  {primeraFrase(foto.ayuda)}
                  {!foto.error && !foto.campo && !/x; y|u; z/.test(foto.ayuda) && !(esEditar(foto.herramienta) && !foto.transformando) && <span className="text-text-tertiary"> O teclee las coordenadas.</span>}
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
              {!dibujando && !eligiendo && hecho && !(foto.asa || foto.estirado || foto.aviso || foto.pilar) && (
                <span className="chip aviso-herr" data-acento="true" role="status">
                  <Check size={14} className="mr-1 inline align-[-2px] text-state-ok" />
                  {hecho} <span className="dib-tecla">{/^Deshecho/.test(hecho) ? "Ctrl+Y" : "Ctrl+Z"}</span>
                </span>
              )}
              {eligiendo && (
                <span className="chip aviso-herr" data-acento="true" role="status">
                  {eligiendo === "copiar" ? "Copiar a otras plantas: elija las vigas, forjados, apoyos o cargas" : "Borrar: elija lo que quiere borrar"} (clic o ventana; con Ctrl+clic, varios e Intro). Esc cancela.
                  {paraAccion(eligiendo).length > 0 && <strong className="font-semibold"> {plural(paraAccion(eligiendo).length, "elegido")}.</strong>}
                </span>
              )}
            </div>
          </>
        }
        props={{
          titulo: "Propiedades",
          contenido:
            dibujando && modeloEd ? (
              <PlantillaDibujo foto={foto} ctrl={ctrl} modelo={modeloEd} planta={planta} plantillas={plantillas} setPlantillas={setPlantillasDibujo} editar={editarDibujo} abrirTabla={(t) => abrirTabla(t)} abacosEnPilares={() => setDialogo("abacos")} />
            ) : !cargas && modeloEd && abacosElegidos.length && abacosElegidos.length === elegidos.length ? (
              <FichaAbacos ids={abacosElegidos} />
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
              <ResumenCaso caso={casoValido} setCaso={setCaso} />
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
      {dialogo === "alinear" && ed && <DialogoAlinear onCerrar={cerrarDialogo} />}
      {(dialogo === "viento" || dialogo === "sismo" || dialogo === "nieve") && ed && <FichaAcciones pestana={dialogo} onCerrar={cerrarDialogo} />}
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
        <ResumenObra />
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
  const { proyecto, planta, elegidos, setElegidos } = useVisor();
  const e = proyecto.estado!;
  const ed = proyecto.edicion;
  // El último elegido con un clic sin Mayús: el otro extremo del rango de Mayús+clic
  const ancla = useRef<string | null>(null);
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
              aqui.slice(0, 300).map((o, _, vistos) => (
                <button
                  key={o.id}
                  type="button"
                  className="arbol-fila sub"
                  data-on={elegidos.includes(o.id)}
                  // Mayús+clic no selecciona el texto de la lista
                  onMouseDown={(x) => x.shiftKey && x.preventDefault()}
                  onClick={(x) => {
                    const r = eleccionLista(
                      vistos.map((v) => v.id),
                      elegidos,
                      ancla.current,
                      o.id,
                      { ctrl: x.ctrlKey || x.metaKey, mayus: x.shiftKey },
                    );
                    ancla.current = r.ancla;
                    setElegidos(r.elegidos);
                  }}
                >
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

// M-23: «Objetos», lo que más se usa, justo bajo el proyecto; las plantillas DXF y las vistas
// (casi siempre vacías al empezar, con una línea) debajo
function NavModelo({ plantillas }: { plantillas: ReactNode }) {
  return (
    <>
      <Proyecto />
      <Situacion />
      <Objetos tablas={["pilares", "vigas", "barras", "forjados", "muros", "apoyos", "apoyosLineales", "ejes"]} />
      {plantillas}
      <NavVistas />
    </>
  );
}

/** Las cargas del caso en un 3D, sobre el modelo (también en sólido): sólo necesitan el modelo físico. */
function TresDCargas({ caso, escala }: { caso: string; escala: number }) {
  const { proyecto } = useVisor();
  const r = usePedido(proyecto.cliente, { tipo: "cargas3d", caso, escala });
  const aviso = proyecto.desactualizado ? (
    <AvisoDesactualizado abriendo />
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
      <Situacion />
      <Seccion titulo="Casos" valor={e.casos.length}>
        {e.casos.map((c) => (
          <button key={c.id} type="button" className="arbol-fila" data-on={c.id === caso} onClick={() => setCaso(c.id)}>
            <span className="mono">{c.id}</span>
            <span className="truncate text-text-secondary">{c.nombre ?? ""}</span>
            {/* R-32: la acción en palabras («nieve»), no su código junto al id («N … S») */}
            <span className="n" title={c.accion ? `Acción ${c.accion} (${NOMBRE_ACCION[c.accion] ?? c.accion})${c.pesoPropio ? ", con el peso propio" : ""}` : "Sin acción: fuera de las combinaciones"}>
              {c.accion ? (NOMBRE_ACCION[c.accion] ?? c.accion) : "sin acción"}
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

/**
 * DO-g: el nombre y lo esencial de la obra (el municipio y los materiales), con el acceso a «Datos de
 * la obra», donde se escriben.
 */
function ResumenObra() {
  const { proyecto } = useVisor();
  const p = proyecto.edicion!.proyecto;
  const emp = p.modelo.acciones?.emplazamiento;
  const lugar = emp?.municipio ?? (emp?.provincia ? provinciaPorIne(emp.provincia)?.nombre : undefined);
  const mats = [...new Set(Object.values(p.obra?.materiales ?? {}))];
  return (
    <div className="px-3.5 pb-2">
      <button type="button" className="block w-full truncate text-left text-[13px] font-semibold hover:underline" title="Datos de la obra" onClick={() => abrirGestor({ coleccion: "obra" })}>
        {p.nombre || "Sin nombre"}
      </button>
      {p.descripcion && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-text-secondary">{p.descripcion}</p>}
      <p className="mt-0.5 text-[12px] text-text-secondary">
        {[lugar ?? "sin emplazamiento", p.obra?.uso ? `uso ${p.obra.uso}` : null, mats.length ? mats.join(", ") : null].filter(Boolean).join(" · ")}
      </p>
      <button type="button" className="enlace mt-1 text-[12px]" onClick={() => abrirGestor({ coleccion: "obra" })}>
        Datos de la obra…
      </button>
    </div>
  );
}

// ─── Propiedades con varios elegidos ────────────────────────────────────────────────────────────

/** Lo elegido, por tipo; un clic deja uno solo (el del inspector). */
function ListaElegidos() {
  const { proyecto, elegidos, setSeleccion, setElegidos, espacio } = useVisor();
  const ed = proyecto.edicion;
  // P-25: con varios tipos, los datos de cada uno se despliegan aparte (antes, los de los ejes, los
  // primeros, llenaban el panel como si sólo se hubieran elegido ellos)
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(() => new Set());
  const porTipo = new Map<string, string[]>();
  const tablaDeTipo = new Map<string, NombreTabla>();
  for (const id of elegidos) {
    const t = ed ? tablaDe(ed.proyecto.modelo, id) : null;
    const nombre = t ? DEF_TABLAS[t].titulo : "Otros";
    if (t) tablaDeTipo.set(nombre, t);
    porTipo.set(nombre, [...(porTipo.get(nombre) ?? []), id]);
  }
  const orden = [...TABLAS.map((t) => DEF_TABLAS[t].titulo), "Otros"].filter((t) => porTipo.has(t));
  const mezcla = orden.length > 1;
  // En Cargas sólo se tocan las cargas: lo demás elegido se lista, sin sus datos
  const editable = (t: string) => !!ed && tablaDeTipo.has(t) && porTipo.get(t)!.length > 1 && (espacio !== "cargas" || tablaDeTipo.get(t) === "cargas");
  const resumen = orden.map((t) => `${porTipo.get(t)!.length} ${t.toLowerCase()}`).join(" · ");
  return (
    <>
      <Cabecera icono={MousePointer2} tipo="Selección" titulo={`${elegidos.length} objetos`} detalle={`${mezcla ? `${resumen}. ` : ""}Un clic en uno lo deja solo; Ctrl+clic en el dibujo añade o quita; Esc suelta todo.`}>
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
          {/* Varios de una tabla: lo que tienen en común, editable en todos a la vez; en una mezcla, al desplegarlo */}
          {editable(t) && mezcla && (
            <div className="px-3.5 pb-2">
              <button
                type="button"
                className="btn"
                aria-expanded={abiertos.has(t)}
                onClick={() => {
                  const n = new Set(abiertos);
                  if (!n.delete(t)) n.add(t);
                  setAbiertos(n);
                }}
              >
                <ChevronRight size={14} style={{ transform: abiertos.has(t) ? "rotate(90deg)" : undefined }} aria-hidden="true" />
                Datos de los {porTipo.get(t)!.length}
              </button>
            </div>
          )}
          {editable(t) && (!mezcla || abiertos.has(t)) && <FormularioVarios ids={porTipo.get(t)!} tabla={tablaDeTipo.get(t)!} />}
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
          <p className="nota">Con el peso propio (−ΣFz de sus cargas).</p>
        </Seccion>
      )}
      <Equilibrio estado={e} />
      {e.hipotesis.length > 0 && (
        <Seccion titulo="Supuestos del cálculo" valor={e.hipotesis.length}>
          <ol className="m-0 list-decimal py-1 pl-8 pr-3.5 text-[12px] leading-snug text-text-secondary">
            {e.hipotesis.map((h, i) => (
              <li key={i} className="py-0.5">
                {textoApp(h)}
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

/** La primera frase de un texto (hasta el primer «. »), con su punto. */
export const primeraFrase = (t: string): string => {
  const k = t.indexOf(". ");
  return k < 0 ? t : t.slice(0, k + 1);
};

function ListaCombinaciones() {
  const { proyecto } = useVisor();
  const e = proyecto.estado!;
  if (!e.calculado) return <p className="nota">Las combinaciones salen de los casos al calcular: entonces se ven aquí.</p>;
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
              {coma(c.etiqueta)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
