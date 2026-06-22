# Concreta · Estructuras — Especificación de diseño del frontend (v3)

> Documento de diseño para esbozar en **Claude Design**.
> Producto: aplicación web de cálculo estructural para **arquitectos**, con interfaz **calcada a CYPECAD** (pestañas, grupos/plantas, sistema gráfico) sobre el motor FEM **PyNite** (`PyNiteFEA`), bajo la marca **Concreta**.
> Versión: borrador 3 · adopta la estructura de CYPECAD como referencia de interfaz.

---

## 1. Tesis y enfoque

El éxito de CYPECAD no está en su solver, sino en haber trasladado la complejidad del FEM a **elementos constructivos** que el arquitecto introduce de forma natural —pilares, vigas, paños de forjado, muros— organizados por **plantas y grupos**, dibujando en planta sobre plantillas DXF. Concreta · Estructuras replica ese modelo de interacción: **fácil en la introducción, potente en el cálculo**. El usuario manipula obra; el FEM ocurre por debajo.

Diferencia con SAP2000/ETABS: allí se modelan nudos y barras abstractos; aquí el arquitecto coloca *un pilar del grupo de plantas 1 al 2* y el sistema genera nudos, barra, vínculos y arranque por su cuenta.

> Lo que aporta Concreta sobre PyNite no es el solver (ya lo da PyNite): es la **capa de obra estilo CYPECAD** + la **discretización automática** + la futura comprobación normativa.

---

## 2. Modelo de dos capas

```
CAPA 1 · MODELO CONSTRUCTIVO (lo que ve y toca el arquitecto)
Plantas/Grupos · Pilares · Vigas · Paños (forjados) · Muros · Cargas por hipótesis
            │  DISCRETIZACIÓN automática (inspeccionable)
            ▼
CAPA 2 · MODELO DE CÁLCULO (FEM, normalmente oculto)
Nodos · Members · Releases · Supports · Mallas · Casos/Combos  →  PyNite (Pyodide/WASM)
```

El propio CYPECAD usa el término **"discretización"** para convertir los elementos lineales en el modelo de cálculo; Concreta hace lo mismo: el discretizador traduce la obra a primitivas PyNite. La Capa 2 es **inspeccionable** ("Ver modelo de cálculo"): nudos, barras y mallas generados, semitransparentes sobre la obra. Frente a la caja negra de CYPECAD, esta transparencia es un diferenciador y encaja con uso docente.

> Regla de oro: toda acción del usuario se expresa en obra; toda llamada a PyNite la genera el sistema. El usuario nunca escribe `def_releases`; marca un empotramiento o una articulación en el extremo de la viga.

---

## 3. Decisiones de producto fijadas

| Decisión | Elección |
|---|---|
| Referencia de interfaz | **CYPECAD** (pestañas, grupos/plantas, sistema gráfico) con estética moderna |
| Público | Arquitectos y técnicos |
| Modelo de interacción | Elementos constructivos + discretización automática |
| Introducción de geometría | Lienzo gráfico, **dibujo en planta por grupos**, sobre plantillas DXF |
| Solver | PyNite en **Pyodide/WASM** (Web Worker), sin servidor |
| Entregable del MVP | **Esfuerzos + deformada** (sin armado ni normativa todavía) |
| Alcance | Todo, **por fases** |
| Marca | App independiente con identidad Concreta |

---

## 4. Estructura de la aplicación: las cuatro pestañas

CYPECAD organiza el trabajo en **cuatro pestañas (solapas) en la parte inferior izquierda**, cada una con su propia barra de menús superior. Concreta adopta exactamente esa estructura. Menús comunes a todas: **Archivo · Obra · Ayuda**. El resto cambian según la pestaña.

```
┌───────────────────────────────────────────────────────────────────────────┐
│  BARRA DE MENÚS (cambia según pestaña)   ·   Archivo · Obra · … · Ayuda     │
├──────┬─────────────────────────────────────────────────────┬──────────────┤
│ BARRA│                                                       │  HERRAMIENTAS │
│ LATE-│              ÁREA DE TRABAJO                          │  ÁREA SUP.    │
│ RAL  │        (planta del grupo activo · 2D / 3D / mosaico) │  DERECHA      │
│ IZQDA│                                                       │  (F4/F3/ayudas)│
│ vistas│                                                      │              │
│ elem.│                                                       │              │
│ leídos│   ← barra de estado / línea de mensajes (inferior)  │              │
├──────┴─────────────────────────────────────────────────────┴──────────────┤
│  [ Entrada de pilares ] [ Entrada de vigas ] [ Resultados ] [ Isovalores ] │
└───────────────────────────────────────────────────────────────────────────┘
```

| Pestaña | Para qué sirve | En Concreta (fase) |
|---|---|---|
| **1 · Entrada de pilares** | Definir plantas/grupos; introducir pilares, pantallas y arranques | F1 (pilares); pantallas en F3 |
| **2 · Entrada de vigas** | Vigas, muros, paños de forjado, cimentación, cargas, y **lanzar el cálculo** | F1 (vigas/cargas/calcular); paños/muros F3; cimentación F4 |
| **3 · Resultados** | Esfuerzos, deformada 3D, reacciones; (luego) armados y comprobaciones | F1 (esfuerzos/deformada); armado F4 |
| **4 · Isovalores** | Mapas de isovalores/isolíneas en losas, reticulares y cimentación | F3 |

> El *shell* de cuatro pestañas se diseña entero desde el MVP; lo que crece por fase es el contenido de cada una. En el MVP, "Resultados" muestra esfuerzos y deformada (no armado), y la pestaña "Isovalores" puede estar visible pero deshabilitada hasta F3.

---

## 5. Grupos y plantas (la columna organizativa)

Como en CYPECAD, la obra se organiza en **plantas** agrupadas en **grupos** (plantas iguales que comparten vigas y cargas). Es lo primero que se define, en la pestaña "Entrada de pilares" → menú **Introducción → Plantas/Grupos**.

- Cada planta tiene **nombre**, **cota** y **altura**.
- Por **grupo** se definen **Categoría de uso**, **Sobrecarga de uso** y **Cargas muertas**, que se aplican a todas sus plantas.
- **Navegación entre grupos**: *Subir grupo*, *Bajar grupo*, *Ir a grupo*. El área de trabajo siempre muestra la planta del grupo activo.
- **Unir grupos / Dividir grupos**.

El **gestor de plantas/grupos** vive en la barra lateral izquierda y/o en una cinta superior; la planta activa se resalta y define el plano de introducción.

---

## 6. Sistema gráfico y vistas

Calcado del entorno de CYPECAD, modernizado:

**Área de trabajo (centro).** Por defecto, **vista en planta 2D** del grupo activo. Conmutable a **vista 3D** del edificio o a **mosaico** (2D + 3D simultáneos, sincronizados).

**Barra lateral izquierda.** Paneles de:
- **Gestión de vistas** (generar vistas 2D/3D, plantas, alzados).
- **Elementos leídos** (visibilidad y referencia a plantillas/modelos importados).
- **Elementos propios** (capas del modelo: pilares, vigas, cargas, etiquetas — visibilidad por capa).
- **Árbol de obra** (jerarquía por grupos → elementos).

**Herramientas del área superior derecha.**
- **Plantillas DXF-DWG (F4)**: importar DXF/DWG/PDF/JPG por planta como fondo para calcar; gestión de vistas de plantillas.
- **Capturas a plantillas (F3)**: referencias tipo CAD a las entidades de la plantilla.
- **Ayudas a la introducción**: capturas a objetos (extremo, intersección, punto medio, perpendicular), **puntos de rastreo**, orto, rejilla.
- Control del **sistema de ventanas anclables**, configuración general, ayuda.

**Barra de estado (inferior).** Línea de mensajes contextual ("Pulse el primer punto de la viga…"), coordenadas del cursor, captura activa, unidades.

**Vista 3D del edificio.** Navegable; opciones *Ver todas las plantas / Ver solo la planta activa*, *dibujar el techo de la planta*. En modo resultados: **deformada 3D con escala de colores** y **animación** del proceso de deformación por combinación. Conmutador **"Ver modelo de cálculo"** (la discretización PyNite superpuesta).

**Captura e introducción precisa.** Snaps tipo CAD + entrada numérica (longitud/ángulo/coordenada al dibujar), igual que en la introducción de vigas y pilares de CYPECAD.

---

## 7. Pestaña 1 · "Entrada de pilares"

**Barra de menús:** Archivo · Obra · **Introducción** · **Edición** · **Grupos** · Vistas · Ayuda.

**Menú Introducción**
- **Plantas/Grupos** — definir cotas, alturas, categorías de uso, sobrecargas y cargas muertas por grupo; unir/dividir grupos.
- **Pilares, pantallas y arranques** — herramienta principal. Al introducir un **pilar**:
  - posición en planta (clic, con captura/coordenadas),
  - **planta inicial y final** (arranca en un grupo, muere en otro),
  - **sección** y **material** (de biblioteca),
  - **ángulo** de giro,
  - **vinculación exterior** Sí/No (Sí ⇒ habilita cimentación bajo ese arranque),
  - **tipo de arranque** (empotrado/articulado/elástico).
  - *Pantallas de H.A.*: elementos lámina → **Fase 3**.

**Menú Edición** — mover, girar, copiar, borrar, array de pilares; igualar pilares.

**Menú Grupos** — Subir/Bajar/Ir a grupo, unir/dividir.

**Traducción a PyNite (discretización):** cada pilar → `member` vertical (nodo de planta inicial → final); si tiene vinculación exterior y arranque empotrado → `def_support(...)` en el nudo de arranque.

---

## 8. Pestaña 2 · "Entrada de vigas"

El modo de trabajo principal. **Barra de menús:** Archivo · Obra · **Vigas** · **Muros** · **Paños** · **Cargas** · **Cimentación** · **Calcular** · **Grupos** · Vistas · Ayuda.

**Menú Vigas** *(Fase 1)*
- **Entrar viga** — de **punto a punto** o por **borde exterior rectangular**; **vigas inclinadas**; vigas comunes entre grupos.
- **Ajuste** de la viga respecto a la línea: Centro / Izquierda / Derecha, con **desplazamiento**.
- **Alineaciones**: unir, dividir, igualar (continuidad de armado en fases posteriores; en MVP, continuidad estructural).
- **Empotramientos** en extremos (empotrado/articulado) → controla las liberaciones.
- **Polivigas**, vinculación a **diafragma rígido** de vigas exentas, desconectar/conectar muros a pilares.
- Información del **pórtico** al que pertenece una viga (línea de mensajes).
- Editar geometría, unir/dividir vigas.

**Menú Muros** *(Fase 3)* — muros de hormigón armado y de fábrica (elementos lámina; mallado).

**Menú Paños (forjados)** *(Fase 3)* — *Gestión paños → Entrar paño*, eligiendo el tipo:
- **Unidireccional** (viguetas) — con viguetas dobles, zunchos sin armar, macizados.
- **Reticular**.
- **Losa maciza**.
- **Placas aligeradas**, **losas mixtas**.
- **Huecos** (marcados con aspa; se forjan o no).
- Los paños deben quedar contenidos entre vigas, zunchos o muros.

**Menú Cargas** *(Fase 1 para lineales/superficiales sobre vigas; resto progresivo)*
- **Cargas puntuales**, **Cargas lineales en vigas**, **Cargas superficiales en paños**.
- Cada carga se asigna a una **hipótesis** (caso): permanente `G`, sobrecarga de uso `Q`, viento `V`, nieve `N`, sismo `E`…
- **Categorías de uso** (CTE DB-SE-AE) que rellenan automáticamente la sobrecarga por grupo.
- Gestión de **hipótesis adicionales** (cargas especiales) sin entrar en "Datos generales".

**Menú Cimentación** *(Fase 4)* — disponible donde arranque un pilar/pantalla "con vinculación exterior": **zapatas** (centrada/esquina/medianera), **encepados**, **vigas centradoras y de atado**, **losas de cimentación**.

**Menú Calcular** *(Fase 1)*
- **Calcular la obra** — con/sin cimentación; en MVP, **solo esfuerzos y deformada** (el "sin obtener armado" de CYPECAD es, de hecho, el estado permanente del MVP).
- **Comprobar geometría de los grupos** — ejecuta la **discretización** para detectar errores antes del cálculo general (nudos sin conectar, mecanismos…).
- **Centro de masas / centro de rigidez** *(F2, con modal)*.
- **Rearmar pórticos / pilares** *(F4)*.

**Traducción a PyNite:** vigas → `members` horizontales con `releases` según empotramientos; cargas por hipótesis → `add_*_load(case=...)`; categorías de uso → valores `Q`; combinaciones CTE → `add_load_combo`.

---

## 9. Pestaña 3 · "Resultados"

**Barra de menús:** Archivo · Obra · **Pilares/Pantallas** · **Vigas** · **Forjados** · **Cimentación** · **Envolventes** · Vistas · Ayuda.

**En el MVP (Fase 1):**
- **Esfuerzos por barra**: diagramas de axil, cortante (Fy/Fz), flector (My/Mz), torsor y flecha, por combinación (Plotly desde los `*_array()` de PyNite). Selección de la viga/pilar en planta o 3D.
- **Deformada 3D** con **escala de colores** y **animación** por combinación/hipótesis; control de escala de amplificación.
- **Reacciones** en arranques y **desplazamientos** en nudos, en tablas por combinación.
- **Envolventes** de esfuerzos por elemento entre combinaciones.
- Selector global de **combinación/hipótesis** activa.

**En fases posteriores (F4):**
- **Armados** de pilares, vigas y forjados; **editor de pilares** por tramo (esfuerzos, dimensionamiento, comprobaciones); elementos con error **en rojo**.
- Resultados de **cimentación**.

---

## 10. Pestaña 4 · "Isovalores" *(Fase 3)*

Mapas de **isovalores** (color) e **isolíneas** (curvas de igual valor) de desplazamientos, esfuerzos y cuantías en **losas macizas, forjados reticulares y losas de cimentación**, generados a partir de los resultados de placa/quad de PyNite (Mx, My, Mxy, Qx, Qy, Sx…), con barra de escala.

---

## 11. Catálogo de elementos → traducción a PyNite

| Elemento (CYPECAD) | Fase | Discretización en PyNite |
|---|---|---|
| Planta / Grupo | F1 | Organiza cotas; no es FEM por sí mismo. |
| **Pilar** | F1 | `member` vertical; arranque → `def_support`. |
| **Viga** (punto a punto / borde / inclinada) | F1 | `member`; `def_releases` según empotramientos. |
| Empotramiento/articulación de extremo | F1 | `releases` en el extremo. |
| Tirante / arriostramiento | F1 | `member` `tension_only=True`. |
| Cercha / celosía | F1 | `members` biarticulados. |
| **Pantalla H.A.** | F3 | malla de `quads`. |
| **Muro** (H.A. / fábrica) | F3 | `add_shear_wall` / malla. |
| **Paño** unidireccional/reticular/losa | F3 | reparto a vigas y/o `add_rectangle_mesh`. |
| Hueco en paño | F3 | exclusión de malla/reparto. |
| **Zapata / encepado / viga de atado** | F4 | `def_support` (empotrado) o muelle (balasto). |
| Escalera / rampa | F4 | FEM aislado → cargas lineales/superficiales sobre la estructura. |

---

## 12. Cargas e hipótesis

El arquitecto introduce cargas **por hipótesis** (no por dirección FEM): permanente `G`, sobrecarga de uso `Q` (por **categoría de uso** CTE), viento `V`, nieve `N`, sismo `E`. Tipos: **puntuales**, **lineales en vigas**, **superficiales en paños**. El sistema:
- aplica peso propio automáticamente (material + sección),
- traduce cada carga a `add_*_load(..., case=hipótesis)`,
- y **genera las combinaciones CTE** (ELU/ELS: `1.35·G + 1.5·Q`, etc.) como `add_load_combo`.

En el MVP basta con permanentes y sobrecarga de uso (lineales/superficiales sobre vigas) y la generación de combinaciones básicas.

---

## 13. Bibliotecas de datos

PyNite exige A, Iy, Iz, J a mano; Concreta los **deriva de catálogo**:
- **Materiales**: Hormigón EHE-08 (HA-25…HA-40), Acero EC3 (S235/S275/S355); *(F2+)* madera, aluminio.
- **Secciones**: perfiles europeos (IPE, HEA, HEB, HEM, UPN, L, tubos) con propiedades automáticas; hormigón paramétrico (rectangular, circular, T, L); y sección genérica manual.
- UI: biblioteca con buscador, filtro por familia y vista previa de propiedades.

---

## 14. Lenguaje visual e identidad

**Potencia técnica con UI moderna.** El lienzo manda; los paneles enmarcan. Viewport oscuro tipo CAD; paneles neutros (o modo oscuro completo conmutable). Datos numéricos en **monoespaciada**. **Color = semántica.** Rejilla de 8 px.

**Tokens (provisionales — confirmar con identidad Concreta):**

| Token | Valor | Uso |
|---|---|---|
| `--canvas-bg` / `--canvas-grid` | `#0E1116` / `#1C2330` | Área de trabajo y rejilla. |
| `--surface` / `--surface-muted` | `#FFFFFF` / `#F4F6F8` | Paneles. |
| `--accent` | `#2563EB` *(placeholder)* | Acción primaria, selección, marca. |
| `--pilar` / `--viga` | `#9DB2CE` / `#C9A66B` | Color por tipo de elemento. |
| `--support` / `--load` / `--moment` | `#22C55E` / `#F97316` / `#A855F7` | Arranques / cargas / momentos. |
| `--deformed` | `#38BDF8` | Deformada. |
| Escala isovalores | rampa azul→verde→amarillo→rojo | Mapas F3 y deformada de colores. |
| `--danger` / `--warning` / `--success` | `#DC2626` / `#F59E0B` / `#16A34A` | Estados; elementos con error "en rojo". |

**Tipografía**: UI grotesca (Inter o de marca); números en monoespaciada (JetBrains Mono / IBM Plex Mono).
**Iconografía**: set lineal con iconos propios de obra (pilar, viga, paño, muro, zapata, empotramiento/articulación, plantilla, captura) y de FEM (para "Ver modelo de cálculo").

---

## 15. Arquitectura técnica y contrato de datos

Todo en el cliente; PyNite en **Pyodide / Web Worker**. El **discretizador** traduce la Capa 1 (obra) a la Capa 2 (JSON PyNite), respetando el orden de dependencias y aplicando validaciones (nombres únicos, referencias válidas, sujeción suficiente, direcciones global/local). Persistencia con IndexedDB (autosave) + export/import del proyecto.

```jsonc
// CAPA 1 — modelo constructivo (lo que se guarda)
{
  "units": "kN-m",
  "groups": [{ "name": "Grupo 1", "use_category": "A", "q": 2.0, "dead": 2.0 }],
  "levels": [{ "name": "Baja", "z": 0.0, "height": 3.2, "group": "Grupo 1" }],
  "columns": [{ "name": "P1", "x": 0, "y": 0, "level_i": "Baja", "level_j": "P1ª",
               "section": "HA40x40", "material": "HA-25",
               "exterior_link": true, "base": "fixed" }],
  "beams":  [{ "name": "V1", "level": "P1ª", "i": "P1", "j": "P2",
               "section": "HA30x50", "material": "HA-25",
               "end_i": "fixed", "end_j": "fixed", "tie": false }],
  "slabs":  [/* F3 */],
  "loads":  [{ "type": "line", "scope": "beam:V1", "value": -10, "case": "G" }],
  "analysis": { "type": "analyze", "check_statics": true }
}
```
El discretizador genera la Capa 2 (`nodes/materials/sections/members/supports/releases/loads/combos`) según el esquema PyNite de la *Guía* §11.1.

---

## 16. Mapeo de fases (qué pestaña/elemento, cuándo)

| Fase | Pestañas / contenido |
|---|---|
| **F1 (MVP)** | Shell de 4 pestañas. Entrada de pilares (plantas/grupos, pilares). Entrada de vigas (vigas, empotramientos, cargas lineales/superficiales, hipótesis, **Calcular = esfuerzos**). Resultados (esfuerzos, deformada 3D color + animación, reacciones, envolventes). Plantillas DXF + capturas. Análisis lineal/general. |
| **F2** | 3D pleno, P-Δ y modal, peso propio automático, centro de masas/rigidez, vigas comunes entre grupos. |
| **F3** | Muros, pantallas, **paños** (uni/reticular/losa), huecos, mallado, **pestaña Isovalores**. |
| **F4** | **Cimentación**, **armados** y editor de pilares/vigas, comprobación normativa EHE-08/EC, separatas/memorias PDF. |

> Recomendación de alcance: cerrar primero un **corte vertical fino** en F1 (pórticos de pilares+vigas por grupos, cargas básicas, esfuerzos/deformada) extremo a extremo, antes de ensanchar el catálogo.

---

## 17. Plan de pantallas para Claude Design

Escritorio, ~1440 px. En orden:

1. **Shell + pestaña "Entrada de pilares".** Las 4 solapas abajo, barra de menús superior, barra lateral izquierda (vistas/elementos), herramientas superior derecha (F4/F3), barra de estado, área de trabajo en planta con rejilla. Diálogo "Plantas/Grupos" abierto.
2. **"Entrada de pilares" — introduciendo pilares.** Planta del grupo activo con pilares colocados, plantilla DXF de fondo, panel de "Pilar actual" (planta inicial/final, sección, vinculación, arranque).
3. **"Entrada de vigas" — trazando vigas.** Menú Vigas activo, panel "Viga actual" (ajuste centro/izq/der, empotramientos), vigas entre pilares, línea de mensajes ("pulse el segundo punto…").
4. **Cargas e hipótesis.** Diálogo de carga lineal/superficial con selección de hipótesis y categoría de uso.
5. **Vista 3D / mosaico.** Edificio en 3D + planta en mosaico sincronizado; gizmo, view cube.
6. **"Resultados".** Deformada 3D con escala de colores + diagrama de esfuerzos de la viga seleccionada (panel inferior) + tabla de reacciones; selector de combinación.
7. **"Ver modelo de cálculo".** La discretización PyNite (nudos/barras/releases/supports) semitransparente sobre la obra — comunica la tesis del producto.
8. **Biblioteca de secciones** y **estado de cálculo / arranque del motor Pyodide**.
9. *(F3, opcional)* **"Isovalores"** con mapa de color de un paño.

---

## 18. Riesgos y decisiones pendientes

**Riesgos.** (1) El **discretizador** es el producto: su corrección (conectividad por grupos, empotramientos, arranques, reparto de cargas) decide todo; validar contra ejemplos de PyNite y casos a mano. (2) La **transparencia** ("Ver modelo de cálculo") es un diferenciador frente a la caja negra de CYPECAD — diséñala de primera clase. (3) **Alcance**: el catálogo CYPECAD completo es enorme; cerrar F1 fino antes de crecer.

**Decisiones pendientes antes de esbozar.**
- Paleta de **acento Concreta** (hoy *placeholder*) y tipografías de marca.
- Nombre del módulo (*Concreta · Estructuras*, *Concreta CAD*…).
- ¿Material del MVP: hormigón, acero o ambos?
- ¿Estética: lienzo oscuro con paneles claros, o modo oscuro completo?
- ¿Mantener literalmente las 4 pestañas de CYPECAD o fusionar "Entrada de pilares/vigas" en un único modo de introducción por capas (más moderno)?
