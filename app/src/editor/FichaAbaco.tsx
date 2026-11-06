/**
 * Propiedades de los ábacos elegidos (fase AC, `docs/fem3d/abacos.md` §3.2): uno, con su forjado y,
 * si es un rectángulo según los nervios, a × b y su centro, que se escriben; varios del mismo forjado,
 * «Unir». Con todos, «Borrar». Lo que solapa al cambiar se une con ello en el mismo paso (AC-b), y lo
 * elegido sigue al ábaco que queda.
 */
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { borrarAbacos, cambiarAbaco, leerIdAbaco, nombreAbaco, poligonoRectangulo, rectanguloDe, toleranciaAbacos, unirAbacos, type ResultadoAbacos } from "../../../src/editor/abacos.ts";
import { areaConSigno } from "../../../src/compilador/poligonos.ts";
import type { Vec2 } from "../../../src/compilador/fisico.ts";
import { IcAbacos } from "../armazon/iconos.tsx";
import { Cabecera, Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { NumeroCampo } from "../dibujo/Plantilla.tsx";
import { coma as comaTexto } from "../fmt.ts";

const coma = (x: number, d: number) => comaTexto(String(Number(x.toFixed(d)) + 0));

export function FichaAbacos({ ids }: { ids: string[] }) {
  const { proyecto, setElegidos } = useVisor();
  const ed = proyecto.edicion;
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  if (!ed) return null;
  const m = ed.proyecto.modelo;
  const tol = toleranciaAbacos(ed.proyecto.opciones);
  const xs = ids.map((id) => ({ id, x: leerIdAbaco(m, id) })).filter((a) => a.x) as { id: string; x: NonNullable<ReturnType<typeof leerIdAbaco>> }[];
  if (!xs.length) return null;
  const hacer = (r: ResultadoAbacos, etiqueta: string) => {
    if (!r.ok) return setError(r.mensaje);
    const a = ed.editar(r.operacion, etiqueta);
    if (!a.ok) return setError(a.errores.map((e) => e.mensaje).join(" "));
    setError(null);
    setHecho(r.avisos.join(" ") || null);
    setElegidos(r.elegidos);
  };
  const borrar = (
    <button type="button" className="btn" onClick={() => hacer(borrarAbacos(m, ids), `Borrar ${xs.length > 1 ? `${xs.length} ábacos` : `el ábaco ${nombreAbaco(xs[0]!.id)}`}`)}>
      <Trash2 size={14} aria-hidden="true" /> Borrar
    </button>
  );
  const pie = (
    <>
      {error && <p className="nota text-state-fail">{error}</p>}
      {hecho && <p className="nota text-state-warn">{hecho}</p>}
    </>
  );

  if (xs.length > 1) {
    const losas = new Set(xs.map((a) => a.x.losa.id));
    return (
      <div role="region" aria-label="Ábacos elegidos">
        <Cabecera icono={IcAbacos} tipo="Ábacos" titulo={`${xs.length} ábacos`} detalle={losas.size > 1 ? "De varios forjados: sólo se unen los de uno." : `De ${[...losas][0]}.`} />
        <Seccion titulo="Unir" valor="rectángulo envolvente">
          <p className="nota">Quedan en uno solo: el rectángulo que los envuelve según los nervios. Si cubre otro ábaco, también se lo lleva.</p>
          <div className="flex gap-2 px-3.5 py-2">
            <button type="button" className="btn btn-p" disabled={losas.size > 1} onClick={() => hacer(unirAbacos(m, ids, tol), `Unir ${xs.length} ábacos de ${[...losas][0]}`)}>
              Unir
            </button>
            {borrar}
          </div>
        </Seccion>
        {pie}
      </div>
    );
  }

  const { id, x } = xs[0]!;
  const p = x.losa.reticular!.abacos![x.i] as Vec2[];
  const r = rectanguloDe(x.losa, p);
  const area = Math.abs(areaConSigno(p));
  const cambiarRect = (c: Partial<{ a: number; b: number; cx: number; cy: number }>) => {
    if (!r) return;
    const n = { centro: [c.cx ?? r.centro[0], c.cy ?? r.centro[1]] as Vec2, a: c.a ?? r.a, b: c.b ?? r.b };
    if (!(n.a > 0 && n.b > 0)) return setError("Las dos medidas del ábaco, mayores que 0.");
    hacer(cambiarAbaco(m, id, poligonoRectangulo(x.losa, n), tol), `Cambiar el ábaco ${nombreAbaco(id)}`);
  };
  return (
    <div role="region" aria-label={`Ábaco ${nombreAbaco(id)}`}>
      <Cabecera icono={IcAbacos} tipo="Ábaco" titulo={nombreAbaco(id)} detalle={`Macizo, en el forjado reticular ${x.losa.id} · ${coma(area, 2)} m² (cuenta lo que cae dentro del forjado).`}>
        {borrar}
      </Cabecera>
      {r ? (
        <Seccion titulo="Rectángulo" valor="según los nervios">
          <div className="py-1">
            <NumeroCampo key={`a${r.a}`} etiqueta="según los nervios" unidad="m" valor={r.a} onCambio={(a) => a !== undefined && cambiarRect({ a })} ayuda="El lado en la dirección de los nervios (el eje 1 del forjado). Crece o mengua desde el centro." />
            <NumeroCampo key={`b${r.b}`} etiqueta="en perpendicular" unidad="m" valor={r.b} onCambio={(b) => b !== undefined && cambiarRect({ b })} ayuda="El lado en la perpendicular a los nervios." />
            <NumeroCampo key={`x${r.centro[0]}`} etiqueta="centro x" unidad="m" valor={r.centro[0]} cero onCambio={(cx) => cx !== undefined && cambiarRect({ cx })} />
            <NumeroCampo key={`y${r.centro[1]}`} etiqueta="centro y" unidad="m" valor={r.centro[1]} cero onCambio={(cy) => cy !== undefined && cambiarRect({ cy })} />
          </div>
          <p className="nota">Con el ábaco elegido, sus esquinas y los medios de sus lados se arrastran en la planta: sigue siendo un rectángulo.</p>
        </Seccion>
      ) : (
        <Seccion titulo="Polígono" valor={`${p.length} vértices`}>
          <p className="nota mono">{p.map((q) => `(${coma(q[0], 3)}; ${coma(q[1], 3)})`).join(" ")}</p>
          <p className="nota">Sus vértices se arrastran en la planta con el ábaco elegido, o se escriben en la columna «ábacos» de la tabla Forjados.</p>
        </Seccion>
      )}
      <p className="nota">Para unirlo con otro, elija los dos (Ctrl+clic) y «Unir». Si al cambiarlo solapa con otro, o queda a menos de {coma(tol, 3)} m, se unen solos.</p>
      {pie}
    </div>
  );
}
