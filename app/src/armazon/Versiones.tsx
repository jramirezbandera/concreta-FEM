/**
 * Las versiones anteriores de un proyecto del navegador (fase AL, `docs/fem3d/almacen-local.md`
 * §3.3): la lista, de la más nueva a la más antigua, y restaurar una. Lo que hay ahora queda antes
 * como versión, así que restaurar también se puede deshacer restaurando.
 */
import { useEffect, useState } from "react";
import { Dialogo } from "../editor/Dialogos.tsx";
import { restaurar, versiones, VERSIONES, type FichaVersion } from "../sesion/almacen.ts";
import { fechaCorta, tamano } from "../fmt.ts";

export function DialogoVersiones({ id, nombre, onCerrar, onRestaurada }: { id: string; nombre: string; onCerrar: () => void; onRestaurada: () => void }) {
  const [lista, setLista] = useState<FichaVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    versiones(id).then(
      (v) => vivo && setLista(v),
      (e: unknown) => vivo && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      vivo = false;
    };
  }, [id]);

  const volver = async (n: number) => {
    setOcupado(true);
    const r = await restaurar(id, n);
    setOcupado(false);
    if (!r.ok) return setError(r.mensaje);
    onRestaurada();
  };

  return (
    <Dialogo
      titulo={`Versiones de ${nombre}`}
      onCerrar={onCerrar}
      pie={
        <button type="button" className="btn" onClick={onCerrar}>
          Cerrar
        </button>
      }
    >
      <p className="text-text-secondary">
        Se guarda una al abrir el proyecto y, mientras se edita, una cada {VERSIONES.cadaMs / 60_000} minutos como mucho. Quedan las {VERSIONES.recientes} últimas y una por día durante {VERSIONES.dias} días. Lo que hay ahora queda como versión antes de volver a otra.
      </p>
      {lista === null && !error && <p className="mt-2 text-text-secondary">Leyendo…</p>}
      {lista?.length === 0 && <p className="mt-2">Aún no hay versiones anteriores.</p>}
      {!!lista?.length && (
        <ul className="mt-2 list-none p-0" aria-label="Versiones anteriores">
          {lista.map((v) => (
            <li key={v.n} className="flex items-center gap-3 border-t border-border-sub py-1.5">
              <span className="mono w-36 shrink-0">{fechaCorta(v.fecha)}</span>
              <span className="min-w-0 flex-1 truncate">{v.nombre}</span>
              <span className="mono shrink-0 text-text-disabled">{tamano(v.tamano)}</span>
              <button type="button" className="btn" disabled={ocupado} onClick={() => void volver(v.n)}>
                Volver a ésta
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-state-fail">{error}</p>}
    </Dialogo>
  );
}
