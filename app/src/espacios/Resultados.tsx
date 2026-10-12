/** Espacio Resultados: un modo por cada pantalla de resultados de V1 (`docs/fem3d/interfaz.md` §4). */
import { useVisor } from "../contexto.ts";
import { ModoDeformada } from "../pantallas/Desplomes.tsx";
import { ModoLosas } from "../pantallas/Losas.tsx";
import { ModoPilares } from "../pantallas/Pilares.tsx";
import { ModoDiagramas } from "../pantallas/Vigas.tsx";

export function EspacioResultados() {
  const { modo } = useVisor();
  if (modo === "losas") return <ModoLosas />;
  if (modo === "diagramas") return <ModoDiagramas />;
  if (modo === "pilares") return <ModoPilares />;
  return <ModoDeformada />;
}
