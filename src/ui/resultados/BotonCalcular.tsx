import { PanelFlotante, Boton } from "../primitivas";
import { useCalcular } from "./useCalcular";
import {
  etiquetaBotonCalcular,
  calculoHabilitado,
  rotuloEstadoMotor,
} from "./estadoMotorUI";
import type { ErrorObra } from "../../discretizador";
import { modeloStore, seleccionStore, vistaStore, type Pestana } from "../../estado";
// Import DIRECTO del helper puro (no del barrel del viewport, que arrastra three.js):
// resolverContextoElemento es lógica pura testeable en Node (F2c), sin R3F.
import { resolverContextoElemento } from "../viewport/hooks/resolverContextoElemento";
import "./botonCalcular.css";

// BotonCalcular (feature-14, Tarea 1.2): boton "Calcular" + indicador de estado del
// motor + panel de errores/avisos en LENGUAJE DE OBRA. Es el unico disparador visible
// del corte vertical F1 (obra -> discretizar -> solver -> resultados). Vocabulario de
// obra; CERO jerga FEM (CLAUDE.md §17): el usuario nunca ve "nodo", "member" ni "release".
//
// El componente NO sabe que detras hay Python/Pyodide: solo consume `useCalcular()`, que
// refleja el `EstadoMotor` del solverClient y orquesta el calculo asincrono (CLAUDE.md §7,
// el hilo principal nunca se bloquea). El estado del motor decide habilitacion y etiqueta;
// los errores de discretizacion / del motor se muestran como panel no intrusivo. Los
// helpers de presentacion del estado del motor viven en estadoMotorUI.ts (compartidos
// con la Brandbar y el Menubar; cerro T-estado-motor-helpers).
//
// [D22b] ERRORES NAVEGABLES: una fila con `elementoId` navegable (pilar/viga/paño) es un
// BOTON: al pulsarlo selecciona el elemento y salta a la pestaña de su tipo, para que el
// arquitecto llegue al culpable sin buscarlo. Filas de MODELO (SIN_SUJECION, OBRA_VACIA…)
// o sin id navegable no son clicables. Un NUDO flotante tiene `posicion` pero no es un
// elemento seleccionable: se muestra la posición en el texto (ya la trae el mensaje D22a)
// y NO navega (decisión: lo simple; navegar a una pestaña sin seleccionar nada confundiría).

// Pestaña destino de un tipo de elemento navegable. pilar -> Entrada de pilares; viga y
// paño -> Entrada de vigas (el paño se introduce y edita en esa pestaña). Los demás tipos
// (nudo/carga/hipotesis/planta/modelo) NO navegan (devuelven null).
function pestanaDestino(tipo: ErrorObra["elementoTipo"]): Pestana | null {
  if (tipo === "pilar") return "entradaPilares";
  if (tipo === "viga" || tipo === "pano") return "entradaVigas";
  return null;
}

// ¿Esta fila puede navegar? Solo con un `elementoId` y un `elementoTipo` cuya pestaña
// destino exista (pilar/viga/paño). Nudo/carga/modelo -> no navegable.
function esNavegable(obra: ErrorObra): boolean {
  return obra.elementoId !== undefined && pestanaDestino(obra.elementoTipo) !== null;
}

// Navega al elemento culpable: selecciona su id, sincroniza el contexto (planta,
// reutilizando resolverContextoElemento de F2c — sin reimplementarlo) para que quede en
// el ámbito visible, y salta a la pestaña de su tipo. Se lee el modelo ACTUAL del store.
function navegarAElemento(obra: ErrorObra): void {
  const id = obra.elementoId;
  const pestana = pestanaDestino(obra.elementoTipo);
  if (id === undefined || pestana === null) return;
  const vista = vistaStore.getState();
  // Contexto (planta): resolverContextoElemento cubre pilar y viga; para el paño
  // devuelve null (aún no mapeado), en cuyo caso no se toca el ámbito (basta con
  // seleccionar y cambiar de pestaña).
  const ctx = resolverContextoElemento(modeloStore.getState().getModelo(), id);
  if (ctx !== null) {
    vista.setPlantaActiva(ctx.plantaActivaId);
  }
  seleccionStore.getState().seleccionar([id]);
  vista.setPestanaActiva(pestana);
}

// Una fila de mensaje de obra (error bloqueante o aviso no bloqueante). Texto tal cual lo
// produce el discretizador (espanol con tildes, sin jerga FEM); el `codigo` no se muestra.
// `n` es el numero de elementos con ESE mismo mensaje: cuando hay varios (p.ej. muchos
// "puntos sueltos") se muestra una sola linea con "(xN)" en vez de N lineas identicas.
//
// [D22b] Si la fila es NAVEGABLE (elementoId de pilar/viga/paño) y NO está agregada (n===1),
// se renderiza como <button>: al pulsar selecciona el elemento y salta a su pestaña. Si está
// agregada (n>1) se mantiene como fila no clicable (varios culpables): la afordancia de clic
// solo aparece cuando lleva a UN elemento concreto.
function FilaMensaje({
  obra,
  n,
  ids,
}: {
  obra: ErrorObra;
  n: number;
  ids: string[];
}) {
  const clase =
    obra.severidad === "error"
      ? "cx-calcular__msg cx-calcular__msg--error"
      : "cx-calcular__msg cx-calcular__msg--aviso";
  const conteo =
    n > 1 ? <span className="cx-calcular__conteo"> (×{n})</span> : null;

  // Navegable e individual (n===1): botón que lleva al culpable.
  if (n === 1 && esNavegable(obra)) {
    return (
      <li>
        <button
          type="button"
          className={`${clase} cx-calcular__msg--nav`}
          onClick={() => navegarAElemento(obra)}
          title="Ir al elemento"
        >
          {obra.mensaje}
        </button>
      </li>
    );
  }

  // Agregada (n>1): fila no clicable; los ids de los culpables se listan en el title
  // para no perder la trazabilidad al colapsar (la posición ya viaja en el propio mensaje
  // de los nudos flotantes, D22a).
  const title = n > 1 && ids.length > 0 ? ids.join(", ") : undefined;
  return (
    <li className={clase} title={title}>
      {obra.mensaje}
      {conteo}
    </li>
  );
}

// Grupo de mensajes IDENTICOS (mismo texto y severidad): el `obra` representante, el
// conteo `n` y los `ids` de todos los culpables agrupados (para el title al colapsar).
interface GrupoMensaje {
  obra: ErrorObra;
  n: number;
  ids: string[];
}

// Agrupa mensajes IDENTICOS (mismo texto y severidad) en una sola fila con su conteo.
// Evita que el panel se llene de lineas repetidas (p.ej. un aviso "punto suelto" por cada
// nudo huerfano). Conserva el orden de primera aparicion y acumula los ids de los
// culpables (trazabilidad al colapsar, D22b). Nota: como los mensajes navegables suelen
// individualizar el texto (FLOTANTE lleva la posición, D22a), en la práctica cada culpable
// distinto tiende a caer en su propia fila clicable.
function agruparMensajes(obras: ErrorObra[]): GrupoMensaje[] {
  const grupos: GrupoMensaje[] = [];
  const indice = new Map<string, number>();
  for (const o of obras) {
    const clave = `${o.severidad} ${o.mensaje}`;
    const existente = indice.get(clave);
    if (existente === undefined) {
      indice.set(clave, grupos.length);
      grupos.push({ obra: o, n: 1, ids: o.elementoId !== undefined ? [o.elementoId] : [] });
    } else {
      const g = grupos[existente]!;
      g.n += 1;
      if (o.elementoId !== undefined) g.ids.push(o.elementoId);
    }
  }
  return grupos;
}

export function BotonCalcular() {
  const { calcular, estadoMotor, calculando, errores, avisos, ultimoError } = useCalcular();

  const habilitado = calculoHabilitado(estadoMotor, calculando);
  const etiqueta = etiquetaBotonCalcular(estadoMotor, calculando);

  // Hay algo que reportar si la discretizacion devolvio errores/avisos de obra o si el
  // motor fallo (carga/calculo). Se muestra debajo del boton, sin bloquear la UI.
  const hayErrores = errores.length > 0;
  const hayAvisos = avisos.length > 0;
  const hayFalloMotor = ultimoError !== null;
  const hayReporte = hayErrores || hayAvisos || hayFalloMotor;

  return (
    <PanelFlotante
      className="cx-calcular"
      // El "estado del motor" como tag mono en la cabecera mantiene visible si el motor
      // esta cargando/listo/calculando sin ocupar mas cromo (Spec feature-14).
      titulo="Cálculo"
      tag={rotuloEstadoMotor(estadoMotor, calculando)}
    >
      <Boton
        variante="primary"
        onClick={() => void calcular()}
        disabled={!habilitado}
        // `aria-busy` comunica a lectores de pantalla que hay trabajo en curso (motor
        // cargando o calculando) sin depender solo del texto.
        aria-busy={calculando || estadoMotor === "cargando"}
      >
        {etiqueta}
      </Boton>

      {hayReporte && (
        <div className="cx-calcular__reporte" role="status" aria-live="polite">
          {hayFalloMotor && (
            // Fallo del motor (carga o calculo): se muestra el mensaje de obra del hook
            // (ya traducido por Tarea 1.1), nunca el traceback de Python.
            <p className="cx-calcular__motor-error">{ultimoError.mensaje}</p>
          )}
          {hayErrores && (
            <ul className="cx-calcular__lista">
              {agruparMensajes(errores).map((g, i) => (
                <FilaMensaje
                  key={`${g.obra.codigo}-${i}`}
                  obra={g.obra}
                  n={g.n}
                  ids={g.ids}
                />
              ))}
            </ul>
          )}
          {hayAvisos && (
            <ul className="cx-calcular__lista">
              {agruparMensajes(avisos).map((g, i) => (
                <FilaMensaje
                  key={`${g.obra.codigo}-${i}`}
                  obra={g.obra}
                  n={g.n}
                  ids={g.ids}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </PanelFlotante>
  );
}
