import { useState, type ReactNode } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { FilaArbol } from "../primitivas";
import { modeloStore, vistaStore } from "../../estado";
import { pilaresDePlanta, plantasDeGrupo } from "../../dominio";

// Sidebar / arbol de obra (Spec Diseno UI §3.3). Secciones colapsables
// (Radix Collapsible). Lenguaje de obra SIEMPRE: nada de nodos/members (CLAUDE
// §17). Solo lectura del modelo + setters de vistaStore. El shell usa estado
// reactivo normal (no esta en el bucle de render del viewport).

interface SeccionProps {
  titulo: string;
  defaultAbierta?: boolean;
  children: ReactNode;
}

function Seccion({ titulo, defaultAbierta = true, children }: SeccionProps) {
  const [abierta, setAbierta] = useState(defaultAbierta);
  return (
    <Collapsible.Root
      className="cx-side-sec"
      open={abierta}
      onOpenChange={setAbierta}
    >
      <Collapsible.Trigger asChild>
        <button
          type="button"
          className="cx-side-sec__head caps"
          data-state={abierta ? "open" : "closed"}
        >
          <span className="cx-side-sec__chevron" aria-hidden="true">
            ▶
          </span>
          <span className="cx-side-sec__title">{titulo}</span>
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="cx-side-sec__body">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

export function Sidebar() {
  // Lectura del modelo: campos sueltos via selectores. El arbol re-renderiza al
  // editar la obra (aceptable; el shell no es alta frecuencia).
  // El modelo completo: lo necesitamos para contar pilares por ambito (helpers de
  // dominio). El selector devuelve la misma referencia salvo que la obra cambie,
  // asi que el arbol solo re-renderiza al editar el modelo (no en alta frecuencia).
  const modelo = modeloStore((s) => s.modelo);
  const grupos = modelo.grupos;
  const plantas = modelo.plantas;
  const numVigas = modelo.vigas.length;

  const grupoActivoId = vistaStore((s) => s.grupoActivoId);
  const plantaActivaId = vistaStore((s) => s.plantaActivaId);
  const setGrupoActivo = vistaStore((s) => s.setGrupoActivo);
  const setPlantaActiva = vistaStore((s) => s.setPlantaActiva);
  const abrirDialogo = vistaStore((s) => s.abrirDialogo);

  // Contador de pilares del AMBITO activo (lenguaje de obra, Spec Diseno UI §3.3):
  // planta activa si la hay; si no, todo el grupo activo (pilares distintos, para no
  // contar dos veces un pilar pasante que arranca y termina en plantas del grupo);
  // si tampoco hay grupo, el total de la obra. Conteo derivado en render: barato y
  // siempre coherente con el modelo (no es estado nuevo, no toca el viewport).
  const numPilares = (() => {
    if (plantaActivaId) {
      return pilaresDePlanta(modelo, plantaActivaId).length;
    }
    if (grupoActivoId) {
      const idsPilares = new Set<string>();
      for (const planta of plantasDeGrupo(modelo, grupoActivoId)) {
        for (const pilar of pilaresDePlanta(modelo, planta.id)) {
          idsPilares.add(pilar.id);
        }
      }
      return idsPilares.size;
    }
    return modelo.pilares.length;
  })();

  const seleccionarPlanta = (grupoId: string, plantaId: string) => {
    setGrupoActivo(grupoId);
    setPlantaActiva(plantaId);
  };

  return (
    <aside className="cx-sidebar" aria-label="Árbol de obra">
      <Seccion titulo="Plantas / Grupos">
        {grupos.length === 0 ? (
          <div className="cx-menu-empty">Sin grupos definidos</div>
        ) : (
          grupos.map((grupo) => {
            // Plantas del grupo, de mayor a menor cota (orden CYPECAD descendente).
            const plantasGrupo = plantas
              .filter((p) => p.grupoId === grupo.id)
              .sort((a, b) => b.cota - a.cota);
            return (
              <div key={grupo.id}>
                {/* Cabecera de grupo: rotulo, no accion (todavia no se selecciona grupo aqui). */}
                <FilaArbol label={grupo.nombre} interactiva={false} />
                <div className="cx-side-indent">
                  {plantasGrupo.map((planta) => (
                    <FilaArbol
                      key={planta.id}
                      label={planta.nombre}
                      contador={planta.cota.toFixed(2)}
                      seleccionada={planta.id === plantaActivaId}
                      onClick={() => seleccionarPlanta(grupo.id, planta.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
        {/* Acceso al dialogo de Plantas y grupos (feature-10): crear/editar la
            estructura de la obra sin pasar por la menubar. */}
        <FilaArbol
          label="Gestionar plantas y grupos…"
          onClick={() => abrirDialogo("gruposPlantas")}
        />
      </Seccion>

      <Seccion titulo="Vistas" defaultAbierta={false}>
        {/* Sin accion en F9: la conmutacion de vista llega con feature posterior. */}
        <FilaArbol label="Planta de grupo" interactiva={false} />
        <FilaArbol label="Vista 3D" interactiva={false} />
      </Seccion>

      <Seccion titulo="Elementos propios">
        {/* Filas-dato (swatch + contador): informativas, no pulsables. */}
        <FilaArbol
          label="Pilares"
          swatch="var(--pilar)"
          contador={numPilares}
          interactiva={false}
        />
        <FilaArbol
          label="Vigas"
          swatch="var(--viga)"
          contador={numVigas}
          interactiva={false}
        />
      </Seccion>
    </aside>
  );
}
