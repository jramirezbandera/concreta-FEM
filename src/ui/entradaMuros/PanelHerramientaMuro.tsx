// PanelHerramientaMuro (F3, muros): panel flotante visible SOLO con la herramienta
// "muro" activa. Fija los `defaultsMuro` (lo que se aplica a cada muro colocado por
// dos clics del eje) ANTES o DURANTE la colocación. Gemelo "de creación" del
// InspectorMuro. Espejo de PanelHerramientaPano.
//
// Vocabulario de obra (Espesor, Material, Tamaño de malla, Anclado al terreno); cero
// jerga FEM (CLAUDE.md §17). Defaults viajan en vistaStore (estado de UI, NO undo).
import { useEffect, useSyncExternalStore } from "react";
import { PanelFlotante, Boton, SelectMaterial } from "../primitivas";
import { CampoLongitudMm, CampoVinculacionMuro } from "./camposMuro";
import { vistaStore, type DefaultsMuro } from "../../estado";
import { DEFAULT_MATERIAL_ID } from "../../biblioteca";
import "./panelHerramientaMuro.css";

// True solo en modo "muro". subscribeWithSelector -> re-render solo al conmutar.
function useHerramientaMuro(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.herramienta, cb),
    () => vistaStore.getState().herramienta === "muro",
    () => vistaStore.getState().herramienta === "muro",
  );
}

function useDefaultsMuro(): DefaultsMuro {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.defaultsMuro, cb),
    () => vistaStore.getState().defaultsMuro,
    () => vistaStore.getState().defaultsMuro,
  );
}

function PanelActivo() {
  const defaults = useDefaultsMuro();
  const setDefaults = vistaStore.getState().setDefaultsMuro;
  const terminar = () => vistaStore.getState().setHerramienta("seleccion");

  // Al activar la herramienta sin material fijado, preselecciona el material por
  // defecto (HA-25). La ColocacionMuro ignora el clic si falta material.
  useEffect(() => {
    if (!defaults.materialId) {
      setDefaults({ materialId: DEFAULT_MATERIAL_ID });
    }
  }, [defaults.materialId, setDefaults]);

  return (
    <PanelFlotante
      className="cx-herramienta-muro"
      titulo="Nuevo muro"
      tag="muro"
      data-testid="panel-herramienta-muro"
    >
      <SelectMaterial
        etiqueta="Material"
        valor={defaults.materialId}
        onCambio={(id) => setDefaults({ materialId: id })}
      />
      <CampoLongitudMm
        etiqueta="Espesor"
        valorM={defaults.espesor}
        onValorM={(m) => {
          if (Number.isFinite(m)) setDefaults({ espesor: m });
        }}
      />
      <CampoLongitudMm
        etiqueta="Tamaño de malla"
        valorM={defaults.tamMalla}
        onValorM={(m) => {
          if (Number.isFinite(m)) setDefaults({ tamMalla: m });
        }}
      />
      <CampoVinculacionMuro
        className="cx-herramienta-muro__campo"
        valor={defaults.vinculacionExterior}
        onValor={(v) => setDefaults({ vinculacionExterior: v })}
      />

      {/* Nota de honestidad del corte (F3, muros): el muro se traza por su EJE (dos
          clics, paralelo a los ejes), rigidiza lateralmente el edificio (mueve el
          centro de rigidez) y recibe el forjado a través de una viga de coronación
          coincidente; aún no admite cargas laterales de viento/empuje. */}
      <p className="cx-note">
        Traza el muro por su eje (dos clics). El muro rigidiza el edificio frente a
        acciones horizontales; la losa apoya en él a través de una viga sobre su eje.
        Todavía no admite empujes de viento ni de tierras.
      </p>

      <div className="cx-herramienta-muro__acciones">
        <Boton variante="ghost" onClick={terminar}>
          Terminar
        </Boton>
      </div>
    </PanelFlotante>
  );
}

export function PanelHerramientaMuro() {
  const activo = useHerramientaMuro();
  if (!activo) return null;
  return <PanelActivo />;
}
