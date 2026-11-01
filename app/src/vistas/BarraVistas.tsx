/**
 * Las vistas en la barra de herramientas (I2): el tipo de la vista activa (planta, alzado o 3D) y la
 * disposición (1, 1|1, 1/1 o 2×2; también Ctrl+1…4). UI-7: el tipo, sólo con sus iconos (también
 * está en el chip de cada vista), y las cuatro disposiciones en un botón con su menú, para que la
 * barra quepa en un portátil.
 */
import { ChevronDown } from "lucide-react";
import { MenuFlotante, Separador } from "../armazon/Disposicion.tsx";
import { Ic3D, IcAlzado, IcDisp1, IcDisp2, IcDisp3, IcDisp4, IcPlanta } from "../armazon/iconos.tsx";
import { useVisor } from "../contexto.ts";
import { DISPOSICIONES, useVistas } from "./estado.ts";

const ICONOS = { "1": IcDisp1, "1|1": IcDisp2, "1/1": IcDisp3, "2x2": IcDisp4 } as const;

export function BarraVistas() {
  const v = useVistas();
  const { proyecto } = useVisor();
  const tipo = v.vistas[v.activa]!.tipo;
  const sinEjes = !proyecto.estado?.ejes.length;
  const tipos = [
    { id: "planta", nombre: "Planta", icono: IcPlanta, title: "La vista activa, en planta" },
    { id: "alzado", nombre: "Alzado", icono: IcAlzado, title: sinEjes ? "La vista activa, en alzado: va por un eje de replanteo, y aún no hay ninguno" : "La vista activa, en alzado (por un eje)" },
    { id: "3d", nombre: "3D", icono: Ic3D, title: "La vista activa, en 3D" },
  ] as const;
  const actual = DISPOSICIONES.find((d) => d.id === v.disposicion)!;
  const IcActual = ICONOS[actual.id];
  return (
    <>
      <div className="herr-seg herr-tipos" role="group" aria-label="Tipo de la vista activa">
        <span className="herr-seg-et">Vista</span>
        <div>
          {tipos.map((t) => (
            <button key={t.id} type="button" data-on={tipo === t.id} aria-pressed={tipo === t.id} aria-label={t.nombre} title={t.title} onClick={() => v.irATipo(t.id)}>
              <t.icono size={16} />
            </button>
          ))}
        </div>
      </div>
      <Separador />
      <MenuFlotante
        etiqueta="Disposición de las vistas"
        boton={({ abierto, alternar, ref }) => (
          <button ref={ref} type="button" className="herr" data-on={abierto} aria-haspopup="menu" aria-expanded={abierto} aria-label={`Disposición: ${actual.nombre}`} title={`Cuántas vistas y cómo (Ctrl+1…4): ahora, ${actual.nombre.toLowerCase()}`} onClick={alternar}>
            <IcActual size={20} />
            <span>
              Vistas <ChevronDown size={11} className="inline" aria-hidden="true" />
            </span>
          </button>
        )}
      >
        {DISPOSICIONES.map((d) => {
          const I = ICONOS[d.id];
          return (
            <button key={d.id} type="button" role="menuitemradio" aria-checked={v.disposicion === d.id} data-on={v.disposicion === d.id} onClick={() => v.setDisposicion(d.id)}>
              <I size={18} />
              <span className="flex-1">{d.nombre}</span>
              <span className="kbd">{d.atajo}</span>
            </button>
          );
        })}
      </MenuFlotante>
    </>
  );
}
