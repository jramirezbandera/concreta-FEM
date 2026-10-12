/**
 * Las vistas guardadas en el proyecto (I3, `docs/fem3d/interfaz.md` §16), en el navegador: un clic
 * deja la vista activa como se guardó (con su cámara y sus filtros); con un proyecto editable, se
 * renombran y se borran, como operaciones del editor (se deshacen). Se guardan desde la barra de
 * cada vista.
 */
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { VistaGuardada } from "../../../src/agente/proyecto.ts";
import { Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { useVistas } from "../vistas/estado.ts";

const TIPO: Record<VistaGuardada["tipo"], string> = { planta: "planta", alzado: "alzado", "3d": "3D" };

export function NavVistas() {
  const { proyecto } = useVisor();
  const { abrirGuardada } = useVistas();
  const ed = proyecto.edicion;
  const lista = ed?.proyecto.vistas ?? proyecto.estado?.vistas ?? [];
  const [renombrando, setRenombrando] = useState<string | null>(null);
  const [texto, setTexto] = useState("");

  const renombrar = (viejo: string) => {
    const nuevo = texto.trim();
    setRenombrando(null);
    if (!ed || !nuevo || nuevo === viejo) return;
    ed.editar({ op: "vistas", vistas: lista.map((x) => (x.nombre === viejo ? { ...x, nombre: nuevo } : x)) }, `Renombrar la vista «${viejo}»`);
  };

  return (
    <Seccion titulo="Vistas" valor={lista.length}>
      {!lista.length && <p className="nota">Sin vistas guardadas: se guardan, con un nombre, desde la barra de cada vista.</p>}
      {lista.map((g) =>
        renombrando === g.nombre ? (
          <div key={g.nombre} className="px-3.5 py-1">
            <input className="sel w-full" aria-label={`Nuevo nombre de la vista ${g.nombre}`} value={texto} autoFocus onChange={(x) => setTexto(x.target.value)} onBlur={() => renombrar(g.nombre)} onKeyDown={(x) => (x.key === "Enter" ? renombrar(g.nombre) : x.key === "Escape" && setRenombrando(null))} />
          </div>
        ) : (
          <div key={g.nombre} className="arbol-fila" style={{ paddingRight: 6 }}>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left" style={{ color: "inherit", font: "inherit", cursor: "pointer" }} title={`Abrir «${g.nombre}» en la vista activa`} onClick={() => abrirGuardada(g)}>
              <span className="truncate">{g.nombre}</span>
            </button>
            <span className="n">{TIPO[g.tipo]}</span>
            {ed && (
              <>
                <button
                  type="button"
                  className="ib-chip"
                  aria-label={`Renombrar la vista ${g.nombre}`}
                  onClick={() => {
                    setTexto(g.nombre);
                    setRenombrando(g.nombre);
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button type="button" className="ib-chip" aria-label={`Borrar la vista ${g.nombre}`} onClick={() => ed.editar({ op: "vistas", vistas: lista.filter((x) => x.nombre !== g.nombre) }, `Borrar la vista «${g.nombre}»`)}>
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </div>
        ),
      )}
    </Seccion>
  );
}
