/**
 * UI2-c (decisión del usuario, 2026-11-28): el navegador de Comprobación lleva la lista de las piezas
 * con su aprovechamiento, para ir de una a otra con la pestaña Armado abierta abajo. Con una pestaña,
 * las partes de su tabla (en su orden, también con «Los peores, primero»); un clic hace lo mismo que
 * en la tabla y el doble clic abre su armado. Sin pestaña, los cuatro tipos: sus tablas no se piden
 * hasta elegir uno (en un edificio grande, pedirlas todas cuesta minutos).
 */
import { useEffect, useRef } from "react";
import type { ParteComprobada, TipoComprobacion } from "../../../src/visor/comprobaciones.ts";
import type { Icono } from "../armazon/iconos.tsx";
import { Seccion } from "../componentes/comunes.tsx";
import { fmt } from "../fmt.ts";

export interface EstadoParte {
  texto: string;
  tono: "ok" | "fail" | "neu" | "warn";
}

export function NavComprobacion({
  tipo,
  tipos,
  partes,
  nombres,
  clave,
  cargando,
  estado,
  elegir,
  abrirArmado,
  ponerTipo,
}: {
  /** La pestaña; `null`, sin pestaña. */
  tipo: TipoComprobacion | null;
  tipos: readonly { id: TipoComprobacion; nombre: string; title: string; icono: Icono }[];
  partes: readonly ParteComprobada[];
  /** «tramo», «tramos». */
  nombres: [string, string];
  clave: string | null;
  cargando: boolean;
  estado: (p: ParteComprobada) => EstadoParte;
  elegir: (p: ParteComprobada) => void;
  abrirArmado: () => void;
  ponerTipo: (t: TipoComprobacion) => void;
}) {
  const lista = useRef<HTMLDivElement>(null);
  // La elegida en la planta o en la tabla, a la vista en la lista
  useEffect(() => {
    if (!clave) return;
    const el = lista.current?.querySelector<HTMLElement>(`[data-clave="${CSS.escape(clave)}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [clave]);

  if (!tipo)
    return (
      <Seccion titulo="Qué comprobar">
        {tipos.map((t) => (
          <button key={t.id} type="button" className="lista-fila nav-comp-tipo" title={t.title} onClick={() => ponerTipo(t.id)}>
            <t.icono size={16} />
            <span>{t.nombre}</span>
          </button>
        ))}
      </Seccion>
    );

  // Como el resumen de Propiedades: lo que tiene armado y no cumple
  const fallan = partes.filter((p) => !p.cumple && p.origen !== "sin-armado" && p.origen !== "no-aplica").length;
  const valor = cargando && !partes.length ? "…" : fallan ? `${partes.length} · ${fallan} no ${fallan === 1 ? "cumple" : "cumplen"}` : partes.length;
  return (
    <Seccion titulo={tipos.find((t) => t.id === tipo)?.nombre ?? ""} valor={valor}>
      <div ref={lista} role="listbox" aria-label={`Los ${nombres[1]}, con su aprovechamiento`}>
        {partes.map((p) => {
          const e = estado(p);
          const a = p.aprovechamiento;
          return (
            <button
              key={p.clave}
              type="button"
              role="option"
              aria-selected={p.clave === clave}
              className="lista-fila nav-comp-fila"
              data-on={p.clave === clave}
              data-clave={p.clave}
              data-tono={e.tono}
              title={`${p.pieza} · ${p.parte}: ${e.texto}${a !== null ? `, ${fmt(a, 2)}` : ""}. Doble clic: su armado`}
              onClick={() => elegir(p)}
              onDoubleClick={() => {
                elegir(p);
                abrirArmado();
              }}
            >
              <span className="min-w-0 truncate">
                <span className="mono">{p.pieza}</span> <span className="nav-comp-parte">{corta(p.parte)}</span>
              </span>
              <span className="nav-comp-barra" aria-hidden>
                {a !== null && <i style={{ width: `${Math.min(1, Math.max(0, a)) * 100}%` }} />}
              </span>
              <span className="nav-comp-aprov">{a !== null ? fmt(a, 2) : "—"}</span>
            </button>
          );
        })}
      </div>
      {!partes.length && !cargando && <p className="nota">Ningún {nombres[0]} que comprobar.</p>}
      {partes.length > 0 && <p className="nota">Doble clic: su armado, abajo.</p>}
    </Seccion>
  );
}

/** «vano 1 · P1 – P2» → «vano 1»: en el navegador no cabe más (lo entero, en la pista y en la tabla). */
const corta = (parte: string) => (/^vano /.test(parte) ? parte.split(" · ")[0]! : parte);
