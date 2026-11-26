/**
 * La pestaña «Proceso» de Comprobación: el registro de la propuesta de armado (`registroProceso`), con
 * lo que se hace ahora arriba (las tiras del avance, con su barra y lo que queda) y, debajo, lo ya
 * hecho línea a línea con su tiempo. Mientras dura, la lista sigue a la última línea salvo que se haya
 * subido a leer.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ClienteSesion } from "../sesion/cliente.ts";
import { duracion, registroProceso, reloj, type RegistroProceso } from "../sesion/registroProceso.ts";
import { AvanceTarea, detalleTarea, useTareas } from "./AvanceTareas.tsx";

export function useProceso(registro: RegistroProceso = registroProceso) {
  return useSyncExternalStore(registro.alCambiar, registro.estado);
}

export function Proceso({ cliente, registro = registroProceso }: { cliente: ClienteSesion | null; registro?: RegistroProceso }) {
  const e = useProceso(registro);
  const tareas = useTareas(cliente);
  const lista = useRef<HTMLOListElement>(null);
  const alFinal = useRef(true);
  // El tiempo que lleva: una vez por segundo mientras dura
  const [, setTic] = useState(0);
  useEffect(() => {
    if (!e.enMarcha) return;
    const i = setInterval(() => setTic((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [e.enMarcha]);
  useEffect(() => {
    const l = lista.current;
    if (l && alFinal.current) l.scrollTop = l.scrollHeight;
  }, [e.lineas.length]);

  const armar = tareas.find((t) => t.pedido.tipo === "armar");
  const otras = tareas.filter((t) => t.pedido.tipo !== "armar");
  if (!e.titulo && !tareas.length)
    return (
      <p className="nota" data-proceso-vacio>
        Aquí se ve, paso a paso y con sus tiempos, lo que hace el programa al proponer el armado: cada tipo de pieza, cada fase, lo que le queda y, al acabar, lo propuesto y lo que se queda sin propuesta con su motivo. Todavía no se ha propuesto nada en esta sesión.
      </p>
    );
  return (
    <div className="proceso" data-proceso={e.enMarcha ? "en-marcha" : "acabado"}>
      <div className="proceso-cab">
        <strong>{e.titulo ?? "Comprobando"}</strong>
        {e.titulo && <span>{e.enMarcha ? `en marcha · lleva ${duracion(performance.now() - e.inicio)}` : `acabado · ${duracion(e.duracion ?? 0)}`}</span>}
      </div>
      {cliente && armar && <AvanceTarea grande tarea={armar} cliente={cliente} />}
      {cliente && otras.map((t) => <AvanceTarea key={t.id} grande tarea={t} cliente={cliente} />)}
      <ol
        ref={lista}
        className="proceso-lineas"
        aria-label="Registro del proceso"
        onScroll={(x) => {
          const l = x.currentTarget;
          alFinal.current = l.scrollHeight - l.scrollTop - l.clientHeight < 24;
        }}
      >
        {e.lineas.map((l, i) => (
          <li key={i} data-clase={l.clase}>
            <time>{reloj(l.t)}</time>
            <span>{l.texto}</span>
          </li>
        ))}
        {e.enMarcha && (
          <li data-clase="ahora">
            <time>{reloj(performance.now() - e.inicio)}</time>
            <span>{armar ? `${detalleTarea(armar)}…` : "esperando su turno…"}</span>
          </li>
        )}
      </ol>
    </div>
  );
}
