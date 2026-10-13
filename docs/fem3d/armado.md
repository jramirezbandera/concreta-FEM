# Fase AB — mapas de armado y armadura base

> **Fecha:** 2026-10-13. **Origen:** el usuario, tras usar Resultados · Armado de la fase F con el edificio objetivo. En su opinión, «ahora mismo no es muy funcional para trabajar con él»:
> - la leyenda no dice la unidad;
> - no se entiende con qué criterio se rotulan unos valores y otros no;
> - un clic no da el valor del punto;
> - sólo se ve en planta;
> - falta lo más útil: con una armadura base que cubre, por ejemplo, 20 kN·m/m, ver sólo lo que queda por encima.
>
> **Decidido por el usuario al empezar (2026-10-13):**
> - la base se da en kN·m/m, y más adelante también como Ø y separación, que rellenan los kN·m/m;
> - se guarda en el proyecto por losa y armadura, con un valor común como atajo;
> - por encima de la base, el color es la demanda total y el rótulo lleva el exceso;
> - primero el plan con sus criterios, y después todo.
>
> **Este documento** fija, antes de empezar, cómo se hace y qué tiene que pasar (§2–§4). El resultado irá en `fase-ab.md`.

## 1. Qué pasa ahora (fase F)

- **Leyenda:** las bandas dicen «20 a 22,5», sin unidad. La unidad sólo está en las notas, que son largas. La cabecera de la vista dice «Armado · X inferior», sin unidad (en Losas sí: «M11 · kN·m/m»).
- **Rótulos:** uno por franja, el mayor de toda su longitud, y cuando dos se pisan cae el menor (`armado.ts`).
  - En X inferior del edificio objetivo, casi todas las franjas tienen el mayor en el último vano. Sus rótulos caen en una columna junto al eje 10 y se tapan unos a otros, así que parece que salen al azar.
  - Para armar, el máximo de toda la franja no basta: hace falta el de cada vano y el de cada apoyo.
- **Clic:** sólo elige la franja (su diagrama, en Propiedades). No da el valor del punto ni lo marca.
- **3D:** el modo sólo tiene planta.
- **Escala:** `datosArmado` admite una escala, pero la pantalla no la ofrece.

## 2. Lo que se fija al empezar

### 2.1 Leyenda y unidades

- **La escena lleva un título de leyenda** (`tituloLeyenda`), que dibujan la app y el SVG de A4. En el armado, por ejemplo, «X inferior · M_Ed (Wood–Armer) · kN·m/m». Los demás mapas no cambian en esta fase, así que sus SVG salen bit a bit.
- **La cabecera de cada vista** dice la unidad: «Armado · X inferior · kN·m/m».
- **Las notas de la leyenda** se quedan en una o dos líneas: qué se dibuja y qué se rotula. La explicación larga (Wood–Armer, caras exactas, paso de 0,25 m) pasa a Propiedades.

### 2.2 Rótulos

- **Sin base: los picos de cada franja.** Se rotulan los máximos locales de la demanda a lo largo de la franja cuya prominencia es ≥ 5 % del mayor de la planta (AB-a). Así sale, por lo general, uno por vano en la inferior y uno por apoyo en la superior.
  - Cada rótulo va en el tramo de su pico, con prioridad por su valor.
  - Con poco zoom no caben todos y se omiten los menores, como en cualquier vista (`rotulos.ts`). Al acercar salen más.
  - La leyenda dice el criterio: «Rotulados: los picos de cada franja; acerque para ver más».
- **Con base: uno por zona de refuerzo** (§2.6), en su máximo, como «24,5 (+4,5)»: la demanda total y, entre paréntesis, lo que supera a la base.
- **Todo número rotulado** va también en los extremos de la escena (el JSON de `fem render`).

### 2.3 El valor de un punto

- **Un clic en la planta** pide `valor-armado` (planta, armadura, combinaciones y punto). Devuelve, de la estación cuyo tramo contiene el punto:
  - la franja, la losa, s y el tipo de estación (cara, apoyo o paso);
  - la demanda inferior y la superior con su combinación, y el mx máximo y mínimo;
  - la base de esa losa y armadura, y el exceso.

  Son los valores de `fem consultar franja` bit a bit.
- **En el dibujo,** una marca con el valor y la unidad, como en Losas. El clic también elige la franja, como ahora.
- **En Propiedades,** arriba, «Valor en el punto». Debajo, el diagrama de la franja, que ahora dibuja la base como una línea discontinua.
- **En el 3D,** el mismo valor bajo el cursor (la sonda de I4).

### 2.4 El armado en 3D

- **Pedido `armado3d`** (armadura, combinaciones, una planta o todas, y la base): los tramos de las franjas como rectángulos en la cota de las losas de su planta (la z de sus nudos en el modelo analítico).
- **Mismos límites y colores que la planta** con una planta. Con todas, una escala común.
- **Misma estructura que los isovalores de I4,** así que el 3D los dibuja sin un camino nuevo. Cada triángulo lleva su planta, para la sonda.
- **Resultados · Armado** admite planta y 3D. El alzado no tiene sentido para las franjas y no se ofrece.

### 2.5 La armadura base, en el proyecto

- **Campo nuevo** en `proyecto.json`, fuera de `modelo` y de la huella, como `vistas`:

  ```ts
  armado?: {
    /** La base común, por armadura (kN·m/m). */
    base?: Partial<Record<"x-inf" | "x-sup" | "y-inf" | "y-sup", number>>;
    /** Por losa, lo que difiere de la común. */
    losas?: Record<string, Partial<Record<"x-inf" | "x-sup" | "y-inf" | "y-sup", number>>>;
  }
  ```

- **La base de una losa y una armadura** es la de la losa si la tiene; si no, la común; si no, no hay base.
- **Cambiarla no cambia la huella,** así que no obliga a recalcular.
- **Validación:** los valores son finitos y ≥ 0, y cada losa existe y es maciza o reticular. Si no, el validador lo rechaza.
- **Editor:**
  - operación `armado`, que sustituye el bloque, con deshacer;
  - renombrar, borrar y renumerar losas lo siguen, como las demás referencias.
- **Ø y separación (más adelante, fuera de AB):** un atajo que rellena los kN·m/m a partir del canto útil, el acero y el hormigón, con la flexión simple copiada de Concreta y validada.

### 2.6 El mapa con base y las zonas de refuerzo

- **Lo que cubre la base** (v ≤ base) va en gris claro, con la leyenda «cubierto por la base (≤ 20 kN·m/m)».
- **Lo que no cubre** se colorea por la demanda total, con bandas desde la base hasta el máximo (`limitesMapa(base, máx)`).
- **Zona de refuerzo:** cada componente conexa de los tramos de una losa con v > base (AB-b).
  - Dos tramos de la misma franja están unidos si son seguidos. Los de dos franjas vecinas, si se solapan en s más de 1 mm.
  - Se dibuja su contorno y se rotula su máximo con el exceso.
  - **Id:** `<losa>:<armadura>:R<i>`, numeradas por s y después por t de su primer tramo, así que no dependen del orden de las listas.
- **Lo que da cada zona:**
  - sus franjas, de la primera a la última, y su ancho transversal [t0, t1];
  - su extensión a lo largo [s0, s1] y su longitud;
  - el máximo, con su franja, s y combinación, y el exceso;
  - su área.
- **La extensión es la de sus tramos** (AB-d): cada estación cubre hasta la mitad de sus vecinas, así que el borde tiene una precisión de ±Δs/2 = 0,125 m. No incluye anclajes ni solapes.
- **Interruptor** «Todo / Lo que no cubre la base»: con base, empieza en lo segundo (AB-g).

### 2.7 Consulta, CLI y app

- **`Consultas.refuerzos`** (planta o losa, y armadura) con las bases del proyecto: las zonas de §2.6. En la CLI, `fem consultar refuerzos --planta <p> --armadura x-inf`.
- **`fem render`** de las vistas `armado-…` lee la base del proyecto.
- **En la app:**
  - en la barra, el selector de armadura y el interruptor de §2.6;
  - en Propiedades, sin nada elegido, la sección «Armadura base»: la común y una fila por losa de la planta, con las cuatro armaduras. Una celda vacía usa la común;
  - en el panel inferior, junto a Franjas, la pestaña «Refuerzos»: una fila por zona. Un clic la elige y la encuadra.
- **Skill del agente:** la base es una decisión del ingeniero. El agente la lee y la usa en las consultas, pero no la inventa.

### 2.8 Lo que no entra

- Ø y separación (§2.5).
- Anclajes, solapes y despiece de los refuerzos.
- Proponer automáticamente la base.
- El título de leyenda en los demás mapas (Losas, Vigas…): se propondrá aparte, porque cambia sus SVG.

## 3. Decisiones por defecto

| # | Decisión | Por defecto | Por qué | Alternativa |
|---|---|---|---|---|
| AB-a | Qué picos se rotulan | **Prominencia ≥ 5 % del mayor de la planta** | Uno por vano o apoyo, sin el ruido de las zonas casi nulas | Un rótulo por vano entre apoyos |
| AB-b | Conexión de los tramos de una zona | **Por un lado común**, no por una esquina | Una esquina no es un refuerzo continuo | También por esquinas |
| AB-c | Color de lo cubierto | **Gris claro** | Deja ver la losa y separa bien lo que falta | Transparente |
| AB-d | Extensión de una zona | **La de sus tramos** (±0,125 m) | Es lo que se dibuja y no inventa un valor entre estaciones | Interpolar dónde la demanda cruza la base |
| AB-e | Dónde se da la base | **Común y por losa** (decisión del usuario) | — | — |
| AB-f | Rótulo con base | **«v (+exceso)»** (decisión del usuario) | — | — |
| AB-g | Qué se ve con base | **Lo que no cubre**, con un interruptor | Es para lo que se pone la base | Todo |

## 4. Criterios de paso

1. **Unidades:** las cuatro armaduras, en planta, en 3D y en el SVG de `fem render`, llevan «kN·m/m» en el título de la leyenda y en la cabecera de la vista.
2. **Bit a bit con las consultas:**
   - `valor-armado` en el centro de cada tramo de una planta (H25 y una planta del edificio objetivo) da los valores de su estación en `fem consultar franja`;
   - el máximo de cada zona es el de sus estaciones;
   - el 3D con una planta tiene los límites y los colores de la planta;
   - Chrome da lo mismo que Node.
3. **Zonas de refuerzo:**
   - cada estación con v > base está en exactamente una zona, y ninguna con v ≤ base;
   - cada zona es conexa;
   - no dependen del orden de las listas;
   - con la base en 0, una zona por región con demanda; con la base ≥ el máximo, ninguna;
   - el área de las zonas es la suma de la de sus tramos, a 1e-9.
4. **Rótulos:** cada pico con prominencia ≥ 5 % tiene su rótulo en la escena, antes de quitar los que se pisan. Con base, uno por zona, en su máximo.
5. **Proyecto:**
   - `armado` no cambia la huella, y la app no recalcula al cambiarlo;
   - el esquema se genera de los tipos;
   - el validador rechaza valores negativos, no finitos y losas que no existen o no tienen franjas;
   - renombrar, borrar y renumerar losas lo siguen;
   - se puede deshacer, y un proyecto sin `armado` se abre y se guarda igual.
6. **3D:** el área de sus triángulos es la de los tramos a 1e-9, y su z, la de las losas. Los búferes de Chrome tienen el sha256 de Node.
7. **Rendimiento** (edificio objetivo, Chrome):
   - el mapa con base, en ≤ 0,2 s más que sin ella;
   - `valor-armado`, en ≤ 50 ms con el mapa ya hecho;
   - ninguna tarea larga (> 50 ms) en el hilo principal.
8. **Puerta de uso:** el usuario pone la base de una losa suya y dice si con las zonas de refuerzo puede armarla.

## 5. Partes

Cada una con sus tests y su commit.

- **AB1, proyecto y editor:** el campo `armado`, su esquema, su validación y la operación `armado` con sus referencias.
- **AB2, render y consultas:**
  - título de leyenda;
  - picos rotulados;
  - mapa con base y zonas de refuerzo;
  - `Consultas.refuerzos` y `fem consultar refuerzos`;
  - la base en `fem render`.
- **AB3, visor y app:**
  - `valor-armado` y `armado3d`;
  - el 3D y la sonda;
  - la marca del clic;
  - la sección «Armadura base»;
  - la pestaña Refuerzos;
  - la base en el diagrama.
- **AB4, validación:** los tests de los criterios y el banco en Chrome (`validacion/ab/`).
