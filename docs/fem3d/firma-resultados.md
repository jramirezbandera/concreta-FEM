# Firma del modelo en los resultados guardados

*2026-11-06. Pedido por el usuario tras el diagnóstico de los racimos de la malla del proyecto «51».*

## 1. El fallo

- **Qué se guardaba:** unos resultados en `.fem/<huella>/` (la CLI) o en la caché de la app (AL1, en el mismo formato).
- **Qué se comprobaba al reutilizarlos:**
  - la huella de compilación, que es la del modelo físico, las opciones y `VERSION_COMPILADOR`;
  - el núcleo;
  - el sha256 de `resultados.bin`.
- **Lo que no se comprobaba:** que el modelo analítico de ahora fuera el que se calculó.
- **Cuándo falla:** si el compilador cambia su salida sin cambiar de versión (mientras se desarrolla, o por un descuido al cerrar una fase), la misma huella da otra malla.
  - Los vectores guardados se leían entonces sobre los nudos y las láminas de la malla nueva, sin aviso.
  - En el «51», con 4 088 nudos en lugar de 4 155, las franjas salieron con hasta 2 300 kN·m/m, frente a 20–40.
- **Por qué es grave:** es un fallo silencioso (regla de oro 1). En el uso normal lo evita cambiar la versión, pero nada lo garantizaba.

## 2. Lo hecho

### 2.1 La firma

- **Dónde va:** la cabecera de los resultados lleva `modelo`, la firma del modelo analítico calculado (`firmaModelo`, `src/agente/resultados.ts`).
- **Qué la comprueba:**
  - `desempaquetarResultados(cabecera, bytes, modelo)` sólo devuelve los casos si la firma casa con la del modelo de ahora; si no, da el motivo.
  - Así ningún sitio puede reutilizar sin comprobarla: la CLI (`calculado`) recalcula, y el visor (`Sesion.usarGuardados`, también la caché de la app) dice el motivo y calcula.
- **Cabeceras antiguas:** las que no llevan firma se rechazan una vez («los guardó una versión anterior»), como las que no llevaban el sha256 en V1-7.

### 2.2 Qué entra en la firma

La firma no puede ser un SHA-256 del modelo: el mismo proyecto sale en V8 (Chrome, Node) y en JavaScriptCore (Bun, la CLI) con la misma malla, pero no con los mismos bits, y la CLI guarda resultados que el visor usa en Chrome. Por eso tiene tres partes:

- **Estructura, exacta:** un hash de 64 bits con aritmética entera de 32 bits (`Math.imul`, igual en cualquier motor). Entran:
  - los ids, también los de los casos;
  - los tipos, las coacciones y las liberaciones;
  - la conectividad: los índices de `nudos`, `nudo`, `barra`, `lamina`, `maestro`, `esclavos` y `gdl`;
  - las claves de cada objeto y cuántos números hay en cada sitio.
- **Números, con tolerancia:** coordenadas, secciones, materiales, offsets, multiplicadores…
  - Por nombre de campo, Σ v·w y Σ |v|·w, con un peso w ∈ [1, 2) según el orden del número.
  - Se aceptan si difieren ≤ 1e-10·Σ |v|·w + 1e-11 por número.
  - Detecta un nudo movido 0,1 mm y deja pasar el ruido de 1e-12 entre motores.
- **Cargas, por la resultante de cada caso:** F, M respecto al origen, Σ|F| y Σ|M|, con `resultanteAnalitica`, la del control sin pérdidas, a 1e-9.

### 2.3 Lo que se encontró al compararla entre motores

Dos cosas del modelo analítico no son iguales en Bun y en Node. Son equivalentes, pero rompían una firma exacta. Se vieron en la planta circular con pilares circulares de G (`edificioGeometria("circular", { circulares: true })`):

- **FR-1:**
  - **Qué pasa:** cuatro barras llevan en Bun un offset de −4,4e-16 m (1 ulp) que en Node no existe.
  - **En la firma:** un offset nulo (todos sus números ≤ 1e-12) cuenta como ausente. Esto sólo vale en `offsets`: en `empotramiento`, por ejemplo, 0 es articulado y no lo mismo que no tenerlo.
- **FR-2:**
  - **Qué pasa:** el compilador reparte las cargas de barra en 19 150 tramos en Bun y en 19 098 en Node, con algunas puntuales donde el otro pone distribuidas. La resultante es la misma, pero no la lista.
  - **En la firma:** las cargas entran sólo por la resultante de cada caso.
  - **Consecuencia:** los resultados del mismo proyecto en Bun y en Chrome no son los mismos bits en ese modelo. La regla de C2 («la malla no depende del motor») sigue cumpliéndose: lo que cambia es el reparto de las cargas.
  - **Pendiente técnico:** sin investigar.

### 2.4 Coste

- **Cuánto:** en los edificios objetivo de 7 plantas, 0,2–0,46 s (con vigas, 86 796 nudos; reticular, 107 306). La mitad son las resultantes. Es un 5–10 % de la compilación.
- **Cuándo:** sólo al guardar y al reutilizar unos resultados.
- **Antes:** con un SHA-256 del texto de la estructura costaba 0,7–1,4 s.

## 3. Límites

- **Cargas:** con la resultante no se ve un cambio que reparta igual la misma carga de otra manera (la misma F y el mismo M en otros nudos).
- **Números:** con la suma ponderada, en principio, dos cambios que se compensen exactamente. Para eso tendrían que coincidir los pesos; no es un caso práctico.

## 4. Validación

- **`src/agente/firma.test.ts`:**
  - el mismo modelo compilado dos veces casa; con otra malla, no;
  - el ruido de 1e-12 en todos los números pasa;
  - no pasan un nudo movido 0,1 mm, una carga nodal más, una superficie ×1,001, un caso más ni una coacción cambiada;
  - unos resultados no se desempaquetan sobre otra malla, ni los guardados sin firma;
  - Bun y Node firman igual cinco modelos (`validacion/firma/firmas.ts`, con plantas y pilares girados, pilares circulares y un reticular).
- **`src/agente/cli.test.ts`:** con los resultados de otra malla en `.fem/<huella>/` (huella, núcleo y sha256 válidos), `fem calcular` recalcula, y la vez siguiente reutiliza los suyos.
