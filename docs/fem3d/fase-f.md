# Fase F — franjas de armado: resultado

> **Fecha:** 2026-10-13. **Plan:** `franjas.md` (lo que se fijó al empezar, aceptado por el usuario con el ancho de 1 m).
>
> **Veredicto: pasan los criterios 1, 2, 5, 6, 8 y 9. El 3 y el 4 quedan a medias (en las caras de los pilares, con el h por defecto), y el 7 (tiempo) también. El 10 (puerta de uso) es del usuario.**
> - **Las losas macizas y reticulares se arman con franjas** de 1 m (el intereje en un reticular) de borde a borde, en su eje 1 (X) y en el perpendicular (Y). Cada franja da, estación a estación, el momento medio por metro y la demanda de Wood–Armer de su armadura inferior y superior en cada combinación.
> - **La app ya no propone ni edita bandas.** Resultados · Armado sustituye a Resultados · Bandas: el mapa de una armadura (X o Y, inferior o superior), la tabla de las franjas y, para la elegida, su diagrama y sus estaciones.
> - **Exacto donde se puede.** En una línea de apoyo que cruza la losa, la suma de las franjas es el corte de toda la losa a 1e-15; por campos, también a ≤ 1e-9. La flexión cilíndrica da qL²/8 a ≤ 0,5 %, y Navier, la media de cada franja a ≤ 0,57 % del máximo.
> - **La posición de las franjas importaba mucho junto a un pilar** (F-2): un pilar partido entre dos franjas daba en cada una hasta un 35 % menos que el metro centrado. Ahora, en la cara de un pilar, la franja que lo toca toma el metro centrado en él, y correr las franjas no cambia nada (0,0 %).
> - **Lo que queda (F-6):** con el h por defecto (0,75 m), el metro junto a un pilar sale un 6 % por debajo del de una malla fina. Con h = 0,5 m queda a −0,7 %. Lo decide el usuario (§4).
>
> **Cómo leerlo:** la tabla resume los criterios, que se fijaron al empezar. Cada sección da el detalle. Las decisiones que quedan para el usuario están en §4.

## Criterios

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Exacto donde se puede | **Pasa.** En una línea de apoyo de lado a lado, la suma de las franjas es el corte de las láminas de toda la losa, a cada lado, a ≤ 1e-9 (1e-15 en la práctica). Por campos, la suma de las franjas de una estación es la integral de la recta entera a ≤ 1e-9. En una cara, la franja que no toca el pilar tiene su ancho exacto; la que lo toca toma la ventana centrada (F-2), así que la «cara = corte de su rectángulo» del plan ya no es la definición | `src/compilador/franjas.test.ts` |
| 2 | Oráculos analíticos | **Pasa.** Flexión cilíndrica: qL²/8 en el centro de las cuatro franjas a ≤ 0,5 %. Navier: la media de cada franja frente a la de la serie en su ancho, en todas sus estaciones de paso: ≤ 0,57 % del máximo con h = 0,25 y ≤ 0,15 % con 0,125, en la placa delgada y en la gruesa | `franjas.test.ts`; `validacion/f/out_validacion.txt` |
| 3 | Oráculos externos | **A medias.** La losa plana de H25 en OpenSeesPy ASDShellQ4, con la misma malla y el mismo reparto: en las caras, ≤ 1,5 % con h = 0,375; con h = 0,75, ≤ 3,2 % del máximo (hasta un 6,3 % sobre su propio valor). En los vanos (las 48 estaciones que caen en rectas de la malla), ≤ 2,6 % con h = 0,375 y hasta un 9,3 % con 0,75; con h = 0,75, el motor por fuerzas nodales ya difiere de OpenSees un 6,6 %, así que es la malla, no el método. **El reticular de SAP2000 del usuario no se ha comparado** (§5) | `validacion/f/out_opensees.txt` |
| 4 | Convergencia y posición | **Posición: pasa** (0,0 % al correr las franjas media franja, en 32 caras con demanda). **Vanos: pasa** (1,7 % de media y ≤ 3,6 % entre h = 0,75 y 0,375). **Caras: no pasa con h = 0,75** (6,4 % de media y hasta un 14 %). Con un pilar interior, el metro centrado converge: −6,0 % con h = 0,75, −0,7 % con 0,5 y ±2 % desde 0,375 (F-6) | `out_validacion.txt`, `out_convergencia.txt` |
| 5 | Malla y D9 | **Pasa.** Edificio objetivo de 7 plantas: losa plana, ×2,04 (183 876 ecuaciones: cabe en el perfil móvil); con vigas y reticular con vigas, ×1,00 (sus pilares se apoyan en vigas, F-3). Ningún aviso de malla nuevo, tampoco en las 5 familias de planta no ortogonal ni en las 24 retículas al azar de G | `out_validacion.txt`; `src/compilador/geometrias.test.ts` |
| 6 | Determinismo y huella | **Pasa.** Las metamórficas de C2–C5 (trasladar, girar 90° y 37°, reordenar, ruido) y la malla de V8 frente a JavaScriptCore dan lo mismo con las caras. La huella lleva `franjas` y `anchoFranja`. Con `franjas: false`, las referencias congeladas de C2–C5 salen iguales | toda la batería |
| 7 | Rendimiento | **A medias.** Edificio objetivo de 7 plantas, con Wood–Armer en las 26 combinaciones ELU-PT: la primera planta, 1,7 s (losa plana; el criterio pedía ≤ 1,5 s) y 1,3 s (con vigas), y las demás, 0,9 y 0,8 s. El edificio entero, 1,7 y 2,1 veces el cálculo. En Chrome, el mapa y la tabla de una planta salen en 1,9 s (≤ 2 s), sin tareas largas | `out_validacion.txt`; `validacion/f/out_chrome.txt` |
| 8 | App | **Pasa** (§1.3): la tabla y el detalle dicen los valores de las consultas bit a bit (DOM y Chrome); lo retirado no deja rastro, y un proyecto con bandas se abre, se edita y se guarda con ellas intactas | `app/src/test/armado.test.tsx`; `src/editor/v2b.test.ts`; `out_chrome.txt` |
| 9 | Referencia congelada | **Pasa.** H25 plana y reticular, pilares mezclados y una planta al azar: el modelo con sus caras, los resultados, las franjas, sus estaciones, los medios y Wood–Armer | `src/compilador/congelado-f.test.ts` |
| 10 | Puerta de uso | **Pendiente del usuario** | — |

Las baterías completas pasan: 1 634 tests en la raíz y 31 en la app.

## 1. Qué hay

### 1.1 Motor (`src/motor/`)

- **`cortes.ts`:**
  - `soloLaminas`: el corte de la losa, sin barras, restricciones ni láminas rígidas (las de una huella);
  - `porLamina`: lo que aporta cada lámina que toca el plano, y cada uno de sus nudos, para repartir el corte entre franjas cuyos bordes no siguen la malla;
  - `quiebres` y `cuadratura: 2` para el método «campos».
- **`campos.ts`:** los tramos se parten en los quiebres, y el bucle por punto ya no crea arrays (los mismos bits, 1,7 veces más rápido).

### 1.2 Compilador (`src/compilador/`)

- **`franjas.ts`:**
  - el reparto (`franjasLosa`);
  - las caras de los pilares (`carasFranjas`), sembradas como trazos exactos de lado a lado de la losa, con las reglas de F-3 y F-4;
  - `pilaresSinCara`.
- **`esfuerzosFranjas.ts`:**
  - **Estaciones:** las caras, las líneas de apoyo (ejes de vigas y muros y apoyos lineales perpendiculares), a cada lado, y cada 0,25 m.
  - **Una recta corta todas las franjas de la losa a la vez:** por fuerzas nodales, con lo de cada nudo repartido en su mitad del lado (F-6), o por campos, con los tramos partidos en los bordes.
  - **Medios:** mx, my y mxy por caso. En la cara de un pilar, la franja que lo toca toma la ventana centrada en él (F-2).
  - **Wood–Armer** por combinación.
  - **Aviso** `franja/pilar-sin-cara`.
- **Opciones:** `franjas` (por defecto, sí) y `anchoFranja` (1 m). La versión del compilador es la F1.
- **Bandas:** con las franjas, sus caras son las de las franjas, y ya no se siembran a lo ancho de cada banda (F-5).
- **`Consultas`:** `franjas(losa)`, `franja(id)` y `armadoFranja(id, combinaciones)`.

### 1.3 Agente, visor y app

- **CLI:** `fem consultar franjas [--losa L | --planta P]` y `fem consultar franja <id>`.
- **A4:** las vistas `armado-x-inf`, `armado-x-sup`, `armado-y-inf` y `armado-y-sup`, también en `fem render`. La skill las describe.
- **Visor:** los pedidos `armado` y `franja`, en `src/visor/franjas.ts`.
- **App:**
  - Resultados · **Armado**, con el selector de armadura, la tabla de las franjas y, en Propiedades, el diagrama de la franja, sus caras y apoyos y todas sus estaciones;
  - **fuera:** el modo Bandas, la tabla Bandas, la herramienta Banda, «Proponer bandas» con su diálogo, la operación `proponerBandas` (una operación que no existe da error) y el recálculo de los apoyos al editar o copiar una banda.
- **Chrome** (`validacion/f/chrome.ts`): ver `out_chrome.txt`.

## 2. Hallazgos

| ID | Hallazgo | Consecuencia |
|---|---|---|
| F-1 | **Las caras sembradas sólo de lo ancho de las franjas que toca el pilar rompían la rejilla:** sus extremos no caían en sus líneas, y el edificio objetivo pasaba de 4 995 a 20 639 nudos por planta, sin una plantilla | Las caras van de lado a lado de la losa, como líneas de la rejilla (las caras de banda de C5 ya lo eran). Así, además, todas las franjas que cruzan la recta tienen ahí su estación exacta |
| F-2 | **La posición de las franjas importa junto a un pilar.** Con el reparto fijo, correr las franjas media franja cambiaba la demanda en la cara de los pilares un 25 % de media y hasta un 35 %: un pilar partido entre dos franjas da en cada una el metro mal centrado (del lado inseguro) | En la cara de un pilar, la franja que lo toca toma una ventana de su ancho centrada en el pilar (`ventana` de la estación; F-h, §3). Con el reparto por láminas es exacta en total y barata. Correr las franjas ya no cambia nada |
| F-3 | **En una losa con vigas, la cara del pilar sobra:** el apoyo de la losa es la viga, cuyo eje ya es una recta de la malla con su estación exacta | Un pilar atravesado por una viga o un muro que va según la transversal (a menos de 60°) no tiene caras en esa dirección. Con vigas, la malla no crece (×1,00) |
| F-4 | **Astillas en la malla** (el aviso de G-4) donde la cara toca la huella en una esquina o tangente (pilares girados o circulares), corre a unos centímetros de un borde (pilares de borde, vuelos de menos de h), roza otro pilar o una viga curva | Sólo tienen caras los pilares rectangulares alineados con los ejes de la losa y con la huella dentro de ella, y no del lado de un vuelo de menos de h. Las caras se cortan a h de los pilares ajenos y de las vigas casi paralelas, y no se siembran dentro de las huellas de sus pilares. Las franjas que tocan un pilar sin cara lo avisan (`franja/pilar-sin-cara`): ahí los momentos son por campos |
| F-5 | **Bandas y franjas a la vez rompían la invariancia de la malla** frente a una traslación (4 954 frente a 4 924 nudos) y la crecían ×2,4: dos trazos exactos casi iguales se partían entre sí | Con las franjas, las bandas no siembran sus caras: son las de las franjas. Las pruebas de C5 van con `franjas: false` |
| F-6 | **El reparto uniforme de cada lámina en su lado subestimaba el pico junto al pilar** (−12 % con h = 0,75 en el metro centrado) | Lo de cada nudo se reparte en su mitad del lado (`porLamina.nudos`): −6 % con h = 0,75, −0,7 % con 0,5 y ±2 % desde 0,375. Lo que queda es la malla junto al pilar. A los dos lados de una viga, los momentos salen además más parecidos (−6,54 y −6,25 frente a −7,02 y −6,03 kN·m/m). Con 0,5 m de ancho, −24 % con h = 0,75 (`out_convergencia.txt`): 1 m es lo que la malla de obra resuelve |
| F-7 | **El tiempo es de las rectas por campos** (386 por planta en el edificio objetivo): 2,2 s por planta al empezar | Bucle por punto sin arrays (los mismos bits) y Gauss de 2 puntos por tramo (exacta en la rejilla): 0,8–0,9 s por planta, 1,3–1,7 s la primera. Sigue siendo 1,7–2,1 veces el cálculo (§4). En la app, el mapa juntaba miles de regiones (una por tramo) y daba una tarea de 235 ms: ahora es una región por banda de color, como los mapas |
| F-8 | **Con h = 0,75, el momento de un vano por campos difiere un 2–4 % del de fuerzas nodales en la misma recta** (C2-1), y el motor de OpenSees otro tanto | Es la malla de obra. Con h = 0,375, ≤ 2,6 % frente a OpenSees |
| F-9 | **En la app, un proyecto con bandas las dibuja en Modelo**: la escena de la planta es la de `fem render` byte a byte (regla de V1) | Se quedan en el dibujo, sin editarse. El plan (§2.6) decía que no se dibujaban |
| F-10 | **Cambiar la malla sin cambiar la versión del compilador deja resultados viejos en `.fem/`** con la misma huella (lo vio una prueba con la CLI: 173 kN·m/m donde son 6) | El compilador pasa a F1.1. Cualquier cambio de la malla tiene que cambiar `VERSION_COMPILADOR` |

## 3. Decisiones por defecto, con sus medidas

| # | Decisión | Por defecto | Medida |
|---|---|---|---|
| F-a | Ancho en losa maciza | 1 m (aceptado) | Con 0,5 m, el metro de la cara converge mucho peor: −24 % con h = 0,75 (F-6) |
| F-b | Ancho en reticular | El intereje | — |
| F-c | Reparto | n = ⌈W/b⌉ iguales de borde a borde | Junto a los pilares manda la ventana (F-h) |
| F-d | Paso entre estaciones | 0,25 m | La mitad del tiempo es de estas rectas (F-7) |
| F-e | Qué dan los mapas | Momentos de dimensionado (kN·m/m) | — |
| F-f | Caras | Las comunes de C5-g, con las reglas de F-3 y F-4 | Sin avisos de malla en G |
| F-g | Vigas dentro de una franja | Fuera | Las estaciones de las líneas de apoyo dan la losa a cada lado de la viga |
| **F-h** (nueva) | Franja que toca un pilar, en su cara | **La ventana de su ancho centrada en el pilar** | 0,0 % al correr las franjas (antes, hasta un 35 %) |

## 4. Para el usuario

- **El h de las losas con franjas (F-6).** Con el h por defecto (0,75 m), el metro centrado en un pilar interior sale un 6 % bajo; con 0,5 m, −0,7 %, a cambio de ×1,6 nudos en la losa. Hay tres salidas:
  - h = 0,5 por defecto en las losas con caras;
  - refinar la malla sólo alrededor de los pilares (por hacer);
  - o aceptar el 6 % y decirlo en el informe.
- **El tiempo (criterio 7).** Las franjas de un edificio de 7 plantas cuestan 1,7–2,1 veces el cálculo. Hay tres salidas:
  - el paso entre estaciones a 0,5 m, que lo reduce a la mitad;
  - el SPR de todos los casos a la vez (C5-4, aplazado);
  - o aceptarlo, porque en la app se calcula planta a planta (la primera, 1,3–1,7 s; en Chrome, 1,9 s).
- **El reticular de SAP2000 (criterio 3).** No se ha comparado franja a franja. E6-12 ya compara el campo de momentos en la misma malla (M11 y M22 a ≤ 1,4 %), y las franjas son medias de ese campo; si quiere la comparación directa, hay que exportar de SAP2000 los momentos por nudo con el modelo (`validacion/e6/sap2000/LEEME.md`).
- **La puerta de uso:** armar con los mapas una losa de un proyecto suyo y decir si le sirve. Se abre en Resultados · Armado.

## 5. Pendiente

- Lo de §4.
- **En el compilador:** caras para los pilares circulares, girados y de borde sin astillas (F-4), y el refinamiento local junto a los pilares (F-6).
- **Siguen:** V2c (dibujar con el ratón), las puertas de uso de V1, V2a, V2b e I1–I4, y E4-9.

## Cómo reproducir

```sh
bun run test:run                                   # toda la batería (franjas.test.ts, congelado-f.test.ts…)
bun validacion/f/validar.ts                        # criterios 2, 4, 5 y 7 → out_validacion.txt
bun validacion/f/convergencia.ts                   # el metro en la cara de un pilar, con h → out_convergencia.txt
bun validacion/f/opensees-modelos.ts               # exporta H25 para el oráculo
.venv312/Scripts/python.exe validacion/f/oraculo_franjas.py   # criterio 3 → out_opensees.txt
node validacion/f/chrome.ts                        # criterios 7 y 8 en Chrome → out_chrome.txt
bun validacion/f/congelar.ts                       # SÓLO a sabiendas: regenera la referencia congelada de F
```
