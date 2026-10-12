/**
 * Aviso de versión nueva, como en Concreta (`concreta-v2/src/components/pwa/`): un cartel fijo con
 * «Actualizar» que nunca recarga por sorpresa. Concreta lo saca de su service worker; aquí no hay
 * ninguno, así que se compara la versión de esta build (`__VERSION_APP__`) con la de
 * `version.json`, que cada build publica junto a la app (vite.config.ts).
 *
 * Se consulta al cargar, cada hora (la pestaña de una herramienta de mesa vive abierta horas) y al
 * volver a la pestaña, como mucho una vez por minuto. Sólo en producción: el visor local
 * (`bun run visor`) va con el servidor de desarrollo, que no tiene `version.json`.
 *
 * Recargar con cambios sin guardar lo para el `beforeunload` de useProyecto.
 */
import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

declare const __VERSION_APP__: string;

const CADA_MS = 60 * 60 * 1000;
const MINIMO_MS = 60 * 1000;

/** La versión publicada, o null si no se pudo leer (sin red, sin version.json). */
export async function versionPublicada(url = "./version.json"): Promise<string | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { version?: unknown };
    return typeof j.version === "string" ? j.version : null;
  } catch {
    return null;
  }
}

export function AvisoVersion({ activo = import.meta.env.PROD, actual = __VERSION_APP__ }: { activo?: boolean; actual?: string }) {
  const [nueva, setNueva] = useState(false);
  const [cerrado, setCerrado] = useState(false);

  useEffect(() => {
    if (!activo || nueva) return;
    let ultima = 0;
    let vivo = true;
    const comprobar = async () => {
      if (Date.now() - ultima < MINIMO_MS) return;
      ultima = Date.now();
      const v = await versionPublicada();
      if (vivo && v !== null && v !== actual) setNueva(true);
    };
    const alVolver = () => {
      if (document.visibilityState === "visible") void comprobar();
    };
    void comprobar();
    const t = setInterval(() => void comprobar(), CADA_MS);
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [activo, actual, nueva]);

  if (!nueva || cerrado) return null;
  return (
    <div className="aviso-version" role="status">
      <span>Hay una nueva versión de Concreta FEM disponible.</span>
      <button type="button" className="btn btn-p" onClick={() => location.reload()}>
        <RefreshCw size={14} /> Actualizar
      </button>
      <button type="button" className="ib" onClick={() => setCerrado(true)} aria-label="Ahora no" title="Ahora no">
        <X size={14} />
      </button>
    </div>
  );
}
