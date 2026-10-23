/**
 * Aviso de versión nueva, como en Concreta (`concreta-v2/src/components/pwa/`): un cartel fijo con
 * «Actualizar» que nunca recarga por sorpresa.
 *
 * Desde AL2 (`docs/fem3d/almacen-local.md` §4) registra el service worker de la PWA, también como
 * Concreta (`PwaUpdatePrompt.tsx`): una versión nueva se queda en espera hasta que se pulsa
 * «Actualizar», y entonces se activa y se recarga (`aplicar`, copiado de `pwaUpdate.ts`). Sin
 * service worker (un navegador que no lo tiene), se compara la versión de esta build
 * (`__VERSION_APP__`) con la de `version.json`, que cada build publica junto a la app.
 *
 * Se consulta al cargar, cada hora (la pestaña de una herramienta de mesa vive abierta horas) y al
 * volver a la pestaña, como mucho una vez por minuto. Sólo en producción: el visor local
 * (`bun run visor`) va con el servidor de desarrollo, que no tiene ni service worker ni
 * `version.json`.
 *
 * Recargar con cambios sin guardar lo para el `beforeunload` de useProyecto.
 */
import { useEffect, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";

declare const __VERSION_APP__: string;

const CADA_MS = 60 * 60 * 1000;
const MINIMO_MS = 60 * 1000;
/**
 * Margen para recargar si no llega `controllerchange` (una pestaña que se cargó sin service worker:
 * la primera visita, o Ctrl+Mayús+R). En una pestaña controlada llega en milisegundos.
 */
const PLAZO_ACTIVAR_MS = 3000;

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

/**
 * Activa el service worker en espera y recarga una sola vez, con `controllerchange` o, si no llega,
 * por plazo (`concreta-v2/src/components/pwa/pwaUpdate.ts`: `updateServiceWorker(true)` sólo manda
 * SKIP_WAITING, y la recarga de workbox-window no salta en una pestaña sin controlar).
 */
function aplicar(actualizar: (recargar?: boolean) => Promise<void>): void {
  let hecho = false;
  const recargar = () => {
    if (hecho) return;
    hecho = true;
    location.reload();
  };
  navigator.serviceWorker?.addEventListener("controllerchange", recargar, { once: true });
  setTimeout(recargar, PLAZO_ACTIVAR_MS);
  void actualizar(true);
}

export function AvisoVersion({ activo = import.meta.env.PROD, actual = __VERSION_APP__ }: { activo?: boolean; actual?: string }) {
  const [nueva, setNueva] = useState(false);
  const [cerrado, setCerrado] = useState(false);
  const registro = useRef<ServiceWorkerRegistration | null>(null);
  const {
    needRefresh: [enEspera],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      registro.current = r ?? null;
    },
  });

  useEffect(() => {
    if (!activo || nueva || enEspera) return;
    let ultima = 0;
    let vivo = true;
    const comprobar = async () => {
      if (Date.now() - ultima < MINIMO_MS) return;
      ultima = Date.now();
      // Con service worker, que mire él si hay otro sw.js: si lo hay, se queda en espera y avisa. Una
      // página que ya controla (aunque su registro no haya llegado) no mira version.json: recargarla
      // sin activar el worker nuevo daría otra vez la versión de la caché
      if (registro.current) return void registro.current.update().catch(() => {});
      if (navigator.serviceWorker?.controller) return;
      const v = await versionPublicada();
      if (vivo && v !== null && v !== actual && !registro.current && !navigator.serviceWorker?.controller) setNueva(true);
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
  }, [activo, actual, nueva, enEspera]);

  if (!(nueva || (activo && enEspera)) || cerrado) return null;
  return (
    <div className="aviso-version" role="status">
      <span>Hay una nueva versión de Concreta FEM disponible.</span>
      <button type="button" className="btn btn-p" onClick={() => (enEspera ? aplicar(updateServiceWorker) : location.reload())}>
        <RefreshCw size={14} /> Actualizar
      </button>
      <button type="button" className="ib" onClick={() => setCerrado(true)} aria-label="Ahora no" title="Ahora no">
        <X size={14} />
      </button>
    </div>
  );
}
