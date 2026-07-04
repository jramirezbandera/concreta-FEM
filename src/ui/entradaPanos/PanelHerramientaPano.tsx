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
import { DEFAULT_MATERIAL_ID } from "../../biblioteca";
import "./panelHerramientaPano.css";

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

  // UX (D4+D5): al activar la herramienta sin material fijado, preselecciona el
  // material por defecto (HA-25; la losa default pasa a hormigon, coherente con el MVP;
  // antes cogia el primero del catalogo). Solo rellena lo vacio. La ColocacionPano ignora
  // el clic si falta material.
  useEffect(() => {
    if (!defaults.materialId) {
      setDefaults({ materialId: DEFAULT_MATERIAL_ID });
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

      {/* UX-C9 (reescrita en F3.2; ampliada en F2.3): la losa DESCARGA en el portico
          cuando su contorno coincide con vigas, y ademas en los pilares que queden
          por DENTRO de su superficie (losa plana); el bordeApoyo queda como fallback
          de los bordes sin viga. Se comunica ANTES de colocar para fijar la
          expectativa: dibujarla sobre vigas/pilares = acoplada. */}
      <p className="cx-note">
        La losa descarga en las vigas y pilares de su contorno cuando los comparte, y
        también en los pilares que queden por dentro de su superficie; en los bordes
        sin viga se usa el apoyo de borde elegido.
      </p>

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
