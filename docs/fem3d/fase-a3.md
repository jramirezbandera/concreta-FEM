# Fase A3 — capa de agente: sensatez e informe de revisión: resultado

> **Fecha:** 2026-10-09. **Plan:** `agente.md` (§3, A3; §8, lo que se fijó al empezar con el usuario: umbrales, mutaciones, firma y reparto de la bajada tributaria).
>
> **Veredicto: A3 pasa sus dos criterios.**
> - **Mutaciones (criterio 1).** Se detectan las 46 mutaciones graves que se pueden aplicar a los cinco modelos de referencia. 37 las detecta un aviso de sensatez nuevo; 9, el compilador o el motor, que las rechazan.
> - **Avisos en las referencias (criterio 2).**
>   - En los seis modelos de referencia a tamaño completo y en los tres proyectos de los agentes de A2 sólo queda un tipo de aviso: el axil reducido de los edificios objetivo de 7 plantas.
>   - Es verdadero: ese modelo sintético lleva pilares de 30 × 50 y 40 × 40 cm en toda la altura, y bajo N1 llegan a ν = 1,46 (A3-3).
>   - La retícula con núcleo, el 1-022 y sus versiones de A2 no dan ningún aviso.
> - **Informe y firma.**
>   - `fem revisar` escribe el informe en Markdown y HTML, ligado a la huella y determinista.
>   - `fem firmar` sólo firma un informe revisado que sea el que sale ahora del proyecto, y lo deja en `<proyecto>.revision.json`.
>   - Si el proyecto cambia, la huella cambia y la firma deja de valer.
>
> **Hallazgos principales:**
> - **A3-1:** el peso propio esperado, calculado sin la malla, coincide con el del compilador a ≤ 4e-14 relativo en todos los modelos sin muros, y a ≤ 0,01 % con muros. Eso contrasta por un camino independiente los descuentos de C2-g y C3-g.
> - **A3-2:** un pilar embebido en un muro reparte su carga con él, y su axil sale a la mitad de su bajada. Esos tramos no se comparan.
> - **A3-5:** nueve mutaciones de unidades acaban en errores del compilador o del motor que no dicen la causa. Por eso `fem validar` da ahora los avisos de sensatez que no necesitan el cálculo, también cuando el modelo no compila.
>
> **Cómo leerlo:** las tablas resumen los criterios, que se fijaron al empezar (`agente.md` §3 y §8). Cada sección da el detalle y la evidencia. Lo que queda para el usuario está en «Pendiente».

## Criterios

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Detectar todas las mutaciones graves de la lista fijada al empezar | **Pasa.** 46 de 46 en 1-022, la retícula con núcleo y los edificios con losas, unidireccional y reticular (3 plantas, 4 × 3 vanos). Las demás combinaciones de modelo y mutación no aplican (un pórtico de acero no tiene losas ni hormigón) | `validacion/a3/mutaciones.ts`, `out_mutaciones.txt`; `src/agente/sensatez.test.ts` |
| 2 | No dar avisos falsos en los modelos de referencia sin mutar, o justificar cada uno | **Pasa.** Sólo avisa el axil reducido de los edificios objetivo de 7 plantas (44 a 48 tramos por modelo), y es un aviso verdadero (A3-3). Ningún otro aviso en los diez modelos | `validacion/a3/referencias.ts`, `out_referencias.txt` |

### Criterio 1: las mutaciones

| Mutación | Modelos | Cómo se detecta |
|---|---|---|
| 1. Carga de superficie en N/m² (×1000) | 5 | `carga-planta` (2 000–3 000 kN/m²), con flechas, axil reducido y bajada. En el 1-022, cuya única carga es lateral, la detecta el desplome (1/97) |
| 2. Carga vertical con el signo cambiado | 4 | `carga-hacia-arriba` |
| 3. Pilar interior quitado | 5 | `esbeltez-viga`: las vigas que pasaban por él quedan con L/h de 19 a 23. En el 1-022, el desplome (1/221), cerca del umbral (A3-7) |
| 4. Ningún caso de peso propio | 4 | `sin-peso-propio` |
| 5. Espesor de losa en cm | 3 | La rechaza el compilador (`pilar/tramo-flexible-nulo`); `validar` da además `sensatez/espesor` |
| 6. Canto de viga en cm | 4 | Lo mismo, con `sensatez/seccion` |
| 7. Altura de planta en cm | 5 | `altura`. En los edificios con losas y reticular, el motor no da el caso de viento por equilibrio (3,97e-9 > 1e-9): la regla de oro 2 lo para |
| 8. Las cargas de uso de una planta, en el caso G | 3 | `planta-sin-caso`. En estos modelos, además, la carga movida queda igual que la de solado de G (`carga-duplicada`) |
| 9. Carga duplicada | 5 | `carga-duplicada` |
| 10. fck en kN/m² | 4 | `material` |
| 11. pp de losa en kN/m³ | 4 | `pp`, con `carga-planta` y axil reducido |

- Se cuenta como detectada si la revisión da un aviso de sensatez que el modelo sin mutar no da (mismo código y mismos objetos), o si el compilador o el motor la rechazan.
- Ningún modelo base da avisos.
- «Una planta con la altura de otra» quedó fuera de la lista al empezar (§8): si la altura sigue siendo plausible, sólo la descripción dice que está mal. El informe da la altura de cada planta para que la revise el ingeniero.

### Criterio 2: las referencias

| Modelo | Avisos | Tiempo de la revisión |
|---|---|---|
| 1-022 y el del agente de A2 | 0 | < 0,1 s |
| Retícula con núcleo y la del agente | 0 | 0,2–0,4 s |
| Edificio objetivo con losas, también con acciones y el del agente | 48 de axil reducido | 6,3–10,6 s |
| Edificio objetivo con muros | 44 de axil reducido | 9,3 s |
| Edificio reticular (V2) | 48 de axil reducido | 7,8 s |
| Edificio unidireccional (V3) | 48 de axil reducido | 3,8 s |

- El tiempo es el de compilar, calcular y revisar, en el mismo proceso.
- La revisión vuelve a compilar el modelo sin cargas para aislar su peso propio (A3-1); en el edificio objetivo, unos 4 s.
- Con la CLI, en el edificio objetivo con sus 238 bandas, `fem revisar` tarda 17,9 s la primera vez. Su salida ocupa 1 654 tokens estimados, dentro del tope de 4 000 de A1 (`validacion/a1/out_tamano.txt`). El resumen pasa de 854 a 969 tokens con los `horizontales`.

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/agente/sensatez.ts` | Umbrales y comprobaciones del modelo: datos, cargas, cargas por m² de planta, pilares y peso propio esperado. `sensatezPrevia` es la parte que no necesita compilar |
| `src/agente/tributaria.ts` | Bajada de cargas por áreas tributarias: Voronoi por planta, cada carga donde cae |
| `src/agente/sensatezResultados.ts` | Comprobaciones con resultados: bajada frente al axil, luz/canto, flechas, desplomes y axil reducido |
| `src/agente/informe.ts` | El informe como documento, escrito en Markdown y en HTML |
| `src/agente/revision.ts` | `revisar` (comprobaciones e informe) y el fichero de firmas |
| `cli/ordenes.ts` | `fem revisar` y `fem firmar`; `validar` y `compilar` dan los avisos previos |
| `src/agente/consultas.ts` | El resumen da ΣFx y ΣFy por planta (`horizontales`), que pidió A-8 |
| `.claude/skills/fem/SKILL.md` | El flujo con `fem revisar`, y las reglas 5 y 6: nada se da por bueno sin revisar, y el agente nunca firma |
| `validacion/a3/` | Mutaciones, referencias, el ayudante que revisa sin la CLI y un informe de ejemplo (`informe-edificio.md`) |

**Uso:**

```sh
bun run fem revisar proyecto.json                     # → .fem/<huella>/informe.md e informe.html
bun run fem firmar proyecto.json --por "Nombre"       # sólo el ingeniero, tras leer el informe
```

`fem revisar` devuelve:
- el estado de cada comprobación (`bien`, `avisos` o `no-aplica`) con lo peor que encontró;
- los avisos de sensatez, delante de los del compilador y el cálculo;
- las rutas y el sha256 del informe;
- el estado de la firma de esa huella.

## 2. Cómo se hacen

**Comprobaciones previas** (sólo el modelo físico):
- **Unidades:** alturas, espesores, dimensiones de las secciones, fck, E y pesos específicos dentro de sus rangos.
  - En la planta más baja, la de los arranques, sólo se mira el máximo de su altura.
  - Un peso específico 0 es un modelo sin peso, deliberado (el 1-022).
- **pp dado:** frente al de una maciza de su espesor; en los paños, en kN/m².
- **Cargas:**
  - una carga duplicada es una igual a otra salvo el id, en el mismo caso;
  - una carga hacia arriba se avisa en los casos G, Q y S y en los que no llevan acción;
  - se avisan los casos vacíos y la falta de un caso de peso propio, ésta sólo si algo pesa.
- **Pilares:**
  - uno con vínculo en la base que arranca en una planta que no es la más baja;
  - uno que acaba bajo una losa o un paño de la planta de encima que cubre su eje, salvo que otro pilar siga desde allí.

**Con el modelo compilado:**
- **Carga por m² de planta:** la del resumen (lo que recibe cada planta, con el peso propio) entre el área de sus losas y paños, sumando los casos de cada tipo de acción. El caso de peso propio sin acción cuenta como G.
- **Planta sin un caso:** se avisa a la planta con losas que no recibe nada de un caso que carga al menos a dos plantas y a la mitad de las que tienen losas. Se exceptúan la planta más alta y las cubiertas, que suelen tener su propio uso.
- **Peso propio esperado:**
  - Σ V·γ por tipo de pieza y planta: los pilares y los muros, por tramos, en la planta de su cabeza; las losas y los paños, con su pp; los reticulares con casetón recuperable, con su volumen.
  - Menos los solapes que el compilador no cuenta dos veces, estimados por la huella de la pieza (su eje con su ancho) dentro de las losas: la viga rectangular de hormigón bajo una losa o un paño (C2-g) y el muro con las losas de cada planta a la que llega, la mitad por cada lado (C3-g).
  - Lo calculado es el caso de peso propio compilado sin las demás cargas.

**Con los resultados:**
- **Bajada tributaria:**
  - En cada planta, el Voronoi de los pilares que la sostienen y de puntos cada 0,5 m de los muros, como intersección de semiplanos (cada celda es convexa).
  - Las cargas de superficie y los pp van por el área de cada celda dentro de su región, con las zonas en triángulos en abanico.
  - Las lineales, las de viga y el peso de las vigas (con el descuelgue de C2-g), muestreadas cada 0,25 m al pilar más cercano.
  - Un pilar apeado lleva lo suyo a la planta en la que nace.
  - Se compara con el axil de compresión en la cabeza de cada tramo, con la suma de los casos gravitatorios.
- **Luz/canto:**
  - de cada vano de viga, de cara a cara de apoyo (`Consultas.viga`);
  - de cada losa, con el mayor lado de sus recuadros entre pilares (los de `Consultas.flechas`).
- **Flechas:**
  - las de las losas, relativas a las esquinas del recuadro (`Consultas.flechas`);
  - las de vigas y viguetas, relativas a la cuerda entre las caras del vano, con la deformada muestreada en las estaciones de cada tramo y en 16 puntos más.
- **Combinaciones:**
  - si todos los casos llevan acción, la ELS característica y las ELU del generador;
  - si no, la «gravedad»: los casos gravitatorios sumados, con factor 1 para las flechas y 1,4 para ν; el desplome, caso a caso.

**Informe:**
- Un documento (`Bloque[]`: títulos, párrafos, listas y tablas) que se escribe en Markdown y en HTML autónomo, con tema claro y oscuro.
- Lleva:
  - el veredicto;
  - la tabla de comprobaciones con sus umbrales y lo peor de cada una;
  - los avisos;
  - el modelo por planta, con las opciones efectivas;
  - las cargas por caso y por planta, verticales y horizontales;
  - las cargas en cimentación de cada pilar, muro y apoyo (desde §5);
  - el desglose del peso propio;
  - los tramos de la bajada que más se separan;
  - las hipótesis y los avisos del compilador y del cálculo.
- No lleva fecha: el mismo proyecto calculado con el mismo núcleo da el mismo informe, bit a bit.

**Firma:**
- `fem firmar` vuelve a armar el informe y sólo firma si es igual al guardado, que es el que el ingeniero ha leído.
- La firma (huella, quién, fecha ISO y sha256 del Markdown) se añade a `<proyecto>.revision.json`.
  - Se nombra por el proyecto, y no `revision.json` como se dijo al empezar, para que dos proyectos en una carpeta no compartan fichero.
- `fem revisar` dice si la huella está firmada y si el informe firmado es el de ahora (`mismoInforme`). Si no lo es, es que cambió el núcleo de cálculo o las comprobaciones.

## 3. Hallazgos

| ID | Hallazgo | Consecuencia |
|---|---|---|
| A3-1 | **El peso propio esperado, sin la malla, es el del compilador:** ≤ 4e-14 relativo por planta en la retícula con núcleo y en los edificios con losas, reticular y unidireccional; ≤ 0,01 % con muros. La diferencia con muros son las esquinas de sus huellas, que cuentan dos veces en un muro cerrado | Contrasta los descuentos de C2-g y C3-g por un camino independiente. Desde A-9 (§5) la estimación descuenta también la viga que corre por el eje de un muro, como el compilador. El solape pilar–losa no lo descuenta ninguno, por decisión del usuario |
| A3-2 | **Los pilares embebidos en un muro llevan la mitad de su bajada** (0,45–0,50 en los de fachada sobre el muro de sótano del edificio con muros): el muro, mucho más rígido, se lleva su carga | Esos tramos (el eje del pilar a menos de t/2 + ε_snap del eje de un muro en la misma planta) no se comparan; el informe dice cuántos son |
| A3-3 | **Los edificios objetivo de 7 plantas tienen pilares que no resisten su axil:** ν = 1,46 bajo N1 con secciones de 30 × 50 y 40 × 40 cm en toda la altura (Nd ≈ 4 400 kN en el pilar interior P12-10, de 30 × 50). Es el único aviso de las referencias | Es verdadero: el modelo es sintético (se hizo para medir tamaño y tiempo, D9) y no está dimensionado. No se cambia, para no mover sus referencias congeladas |
| A3-4 | **La «gravedad» ×1,4 da el mismo ν que la ELU del generador** a ≤ 1,5 % en el edificio objetivo (1,28 frente a 1,27 en P6-5) | El axil reducido de los modelos sin acciones sirve como aviso. Los tres proyectos de A2 no llevan acciones |
| A3-5 | **Nueve mutaciones de unidades acaban en errores que no dicen la causa:** un espesor o un canto en cm hace que el tramo de pilar quede entero en la zona rígida (`pilar/tramo-flexible-nulo`), y una planta de 300 m hace que el viento no cumpla el equilibrio a 1e-9 | `fem validar` y `fem compilar` dan ahora los avisos previos, también si el modelo no compila: el agente ve «¿está en cm?» junto al error |
| A3-6 | **El axil de los pilares sigue a la bajada tributaria de cerca:** de 0,85 a 1,11 en los edificios de referencia de 7 plantas (de 0,74 a 1,25 en los de 3 plantas de las mutaciones), con los de esquina abajo y los interiores junto a ellos arriba | Los umbrales [0,5; 2] dejan margen. Quitar un pilar no sale en la bajada, porque el Voronoi se rehace sin él; lo ven la luz/canto de las vigas y las flechas |
| A3-7 | **En el 1-022 (pórtico de acero con sólo carga lateral), quitar el pilar central sólo se ve en el desplome,** a 1/221 frente al umbral de 1/250 | Sin cargas gravitatorias, ni la bajada ni las flechas tienen nada que comparar. Es la detección más justa de la batería |

## 4. Pendiente

**Del usuario:**
- Revisar el informe de ejemplo (`validacion/a3/informe-edificio.md`), ya con las cargas en cimentación (§5), antes de usarlo con un proyecto real.

**Técnico:**
- Un caché de la compilación (A-5): `fem revisar` compila dos veces, la segunda sin cargas para el peso propio.
- La esbeltez de las viguetas y de los paños no se comprueba: no estaba en la lista fijada.
- El segundo spike de A2, con una descripción con datos que falten o se contradigan, ahora con `fem revisar` en el flujo.

**Siguiente:** A4 (render y revisión visual), según `agente.md` §3.

## 5. Decisiones del usuario tras A3 (2026-10-09)

El usuario aceptó las recomendaciones sobre lo que quedaba abierto de A0–A2 y pidió una sección más en el informe.

| Decisión | Qué se hizo | Evidencia |
|---|---|---|
| **A-1:** `compilar` rechaza los campos desconocidos, como error | El validador del esquema pasa a `src/compilador/esquema.ts`, y el generador escribe un esquema estructural del modelo y las opciones (`src/compilador/fisico.schema.json`, sin descripciones). `compilar` sólo se queda con sus campos desconocidos (`fisico/campo-desconocido`, `opciones/campo-desconocido`), con el campo más parecido; lo demás lo siguen diciendo sus códigos. Las 9 erratas de A-1 son ahora errores. Cuesta 5–6 ms en el edificio objetivo. Dos entradas del catálogo de no válidos que ya rechazaban una clave desconocida lo hacen ahora con el código nuevo. Ninguna huella cambia | `src/compilador/campos.test.ts` |
| **A-9:** la viga por el eje de un muro pesa sólo lo que sobresale de él; el solape pilar–losa se queda | Una viga rectangular de hormigón que corre por el eje de un muro que le llega desde abajo pesa w·max(0, b − t)/b sobre él: cuelga del forjado dentro del muro, que pesa de forjado a forjado. El pilar sigue pesando de forjado a forjado, sin descontar su cruce con la losa (del lado de la seguridad, como es habitual), y las dos cosas van en las hipótesis. Cambia sólo el caso de peso propio de dos referencias congeladas de C3 (la retícula con núcleo, −38,5 kN, a mano; el modelo al azar 3, −19,3 kN), con la malla, el mapeo y los demás casos iguales a ≤ 3e-13. El peso esperado de A3 y la bajada tributaria siguen la misma regla | `src/compilador/vigasSobreMuros.test.ts`; `congelado-c3.json` |
| **A-2:** ψ por su nombre | `psi` admite `"uso-A"` … `"uso-G"`, `"nieve-hasta-1000"`, `"nieve-mas-de-1000"`, `"viento"` y `"temperatura"`, además de los números; se traducen con la tabla de `src/combinaciones/psi.ts` al armar las combinaciones, y dan las mismas que sus valores. La skill pide los nombres (y preguntar la categoría si no la dan), y el ejemplo los usa. El esquema agrupa los literales de una unión mixta en un `enum`, y su validador prefiere la variante que admite el tipo del dato: un nombre mal escrito dice cuáles valen | `src/compilador/psiNombrado.test.ts` |
| **Fichero de firmas:** `<proyecto>.revision.json` | Sin cambios | — |
| **Informe:** cargas en cimentación | Nueva sección con las reacciones en la base de cada pilar, muro y apoyo por caso: una tabla de Fz por caso con su total y, por caso, las seis componentes en ejes globales, con el convenio escrito (Fz > 0 hacia arriba) | `src/agente/sensatez.test.ts` |

## Cómo reproducir

```sh
bun run test:run                                  # los de A3 en src/agente/sensatez.test.ts y cli.test.ts
bun validacion/a3/mutaciones.ts                   # criterio 1 → validacion/a3/out_mutaciones.txt
bun validacion/a3/referencias.ts                  # criterio 2 → validacion/a3/out_referencias.txt e informe-edificio.md
```
