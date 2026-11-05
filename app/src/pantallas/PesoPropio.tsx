/**
 * El caso del peso propio es del programa (2026-11-05): lo que mete el usuario va en un caso de
 * cargas muertas con la misma acción, para que en el dibujo y en los resultados por caso se vea qué
 * es de quién. Las combinaciones dan lo mismo (el CTE toma las permanentes «globalmente», 4.2.2).
 *
 * `PasarACargasMuertas`: el botón que hace `separarPesoPropio` (un paso de deshacer), en la ficha de
 * una pieza, en el resumen del caso y junto al aviso `sensatez/cargas-en-peso-propio` de Diagnósticos.
 */
import { useState } from "react";
import { cargasEnPesoPropio, separarPesoPropio } from "../../../src/editor/casos.ts";
import { useVisor } from "../contexto.ts";

export function PasarACargasMuertas({ alHacer, compacto = false }: { alHacer?: (destino: string) => void; compacto?: boolean }) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion;
  const [error, setError] = useState<string | null>(null);
  if (!ed) return null;
  const m = ed.proyecto.modelo;
  const n = cargasEnPesoPropio(m).length;
  if (!n) return null;
  const pasar = () => {
    const r = separarPesoPropio(ed.proyecto.modelo);
    if (!r.ok) return setError(r.mensaje);
    const a = ed.editar(r.operacion, r.etiqueta);
    if (!a.ok) return setError(a.errores.map((x) => x.mensaje).join(" "));
    setError(null);
    alHacer?.(r.destino);
  };
  const s = separarPesoPropio(m);
  const destino = s.ok ? s.destino : "CM";
  const texto = `Pasar ${n === 1 ? "la carga" : `las ${n} cargas`} a ${destino}${s.ok && s.nuevo ? " (nuevo)" : ""}`;
  return (
    <div className={compacto ? "mt-1" : "px-3.5 pt-1"}>
      <button type="button" className={compacto ? "btn" : "btn btn-p"} style={compacto ? { height: 22, padding: "0 8px", fontSize: 11 } : undefined} onClick={pasar} title={`A un caso de cargas muertas con la misma acción: las combinaciones dan lo mismo. Un paso de deshacer.`}>
        {texto}
      </button>
      {error && <p className="nota text-state-fail">{error}</p>}
    </div>
  );
}
