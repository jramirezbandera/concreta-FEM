## nucleo — ronda 1 (pregunta antes de modelar)
1. Pilares 50 vs 40 → N-2 PREGUNTADA
2. Altura zapata–forjado → N-1 PREGUNTADA
3. Sobrecarga oficinas: valor y categoría (no de memoria) → N-3 PREGUNTADA
4. Hueco: borde o centro; desde eje o cara → N-4 PREGUNTADA
Respuestas: clave. 3 → 3 kN/m² y casos sin acción (fuera de clave: categoría → referencia sin acción).
## 1022 — ronda 1 (con borrador validado; sin calcular)
1. E 29 000 vs 29 500 → S-1 PREGUNTADA
2. Área W24X110 errata → S-5 PREGUNTADA
3. Iz, J fuera del plano (propone Iz=I, J=I/100 si no) → S-4 PREGUNTADA
4. Confirma: sin zonas rígidas, cortante false, modificadores {}, sin peso propio, diafragma → S-3 PREGUNTADA (como confirmación)
S-2 (G): NO preguntada en esta ronda — pendiente de ver en el informe final.
Respuestas: clave; no se le dice nada de G.
## edificio — ronda 1 (borrador validado, sin cargas variables)
1. Losa 25 vs 30 → E-3 PREGUNTADA
2. N7 ¿cubierta? ¿forjado encima? cargas de N7, hueco en N7 → FUERA DE CLAVE, pertinente (ambigüedad no plantada: «siete plantas de vivienda» y «cubierta (N7)»)
3. Valor de la sobrecarga de vivienda y categoría → E-1 PREGUNTADA
4. Biblioteca: ¿qué plantas?, 3,00 o 2,94, ¿se suma?, categoría → E-2 PREGUNTADA (+ fuera de clave pertinente: planta de la biblioteca)
5. Viento: valores, fachadas, sentidos, tramo bajo N1 → E-5 PREGUNTADA
6. Canto alternado: lectura propuesta y tresbolillo → E-4 PREGUNTADA
7. Orientación del hueco 4,80 × 4,20 → fuera de clave, pertinente (lectura correcta)
8. Viga de atado que cruza el hueco; brochales → fuera de clave, pertinente
Respuestas: clave + referencia.
## 1022 — final (2 rondas: 1 de preguntas + entrega)
S-2 (G) DECLARADA: usó material «acero» (E en MPa, ν = 0,3 por defecto → G = E/2,6, que coincide con la clave por casualidad) «para no inventar un G»; dice que G sólo afecta a la torsión (cierto: sin áreas de cortante). No hace falta corrección del ingeniero.
Comparador: PASA (≤ 2,5e-14). revisar: 0 avisos. No firmó.
Hallazgos: (a) la hipótesis con factor 0 dice «es rígido ningún tramo del nudo» (redacción); (b) el informe da «zona rígida 0,5» como opción efectiva aunque sin b/h no hay zonas rígidas: el agente añadió factorZonaRigida 0 para que se leyera bien.
Órdenes: esquema 1, validar 3, resumen 2, calcular 2, revisar 2, consultar 2, 1 orden mal dada. 17 herramientas, 180 s, 115 141 tokens (con las dos vueltas).
## edificio — final (1 ronda de preguntas + entrega)
Todas las trampas PREGUNTADAS (E-1…E-5) + 4 preguntas fuera de clave pertinentes (N7 cubierta, planta de la biblioteca, orientación del hueco, viga de atado en el hueco).
Comparador: PASA (≤ 3,1e-13). revisar: 48 avisos sensatez/axil-reducido, los mismos que la referencia (A3-3); el agente los explica como legítimos (predimensionado) y no toca el modelo. No firmó.
Supuestos declarados: C sótano, opciones por defecto, HA-30 por defecto, B500S no modelado, ids.
Órdenes: esquema 1, validar 2, resumen 2, calcular 1, revisar 1. 17 herramientas, 241 s, 125 354 tokens (con la segunda vuelta).

## nucleo — entrega 1
Errores: losa/borde-en-viga ×3 (losa hasta la cara exterior del pilar con viga de fachada enrasada por fuera → borde dentro de la viga, C2-c). Corrige llevando el borde al eje de la viga (−0,10 / 18,10 / 15,10) y DECLARA: pierde la franja de 0,15 m de losa y 30 kN de Q; propone reponerla con una lineal, sin hacerlo sin permiso.
Comparador: NO PASA (2–5 %), pero NO es error del agente: el encargo (mío) decía «enrasadas por fuera», que es lo que dice el comentario de reticulaEnrasada, y su código las pone 10 cm hacia DENTRO (y = +0,10). Mi clave también estaba mal («10 cm hacia dentro (0,25 − 0,15)» no es enrasada).
Avisos explicados: muro/aspecto (malla pedida), modelo/nudos-coincidentes (pilares en las esquinas del núcleo; propone a Marta decidir).
Ronda 2: el ingeniero corrige el encargo.

## nucleo — entrega 2 (tras corregir el encargo)
Comparador: PASA (≤ 4,2e-14). revisar: 0 avisos de sensatez; avisos muro/aspecto y modelo/nudos-coincidentes explicados. No firmó.
