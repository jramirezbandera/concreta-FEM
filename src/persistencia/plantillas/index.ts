// Barrel del submodulo de persistencia-referencia de plantillas DXF (feature-15).
// Reexporta la API publica; el barrel raiz de /src/persistencia la reexpone para
// que la app (App/T4.1) hable solo con /src/persistencia, sin conocer Dexie.
export {
  guardarPlantillasDeProyecto,
  cargarPlantillasDeProyecto,
  borrarPlantillasDeProyecto,
} from "./repositorioPlantillas";
export {
  iniciarAutosavePlantillas,
  cargarPlantillasEnStore,
} from "./autosavePlantillas";
