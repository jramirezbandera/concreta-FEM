import { useEffect, useState } from "react";
import { Dialogo } from "./Dialogo";
import { CampoNumero, Segmentado, Boton } from "../primitivas";
import {
  modeloStore,
  vistaStore,
  crearSeccion,
  type DatosSeccion,
} from "../../estado";
import { PRESETS_HORMIGON, type PresetHormigon } from "../../biblioteca";
import { mmToM } from "../../unidades";
import "./dialogos.css";
import "./seccionPersonalizada.css";

// DialogoSeccionPersonalizada (auditoria UI/UX D3): crea una seccion DE OBRA de hormigon
// a medida. AUTO-GATEADO: lee `dialogoActivo` de vistaStore y devuelve null salvo que sea
// "seccionPersonalizada" (el orquestador NO lo monta condicional: lo monta siempre y el
// dialogo decide si se muestra). Vocabulario de obra (Sección, rectangular b×h, circular
// Ø); cero jerga FEM.
//
// PERSISTE SOLO DIMENSIONES (condicion del guardian D3.3): b/h o Ø, convertidas mm->m en el
// BORDE (src/unidades, aqui con mmToM). JAMAS A/Iy/Iz (la unica fuente de las propiedades de
// calculo es resolverSeccion; convencion C-1b Iy=eje fuerte ya resuelta en la emision). La
// seccion NO lleva material (el elemento lo referencia por su lado).
//
// El comando crearSeccion fija un id OPACO (nuevoId), NUNCA semantico tipo "HR-300x500"
// (shadowing del catalogo en resolverSeccionFEMPorId). El nombre legible ("HA 30×30") va en
// `nombre`.

// Clase de geometria de la seccion a medida.
type Clase = "rectangular" | "circular";

const OPCIONES_CLASE = [
  { valor: "rectangular", etiqueta: "Rectangular" },
  { valor: "circular", etiqueta: "Circular" },
] as const;

// Dimensiones por defecto al abrir (mm): 300×300 rectangular, Ø300 circular. Coinciden
// con el primer preset (30×30 / Ø30). El usuario los cambia con los campos o los presets.
const DIM_DEFECTO = { b: 300, h: 300, d: 300 };

// Lee el modelo ACTUAL del store (invariante del `base`, CLAUDE.md §10): se llama justo
// antes del comando para no retener el modelo del render.
function leerModelo() {
  return modeloStore.getState().getModelo();
}

// ¿Ya existe una seccion de obra con ese nombre (trimeado)? Aviso NO bloqueante: dos
// secciones pueden llamarse igual (se distinguen por id opaco), pero conviene avisar.
function nombreDuplicado(nombre: string): boolean {
  const limpio = nombre.trim();
  if (limpio === "") return false;
  return modeloStore
    .getState()
    .getModelo()
    .secciones.some((s) => s.nombre.trim() === limpio);
}

export function DialogoSeccionPersonalizada() {
  const dialogoActivo = vistaStore((s) => s.dialogoActivo);
  const cerrarDialogo = vistaStore((s) => s.cerrarDialogo);
  const open = dialogoActivo === "seccionPersonalizada";

  // Estado local del formulario (no de obra ni de vista): se reinicia al abrir.
  const [clase, setClase] = useState<Clase>("rectangular");
  const [b, setB] = useState(DIM_DEFECTO.b); // mm
  const [h, setH] = useState(DIM_DEFECTO.h); // mm
  const [d, setD] = useState(DIM_DEFECTO.d); // mm
  const [nombre, setNombre] = useState("");

  // Al abrir, reinicia el formulario a los valores por defecto (no arrastra la sesion
  // anterior). Depende de `open`: solo al pasar a abierto.
  useEffect(() => {
    if (open) {
      setClase("rectangular");
      setB(DIM_DEFECTO.b);
      setH(DIM_DEFECTO.h);
      setD(DIM_DEFECTO.d);
      setNombre("");
    }
  }, [open]);

  // Aplica un preset (rellena b×h o Ø). Los presets son PLANTILLAS de dimensiones (mm),
  // no entradas de catalogo (ver biblioteca/defaults.ts): el clic solo rellena los campos.
  const aplicarPreset = (p: PresetHormigon) => {
    if (p.clase === "rectangular") {
      setClase("rectangular");
      setB(p.b);
      setH(p.h);
    } else {
      setClase("circular");
      setD(p.d);
    }
  };

  // Nombre legible por defecto si el usuario no escribe uno. Se compone en CENTIMETROS
  // (b/h/d vienen en mm; /10 -> cm) para calcar la convencion de las secciones sembradas
  // ("HA 30×30", "HA 30×50") en vez de "HA 300×300": asi el nombre derivado es coherente
  // con el resto de la biblioteca y el aviso de duplicado casa. El usuario puede
  // sobrescribirlo (el id es opaco; el nombre es solo etiqueta).
  const nombreEfectivo =
    nombre.trim() !== ""
      ? nombre.trim()
      : clase === "rectangular"
        ? `HA ${b / 10}×${h / 10}`
        : `HA Ø${d / 10}`;

  // Validez geometrica minima: dimensiones positivas y finitas (el schema del dominio
  // exige .positive()). El boton se deshabilita si no se cumple; no es un error de campo.
  const dimensionesValidas =
    clase === "rectangular"
      ? Number.isFinite(b) && Number.isFinite(h) && b > 0 && h > 0
      : Number.isFinite(d) && d > 0;

  const avisoDuplicado = nombreDuplicado(nombreEfectivo);

  // Crea la seccion de obra: convierte mm->m en el BORDE (mmToM) y despacha crearSeccion.
  const crear = () => {
    if (!dimensionesValidas) return;
    const datos: DatosSeccion =
      clase === "rectangular"
        ? { clase: "rectangular", nombre: nombreEfectivo, b: mmToM(b), h: mmToM(h) }
        : { clase: "circular", nombre: nombreEfectivo, d: mmToM(d) };
    modeloStore.getState().ejecutar(crearSeccion(leerModelo(), datos));
    cerrarDialogo();
  };

  const pie = (
    <>
      <Boton variante="ghost" onClick={cerrarDialogo}>
        Cancelar
      </Boton>
      <Boton variante="primary" onClick={crear} disabled={!dimensionesValidas}>
        Crear sección
      </Boton>
    </>
  );

  return (
    <Dialogo
      open={open}
      onOpenChange={(o) => {
        if (!o) cerrarDialogo();
      }}
      titulo="Sección personalizada"
      pie={pie}
    >
      <div className="cx-secper">
        {/* Accesos rapidos: presets de dimensiones tipicas (clic -> rellena b×h/Ø). */}
        <div className="cx-secper__grupo">
          <span className="cx-campo__label">Accesos rápidos</span>
          <div className="cx-secper__presets">
            {PRESETS_HORMIGON.map((p) => (
              <button
                key={p.etiqueta}
                type="button"
                className="cx-secper__preset"
                onClick={() => aplicarPreset(p)}
              >
                {p.etiqueta}
              </button>
            ))}
          </div>
        </div>

        {/* Tipo de geometria: rectangular b×h / circular Ø. */}
        <div className="cx-secper__grupo">
          <span className="cx-campo__label">Geometría</span>
          <Segmentado
            aria-label="Geometría"
            opciones={OPCIONES_CLASE}
            valor={clase}
            onValor={(v) => setClase(v)}
          />
        </div>

        {/* Dimensiones en mm (la UI teclea/lee en mm; el borde convierte a m). */}
        {clase === "rectangular" ? (
          <div className="cx-secper__fila">
            <CampoNumero
              etiqueta="Ancho b"
              sufijo="mm"
              valor={b}
              onCommit={(v) => setB(v)}
            />
            <CampoNumero
              etiqueta="Canto h"
              sufijo="mm"
              valor={h}
              onCommit={(v) => setH(v)}
            />
          </div>
        ) : (
          <CampoNumero
            etiqueta="Diámetro Ø"
            sufijo="mm"
            valor={d}
            onCommit={(v) => setD(v)}
          />
        )}

        {/* Nombre legible (opcional): si se deja vacio se deriva "HA b×h"/"HA Ø d". */}
        <CampoTextoNombre valor={nombre} onCambio={setNombre} placeholder={nombreEfectivo} />

        {/* Aviso NO bloqueante de nombre duplicado (--warning, role=status). No impide
            crear: dos secciones pueden compartir nombre (id opaco distinto). */}
        {avisoDuplicado ? (
          <p className="cx-aviso-coherencia" role="status">
            Ya existe una sección llamada «{nombreEfectivo}». Puedes crearla igualmente.
          </p>
        ) : null}
      </div>
    </Dialogo>
  );
}

// Campo de texto simple para el nombre (no numerico): input controlado con placeholder
// que muestra el nombre derivado. Se define aqui (no en primitivas) porque es un caso
// puntual de este dialogo; usa las clases .cx-campo/.cx-input de las primitivas.
function CampoTextoNombre({
  valor,
  onCambio,
  placeholder,
}: {
  valor: string;
  onCambio: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="cx-campo">
      <span className="cx-campo__label">Nombre</span>
      <input
        className="cx-input"
        type="text"
        value={valor}
        placeholder={placeholder}
        onChange={(e) => onCambio(e.target.value)}
      />
    </label>
  );
}
