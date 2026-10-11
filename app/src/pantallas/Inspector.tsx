/**
 * Inspector de un objeto físico: sus datos tal como están en el proyecto (nada se resume ni se
 * esconde), sus diagnósticos y, con el cálculo, el acceso a sus resultados.
 */
import { X } from "lucide-react";
import { ListaDiagnosticos, Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";

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

  /** Planta donde mirar el objeto: la suya o, en un pilar o un muro, la actual si la atraviesa (si no, la de arriba). */
  const localizar = () => {
    if (!o) return;
    const d = o.datos as { planta?: string; desde?: string; hasta?: string };
    if (d.planta) setPlanta(d.planta);
    else if (d.desde && d.hasta) {
      const [a, b] = [plantasIds.indexOf(d.desde), plantasIds.indexOf(d.hasta)];
      const k = planta ? plantasIds.indexOf(planta) : -1;
      if (!(k >= b && k < a)) setPlanta(d.hasta);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border-sub px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">{o?.tipo ?? "objeto"}</div>
          <div className="mono truncate text-[14px] font-medium">{id}</div>
        </div>
        <button type="button" className="btn" onClick={localizar} disabled={!o}>
          Localizar
        </button>
        <button type="button" className="btn" style={{ width: 28, padding: 0 }} aria-label="Cerrar" onClick={() => setSeleccion(null)}>
          <X size={14} />
        </button>
      </div>
      {r.diagnosticos && <p className="nota text-state-warn">{r.diagnosticos.map((d) => d.mensaje).join(" ")} (puede que ya no exista en esta versión del proyecto).</p>}
      {o && (
        <>
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
          {e.calculado && (o.tipo === "pilar" || o.tipo === "viga" || o.tipo === "vigueta" || o.tipo === "losa") && (
            <Seccion titulo="Resultados">
              <div className="flex flex-wrap gap-2 px-3.5 py-2">
                {o.tipo === "pilar" && (
                  <button type="button" className="btn" onClick={() => irA("pilares")}>
                    Ver en Pilares
                  </button>
                )}
                {(o.tipo === "viga" || o.tipo === "vigueta") && (
                  <button type="button" className="btn" onClick={() => irA("vigas")}>
                    Ver en Vigas
                  </button>
                )}
                {o.tipo === "losa" && (
                  <button type="button" className="btn" onClick={() => irA("losas")}>
                    Ver en Losas
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
