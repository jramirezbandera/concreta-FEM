import * as Select from "@radix-ui/react-select";
import { listarSecciones } from "../../biblioteca";
import { modeloStore } from "../../estado";
import type { Seccion } from "../../dominio";

// SelectSeccion (feature-11, T3.1): selector de la seccion de un pilar. Las opciones
// son DOS familias:
//   1. Catalogo FIJO de la biblioteca (`listarSecciones()`): perfiles metalicos
//      IPE/HEB. Inmutable -> se lista una vez fuera del render.
//   2. Secciones PARAMETRICAS de la obra (`modelo.secciones`, Capa 1): hormigon
//      rectangular/circular que el usuario dimensiona. Cambian con la obra, asi que
//      se leen con una suscripcion LIGERA al modeloStore (hook con selector sobre
//      `subscribeWithSelector`): re-render SOLO cuando la referencia del array
//      cambia (Immer la preserva si no se tocan las secciones), nunca por frame
//      (regla de oro del viewport, #11).
// El `value` de cada item es el `id`; la etiqueta visible es un `nombre` legible.
// Reusa las clases .cx-select* de SelectUso para identico look CAD.
const OPCIONES_CATALOGO = listarSecciones();

export interface SelectSeccionProps {
  // `null` => placeholder "Seccion…" (pilar sin seccion asignada todavia).
  valor: string | null;
  onCambio: (id: string) => void;
  etiqueta?: string;
}

// Etiqueta legible de una seccion de OBRA (Capa 1). Si el usuario le ha puesto
// `nombre`, gana (es lo que escribio). Si no, se deriva por tipo. Las dimensiones
// del dominio estan en METROS (interno, §14); en UI se muestran en mm, asi que se
// multiplican por 1000 en este borde de presentacion (la UI nunca convierte en
// mitad de la logica; aqui es el borde de salida hacia la etiqueta).
function etiquetaSeccionObra(s: Seccion): string {
  if (s.nombre.trim() !== "") return s.nombre;
  switch (s.tipo) {
    case "hormigonRectangular":
      return `Rectangular ${s.b * 1000}×${s.h * 1000}`;
    case "hormigonCircular":
      return `Circular Ø${s.d * 1000}`;
    case "perfilMetalico":
      return s.perfilId;
    case "generico":
      return s.id;
  }
}

export function SelectSeccion({ valor, onCambio, etiqueta }: SelectSeccionProps) {
  // Suscripcion ligera: re-render solo si cambia la referencia del array de
  // secciones de la obra. No entra en el bucle de render del viewport.
  const seccionesObra = modeloStore((s) => s.modelo.secciones);

  return (
    <Select.Root value={valor ?? undefined} onValueChange={(v) => onCambio(v)}>
      <Select.Trigger className="cx-select" aria-label={etiqueta ?? "Sección"}>
        <Select.Value placeholder="Sección…" />
        <Select.Icon className="cx-select__icon">▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="cx-select-content" position="popper" sideOffset={4}>
          <Select.Viewport className="cx-select-viewport">
            {OPCIONES_CATALOGO.map((sec) => (
              <Select.Item key={sec.id} value={sec.id} className="cx-select-item">
                <Select.ItemText>{sec.nombre}</Select.ItemText>
                <Select.ItemIndicator className="cx-select-item__check">
                  ✓
                </Select.ItemIndicator>
              </Select.Item>
            ))}
            {seccionesObra.map((sec) => (
              <Select.Item key={sec.id} value={sec.id} className="cx-select-item">
                <Select.ItemText>{etiquetaSeccionObra(sec)}</Select.ItemText>
                <Select.ItemIndicator className="cx-select-item__check">
                  ✓
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
