/**
 * Paleta de órdenes (Ctrl+K, `docs/fem3d/interfaz.md` §13): todo lo que se hace con un clic, con el
 * teclado. Se escribe parte del nombre (sin tildes ni mayúsculas) y se elige con las flechas e Intro.
 * Los objetos del proyecto salen al escribir: elegir uno lo elige en el dibujo.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

export interface Orden {
  id: string;
  grupo: string;
  nombre: string;
  atajo?: string;
  hacer: () => void;
  deshabilitada?: boolean;
}

const normal = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const MAX = 60;

export function Paleta({ ordenes, objetos, onCerrar }: { ordenes: Orden[]; objetos: (consulta: string) => Orden[]; onCerrar: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  useEffect(() => entrada.current?.focus(), []);

  const vistas = useMemo(() => {
    const palabras = normal(q).split(/\s+/).filter(Boolean);
    const vale = (o: Orden) => {
      const t = normal(`${o.grupo} ${o.nombre}`);
      return palabras.every((p) => t.includes(p));
    };
    const r = ordenes.filter((o) => !o.deshabilitada && vale(o));
    if (palabras.length) r.push(...objetos(q).filter(vale));
    return r.slice(0, MAX);
  }, [q, ordenes, objetos]);
  const sel = Math.min(i, Math.max(0, vistas.length - 1));

  useEffect(() => {
    listaRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [sel]);

  const hacer = (o: Orden | undefined) => {
    if (!o) return;
    onCerrar();
    o.hacer();
  };

  return (
    <div className="paleta-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="paleta" role="dialog" aria-modal="true" aria-label="Paleta de órdenes">
        <div className="paleta-busca">
          <Search size={17} aria-hidden="true" />
        <input
          ref={entrada}
          value={q}
          placeholder="Escriba una orden, una planta o el id de un objeto…"
          aria-label="Buscar una orden"
          role="combobox"
          aria-expanded="true"
          aria-controls="paleta-lista"
          aria-activedescendant={vistas[sel] ? `paleta-${sel}` : undefined}
          onChange={(e) => {
            setQ(e.target.value);
            setI(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setI(Math.min(vistas.length - 1, sel + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setI(Math.max(0, sel - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              hacer(vistas[sel]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCerrar();
            }
          }}
        />
        </div>
        {vistas.length ? (
          <ul id="paleta-lista" ref={listaRef} role="listbox" aria-label="Órdenes">
            {vistas.map((o, k) => (
              <li key={o.id} id={`paleta-${k}`} data-i={k} role="option" aria-selected={k === sel} onMouseEnter={() => setI(k)} onMouseDown={(e) => e.preventDefault()} onClick={() => hacer(o)}>
                <span className="grupo">{o.grupo}</span>
                <span className="nombre truncate">{o.nombre}</span>
                {o.atajo && <span className="atajo">{o.atajo}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="vacia">Nada con «{q}».</p>
        )}
        <div className="paleta-pie" aria-hidden="true">
          <span>
            <kbd>↑↓</kbd>moverse
          </span>
          <span>
            <kbd>Intro</kbd>abrir
          </span>
          <span>
            <kbd>Esc</kbd>cerrar
          </span>
        </div>
      </div>
    </div>
  );
}
