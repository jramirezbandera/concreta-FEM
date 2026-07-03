import { useEffect, useSyncExternalStore } from "react";
import {
  PanelFlotante,
  Boton,
  SelectSeccion,
  SelectMaterial,
} from "../primitivas";
import { CampoExtremo, CampoTirante } from "./camposViga";
import { vistaStore, modeloStore, type DefaultsViga } from "../../estado";
import {
  DEFAULT_MATERIAL_ID,
  DEFAULT_SECCION_VIGA,
  resolverSeccionDefault,
  esCombinacionIncoherentePorId,
  mensajeCoherencia,
} from "../../biblioteca";
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
  // Secciones de obra (Capa 1): para resolver el default de obra (hormigon sembrado)
  // y para el aviso de coherencia D15. Suscripcion ligera (referencia estable via Immer).
  const seccionesObra = modeloStore((s) => s.modelo.secciones);

  // UX (D4+D5): al activar la herramienta sin seccion/material fijados, preselecciona
  // la seccion de obra por defecto (hormigon HA 30×50 sembrado; antes cogia el primer
  // PERFIL del catalogo, IPE) y el material por defecto (HA-25). Solo rellena lo vacio.
  useEffect(() => {
    const parche: Partial<DefaultsViga> = {};
    if (!defaults.seccionId) {
      const id = resolverSeccionDefault(DEFAULT_SECCION_VIGA.nombre, seccionesObra);
      if (id) parche.seccionId = id;
    }
    if (!defaults.materialId) parche.materialId = DEFAULT_MATERIAL_ID;
    if (Object.keys(parche).length > 0) setDefaults(parche);
    // Se ejecuta al montar (entrada en modo viga); las dependencias evitan
    // re-disparar tras rellenar (los ids ya no son null).
  }, [defaults.seccionId, defaults.materialId, seccionesObra, setDefaults]);

  // D15: aviso NO bloqueante si la seccion (perfil metalico / hormigon) no casa con
  // la familia del material (acero / hormigon).
  const avisoCoherencia = mensajeCoherencia(
    esCombinacionIncoherentePorId(defaults.seccionId, defaults.materialId, seccionesObra),
  );

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

      {/* D15: aviso de mezcla incoherente seccion<->material. NO bloquea la
          colocacion; solo advierte (--warning, role=status). */}
      {avisoCoherencia ? (
        <p className="cx-aviso-coherencia" role="status">
          {avisoCoherencia}
        </p>
      ) : null}

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
