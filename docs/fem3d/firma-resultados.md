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

Dos cosas del modelo analítico no eran iguales en Bun y en Node. Son equivalentes, pero rompían una firma exacta. Se vieron en la planta circular con pilares circulares de G (`edificioGeometria("circular", { circulares: true })`):

- **FR-1:**
  - **Qué pasa:** cuatro barras llevan en Bun un offset de −4,4e-16 m (1 ulp) que en Node no existe.
  - **En la firma:** un offset nulo (todos sus números ≤ 1e-12) cuenta como ausente. Esto sólo vale en `offsets`: en `empotramiento`, por ejemplo, 0 es articulado y no lo mismo que no tenerlo.
- **FR-2:**
  - **Qué pasa:** el compilador reparte las cargas de barra en 19 150 tramos en Bun y en 19 098 en Node, con algunas puntuales donde el otro pone distribuidas. La resultante es la misma, pero no la lista.
  - **En la firma:** las cargas entran sólo por la resultante de cada caso.

**Investigado el 2026-11-06: las dos venían de la entrada, no del compilador.** La prueba generaba el modelo físico en cada motor, y `edificioGeometria` calcula los vértices de la planta circular con senos y cosenos, que difieren en 1 ulp entre V8 y JavaScriptCore (COM-12). Con dos entradas distintas a 1 ulp:

- un vértice de viga que en un motor cae justo en su nudo y en el otro a 1 ulp deja un offset de ruido (FR-1; los dos motores tienen cientos: 424 en Node y 486 en Bun, porque la geometría dibujada no se mueve y el hueco hasta el nudo es un offset);
- el borde de una pieza de carga que cae 1 ulp a un lado u otro del borde de un trozo de barra da una rebanada de 4e-16 m más, que va como puntual de 1e-16 kN por la rama del «trozo de redondeo» de `aplicarLineal` (FR-2).

**Con el mismo `proyecto.json`** (lo que pasa de verdad: la CLI guarda, el visor lee el mismo fichero), los dos motores dan los mismos nudos y las mismas cargas de los tres casos, byte a byte; sólo difieren las propiedades de sección a 1–2 ulp y el `vz` de 4 barras (COM-12). Así que los resultados de un proyecto en Bun y en Chrome se calculan sobre el mismo reparto de cargas, y la regla de C2 («la malla no depende del motor») se cumple también en las cargas.

La prueba (`validacion/firma/firmas.ts`) genera ahora los físicos una vez, en Node, y Bun compila esos mismos por la entrada estándar; además de la firma, exige los nudos y las cargas idénticos (su sha256) en los cinco modelos. Las tolerancias de la firma (el offset nulo de FR-1, las cargas por su resultante) se quedan: no cuestan nada y cubren un proyecto que llegue con ruido de 1 ulp.

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
  - Bun y Node firman igual cinco modelos (`validacion/firma/firmas.ts`, con plantas y pilares girados, pilares circulares y un reticular), compilados desde el mismo físico, y dan los mismos nudos y las mismas cargas byte a byte (§2.3).
- **`src/agente/cli.test.ts`:** con los resultados de otra malla en `.fem/<huella>/` (huella, núcleo y sha256 válidos), `fem calcular` recalcula, y la vez siguiente reutiliza los suyos.
