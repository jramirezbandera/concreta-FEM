import { useEffect, useSyncExternalStore } from "react";
import {
  PanelFlotante,
  Boton,
  SelectSeccion,
  SelectMaterial,
} from "../primitivas";
import { CampoExtremo, CampoTirante } from "./camposViga";
import { vistaStore, type DefaultsViga } from "../../estado";
import { listarSecciones, listarMateriales } from "../../biblioteca";
import "./panelHerramientaViga.css";

// PanelHerramientaViga (feature-12, Tarea 2.1): panel flotante ligero visible SOLO
// cuando la herramienta "viga" esta activa. Fija los `defaultsViga` (lo que se
// aplicara a cada viga colocada con clic) ANTES o DURANTE la colocacion. Es el
// gemelo "de creacion" del InspectorViga (que edita la viga ya seleccionada).
// Autocontrolado: se autooculta fuera del modo viga. Espejo de PanelHerramientaPilar.
//
// Vocabulario de obra (Sección, Material, Extremo, Tirante); cero jerga FEM
// (CLAUDE.md §17). Defaults viajan en vistaStore (estado de UI, NO undo).
//
// UNIDADES (CLAUDE.md §14): la seccion y el material solo se eligen por id; los
// extremos y el tirante son del dominio. No hay conversion aqui.

// Catalogos inmutables: se listan una vez fuera del render (igual que los Select*).
const PRIMERA_SECCION = listarSecciones()[0]?.id ?? null;
const PRIMER_MATERIAL = listarMateriales()[0]?.id ?? null;

// True solo en modo "viga". subscribeWithSelector -> re-render solo al conmutar.
function useHerramientaViga(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.herramienta, cb),
    () => vistaStore.getState().herramienta === "viga",
    () => vistaStore.getState().herramienta === "viga",
  );
}

// Suscripcion ligera a los defaults (cambian al editar el panel, nunca por frame).
function useDefaultsViga(): DefaultsViga {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.defaultsViga, cb),
    () => vistaStore.getState().defaultsViga,
    () => vistaStore.getState().defaultsViga,
  );
}

function PanelActivo() {
  const defaults = useDefaultsViga();
  const setDefaults = vistaStore.getState().setDefaultsViga;
  const terminar = () => vistaStore.getState().setHerramienta("seleccion");

  // UX: al activar la herramienta sin seccion/material fijados, preselecciona el
  // primero del catalogo para que el primer clic pueda colocar de inmediato (la
  // ColocacionViga ignora el clic si faltan seccion/material). Solo rellena lo
  // vacio: respeta lo que el usuario ya hubiera elegido en sesiones previas.
  useEffect(() => {
    const parche: Partial<DefaultsViga> = {};
    if (!defaults.seccionId && PRIMERA_SECCION) parche.seccionId = PRIMERA_SECCION;
    if (!defaults.materialId && PRIMER_MATERIAL) parche.materialId = PRIMER_MATERIAL;
    if (Object.keys(parche).length > 0) setDefaults(parche);
    // Se ejecuta al montar (entrada en modo viga); las dependencias evitan
    // re-disparar tras rellenar (los ids ya no son null).
  }, [defaults.seccionId, defaults.materialId, setDefaults]);

  return (
    <PanelFlotante
      className="cx-herramienta-viga"
      titulo="Nueva viga"
      tag="viga"
      // data-testid para E2E (feature-16): panel glass sin rol (es un <div .cx-float>);
      // marca que la herramienta de viga esta activa. Sus controles internos
      // (Sección, Material, Extremos, Tirante) se localizan por etiqueta/rol; el panel
      // da el gancho estable para afirmar el modo de introduccion.
      data-testid="panel-herramienta-viga"
    >
      <SelectSeccion
        etiqueta="Sección"
        valor={defaults.seccionId}
        onCambio={(id) => setDefaults({ seccionId: id })}
      />
      <SelectMaterial
        etiqueta="Material"
        valor={defaults.materialId}
        onCambio={(id) => setDefaults({ materialId: id })}
      />

      {/* Tirante => biarticulado: el discretizador fuerza ambos extremos articulados.
          Se muestran fijos en "Articulado" (no se ocultan) para no ignorar en silencio. */}
      <CampoExtremo
        className="cx-herramienta-viga__campo"
        etiqueta="Extremo I"
        valor={defaults.tirante ? "articulado" : defaults.extremoI}
        onValor={(v) => setDefaults({ extremoI: v })}
        disabled={defaults.tirante}
      />

      <CampoExtremo
        className="cx-herramienta-viga__campo"
        etiqueta="Extremo J"
        valor={defaults.tirante ? "articulado" : defaults.extremoJ}
        onValor={(v) => setDefaults({ extremoJ: v })}
        disabled={defaults.tirante}
      />

      <CampoTirante
        className="cx-herramienta-viga__campo"
        valor={defaults.tirante}
        onValor={(v) => setDefaults({ tirante: v })}
      />

      <div className="cx-herramienta-viga__acciones">
        <Boton variante="ghost" onClick={terminar}>
          Terminar
        </Boton>
      </div>
    </PanelFlotante>
  );
}

export function PanelHerramientaViga() {
  const activo = useHerramientaViga();
  if (!activo) return null;
  return <PanelActivo />;
}
