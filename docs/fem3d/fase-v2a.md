# Fase V2a — editor por tablas: resultado

> **Fecha:** 2026-10-11. **Plan:** `visor.md` §6 (lo que se fijó al empezar, aceptado tal cual por el usuario) y §5 (sus decisiones V-d, V-e y V-f).
>
> **Veredicto: V2a pasa los criterios 1 a 5. El 6, la puerta de uso, es del usuario: meter desde cero un proyecto suyo real, calcularlo y revisarlo.**
> - **Ida y vuelta (criterio 1).** Abrir y guardar sin cambios los cuatro proyectos de ejemplo da el mismo modelo y la misma huella, y guardar otra vez da los mismos bytes.
> - **Las operaciones nunca rompen el fichero (criterio 2).** Con 1 040 pasos al azar sobre los tres proyectos de ejemplo y seis modelos al azar:
>   - el proyecto pasa siempre el esquema;
>   - no queda ninguna referencia rota;
>   - deshacerlo todo devuelve los bytes del principio.
> - **Se puede meter un edificio de verdad (criterio 3).** 1-022 y el edificio objetivo se reconstruyen desde un proyecto vacío pegando sus tablas, con la huella de su `proyecto.json`. En el DOM, un pórtico con losa tecleado y pegado en las tablas da la huella del mismo modelo escrito a mano.
> - **Nunca se pierde ni se pisa nada en silencio (criterio 4).** Probado en tests del hook, del servidor y en Chrome:
>   - un cambio en el disco con cambios sin guardar avisa en 1 s y no recarga ni sobrescribe;
>   - un guardado que falla lo dice y conserva los cambios;
>   - los resultados se marcan como desactualizados con el primer cambio, y la respuesta tardía de una versión anterior se descarta;
>   - el servidor rechaza otro fichero, otra web y un texto que no es un proyecto.
> - **Fluidez (criterio 5), en el edificio objetivo, en Chrome.**
>   - Ninguna tarea larga del hilo principal al escribir una celda, pegar 80 filas o guardar.
>   - Los diagnósticos de un cambio salen en 1,23–1,30 s; el límite es 1,5 s.
>   - Guardar tarda 30 ms.
>
> **Hallazgos principales:**
> - **V2a-1:** la ayuda de la tabla decía que una carga de superficie sin losa iba a toda la planta, y el compilador la rechaza (necesita una losa, un paño o una zona). Lo encontró el test de DOM; la ayuda está corregida.
> - **V2a-2:** en la tabla de materiales, la columna E iba en MPa para el acero y en kN/m² para un material general, como en el modelo físico. Ahora son dos columnas, cada una con su unidad, y la que no toca tiene que ir vacía.
> - **V2a-3:** casi todo el retraso de los diagnósticos es compilar (0,85 s en el edificio objetivo). Con modelos mayores pasará del límite de 1,5 s; ver «Pendiente».

## Criterios

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Ida y vuelta: abrir y guardar sin cambios da el mismo modelo y la misma huella; guardar otra vez, los mismos bytes | **Pasa.** `ejemplo.json` y los tres de A2 | `src/editor/serializar.test.ts` |
| 2 | Las operaciones nunca rompen el fichero (esquema, referencias, deshacer) | **Pasa.** 26 sucesiones de 40 pasos: celdas, renombrar, borrar (en cascada o reasignando), copiar plantas y ordenar. Sobre los tres de ejemplo y seis modelos de `fisicoAleatorio` | `src/editor/editor.test.ts` |
| 3 | 1-022 y el edificio objetivo, desde vacío, sólo con operaciones del editor; un modelo pequeño tecleado en el DOM | **Pasa.** Misma huella en los dos, pegando el texto de sus tablas; el pórtico tecleado y pegado, la del modelo escrito a mano | `editor.test.ts`; `app/src/test/editor.test.tsx` |
| 4 | Nunca se pierde ni se pisa nada en silencio | **Pasa.** Conflicto, recargar o sobrescribir, guardado que falla, desactualizado al primer cambio, respuesta tardía descartada; servidor: otro fichero, `..`, `.fem/`, otro `Origin` o ninguno, sin `If-Match`, texto no válido | `app/src/test/editor.test.tsx` (7 del hook); `app/src/test/servidor.test.ts` (7); `validacion/v2a/out_chrome.txt` |
| 5 | Edificio objetivo: sin tareas largas > 50 ms al escribir y pegar 80 filas; diagnósticos ≤ 1,5 s; guardar ≤ 0,5 s | **Pasa.** 0 tareas largas; diagnósticos en 1,30 s (una celda) y 1,23 s (80 filas); guardar, 30 ms | `validacion/v2a/chrome.ts`, `out_chrome.txt` |
| 6 | Puerta de uso: el usuario mete desde cero un proyecto suyo real, lo calcula y lo revisa | **Pendiente del usuario** | — |

El banco de V1 sigue igual con la tabla bajo la planta: no hay tareas largas, y la primera M11 de una planta tarda 550 ms (592 antes, V1-3).

## 1. Qué hay nuevo

| Dónde | Qué |
|---|---|
| `src/editor/` (puro) | Todo lo que el editor hace con el proyecto, sin React ni DOM, para llevarlo a Concreta tal cual. Lo detallan las cuatro filas siguientes |
| `src/editor/`: operaciones | `referencias.ts`: el catálogo de colecciones y de las referencias entre ellas. `operaciones.ts`: crear, cambiar (renombrar propaga), borrar (pregunta, en cascada o reasignando), mover y datos; `aplicar` sólo deja pasar un proyecto que cumple el esquema |
| `src/editor/`: tablas | `tablas.ts`: las nueve tablas (objeto ↔ fila de textos). `celdas.ts`: el formato de cada celda, como lo pega Excel en español, y TSV con comillas |
| `src/editor/`: edición | `edicion.ts`: escribir una fila, pegar (por id con cabecera, o por posición como en Excel), exportar y copiar a plantas |
| `src/editor/`: historial y fichero | `historial.ts` (deshacer y rehacer por instantáneas), `serializar.ts` (formato canónico por el orden del esquema) y `plantilla.ts` (proyecto nuevo) |
| `app/src/sesion/useProyecto.ts` | El documento editado: historial, compilar sin calcular tras cada cambio (pausa de 150 ms), calcular a demanda, guardar, conflicto y aviso al cerrar con cambios sin guardar |
| `app/src/sesion/origen.ts` | `escribir` con el sello leído: en la carpeta, con File System Access (el permiso de escritura se pide al guardar); en el servidor, con `PUT` e `If-Match`. Sin carpeta, guardar descarga el fichero. `crearEnCarpeta` para el proyecto nuevo |
| `app/src/editor/` | `Hoja.tsx`: la tabla bajo la planta. `Formulario.tsx`: el inspector editable. `Dialogos.tsx`: borrar (con lo que lo usa) y copiar a plantas |
| `app/src/App.tsx`, `Inicio.tsx`, `pantallas/` | Deshacer, rehacer, guardar y calcular en la cabecera; banda de conflicto y de guardado fallido; Ctrl+S, Ctrl+Z y Ctrl+Y. Proyecto nuevo; nombre y descripción editables |
| `app/servidor.ts`, `app/visor.ts` | La carpeta del proyecto en `/proyecto/`, ahora con `PUT` del proyecto abierto. `bun run visor <fichero> --nuevo` crea un proyecto con la plantilla |
| `validacion/v2a/chrome.ts` | Banco en Chrome headless, con el manejador real del servidor: criterios 4 y 5. Con `CAPTURAS=<carpeta>`, guarda PNG de la interfaz |
| `.claude/skills/fem/SKILL.md` | El ingeniero edita el mismo fichero desde la app: el agente lo lee justo antes de cambiarlo |

## 2. Cómo se hace

- **Una operación, un proyecto nuevo.** `aplicar` copia sólo lo que cambia y deja el resto tal cual:
  - deshacer es volver al objeto anterior, así que da los mismos bytes;
  - la tabla no vuelve a pintar las filas que no cambiaron;
  - «sin guardar» es comparar la referencia con la del disco, así que deshacer hasta lo guardado lo quita.
- **Qué se valida.** Validar el esquema entero tras cada operación cuesta ~5 ms en el edificio objetivo, y pegar 80 filas, ~10 ms. Por eso no hace falta una validación incremental.
- **Lo que se ve es lo que se guarda.** La fila de una tabla es el texto de cada campo, y el objeto se reconstruye de ese texto con las mismas funciones al teclear, pegar y copiar. La ida y vuelta se comprueba objeto a objeto en los tres proyectos.
  - Lo que la tabla no edita se conserva del objeto anterior: un reticular, un perfil I, un empuje.
- **Ids.** Son únicos en todo el modelo, y los nuevos salen solos con el prefijo de la tabla. En `ejemplo.json`, el primer pilar nuevo es P3, porque P1 y P2 son plantas.
  - Renombrar desde la celda del id, o pegando en esa columna, cambia todas las referencias.
- **Borrar.** Si nada usa el objeto, se confirma y se borra. Si algo lo usa, el diálogo lista quién y elige el ingeniero:
  - borrarlo también, en cascada (un tramo de pilar sólo pierde el tramo);
  - o pasarlo a otro objeto de la misma colección.
- **Conflictos.** El sello del fichero (fecha y tamaño, o ETag) se compara al guardar y en la vigilancia de cada segundo. No hay fusión: con la pantalla 2 fuera de V2, basta con no pisar nada sin avisar.
  - Lo que guarda la propia app no cuenta como cambio de fuera.

## 3. Hallazgos

| # | Hallazgo | Consecuencia |
|---|---|---|
| V2a-1 | La ayuda de «sobre» decía que una carga de superficie sin losa iba a toda la planta. El compilador la rechaza: necesita una losa, un paño o una zona (C2-h) | Ayuda corregida. Lo encontró el test de DOM, al dar «no compila» con la huella correcta |
| V2a-2 | El E de un material va en MPa si es acero y en kN/m² si es general (`fisico.ts`). En una sola columna, un E de acero en kN/m² habría pasado | Dos columnas, «E acero» (MPa) y «E general» (kN/m²); la que no toca tiene que ir vacía, con test |
| V2a-3 | Los diagnósticos de un cambio tardan la pausa más compilar en un worker nuevo: 1,30 s en el edificio objetivo (1,39 s con una pausa de 250 ms). Compilar es 0,85 s; el edificio V2, con reticular, tiene 52 125 nudos | Pausa de 150 ms. Para modelos mayores, ver «Pendiente» |
| V2a-4 | Los proyectos de A2, escritos desde Python con un espacio de sangría, cambian de formato la primera vez que se guardan (ni de contenido ni de huella) | Lo dice la skill. Un `git diff` de ese primer guardado es grande; los siguientes, sólo lo cambiado |
| V2a-5 | Chrome headless no abre el selector de carpetas: guardar en una carpeta con File System Access no se puede probar en el banco | El mismo código de conflicto y escritura se prueba con un origen en memoria y con el servidor. La carpeta, a mano (criterio 6) |
| V2a-6 | En un pegado, las filas entran en orden: una que apunta a otra de más abajo del mismo bloque no entra (un caso N que «deriva de» un caso creado después) | Raro; se pega en otro orden o en dos veces, y el error dice qué fila y por qué |

## 4. Fuera de V2a, como se fijó

- **V2b:** muros y empujes, reticular, unidireccional, apoyos lineales y bandas editables. Mientras tanto se conservan al editar y se ven en el inspector, de sólo lectura.
- **V2c:** dibujar y mover con el ratón, ejes y enganches.
- **Con la capa de agente:** la pantalla 2 (propuestas del agente).
- **Sin editar en la app:** las opciones de compilación (se ven) y los perfiles I del catálogo (se conservan).
- **V3:** IndexedDB y móvil.

## 5. Pendiente

- **Del usuario: el criterio 6.**
  - Meter desde cero un proyecto suyo real (`bun run visor nuevo.json --nuevo`, o «Proyecto nuevo» eligiendo una carpeta), calcularlo y revisarlo en las pantallas de V1.
  - Probar a mano «Abrir la carpeta» y guardar en ella (V2a-5).
  - Lo que falte va a V2a.1, V2b o V2c.
- **Técnico: diagnósticos en modelos mayores (V2a-3).** Si con el reticular de V2 o un modelo real se pasa de 1,5 s, hay dos opciones:
  - enseñar antes los errores de esquema y de referencias, que el hilo principal ya tiene (`aplicar`), y dejar los del compilador para cuando lleguen;
  - o reutilizar el worker entre versiones, en vez de uno nuevo por versión.
- **Siguen de V1:** el criterio 4 de V1 (V1-3, C5-4) y su puerta de uso.
