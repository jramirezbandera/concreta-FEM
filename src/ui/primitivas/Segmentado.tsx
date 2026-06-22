import * as ToggleGroup from "@radix-ui/react-toggle-group";

// Control segmentado de seleccion exclusiva (Spec Diseno UI §5: .cx-seg).
// Usos: 2D/3D/Mosaico (modo de vista), Empotrado/Articulado (extremos de viga),
// Izq/Centro/Der. Sobre @radix-ui/react-toggle-group (accesibilidad: roving
// tabindex, teclado, ARIA). El item activo se resalta en --surface + shadow-panel.
//
// Controlado: pasar `valor` + `onValor`. Generico en el conjunto de valores T
// para que el llamante tipe sus opciones (p. ej. "2d" | "3d" | "mosaico").

export interface OpcionSegmento<T extends string> {
  valor: T;
  etiqueta: string;
  titulo?: string; // tooltip / aria
}

export interface SegmentadoProps<T extends string> {
  opciones: ReadonlyArray<OpcionSegmento<T>>;
  valor: T;
  onValor: (valor: T) => void;
  "aria-label": string;
  className?: string;
}

export function Segmentado<T extends string>({
  opciones,
  valor,
  onValor,
  className,
  "aria-label": ariaLabel,
}: SegmentadoProps<T>) {
  const clases = ["cx-seg", className].filter(Boolean).join(" ");
  return (
    <ToggleGroup.Root
      type="single"
      value={valor}
      // Radix emite "" si se intenta deseleccionar; ignoramos para mantener
      // siempre una opcion activa (semantica de segmented exclusivo).
      onValueChange={(v) => {
        if (v) onValor(v as T);
      }}
      aria-label={ariaLabel}
      className={clases}
    >
      {opciones.map((op) => (
        <ToggleGroup.Item
          key={op.valor}
          value={op.valor}
          title={op.titulo ?? op.etiqueta}
          className="cx-seg__item"
        >
          {op.etiqueta}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
