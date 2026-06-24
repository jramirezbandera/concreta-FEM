import { useRef, useState, useSyncExternalStore } from "react";
import { PanelFlotante, Boton, CampoNumero } from "../primitivas";
import { vistaStore, nuevoId } from "../../estado";
import { parseDxf } from "../viewport/dxf/parseDxf";
import { PlantillaSchema, type Plantilla } from "../viewport/dxf/tiposDxf";
import "./panelPlantillas.css";

// Topes defensivos del borde de importacion. El parse de dxf-parser corre en el
// hilo principal (worker-isolation = TODO); el tope de tamano es la mitigacion de
// freeze por ahora, y el de entidades acota geometria patologica.
const MAX_DXF_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_ENTIDADES = 100000;

// PanelPlantillas (feature-15, T3.1): panel flotante (hudOverlay) de la herramienta
// F4. Importa un fichero DXF como CALCO de fondo de la planta activa y gestiona sus
// plantillas (visibilidad, bloqueo, eliminar, seleccionar) y su transform
// (escala / origen X·Y / rotacion / opacidad).
//
// INVARIANTE (feature-15): las plantillas son ayuda de dibujo, NO Capa 1. Viven en
// vistaStore (UI), fuera del undo: cada edicion es una llamada DIRECTA a las acciones
// del store (sin comandos). El boton F4 (T4.1) conmuta `panelPlantillasAbierto`.
//
// UNIDADES (CLAUDE.md §14): origen X·Y en METROS (= sistema interno), rotacion en
// GRADOS, opacidad 0..1 (se muestra como % en el borde del control). La conversion
// DXF -> metros ya la hizo parseDxf en el borde de importacion; aqui no hay mas.
//
// Vocabulario de obra (Plantilla, Escala, Origen, Rotacion, Opacidad); cero jerga
// FEM ni de fichero CAD interno.

// --- Suscripciones finas al store (re-render solo al cambiar lo observado) ------

function usePanelAbierto(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.panelPlantillasAbierto, cb),
    () => vistaStore.getState().panelPlantillasAbierto,
    () => vistaStore.getState().panelPlantillasAbierto,
  );
}

function usePlantillas(): Plantilla[] {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.plantillas, cb),
    () => vistaStore.getState().plantillas,
    () => vistaStore.getState().plantillas,
  );
}

function usePlantaActivaId(): string | null {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.plantaActivaId, cb),
    () => vistaStore.getState().plantaActivaId,
    () => vistaStore.getState().plantaActivaId,
  );
}

function usePlantillaActivaId(): string | null {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.plantillaActivaId, cb),
    () => vistaStore.getState().plantillaActivaId,
    () => vistaStore.getState().plantillaActivaId,
  );
}

// Hidratacion de persistencia completa (feature-15, T3): gatea la importacion para
// no perder un DXF importado antes de que la carga asincrona del proyecto resuelva.
function usePersistenciaLista(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.persistenciaLista, cb),
    () => vistaStore.getState().persistenciaLista,
    () => vistaStore.getState().persistenciaLista,
  );
}

// Deriva el nombre visible de la plantilla del nombre de archivo (sin extension).
// "Planta baja.dxf" -> "Planta baja". Si queda vacio, usa el nombre completo.
function nombreDesdeArchivo(nombreArchivo: string): string {
  const sinExt = nombreArchivo.replace(/\.[^.]+$/, "").trim();
  return sinExt.length > 0 ? sinExt : nombreArchivo;
}

// Mensaje de avisos del ultimo import (entidades no soportadas + avisos del parser).
// Lenguaje claro, sin jerga: nombramos los tipos DXF omitidos tal cual (TEXT,
// SPLINE...) porque es lo que el usuario ve en su CAD, no jerga FEM.
function mensajesDeImport(
  noSoportadas: string[],
  avisos: string[],
): string[] {
  const msgs = [...avisos];
  if (noSoportadas.length > 0) {
    msgs.push(`Entidades no soportadas omitidas: ${noSoportadas.join(", ")}.`);
  }
  return msgs;
}

// --- Importador de DXF ----------------------------------------------------------

interface ImportadorProps {
  plantaActivaId: string | null;
  onAvisos: (msgs: string[]) => void;
}

function Importador({ plantaActivaId, onAvisos }: ImportadorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // true mientras se lee/parsea el fichero (parseDxf es async por el import()
  // dinamico de dxf-parser). Deshabilita el boton para no encolar imports.
  const [importando, setImportando] = useState(false);
  // Gate #8: no importar hasta que la persistencia haya hidratado. Importar antes
  // de que cargarPlantillasEnStore resuelva perderia el import (lo sobrescribiria).
  const lista = usePersistenciaLista();

  const elegir = () => inputRef.current?.click();

  const alElegirFichero = async (file: File | undefined) => {
    if (!file) return;
    // Gate de hidratacion: si la persistencia aun no esta lista, no importamos (un
    // setPlantillas tardio de la carga pisaria este import).
    if (!lista) {
      onAvisos(["Cargando proyecto… espera un momento antes de importar."]);
      return;
    }
    // Sin planta activa no hay donde anclar el calco: avisa y no importa.
    if (!plantaActivaId) {
      onAvisos(["Selecciona una planta antes de importar."]);
      return;
    }
    // Tope de tamano ANTES de leer/parsear: no encolar un fichero enorme que
    // congele el hilo principal (el parse no esta aislado en worker todavia).
    if (file.size > MAX_DXF_BYTES) {
      onAvisos(["El fichero DXF es demasiado grande (máx 25 MB)."]);
      return;
    }
    setImportando(true);
    try {
      const texto = await file.text();
      const { entidades, noSoportadas, avisos } = await parseDxf(texto);

      // DXF vacio/corrupto: no creamos una plantilla en blanco (no hay nada que
      // calcar). Avisamos en lenguaje de obra y abortamos.
      if (entidades.length === 0) {
        onAvisos([
          "No se pudo importar: el DXF no contiene entidades soportadas (líneas, polilíneas, puntos, círculos, arcos).",
          ...avisos,
        ]);
        return;
      }
      // Tope de entidades: geometria patologica que ralentizaria render/snap.
      if (entidades.length > MAX_ENTIDADES) {
        onAvisos([
          "El DXF tiene demasiadas entidades (máx 100000); importación cancelada.",
        ]);
        return;
      }

      const id = nuevoId();
      const plantilla: Plantilla = {
        id,
        nombre: nombreDesdeArchivo(file.name),
        nombreArchivo: file.name,
        plantaId: plantaActivaId,
        entidades,
        // Transform por defecto: sin desplazar, sin escalar ni rotar, calco tenue.
        transform: { x: 0, y: 0, escala: 1, rotacion: 0, opacidad: 0.7 },
        visible: true,
        bloqueado: false,
        creadaEn: Date.now(),
      };

      // Zod en la frontera de import (CLAUDE.md §8): si la geometria parseada no
      // valida (coords no finitas, radios <= 0...), NO entra al store.
      const result = PlantillaSchema.safeParse(plantilla);
      if (!result.success) {
        onAvisos(["El DXF contiene geometría inválida y no se pudo importar."]);
        if (import.meta.env.DEV) {
          console.error("[plantillas] DXF invalido:", result.error.issues);
        }
        return;
      }

      const v = vistaStore.getState();
      v.addPlantilla(plantilla);
      v.setPlantillaActiva(id);
      onAvisos(mensajesDeImport(noSoportadas, avisos));
    } finally {
      setImportando(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".dxf"
        // Oculto: el boton "Importar DXF" lo dispara. style en vez de display:none
        // para que siga siendo accesible por el label asociado en test.
        style={{ display: "none" }}
        aria-label="Importar DXF"
        onChange={(e) => {
          void alElegirFichero(e.target.files?.[0] ?? undefined);
          // Permite re-importar el mismo fichero (onChange no dispara si el value
          // no cambia).
          e.target.value = "";
        }}
      />
      <Boton onClick={elegir} disabled={importando || !lista}>
        {importando ? "Importando…" : !lista ? "Cargando…" : "Importar DXF"}
      </Boton>
    </>
  );
}

// --- Fila de la lista de plantillas ---------------------------------------------

interface FilaProps {
  plantilla: Plantilla;
  activa: boolean;
}

function FilaPlantilla({ plantilla, activa }: FilaProps) {
  const v = vistaStore.getState();
  const clases = [
    "cx-panel-plantillas__fila",
    activa && "cx-panel-plantillas__fila--activa",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li className={clases}>
      <button
        type="button"
        className="cx-panel-plantillas__nombre"
        title={plantilla.nombreArchivo}
        onClick={() => v.setPlantillaActiva(plantilla.id)}
      >
        {plantilla.nombre}
      </button>

      <button
        type="button"
        className={[
          "cx-panel-plantillas__icono",
          plantilla.visible && "cx-panel-plantillas__icono--activo",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-pressed={plantilla.visible}
        aria-label={plantilla.visible ? "Ocultar plantilla" : "Mostrar plantilla"}
        title={plantilla.visible ? "Ocultar" : "Mostrar"}
        onClick={() =>
          v.actualizarPlantilla(plantilla.id, { visible: !plantilla.visible })
        }
      >
        {plantilla.visible ? "👁" : "—"}
      </button>

      <button
        type="button"
        className={[
          "cx-panel-plantillas__icono",
          plantilla.bloqueado && "cx-panel-plantillas__icono--activo",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-pressed={plantilla.bloqueado}
        aria-label={plantilla.bloqueado ? "Desbloquear plantilla" : "Bloquear plantilla"}
        title={plantilla.bloqueado ? "Desbloquear" : "Bloquear"}
        onClick={() =>
          v.actualizarPlantilla(plantilla.id, { bloqueado: !plantilla.bloqueado })
        }
      >
        {plantilla.bloqueado ? "🔒" : "🔓"}
      </button>

      <button
        type="button"
        className="cx-panel-plantillas__icono"
        aria-label="Eliminar plantilla"
        title="Eliminar"
        onClick={() => v.quitarPlantilla(plantilla.id)}
      >
        ✕
      </button>
    </li>
  );
}

// --- Controles de transform de la plantilla activa ------------------------------

interface TransformProps {
  plantilla: Plantilla;
}

function ControlesTransform({ plantilla }: TransformProps) {
  const v = vistaStore.getState();
  const t = plantilla.transform;
  const bloqueada = plantilla.bloqueado;
  // Bloqueada: los controles se muestran pero deshabilitados (no se edita el calco
  // anclado). CampoNumero no expone `disabled`, asi que envolvemos en un fieldset.
  return (
    <fieldset
      className="cx-panel-plantillas__transform"
      disabled={bloqueada}
      // <fieldset disabled> ya deshabilita los inputs descendientes; el estilo CAD
      // del propio fieldset es neutro (sin borde de navegador).
      style={{ border: "none", margin: 0, padding: 0 }}
    >
      <CampoNumero
        etiqueta="Escala"
        valor={t.escala}
        // Escala invalida (<=0 o no numerica) se ignora: conserva la actual.
        onCommit={(val) =>
          v.actualizarPlantilla(plantilla.id, {
            transform: { escala: Number.isFinite(val) && val > 0 ? val : t.escala },
          })
        }
      />

      <div className="cx-panel-plantillas__fila-doble">
        <CampoNumero
          etiqueta="Origen X"
          sufijo="m"
          valor={t.x}
          onCommit={(val) =>
            v.actualizarPlantilla(plantilla.id, {
              transform: { x: Number.isFinite(val) ? val : t.x },
            })
          }
        />
        <CampoNumero
          etiqueta="Origen Y"
          sufijo="m"
          valor={t.y}
          onCommit={(val) =>
            v.actualizarPlantilla(plantilla.id, {
              transform: { y: Number.isFinite(val) ? val : t.y },
            })
          }
        />
      </div>

      <CampoNumero
        etiqueta="Rotación"
        sufijo="°"
        valor={t.rotacion}
        onCommit={(val) =>
          v.actualizarPlantilla(plantilla.id, {
            transform: { rotacion: Number.isFinite(val) ? val : t.rotacion },
          })
        }
      />

      <CampoNumero
        etiqueta="Opacidad"
        sufijo="%"
        // Borde de UI: opacidad interna 0..1 -> % en el control. Se reconvierte al
        // commitear y se acota a [0, 100] -> [0, 1].
        valor={Math.round(t.opacidad * 100)}
        onCommit={(val) => {
          if (!Number.isFinite(val)) return;
          const pct = Math.min(100, Math.max(0, val));
          v.actualizarPlantilla(plantilla.id, {
            transform: { opacidad: pct / 100 },
          });
        }}
      />
    </fieldset>
  );
}

// --- Panel ----------------------------------------------------------------------

function PanelAbierto() {
  const plantillas = usePlantillas();
  const plantaActivaId = usePlantaActivaId();
  const plantillaActivaId = usePlantillaActivaId();
  // Avisos del ULTIMO import (entidades omitidas, unidades). Estado local efimero.
  const [avisos, setAvisos] = useState<string[]>([]);

  const cerrar = () => vistaStore.getState().setPanelPlantillas(false);

  // Solo las plantillas de la planta activa (el calco es por planta).
  const dePlanta = plantillas.filter((p) => p.plantaId === plantaActivaId);
  // La plantilla en edicion, si pertenece a la planta activa y esta seleccionada.
  const activa =
    dePlanta.find((p) => p.id === plantillaActivaId) ?? null;

  return (
    <PanelFlotante
      className="cx-panel-plantillas"
      titulo="Plantillas"
      tag="F4"
    >
      <Importador plantaActivaId={plantaActivaId} onAvisos={setAvisos} />

      {avisos.length > 0 ? (
        <div className="cx-panel-plantillas__avisos" role="status">
          {avisos.map((msg, i) => (
            <span key={i} className="cx-panel-plantillas__aviso">
              {msg}
            </span>
          ))}
        </div>
      ) : null}

      {dePlanta.length === 0 ? (
        <p className="cx-panel-plantillas__vacio">
          No hay plantillas en esta planta. Importa un DXF para calcar sobre él.
        </p>
      ) : (
        <ul className="cx-panel-plantillas__lista">
          {dePlanta.map((p) => (
            <FilaPlantilla
              key={p.id}
              plantilla={p}
              activa={p.id === plantillaActivaId}
            />
          ))}
        </ul>
      )}

      {activa ? <ControlesTransform plantilla={activa} /> : null}

      <div className="cx-panel-plantillas__acciones">
        <Boton variante="ghost" onClick={cerrar}>
          Cerrar
        </Boton>
      </div>
    </PanelFlotante>
  );
}

export function PanelPlantillas() {
  const abierto = usePanelAbierto();
  if (!abierto) return null;
  return <PanelAbierto />;
}
