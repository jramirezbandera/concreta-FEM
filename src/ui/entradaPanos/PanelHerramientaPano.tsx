// PanelHerramientaPano (F3): panel flotante ligero visible SOLO cuando la herramienta
// "pano" esta activa. Fija los `defaultsPano` (lo que se aplicara a cada paño colocado
// por dos clics) ANTES o DURANTE la colocacion. Gemelo "de creacion" del InspectorPano
// (que edita el paño ya seleccionado). Autocontrolado: se autooculta fuera del modo
// paño. Espejo de PanelHerramientaViga.
//
// Vocabulario de obra (Espesor, Material, Tamaño de malla, Apoyo de borde); cero jerga
// FEM (CLAUDE.md §17). Defaults viajan en vistaStore (estado de UI, NO undo).
//
// UNIDADES (CLAUDE.md §14): espesor y tamaño de malla se muestran/teclean en mm (campos
// CampoLongitudMm); el dominio guarda m. El material se elige por id.
import { useEffect, useSyncExternalStore } from "react";
import { PanelFlotante, Boton, SelectMaterial } from "../primitivas";
import { CampoBordeApoyo, CampoLongitudMm } from "./camposPano";
import { vistaStore, type DefaultsPano } from "../../estado";
import { listarMateriales } from "../../biblioteca";
import "./panelHerramientaPano.css";

const PRIMER_MATERIAL = listarMateriales()[0]?.id ?? null;

// True solo en modo "pano". subscribeWithSelector -> re-render solo al conmutar.
function useHerramientaPano(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.herramienta, cb),
    () => vistaStore.getState().herramienta === "pano",
    () => vistaStore.getState().herramienta === "pano",
  );
}

function useDefaultsPano(): DefaultsPano {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.defaultsPano, cb),
    () => vistaStore.getState().defaultsPano,
    () => vistaStore.getState().defaultsPano,
  );
}

function PanelActivo() {
  const defaults = useDefaultsPano();
  const setDefaults = vistaStore.getState().setDefaultsPano;
  const terminar = () => vistaStore.getState().setHerramienta("seleccion");

  // UX: al activar la herramienta sin material fijado, preselecciona el primero del
  // catalogo para que el primer dibujo pueda crear de inmediato (la ColocacionPano ignora
  // el clic si falta material). Solo rellena lo vacio.
  useEffect(() => {
    if (!defaults.materialId && PRIMER_MATERIAL) {
      setDefaults({ materialId: PRIMER_MATERIAL });
    }
  }, [defaults.materialId, setDefaults]);

  return (
    <PanelFlotante
      className="cx-herramienta-pano"
      titulo="Nuevo paño"
      tag="losa"
      data-testid="panel-herramienta-pano"
    >
      <CampoLongitudMm
        etiqueta="Espesor"
        valorM={defaults.espesor}
        onValorM={(m) => {
          if (Number.isFinite(m)) setDefaults({ espesor: m });
        }}
      />
      <SelectMaterial
        etiqueta="Material"
        valor={defaults.materialId}
        onCambio={(id) => setDefaults({ materialId: id })}
      />
      <CampoLongitudMm
        etiqueta="Tamaño de malla"
        valorM={defaults.tamMalla}
        onValorM={(m) => {
          if (Number.isFinite(m)) setDefaults({ tamMalla: m });
        }}
      />
      <CampoBordeApoyo
        className="cx-herramienta-pano__campo"
        valor={defaults.bordeApoyo}
        onValor={(v) => setDefaults({ bordeApoyo: v })}
      />

      <div className="cx-herramienta-pano__acciones">
        <Boton variante="ghost" onClick={terminar}>
          Terminar
        </Boton>
      </div>
    </PanelFlotante>
  );
}

export function PanelHerramientaPano() {
  const activo = useHerramientaPano();
  if (!activo) return null;
  return <PanelActivo />;
}
