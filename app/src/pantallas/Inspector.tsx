/**
 * Inspector de un objeto físico: sus datos tal como están en el proyecto (nada se resume ni se
 * esconde), sus diagnósticos y, con el cálculo, el acceso a sus resultados. Desde V2a, los datos de
 * lo que se edita por tablas son un formulario (`FormularioObjeto`); desde V2b, todo el modelo
 * físico (sin tablas, sólo un proyecto de sólo lectura).
 */
import { Box, Crosshair, X } from "lucide-react";
import { IcApoyo, IcApoyoLineal, IcBanda, IcCarga, IcCasos, IcEjes, IcForjado, IcMateriales, IcMuro, IcPilar, IcPlanta, IcSecciones, IcViga } from "../armazon/iconos.tsx";
import { Cabecera, ListaDiagnosticos, Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { FormularioObjeto, tablaDe } from "../editor/Formulario.tsx";
import { objetosTabla } from "../../../src/editor/tablas.ts";

/** El tipo de un objeto como lo llama la app: losas y paños son forjados, con su tipo (la tabla Forjados). */
export function etiquetaTipo(o: { tipo: string; datos: Record<string, unknown> }): string {
  if (o.tipo === "losa") return `forjado · ${o.datos.reticular ? "reticular" : "losa maciza"}`;
  if (o.tipo === "paño") return "forjado · unidireccional";
  return o.tipo;
}

/** El icono de cada tipo de objeto, el de su herramienta en la barra. */
const ICONO_TIPO: Record<string, Parameters<typeof Cabecera>[0]["icono"]> = {
  planta: IcPlanta,
  pilar: IcPilar,
  viga: IcViga,
  vigueta: IcViga,
  losa: IcForjado,
  paño: IcForjado,
  muro: IcMuro,
  apoyo: IcApoyo,
  "apoyo lineal": IcApoyoLineal,
  banda: IcBanda,
  carga: IcCarga,
  caso: IcCasos,
  sección: IcSecciones,
  material: IcMateriales,
  eje: IcEjes,
};

/** Un valor del proyecto en texto: números como están, puntos como (x; y), lo demás en JSON. */
export function valorCampo(v: unknown): string {
  if (typeof v === "number") return String(v).replace(".", ",");
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((p) => Array.isArray(p) && p.every((x) => typeof x === "number"))) return v.map((p: number[]) => `(${p.map((x) => String(x).replace(".", ",")).join("; ")})`).join(" ");
  return JSON.stringify(v);
}

export function Inspector({ id }: { id: string }) {
  const { proyecto, setSeleccion, setPlanta, planta, irA } = useVisor();
  const e = proyecto.estado!;
  const r = usePedido(proyecto.cliente, { tipo: "objeto", id });
  const o = r.datos;
  const plantasIds = e.plantas.map((p) => p.id);
  const ed = proyecto.edicion;
  const tabla = ed ? tablaDe(ed.proyecto.modelo, id) : null;

  /** Planta donde mirar el objeto: la suya o, en un pilar o un muro, la actual si la atraviesa (si no, la de arriba). */
  const localizar = () => {
    // Lo editado manda: el worker puede ir aún por la versión anterior
    const local = ed && tabla ? objetosTabla(ed.proyecto.modelo, tabla).find((x) => x.id === id) : undefined;
    const d = (local ?? o?.datos) as { planta?: string; desde?: string; hasta?: string } | undefined;
    if (!d) return;
    if (d.planta) setPlanta(d.planta);
    else if (d.desde && d.hasta) {
      const [a, b] = [plantasIds.indexOf(d.desde), plantasIds.indexOf(d.hasta)];
      const k = planta ? plantasIds.indexOf(planta) : -1;
      if (!(k >= b && k < a)) setPlanta(d.hasta);
    }
  };

  return (
    <>
      <Cabecera icono={(o && ICONO_TIPO[o.tipo]) ?? Box} tipo={o ? etiquetaTipo(o) : "objeto"} titulo={id} mono>
        <button type="button" className="btn" onClick={localizar} disabled={!o && !tabla} title="Ir a la planta del objeto">
          <Crosshair size={14} />
          Localizar
        </button>
        <button type="button" className="ib" style={{ width: 28, height: 28 }} aria-label="Cerrar" title="Soltar (Esc)" onClick={() => setSeleccion(null)}>
          <X size={16} />
        </button>
      </Cabecera>
      {ed && tabla && <FormularioObjeto id={id} tabla={tabla} />}
      {r.diagnosticos && !tabla && <p className="nota text-state-warn">{r.diagnosticos.map((d) => d.mensaje).join(" ")} (puede que ya no exista en esta versión del proyecto).</p>}
      {r.diagnosticos && tabla && <p className="nota">Compilando la versión nueva…</p>}
      {o && (
        <>
          {!tabla && (
          <Seccion titulo="Datos del proyecto">
            <table className="tb">
              <tbody>
                {Object.entries(o.datos).map(([k, v]) => (
                  <tr key={k}>
                    <td className="txt" style={{ color: "var(--color-text-secondary)", width: 110 }}>
                      {k}
                    </td>
                    <td className="txt mono" style={{ textAlign: "left", wordBreak: "break-word" }}>
                      {valorCampo(v)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Seccion>
          )}
          {e.calculado && (o.tipo === "pilar" || o.tipo === "viga" || o.tipo === "vigueta" || o.tipo === "losa") && (
            <Seccion titulo="Resultados">
              <div className="flex flex-wrap gap-2 px-3.5 py-2">
                {o.tipo === "pilar" && (
                  <button type="button" className="btn" onClick={() => irA("resultados", "pilares")}>
                    Ver en Resultados
                  </button>
                )}
                {(o.tipo === "viga" || o.tipo === "vigueta") && (
                  <button type="button" className="btn" onClick={() => irA("resultados", "diagramas")}>
                    Ver en Resultados
                  </button>
                )}
                {o.tipo === "losa" && (
                  <button type="button" className="btn" onClick={() => irA("resultados", "losas")}>
                    Ver en Resultados
                  </button>
                )}
              </div>
            </Seccion>
          )}
          <Seccion titulo="Diagnósticos" valor={fmt(o.diagnosticos.length, 0)}>
            <ListaDiagnosticos ds={o.diagnosticos} />
          </Seccion>
        </>
      )}
    </>
  );
}
