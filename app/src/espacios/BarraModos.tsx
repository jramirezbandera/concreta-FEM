/** Los modos de Resultados en la barra (lo que eran las pantallas de resultados de V1). */
import { Herramienta } from "../armazon/Disposicion.tsx";
import { IcDeformada, IcDiagramas, IcLosas, IcPilares, type Icono } from "../armazon/iconos.tsx";
import { useVisor, type ModoResultados } from "../contexto.ts";

const MODOS: { id: ModoResultados; nombre: string; icono: Icono; title: string }[] = [
  { id: "losas", nombre: "Losas", icono: IcLosas, title: "uz, M11, M22, M12, V13 y V23 por planta" },
  { id: "diagramas", nombre: "Diagramas", icono: IcDiagramas, title: "Diagramas de las vigas y su envolvente por vanos" },
  { id: "pilares", nombre: "Pilares", icono: IcPilares, title: "Axil de los tramos y cuadro de pilares" },
  { id: "deformada", nombre: "Deformada", icono: IcDeformada, title: "Deformada en 3D y desplomes por planta" },
];

export function BarraModos() {
  const { modo, irA } = useVisor();
  return (
    <>
      {MODOS.map((m) => (
        <Herramienta key={m.id} icono={m.icono} nombre={m.nombre} activa={modo === m.id} title={m.title} onClick={() => irA("resultados", m.id)} />
      ))}
    </>
  );
}
