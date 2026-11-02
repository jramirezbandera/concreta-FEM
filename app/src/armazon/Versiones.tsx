/**
 * Las versiones anteriores de un proyecto del navegador (fase AL, `docs/fem3d/almacen-local.md`
 * §3.3): la lista, de la más nueva a la más antigua, y restaurar una. Lo que hay ahora queda antes
 * como versión, así que restaurar también se puede deshacer restaurando.
 */
import { useEffect, useState } from "react";
import { Dialogo } from "../editor/Dialogos.tsx";
import { restaurar, textoVersion, versiones, VERSIONES, type FichaVersion } from "../sesion/almacen.ts";
import { fechaCorta, tamano } from "../fmt.ts";

/** Lo que se cuenta de cada versión (P-19), en el orden en que se enseña. */
const CUENTAS = [
  ["plantas", "planta", "plantas"],
  ["pilares", "pilar", "pilares"],
  ["vigas", "viga", "vigas"],
  ["forjados", "forjado", "forjados"],
  ["muros", "muro", "muros"],
  ["cargas", "carga", "cargas"],
] as const;
type Cuenta = Record<(typeof CUENTAS)[number][0], number>;

/** Cuántos objetos de cada tipo tiene el texto de un proyecto (null si no se lee). */
export function contarVersion(texto: string): Cuenta | null {
  try {
    const m = (JSON.parse(texto) as { modelo?: Record<string, unknown[] | undefined> }).modelo ?? {};
    const n = (k: string) => (Array.isArray(m[k]) ? m[k]!.length : 0);
    return { plantas: n("plantas"), pilares: n("pilares"), vigas: n("vigas"), forjados: n("losas") + n("panos"), muros: n("muros"), cargas: n("cargas") };
  } catch {
    return null;
  }
}

/** «4 plantas · 9 pilares · …» (sin lo que no tiene), y lo que cambia frente a la siguiente («+2 vigas»). */
export function textoCuenta(c: Cuenta, despues: Cuenta | null): { resumen: string; cambios: string } {
  const resumen = CUENTAS.filter(([k]) => c[k] > 0)
    .map(([k, uno, varios]) => `${c[k]} ${c[k] === 1 ? uno : varios}`)
    .join(" · ");
  const cambios = despues
    ? CUENTAS.filter(([k]) => despues[k] !== c[k])
        .map(([k, uno, varios]) => {
          const d = c[k] - despues[k];
          return `${d > 0 ? "+" : "−"}${Math.abs(d)} ${Math.abs(d) === 1 ? uno : varios}`;
        })
        .join(", ")
    : "";
  return { resumen: resumen || "vacío", cambios };
}

export function DialogoVersiones({ id, nombre, onCerrar, onRestaurada }: { id: string; nombre: string; onCerrar: () => void; onRestaurada: () => void }) {
  const [lista, setLista] = useState<FichaVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // P-19: lo que tiene cada versión, para saber a cuál volver sin adivinar por la hora
  const [cuentas, setCuentas] = useState<Map<number, Cuenta | null>>(new Map());
  useEffect(() => {
    if (!lista) return;
    let vivo = true;
    void (async () => {
      const m = new Map<number, Cuenta | null>();
      for (const v of lista) {
        const t = await textoVersion(v.n).catch(() => null);
        m.set(v.n, t === null ? null : contarVersion(t));
      }
      if (vivo) setCuentas(m);
    })();
    return () => {
      vivo = false;
    };
  }, [lista]);

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
          {lista.map((v, i) => {
            const c = cuentas.get(v.n);
            // La lista va de la más nueva a la más antigua: lo que cambió es frente a la de antes de ella
            const antes = cuentas.get(lista[i + 1]?.n ?? -1) ?? null;
            const t = c ? textoCuenta(c, antes) : null;
            return (
            <li key={v.n} className="flex items-center gap-3 border-t border-border-sub py-1.5">
              <span className="mono w-36 shrink-0">{fechaCorta(v.fecha)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{v.nombre}</span>
                {t && (
                  <span className="block truncate text-[11.5px] text-text-muted" title={t.resumen}>
                    {t.resumen}
                    {t.cambios && <span className="text-text-secondary"> · {t.cambios} frente a la anterior</span>}
                  </span>
                )}
              </span>
              <span className="mono shrink-0 text-text-muted">{tamano(v.tamano)}</span>
              <button type="button" className="btn" disabled={ocupado} onClick={() => void volver(v.n)}>
                Volver a ésta
              </button>
            </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-2 text-state-fail">{error}</p>}
    </Dialogo>
  );
}
