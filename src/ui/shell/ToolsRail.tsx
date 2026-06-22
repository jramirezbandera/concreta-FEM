// Tools rail (Spec Diseno UI §3.4): columna de ayudas de dibujo CAD a la derecha
// (52px). En F9 son placeholders accesibles (title + aria-label): F4 plantillas,
// F3 capturas, snap/orto/rejilla, biblioteca, config, ayuda. Sin funcion real
// todavia; las cablean feature-15 (DXF) y otras. snap/orto/rejilla mantienen un
// estado local de toggle solo para mostrar el patron visual.
import { useState } from "react";

interface HerramientaIcono {
  clave: string;
  glifo: string;
  title: string;
  /** Conmutable (snap/orto/rejilla): pinta estado activo. */
  toggle?: boolean;
}

const ANTES: HerramientaIcono[] = [
  { clave: "f4", glifo: "▦", title: "F4 · Plantillas DXF/DWG" },
  { clave: "f3", glifo: "▣", title: "F3 · Capturas" },
];
const AYUDAS: HerramientaIcono[] = [
  { clave: "snap", glifo: "⌖", title: "Referencia a objetos (snap)", toggle: true },
  { clave: "orto", glifo: "∟", title: "Modo orto", toggle: true },
  { clave: "rejilla", glifo: "▤", title: "Rejilla", toggle: true },
];
const FINALES: HerramientaIcono[] = [
  { clave: "biblioteca", glifo: "≣", title: "Biblioteca de secciones" },
  { clave: "config", glifo: "⚙", title: "Configuración" },
  { clave: "ayuda", glifo: "?", title: "Ayuda" },
];

export function ToolsRail() {
  // Estado local solo para el feedback visual de los toggles CAD. No afecta a
  // ningun store (la logica real se cablea en features posteriores).
  const [activos, setActivos] = useState<Record<string, boolean>>({
    snap: true,
    orto: false,
    rejilla: true,
  });

  const boton = (h: HerramientaIcono) => {
    const activo = h.toggle ? Boolean(activos[h.clave]) : undefined;
    return (
      <button
        key={h.clave}
        type="button"
        className="cx-iconbtn"
        title={h.title}
        aria-label={h.title}
        aria-pressed={h.toggle ? activo : undefined}
        data-activo={activo ? "true" : undefined}
        onClick={
          h.toggle
            ? () => setActivos((s) => ({ ...s, [h.clave]: !s[h.clave] }))
            : undefined
        }
      >
        {h.glifo}
      </button>
    );
  };

  return (
    <div className="cx-tools" role="toolbar" aria-label="Herramientas de dibujo">
      {ANTES.map(boton)}
      <span className="cx-tools__sep" aria-hidden="true" />
      {AYUDAS.map(boton)}
      <span className="cx-tools__sep" aria-hidden="true" />
      {FINALES.map(boton)}
    </div>
  );
}
