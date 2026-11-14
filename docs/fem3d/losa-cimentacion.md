# Fase LC: la losa de cimentación sobre balasto

Plan del 2026-11-14, desde la propuesta de `cimentacion-y-arriostramientos.md` §2 (2026-10-13). El orden lo decidió el usuario el 2026-11-08: DN, luego LC y luego CO. Estado: **plan, con lo medido para CB-b (§3); CB-a, CB-b y LC-c…LC-i decididas por el usuario el 2026-11-14 como se recomendaban (§5).** **LC1 hecho el 2026-11-14** (§8); faltan LC2 y la sombra.

## 1. Qué se pide

Como en CYPECAD: los pilares y los muros caen en una losa «de cimentación» con su coeficiente de balasto, y la losa se calcula sobre muelles en los nudos de su malla (Winkler). Lo que sale es lo de siempre de una losa (franjas de armado, mapas) más lo del terreno: la tensión σ = k·w, los asientos y dónde despega.

Esta fase es **lineal**: un muelle en tracción no se quita, se avisa (`cimentacion/despegue`). Quitarlo es el cálculo no lineal por combinación de `cimentacion-y-arriostramientos.md` §4, que va con las barras sólo a tracción.

## 2. Cómo está hoy

- **El motor ya tiene muelles** (`Muelle`, `src/motor/modelo.ts`): a tierra o entre dos nudos, 6 o 36 rigideces. Sus reacciones entran en las de los apoyos y en el equilibrio de cada cálculo (regla de oro 2). El compilador no genera ninguno.
- **Un pilar con `base: "ninguno"` se apoya en una losa por su huella rígida** (apeo, C2-d; HR), y un muro, por sus nudos de la base (C3-f). Es lo que hace falta.
- **La planta más baja no tiene diafragma** por defecto (C1-d). Con RV-b, la cota de la planta es la cara superior de la losa y el pilar arranca en el nudo.
- **Las franjas y los mapas de armado nombran caras físicas** (`armado-x-inf` es la cara inferior). En una losa de cimentación el armado de los vanos sale arriba y el de bajo los pilares, abajo, pero no hay que cambiar ningún nombre: `cimentacion-y-arriostramientos.md` §2.4 decía mal que había que invertirlos.
- **Un nudo con un apoyo en ux y uy manda su masa sísmica al terreno** (VS2), y el segundo orden toma como nivel sin desplazamientos el más alto bajo el cual nada se mueve (A2-4).

## 3. Lo medido para CB-b (`validacion/lc/`)

**La pregunta:** muelles por nudo (k por el área tributaria, la fila sumada de la matriz consistente; cabe en el motor sin tocarlo) o la matriz consistente ∫ k·Nᵀ·N dA (acopla los nudos de cada lámina y tendría que ir en el motor, con su oráculo).

### 3.1 La viga de Hetényi (`hetenyi.py`, `out_hetenyi.txt`)

Para aislar lo que es del reparto del balasto, una viga de Euler-Bernoulli con elementos de Hermite (exactos sin terreno) sobre Winkler, con una carga puntual, frente a la solución cerrada. l_v = 1/β = (4EI/k_b)^¼.

| h/l_v | w bajo la carga, nudo / consistente | M bajo la carga, nudo / consistente |
|---|---|---|
| 1,00 | −1,03 / −0,41 % | −18,0 / −0,10 % |
| 0,50 | −0,05 / −0,03 % | −4,3 / −0,01 % |
| 0,27 | 0,00 / 0,00 % | −1,23 / 0,00 % |
| 0,10 | 0,00 / 0,00 % | −0,17 / 0,00 % |

Lejos de la carga (2 y 3 l_v), las dos dan lo mismo. **Lo único que pierde el reparto por nudos es el pico de momento bajo una carga concentrada, del lado inseguro, con orden 2: ≤ 1,2 % con h ≤ 0,27·l_v** (con la l de la losa, h ≤ 0,4·l).

### 3.2 La losa frente a Navier–Winkler (`medir.ts`, `out_medir.txt`)

El oráculo es la solución de Navier de Mindlin (`src/pruebas/navier.ts`, con el campo nuevo `balasto`: k suma al término de W). Placa de 12,75 × 12,75 m apoyada «hard», HA-30, con un pilar de 0,75 × 0,75 m en el centro como parche de 1 500 kN (≥ 2,3 l de los bordes). l = (D/k)^¼. Muelles por nudo, mallas regulares.

- **Prueba del parche** (losa libre, carga uniforme): w = q/k en todos los nudos a ≤ 4e-12 y momentos ≤ 1e-10 kN·m/m. El vector de cargas de la lámina y los muelles son coherentes.
- **El pilar** (lámina más cercana a cada punto, frente a Navier en su centroide):

| t, k | l | h | h/l | w junto al centro | Mx centro | Mx a 1,5 m | Mx a 3 m |
|---|---|---|---|---|---|---|---|
| 0,6 m, 10 000 | 2,80 | 0,75 | 0,27 | −0,9 % | −25,9 % | +6,1 % | +12,1 % |
| | | 0,375 | 0,13 | −0,3 % | −7,5 % | +1,7 % | +4,0 % |
| 0,6 m, 50 000 | 1,87 | 0,75 | 0,40 | −1,6 % | −31,7 % | +24,3 % | −7,8 % |
| | | 0,375 | 0,20 | −0,5 % | −9,4 % | +11,0 % | −1,8 % |
| 1,0 m, 50 000 | 2,75 | 0,75 | 0,27 | −0,8 % | −26,4 % | +6,8 % | +16,3 % |
| 0,4 m, 150 000 | 1,05 | 0,75 | 0,71 | −3,9 % | −41,4 % | −31,7 % | −5,1 % |
| | | 0,375 | 0,36 | −1,3 % | −12,7 % | −5,9 % | −1,2 % |
| | | 0,25 | 0,24 | −0,6 % | −5,0 % | −4,4 % | −0,7 % |

(Mx a 1,5 m con k = 50 000 está junto al cero del momento: el tanto por ciento engaña.)

**Lo que sale:**

- **CB-b: los muelles por nudo bastan.** En la losa, el error con h = 0,75 es 20 veces el que la viga atribuye al reparto (−26 % frente a ≈ −1 % con h/l = 0,27): es de la malla de la lámina bajo una carga concentrada, y la matriz consistente no lo arregla. Meterla en el motor, con su oráculo, no compensa.
- **Lo que manda es h/l.** Con la h = 0,75 de los forjados, una losa de cimentación de 0,4 m sobre roca blanda (k = 150 000) queda en h/l = 0,71 y el momento a 1,5 m del pilar sale un 32 % bajo. Hace falta una regla de malla por l (LC-e).
- **Esto no es todavía lo que se dimensiona.** El valor del centroide de la lámina del parche no es el de la cara del pilar, y en el modelo compilado la huella es rígida y lleva las plantillas de F2/F3. La regla de LC-e se fija midiendo en LC1 las estaciones de cara y la σ máxima del modelo compilado frente a una malla fina.

## 4. Propuesta

**En el modelo físico** (`fisico.ts`, con el esquema y A-1):

```ts
/** En una Losa: es de cimentación, sobre el terreno (fase LC). */
cimentacion?: {
  /** Módulo de balasto vertical, kN/m³, ya corregido por tamaño y forma (lo decide el ingeniero). */
  balasto: number;
  /** Lo horizontal (CB-a). Por defecto, "coartado". */
  horizontal?: "coartado" | { kh: number };
  /** Tensión admisible del terreno, kN/m² (opcional): sólo para el aviso de LC-f. */
  tensionAdmisible?: number;
};
```

**En el compilador** (versión nueva, LC1; sin `cimentacion`, la misma salida bit a bit):

1. **Un muelle vertical por nudo** de la losa, k por el área tributaria (la fila sumada de ∫ k·N dA de sus láminas), a tierra y en ejes globales. Los nudos de la huella de un pilar son de la losa y llevan su muelle (su reacción va al enlace). Lo que el ancho de una viga quita de la losa (LV) también apoya: su área va a los nudos de las caras (por defecto, LC-g).
2. **Lo horizontal (CB-a):** con `"coartado"`, ux y uy coartados en todos los nudos de la losa; con `{ kh }`, muelles en ux y uy con kh por el área tributaria. En los dos, rz no es un mecanismo.
3. **La malla (LC-e):** la losa se malla con h_c = min(h, l/n), l = (D/k)^¼ con el E y el espesor de la losa; n sale de lo medido en LC1.
4. **Los pilares y muros que arrancan en la losa (LC-c):** sin `base` escrita, se apoyan en ella (`"ninguno"`); con `"empotrado"` o `"articulado"` escritos y la huella en la losa, error `pilar/apoyo-sobre-cimentacion` (y el del muro). Un pilar que sigue por debajo de una losa de cimentación es un error (`cimentacion/pilar-debajo`).
5. **El diafragma:** un diafragma rígido no puede abarcar los nudos coartados en ux y uy (un GDL no puede ser esclavo y llevar apoyo). La losa de cimentación queda fuera del de su planta; con `diafragma: "rigido"` escrito y sólo la losa en la planta, aviso.
6. **El peso propio** de la losa va a sus muelles (G), como cualquier carga. **Sismo y segundo orden,** sin cambios: con `"coartado"` la masa de la losa va al terreno y su cota es el nivel sin desplazamientos.
7. **La hipótesis** dice el balasto de cada losa, lo horizontal, h_c y que el cálculo es lineal (sin despegue).

**Consultas y salidas:**

- **`terreno`:** σ = k·w por nudo y por combinación (por defecto, la ELS característica, como las reacciones de UI-11), el asiento w y el máximo de cada losa; `fem consultar terreno`.
- **Despegue:** aviso `cimentacion/despegue` si un muelle queda en tracción en alguna combinación, con el área que despega y su fracción de la losa, y la combinación.
- **Tensión admisible (LC-f):** con `tensionAdmisible`, aviso `cimentacion/tension` si σ máx de la ELS característica la pasa. La comprobación geotécnica completa (DB SE-C) es de CO.
- **Distorsión angular** entre pilares que arrancan en la losa (asiento diferencial / distancia), como dato.
- **Sensatez (A3):** la suma de las reacciones de los muelles es la de las cargas (ya está en la regla de oro 2) y la bajada tributaria acaba en la losa.

**Fuera del compilador (LC2):** la columna «balasto» y el tipo «cimentación» en Forjados y en la plantilla de Forjado; Resultados con los mapas de σ y de asiento (planta y 3D) y el despegue; el informe con σ máx, asiento máx y distorsión; la skill con la pregunta del balasto en la lista de datos del encargo (MA1).

**Fuera de LC:** vigas de cimentación y riostras sobre balasto, zapatas como base elástica (`cimentacion-y-arriostramientos.md` §2.6), el balasto por zonas dentro de una losa (LC-d) y el despegue de verdad (§4 de esa propuesta).

## 5. Decisiones del usuario

**Decididas el 2026-11-14:** todas como se recomendaban; LC-h, a falta del modelo de CYPECAD.

- **CB-a, lo horizontal.** Recomendado: **`"coartado"` por defecto y `{ kh }` como opción**. Coartado es lo más simple, no deja mecanismos, manda la masa sísmica al terreno y fija el nivel del segundo orden; los esfuerzos de membrana de la losa salen nulos (es lo rígido). Con kh (rozamiento, empuje pasivo) la losa se estira y los pilares de la planta baja se reparten algo distinto el cortante. Qué hace CYPECAD no lo he podido confirmar: se ve en la sombra (LC-h).
- **CB-b, muelles por nudo o matriz consistente.** Recomendado: **por nudo** (§3: lo que pierde es ≤ 1,2 % bajo la carga con h ≤ 0,4·l; lo que pesa es la malla, LC-e). El motor no cambia.
- **LC-c, los pilares sobre la losa.** Recomendado: **sin `base` escrita, se apoyan en la losa; escrita, error**. La alternativa es exigir `"ninguno"` y que el editor lo escriba al dibujar la losa; obliga a tocar todos los pilares y falla en silencio si se olvida uno (quedaría empotrado al terreno a través de la losa).
- **LC-d, balasto por zonas.** Recomendado: **no hay `zonas`**: un balasto distinto bajo un núcleo o en los bordes son dos losas de cimentación que comparten un lado (C2 ya las une y siembra el lado). Menos campos y la misma malla.
- **LC-e, la malla de la losa.** Recomendado: **h_c = min(h, l/n), con n fijado en LC1** midiendo las caras de los pilares y la σ máxima del modelo compilado frente a una malla fina (criterio 4). Con lo de §3, n estará entre 3 y 4. El coste: con h_c = l/4 y l = 1,9 m, la losa de cimentación del edificio objetivo es ~2,5 veces la de un forjado.
- **LC-f, la tensión admisible.** Recomendado: **campo opcional y sólo un aviso** con σ máx de la ELS característica; lo de la norma (σ media, bordes, hundimiento con sus γ) es de CO.
- **LC-g, el ancho de las vigas sobre la losa** (una viga de atado o un murete sobre la losa unidos por sus caras, LV). Recomendado: **el área del ancho reparte su balasto a los nudos de sus caras**, para no perder terreno bajo la viga (con 30 cm cada 6 m, un 5 %).
- **LC-h, la sombra.** Un modelo de CYPECAD del usuario con una losa de cimentación (pilares, algún muro, viento), para comparar σ, asientos, esfuerzos de la losa y de los pilares de la planta baja, y para ver qué hace con lo horizontal.
- **LC-i, el perfil móvil.** El edificio objetivo con losa plana está en 192 066 ecuaciones; con su losa de cimentación pasa de las 200 000 del perfil móvil. Recomendado: **aceptarlo** (como LV2-d con el reticular) y medirlo en LC1.

## 6. Criterios (para fijar con las decisiones)

1. Sin `cimentacion`, la salida del compilador bit a bit en todas las referencias congeladas.
2. **Oráculos analíticos del modelo compilado:** la prueba del parche (losa libre con su peso y una carga uniforme: w = q/k a 1e-9 y momentos nulos); Navier–Winkler con un pilar a ≤ 2 % en w y σ y a ≤ 5 % en el momento de las caras con h_c; la losa rígida (asiento y giro de sólido rígido de la resultante, con una carga excéntrica); flexión cilíndrica frente a Hetényi.
3. **Oráculo externo:** OpenSeesPy con los mismos nudos, ASDShellQ4 y muelles `zeroLength` en una losa con pilares: σ y momentos a ≤ 0,5 % (elementos distintos) y las reacciones de los muelles, idénticas en suma.
4. **LC-e medida:** con h_c, las estaciones de cara de los pilares y la σ máxima a ≤ 5 % y ≤ 2 % de la malla convergida (`referencia-fina-convergida`), en una retícula con pilares de esquina, de borde e interiores y dos balastos.
5. El equilibrio de cada cálculo (regla de oro 2) con los muelles; el despegue sale donde w > 0 y en ningún otro sitio; metamórficas (traslación, giro, orden de las listas) sin cambio.
6. Los errores de §4 en el catálogo de no válidos.
7. El coste en ecuaciones de los edificios objetivo con su losa de cimentación, informado (LC-i).
8. La sombra con CYPECAD (LC-h), cuando el usuario dé el modelo.

## 7. Tramos

- **LC1, el compilador y las consultas:** el campo, los muelles, lo horizontal, la malla por l, los pilares y muros, el diafragma, `terreno`, los avisos, la hipótesis y la referencia congelada, con los criterios 1 a 7.
- **LC2, la app y el agente:** la tabla y la plantilla, los mapas de σ y asiento, el despegue, el informe, la skill y `fem consultar terreno`.
- **LC3:** la sombra (criterio 8).

## 8. LC1 hecho (2026-11-14)

Pasan los criterios 1 a 7; el 8 (la sombra) espera al modelo de CYPECAD del usuario.

**Ya en el repo:**

- **Modelo físico** (`fisico.ts`, esquemas regenerados): `Losa.cimentacion` (`balasto`, `horizontal`, `tensionAdmisible`) y la opción `mallaCimentacion` (n, por defecto `MALLA_CIMENTACION` = 4; sólo entra en la huella si se da).
- **`src/compilador/cimentacion.ts`:**
  - `resolverCimentacion` (dentro de `fisicoResuelto`): los pilares y muros sin `base` escrita que arrancan en una losa de cimentación, con base "ninguno" (LC-c);
  - `erroresCimentacion` (al final de `validar`, sobre el modelo tal como se escribió): `pilar/apoyo-sobre-cimentacion` y `muro/apoyo-sobre-cimentacion` con la base escrita, `cimentacion/pilar-debajo` y `cimentacion/muro-debajo`, `cimentacion/diafragma` (un diafragma rígido escrito en su planta) y `cimentacion/kh-con-sismo`;
  - `tamanoMallaPlanta`: h = min(h, l/n) en `mallarPlanta` y en las caras de las franjas de esa planta;
  - `construirCimentacion`: un `Muelle` a tierra por nudo, con k·∫Nₐ dA de sus láminas (la integral del vector de cargas de superficie del motor) más lo del ancho de las vigas, a los dos nudos del eje que rodean el centroide de cada pieza (LC-g); con lo horizontal coartado, ux y uy en cada nudo o, en uno de un enlace, ux, uy y rz en el maestro de su cadena;
  - la hipótesis.
- **Diafragma:** por defecto ninguno en la planta de una losa de cimentación; la planta no cuenta para `sismo/planta-sin-diafragma`.
- **Mapeo:** `cimentacion` por losa (balasto, nudos, áreas y los nudos con apoyo).
- **Consultas:** `Consultas.terreno` (uz por caso base, áreas, pilares que arrancan en ella), `objetosReaccion` (la losa es el objeto con reacciones; sus pilares, no) y las reacciones de la losa; `fem consultar terreno` (`src/agente/terreno.ts`: σ máx y mín, asiento, despegue y distorsión angular entre pilares, en la ELS característica; con el sismo, la parte estática ± la amplitud).
- **Revisión (A3):** las comprobaciones `cimentacion/despegue` y `cimentacion/tension`; la losa de cimentación sale de las de flecha y esbeltez, del aviso de zunchos y de «plantas sin la carga de un caso». En el informe, la losa en las cargas en cimentación.

**Criterios:**

1. Sin `cimentacion`, los mismos bits: pasan las 104 pruebas del compilador con sus referencias congeladas idénticas.
2. `cimentacion.test.ts`: la prueba del parche (w = q/k a 1e-9 y momentos ≤ 1e-8, las áreas suman la losa a 1e-9); la franja en flexión cilíndrica frente a la serie de Mindlin sobre Winkler (w ≤ 0,5 %, Mx ≤ 2 %); la losa casi rígida frente al sólido rígido de sus muelles (≤ 0,1 %); los pilares y muros que arrancan en ella, kh, los errores, el ancho de una viga y las consultas.
3. `oraculo-lc.test.ts` frente a OpenSeesPy (`validacion/lc/oraculo_balasto.py`, ASDShellQ4 y `zeroLength`): el asiento de cada nudo a ≤ 0,5 % del mayor y la misma suma de reacciones de los muelles.
4. `validacion/lc/malla.ts` (`out_malla.txt`), una retícula de 3 × 3 vanos de 6 m sobre dos losas de cimentación, frente a n = 16: con n = 4, σ máx a ≤ 0,7 %, el asiento a ≤ 0,5 %, las caras de los pilares a ≤ 1,6 % y el máximo superior de las franjas (los vanos) a ≤ 1,7 %, también con l = 1,3 m. Con n = 3, un 10 % en los vanos del caso duro; con h = 0,75, un 4,7 %. n = 4 queda por defecto.
5. El equilibrio de cada cálculo lo comprueba el motor con los muelles; el despegue sale con una carga que levanta la losa y no sin ella; trasladar el modelo y cambiar el orden de pilares y cargas no mueve σ, el asiento ni la distorsión.
6. Siete entradas nuevas en el catálogo de no válidos de C2 y una de opciones.
7. El coste, en §8.1.

**Hallazgos:**

- **LC-1, la inercia de giro de los muelles por nudo:** es la de la regla del trapecio, ∫x²dA + A·h²/12 en una malla regular; en una losa casi rígida de 6 m con h = 0,75, un 3 % más que la continua, así que el giro sale un 3 % menor. Con las losas y las mallas de LC (l/4) es menos del 1 %. Es lo que pierde CB-b, y queda en la prueba de la losa rígida.
- **LC-2, el pico inferior junto a la huella:** el máximo de la armadura inferior de una franja junto a la esquina de un pilar no converge (de n = 12 a 16, un 9 %): es la singularidad de la esquina de la huella rígida, como en los forjados. Lo que dimensiona, las caras, converge (≤ 1,6 %).
- **LC-3, los pilares que arrancan en la losa no tenían caras de franja:** `pilaresEnLosa` sólo tomaba los que llegan a la losa desde abajo o la atraviesan. Ahora, en una losa de cimentación, también los que arrancan en ella (con la sección de su primer tramo); en las demás losas, nada cambia (un pilar apeado sigue sin caras).
- **LC-4, el ruido en las referencias congeladas:** con cargas sólo verticales y pilares de cabeza libre, sus momentos (1e-16) y los de los apoyos horizontales de la losa (1e-13) son ruido, y su error relativo de grupo en `errorPorGrupos` cambia entre V8 y JSC (1,45 frente a 3e-13 con los mismos números). La prueba congelada de LC los pone a cero por debajo de 1e-9.

**Cambios frente al plan:** el diafragma rígido escrito en la planta es un error, no un aviso (sus nudos llevan apoyo); kh con el sismo, un error (la masa de la losa no tendría adónde ir); una losa de cimentación reticular, también.

### 8.1 El coste (criterio 7, LC-i; `validacion/lc/tamano.ts`, `out_tamano.txt`)

Los tres edificios objetivo de 7 plantas con una losa de cimentación de 0,8 m sobre k = 40 000 kN/m³ (l = 2,24 m, malla de 0,56 m) bajo toda la planta, con los pilares apoyados en ella: la losa son 11 189 nudos y 42 860 ecuaciones más.

| Modelo | Ecuaciones sin la losa | Con ella | Cambio | Perfil móvil (200 000) |
|---|---|---|---|---|
| Con vigas | 149 814 | 192 674 | +28,6 % | cabe |
| Reticular | 199 962 | 242 822 | +21,4 % | no cabe |
| Losa plana | 193 809 | 236 669 | +22,1 % | no cabe |

Como se aceptó en LC-i, el reticular y la losa plana con su losa de cimentación pasan del perfil móvil (ya iban a menos de un 1 % de él sin ella).
