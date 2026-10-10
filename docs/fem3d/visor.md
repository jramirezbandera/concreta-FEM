# Visor: propuesta

> **Qué es.** La interfaz web del motor, en fases V1–V3. V1 es un visor de sólo lectura: abre un `proyecto.json`, lo calcula (o lee lo que la CLI dejó en `.fem/<huella>/`) y enseña el modelo y los resultados en las pantallas de los prototipos v3. El modelo lo sigue editando el agente, o el ingeniero, en el JSON, y el visor se recarga solo. **Fecha:** 2026-10-11.
>
> **Estado:** §3 aceptada por el usuario el 2026-10-11, con las decisiones de §5. V1 en curso.
>
> **Por qué ahora y no después de A5.** La capa de agente da por hecho que el ingeniero revisa y firma «sobre un informe y un visor» (`agente.md`, veredicto), y la superposición con la que A5 confirma un plano se ve mucho mejor en un visor que en una PNG. Hasta ahora sólo existen los prototipos (lienzo «FEM 3D · Interfaz», v3) y los SVG/PNG de `fem render`.

## 1. Fases

| Fase | Contenido |
|---|---|
| **V1 Visor de sólo lectura** | Abrir, calcular o reutilizar `.fem/`, recargar al cambiar el fichero. Pantallas: modelo (planta y 3D), losas, vigas, pilares, desplomes y revisión. No escribe nada |
| **V2 Editor por plantas** | Editar el modelo físico en la interfaz (pantalla 1 completa) y aceptar o rechazar los cambios que propone el agente (pantalla 2). Necesita decidir cómo conviven las ediciones del agente y las del ingeniero sobre el mismo fichero |
| **V3 Móvil y Concreta** | Pantalla 8 (consulta en obra), persistencia en IndexedDB (H44), offline, y llevarlo a `src/features/fem3d/` de Concreta con el PR que decida el usuario |

## 2. Lo que ya está decidido y se usa

- **Three.js directo, sin R3F** (H41): un motor `Visor3D` imperativo fuera de React, un único `WebGLRenderer` de larga vida y render bajo demanda. Barras como `LineSegments` y nada de un objeto Three por elemento (H42).
- **Ninguna tarea de más de 50 ms en el hilo principal** (`diseno-tecnico.md` §14.3, H42).
- **Resultados por Transferable, nunca en JSON** (H27), con la huella como identidad: una respuesta sólo se acepta si su huella es la del modelo abierto (PLA-15).
- **Color sin interpolar** (H43): bandas con valores, sin degradados entre vértices; cada región SPR con sus valores, sin promediar los saltos (E5-7).
- **Todo número rotulado sale de una consulta** (A4): de `Consultas` (C5) o de las consultas de A1, nunca del dibujo.
- **Estilo de Concreta, denso y con todo a la vista** (decisión del usuario sobre los prototipos): paneles fijos, tablas con la combinación de cada valor, y nada escondido tras pestañas.

## 3. V1: lo que se fija al empezar

Lo propuso el agente y el usuario lo aceptó tal cual el 2026-10-11, antes de escribir código.

### 3.1 Arquitectura

```
proyecto.json ─┐                     ┌─ worker de sesión (puro) ─────────────────────────┐
.fem/<huella>/ ┼─ hilo principal ───►│ proyecto → compilar → calcular (núcleo WASM)      │
               │  (React: dibuja,    │ → Consultas, ResultadosRender, revisar            │
               │   no calcula)  ◄────│ responde: escenas, tablas y extremos, por huella  │
               └                     └───────────────────────────────────────────────────┘
```

- **`src/visor/` (puro, como el motor):** lo que cada pantalla necesita, calculado desde la sesión: escenas de planta (las de A4), tablas, extremos, envolventes por estación, desplomes y la geometría 3D en `Float32Array`. Sin React ni DOM, así que se prueba en Node contra la CLI y se llevará a Concreta tal cual.
- **Worker de sesión:** guarda el proyecto, la compilación, los resultados y las `Consultas`, y contesta pedidos pequeños («la escena de N3 en uz con ELS-C-4», «la envolvente de la viga V12»). Así compilar (0,85 s en el edificio objetivo), calcular (3–4 s), las consultas y la revisión (5,5 s) no bloquean la interfaz. Llama al núcleo WASM directamente, sin el `ClienteMotor` de E4. Cancelar es `terminate` y volver a abrir.
- **`app/`:** sólo la interfaz, con Vite + React + Tailwind como Concreta y Three.js para el 3D. Importa de `src/` y nunca al revés.
- **Abrir un proyecto:**
  - **Carpeta del proyecto,** con la File System Access API (Chrome y Edge). Lee `proyecto.json` y, si en `.fem/<huella>/` hay resultados de esa huella calculados con el mismo núcleo (sha256 del WASM), los usa sin recalcular; si no, calcula.
  - **Vigila el fichero:** si el agente lo cambia, el visor recarga, marca los resultados como desactualizados al instante y recalcula. Conserva la planta, la vista y la selección si el objeto sigue existiendo.
  - **Arrastrar un `proyecto.json`,** en cualquier navegador: lo mismo, sin vigilancia y sin `.fem/`.
  - **El visor no escribe nada:** ni el proyecto, ni `.fem/`, ni las firmas. Firmar sigue siendo `fem firmar`.
- **El 2D reutiliza la escena de A4** (primitivas en metros, con el objeto físico de cada una). El visor dibuja esas mismas primitivas en un SVG interactivo, con pan y zoom: lo que se ve en el visor y en `fem render` es la misma escena.

### 3.2 Pantallas

Las de los prototipos v3 (1, 3, 4, 5, 6 y 7), sin lo que es de edición.

| Pantalla | Qué tiene en V1 |
|---|---|
| **Modelo** | Lista de plantas con cota, altura y avisos; capas (ejes, pilares y muros, vigas, losas y paños, cargas por caso, avisos, malla, bandas). Planta con selección: inspector del objeto (datos, tramos, lo que le llega, diagnósticos). Si el modelo no compila, se dibuja con sus diagnósticos, como la vista `diagnosticos` de A4. Pestaña 3D: el edificio con órbita, la planta activa resaltada |
| **Losas** | uz, M11, M22, M12, V13 y V23 por planta, en una combinación, una envolvente o un caso. Leyenda con bandas redondas, extremos con «ir al punto», valor en el punto pulsado (de la consulta, no del color), flecha absoluta y relativa por recuadro, equilibrio por caso |
| **Vigas** | Planta con la viga elegida y alzado con la envolvente de My o Vz (y T), cursor por estaciones con la combinación de cada valor, y tabla por vanos de cara a cara |
| **Pilares** | Tramos por planta, rotulado en planta de ν, N, My o Mz, gráfico de axil por tramo y cuadro con la combinación de cada valor |
| **Desplomes** | Por dirección: deformada 3D con escala, perfil por plantas y tabla de desplome total y relativo frente a los límites del CTE |
| **Revisión** | El informe de A3 (`revisar`), con su índice, y el estado de la firma leído de `<proyecto>.revision.json`: firmado, sin firmar o caducado porque la huella cambió |

**Fuera de V1:** editar (V2), la pantalla 2 (propuesta del agente, V2), el alzado de pórtico, el móvil (V3), IndexedDB y offline (V3), los rótulos masivos en 3D (H45), exportar y el plano de fondo (A5).

### 3.3 Criterios de paso

1. **Fidelidad.** Cada número que enseña el visor es el de una consulta:
   - en los cuatro proyectos de ejemplo (`ejemplo.json` y los tres de A2), los datos de cada pantalla (tablas, extremos, rótulos, envolventes por estación, desplomes) coinciden bit a bit con `Consultas` y con las consultas de A1 llamadas a mano;
   - la escena de cada planta y vista es igual, primitiva a primitiva, a la de `fem render`;
   - un test de DOM comprueba que el texto de las tablas es el valor de la consulta con su formato.
2. **Los mismos bits que la CLI.** Calcular en el worker, en Chrome, da el mismo sha256 de resultados que `fem calcular` en los cuatro proyectos. Abrir con los resultados de `.fem/` da las mismas pantallas que calcular.
3. **Nunca un resultado que no vale presentado como válido.** Con tests:
   - al cambiar el fichero, los resultados se marcan como desactualizados antes de cualquier otra cosa, y la respuesta tardía de un cálculo anterior se descarta por su huella;
   - un `resultados.bin` de otra huella, de otro núcleo o alterado no se usa (se recalcula y se dice por qué);
   - un cálculo sin equilibrio, o un modelo que no compila, no enseña resultados: enseña el error y los diagnósticos.
4. **Fluidez, en el edificio objetivo** (en sobremesa, en Chrome):
   - en un recorrido guionizado (abrir, calcular, cambiar de planta, de magnitud y de combinación, mover el cursor de una viga, orbitar el 3D), ninguna tarea larga del hilo principal pasa de 50 ms (`PerformanceObserver`, `longtask`);
   - cambiar de planta, magnitud o combinación tarda ≤ 0,5 s con el cálculo hecho;
   - abrir con `.fem/` tarda ≤ 2 s; abrir y calcular, lo que tarde el cálculo más ≤ 1 s.
5. **Recarga.** Si se edita `proyecto.json` en disco (por ejemplo, con `fem` o a mano), el visor lo detecta en ≤ 2 s sin hacer nada, y conserva planta, vista y selección.
6. **Puerta de uso.** El usuario revisa con el visor los tres proyectos de A2 y dice si le sirve para revisar. Lo que le falte se apunta para V1.1 o V2.

## 4. Pila y licencias

| Pieza | Versión | Licencia |
|---|---|---|
| react, react-dom | 19.2 (como Concreta) | MIT |
| vite, @vitejs/plugin-react | 8, 6 (como Concreta) | MIT |
| tailwindcss, @tailwindcss/vite | 4.2 (como Concreta) | MIT |
| three | la última | MIT |
| lucide-react (iconos) | 1.7 (como Concreta) | ISC |
| jsdom, @testing-library/react | como Concreta (sólo tests) | MIT |

- **De Concreta se copian** los tokens de `src/index.css` (tema claro y oscuro), el tema (`src/lib/theme/`), el lienzo 2D (`useCanvasView2D.ts`, `lib/canvas/transform.ts`, `ZoomControls.tsx`) y las clases de las tablas densas (`cargas-planta/estilos.ts`), citando el fichero de origen y en `NOTICE`. Todos tienen un solo autor, el usuario (comprobado con `git log`).
- **El banco de Chrome** sigue a `validacion/e4/chrome.ts`: Chrome headless con perfil temporal, sin tocar la sesión del usuario.

## 5. Decisiones del usuario (2026-10-11)

- **V-a. Código de Concreta:** se copian aquí los ficheros de §4, que son sólo del usuario, citando el origen en cada uno y en `NOTICE`. Quedan publicados con el repo.
- **V-b. Tipografía:** Geist y Geist Mono, como Concreta. SIL OFL 1.1 se admite sólo para fuentes (regla 6).
- **V-c. Móvil:** fuera de V1; va con V3.
