import { FilaArbol, SeccionColapsable } from "../primitivas";
import { modeloStore, vistaStore } from "../../estado";
import {
  pilaresDePlanta,
  vigasDePlanta,
  panosDePlanta,
} from "../../dominio";

// Sidebar / arbol de obra (Spec Diseno UI §3.3). Secciones colapsables via la primitiva
// compartida SeccionColapsable (D14 · PR3: DRY — antes tenia un `Seccion` local con Radix
// Collapsible duplicado). Lenguaje de obra SIEMPRE: nada de nodos/members (CLAUDE §17).
// Solo lectura del modelo + setters de vistaStore. El shell usa estado reactivo normal
// (no esta en el bucle de render del viewport).
//
// Sin grupos (F3.4): el arbol lista las plantas del edificio directamente, de mayor
// a menor cota (orden CYPECAD descendente).

// Alias fino para conservar el JSX legible (<Seccion titulo=…>) tras adoptar la primitiva.
const Seccion = SeccionColapsable;

export function Sidebar() {
  // Lectura del modelo: campos sueltos via selectores. El arbol re-renderiza al
  // editar la obra (aceptable; el shell no es alta frecuencia).
  // El modelo completo: lo necesitamos para contar pilares por ambito (helpers de
  // dominio). El selector devuelve la misma referencia salvo que la obra cambie,
  // asi que el arbol solo re-renderiza al editar el modelo (no en alta frecuencia).
  const modelo = modeloStore((s) => s.modelo);
  const plantas = modelo.plantas;

  const plantaActivaId = vistaStore((s) => s.plantaActivaId);
  const setPlantaActiva = vistaStore((s) => s.setPlantaActiva);
  const abrirDialogo = vistaStore((s) => s.abrirDialogo);
  // [D11a] Conmutacion de vista desde el arbol (espejo del selector 2D/3D del HUD).
  // "Planta" -> modoVista "planta"; "Vista 3D" -> "3d". La fila activa se resalta
  // (patron FilaArbol `seleccionada`). Mosaico NO se ofrece aqui (sigue
  // "próximamente" en el HUD).
  const modoVista = vistaStore((s) => s.modoVista);
  const setModoVista = vistaStore((s) => s.setModoVista);
  // Alzados de consulta (UX-1.5): sub-vista de 3D con camara ortografica fija.
  const vista3d = vistaStore((s) => s.vista3d);
  const setVista3d = vistaStore((s) => s.setVista3d);
  const irAAlzado = (dir: "frontal" | "lateral") => {
    // El orden importa: setModoVista resetea vista3d a "orbita".
    setModoVista("3d");
    setVista3d(dir);
  };

  // Contador de un tipo de elemento en el AMBITO activo (lenguaje de obra, Spec Diseno
  // UI §3.3): planta activa si la hay; si no, el total de la obra. UN solo criterio
  // para pilares, vigas y paños (auditoria UX-A8). Conteo derivado en render: barato
  // y siempre coherente con el modelo.
  const contarEnAmbito = (
    porPlanta: (m: typeof modelo, plantaId: string) => Array<{ id: string }>,
    totalObra: number,
  ): number => {
    if (plantaActivaId) {
      return porPlanta(modelo, plantaActivaId).length;
    }
    return totalObra;
  };

  const numPilares = contarEnAmbito(pilaresDePlanta, modelo.pilares.length);
  const numVigas = contarEnAmbito(vigasDePlanta, modelo.vigas.length);
  const numPanos = contarEnAmbito(panosDePlanta, modelo.panos.length);

  // Plantas de mayor a menor cota (orden CYPECAD descendente).
  const plantasDesc = plantas.slice().sort((a, b) => b.cota - a.cota);

  return (
    <aside className="cx-sidebar" aria-label="Árbol de obra">
      <Seccion titulo="Plantas">
        {plantasDesc.length === 0 ? (
          <div className="cx-menu-empty">Sin plantas definidas</div>
        ) : (
          plantasDesc.map((planta) => (
            <FilaArbol
              key={planta.id}
              label={planta.nombre}
              contador={planta.cota.toFixed(2)}
              seleccionada={planta.id === plantaActivaId}
              onClick={() => setPlantaActiva(planta.id)}
            />
          ))
        )}
        {/* Acceso al dialogo de Plantas (feature-10/F3.4): crear/editar la
            estructura de la obra sin pasar por la menubar. */}
        <FilaArbol
          label="Gestionar plantas…"
          onClick={() => abrirDialogo("plantas")}
        />
      </Seccion>

      <Seccion titulo="Vistas" defaultAbierta={false}>
        {/* [D11a] Filas accionables: espejo de setModoVista. La activa se resalta
            (patron FilaArbol `seleccionada`). Mosaico no se ofrece (sigue en el HUD
            como "próximamente"). */}
        <FilaArbol
          label="Planta"
          seleccionada={modoVista === "planta"}
          onClick={() => setModoVista("planta")}
        />
        <FilaArbol
          label="Vista 3D"
          seleccionada={modoVista === "3d" && vista3d === "orbita"}
          onClick={() => setModoVista("3d")}
        />
        {/* Alzados de consulta (UX-1.5): encuadre ortografico fijo, solo lectura
            (el dibujo sigue siendo en planta). */}
        <FilaArbol
          label="Alzado frontal"
          seleccionada={modoVista === "3d" && vista3d === "frontal"}
          onClick={() => irAAlzado("frontal")}
        />
        <FilaArbol
          label="Alzado lateral"
          seleccionada={modoVista === "3d" && vista3d === "lateral"}
          onClick={() => irAAlzado("lateral")}
        />
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
        {/* Paños (forjados, F3): mismo criterio de ambito que pilares/vigas. Swatch
            con el token del pilar (no hay --pano dedicado; PanoHuella pinta la huella
            con --pilar, asi el arbol es coherente con el lienzo). */}
        <FilaArbol
          label="Paños"
          swatch="var(--pilar)"
          contador={numPanos}
          interactiva={false}
        />
      </Seccion>
    </aside>
  );
}
