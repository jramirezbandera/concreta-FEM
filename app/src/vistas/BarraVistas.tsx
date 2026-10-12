/**
 * Las vistas en la barra de herramientas (I2): el tipo de la vista activa (planta, alzado o 3D) y la
 * disposición (1, 1|1, 1/1 o 2×2; también Ctrl+1…4).
 */
import { Herramienta, Separador } from "../armazon/Disposicion.tsx";
import { Ic3D, IcAlzado, IcDisp1, IcDisp2, IcDisp3, IcDisp4, IcPlanta } from "../armazon/iconos.tsx";
import { useVisor } from "../contexto.ts";
import { DISPOSICIONES, useVistas } from "./estado.ts";

const ICONOS = { "1": IcDisp1, "1|1": IcDisp2, "1/1": IcDisp3, "2x2": IcDisp4 } as const;
const CORTOS = { "1": "1", "1|1": "1 | 1", "1/1": "1 / 1", "2x2": "2 × 2" } as const;

export function BarraVistas() {
  const v = useVistas();
  const { proyecto } = useVisor();
  const tipo = v.vistas[v.activa]!.tipo;
  const sinEjes = !proyecto.estado?.ejes.length;
  return (
    <>
      <Herramienta icono={IcPlanta} nombre="Planta" activa={tipo === "planta"} onClick={() => v.irATipo("planta")} title="La vista activa, en planta" />
      <Herramienta icono={IcAlzado} nombre="Alzado" activa={tipo === "alzado"} disabled={sinEjes} onClick={() => v.irATipo("alzado")} title={sinEjes ? "Sin ejes de replanteo" : "La vista activa, en alzado (por un eje)"} />
      <Herramienta icono={Ic3D} nombre="3D" activa={tipo === "3d"} onClick={() => v.irATipo("3d")} title="La vista activa, en 3D" />
      <Separador />
      {DISPOSICIONES.map((d) => (
        <Herramienta key={d.id} icono={ICONOS[d.id]} nombre={CORTOS[d.id]} activa={v.disposicion === d.id} onClick={() => v.setDisposicion(d.id)} title={`${d.nombre} (${d.atajo})`} />
      ))}
    </>
  );
}
