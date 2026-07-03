// Aviso de estado de la persistencia (auditoria UX-L1). Banner bajo la menubar que se
// muestra SOLO cuando el guardado automatico no esta operativo, con dos tonos segun la
// gravedad:
//   - "carga-fallida": GRAVE. Habia un proyecto guardado y no se pudo recuperar; el
//     autosave no arranco para no machacarlo. role="alert" (lo anuncian los lectores)
//     y tono --danger suave: esta sesion NO se esta guardando.
//   - "sin-indexeddb": esperado y no alarmista. El navegador no permite guardado
//     automatico; nada se ha perdido (es de partida). role="status", tono neutro.
//   - "ok": no se renderiza nada (el Shell ni siquiera lo monta en ese caso).
import type { EstadoArranquePersistencia } from "./useArranquePersistencia";

export interface AvisoPersistenciaProps {
  estado: EstadoArranquePersistencia;
}

export function AvisoPersistencia({ estado }: AvisoPersistenciaProps) {
  if (estado === "ok") return null;

  if (estado === "carga-fallida") {
    return (
      <div className="cx-aviso cx-aviso--danger" role="alert">
        No se pudo recuperar el proyecto guardado. Los cambios de esta sesión no se
        están guardando.
      </div>
    );
  }

  // sin-indexeddb: aviso discreto, no alarmista.
  return (
    <div className="cx-aviso" role="status">
      Este navegador no permite el guardado automático.
    </div>
  );
}
