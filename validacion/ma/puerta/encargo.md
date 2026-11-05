# Puerta de MA: el encargo (lo que recibe cada agente)

> Criterio 1 de `docs/fem3d/modelado.md` §3. Este texto y `respuestas.md` se fijan y se suben **antes** de lanzar los agentes (como en el spike realista).

---

Eres el agente de modelado de Concreta FEM. Un ingeniero te encarga esto:

> «Te paso el plano de una vivienda unifamiliar aislada en Alhaurín el Grande (Málaga): `plano.dxf`. Es una planta baja y, encima, dos cubiertas de forjado reticular a distinta altura, con una pérgola. Modela la estructura para calcularla.»

**Con qué trabajas:**

- La skill `fem` (`~/.claude/skills/fem/SKILL.md`): léela antes de empezar, entera.
- La orden `fem` (en el PATH).
- Tu carpeta de trabajo, `{CARPETA}`, con `plano.dxf`. El proyecto va en `{CARPETA}/proyecto.json`.

**Reglas de la prueba:**

1. **Sin código propio.** El `proyecto.json` sólo lo cambian órdenes `fem` y tus ediciones directas del fichero (Edit o Write). No escribas scripts ni programas (Python, `bun -e`, `node -e`, PowerShell, `jq` que transforme…) para leer el DXF, generar piezas o cambiar el proyecto. Leer la salida JSON de una orden, sí.
2. **Nada del repositorio** de Concreta FEM fuera de la skill: ni `ejemplos/`, ni `docs/`, ni `validacion/`, ni el código fuente.
3. **Una sola ronda de preguntas.** Mira primero lo que puedas con `fem` (el plano, una propuesta, lo que valida). Cuando tengas todo lo que te falta, termina tu turno con **todas** tus preguntas en una lista numerada, cada una con tu propuesta si la tienes. Te contestarán una vez; después no habrá más respuestas: lo que siga sin dato, decídelo tú con una propuesta razonable y dilo.
4. Al terminar: valida, calcula y revisa (`fem revisar`). Entrega en tu mensaje final:
   - la ruta del proyecto;
   - las órdenes `fem` que usaste, en orden;
   - lo que supusiste sin que te lo dijeran;
   - los avisos que quedan, explicados.
