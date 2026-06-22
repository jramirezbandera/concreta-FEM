# feature-3 · Biblioteca de materiales y secciones (hormigón + acero)

> Tier 1 · Motor · **Dependencias: feature-2** · Bloquea: 4.

## Objetivo

Catálogos de **materiales** (hormigón y acero) y **secciones** (perfiles metálicos tabulados + hormigón paramétrico) que el discretizador convertirá en `materials`/`sections` de la Capa 2. Valores como **tabla de configuración aislada y corregible**, verificada contra normativa vigente.

## ⚠️ Normativa (cambio por derogación, no por error de la I+D)

La I+D **eligió deliberadamente EHE-08** (por coherencia con la tradición española); su única corrección de cálculo fue un valor numérico espurio de Ecm, **no la fórmula**. Como **EHE-08 está derogada**, la norma aplicable pasa a ser el **Código Estructural (RD 470/2021)**, alineado con Eurocódigo 2 para hormigón y subsumiendo EAE para acero.

- **Módulo del hormigón:** la I+D (hallazgo #13) usa la fórmula EHE-08 `Ecm = 8500·fcm^(1/3)`. **Sustituir** por la del Código Estructural / EC2, del tipo `Ecm = 22000·(fcm/10)^0,3` (MPa), con `fcm = fck + 8`. **Verificar la fórmula y los valores exactos contra el texto del Código Estructural antes de cablearlos.** No copiar los MPa de la I+D.
- **Nomenclatura de hormigones:** confirmar si se usa `HA-25`/`HA-30`/`HA-35` (tradición española) o `C25/30` (EC2). Dejarlo configurable.
- **Acero estructural:** E=210 000, G=81 000, ν=0,3 (estable, EC3). Armadura B500S: Es=200 000 (≠ acero estructural) — solo informativo en F1 (sin armado).
- **Pesos:** hormigón 25 kN/m³, acero 78,5 kN/m³.

> Implementar las propiedades en un único módulo de datos con comentario `// VERIFICAR contra Código Estructural` y referencia al artículo, de modo que una corrección sea un cambio de un valor, no de código.

## Alcance

**Incluye** (`/src/biblioteca`)
- `materiales` (`hormigon.ts`, `aceros.ts`): catálogo con `E`, `G`, `ν`, `peso`, denominación. Función que deriva `Ecm` del hormigón.
- `secciones`:
  - `perfiles.ts`: perfiles metálicos (IPE/HEA/HEB/HEM/UPN/L/tubos) con `A`, `Iy`, `Iz`, `J`. **`J` por coeficiente β / tablas (EN 10365), nunca momento polar.** Verificar antes de cablear.
  - hormigón paramétrico: rectangular/circular → `A`, `Iy`, `Iz`, `J` calculadas.
- **Mínimo obligatorio de F1** (criterio de aceptación, no "empezar por"): series **IPE e HEB completas** (acero) + secciones de hormigón **rectangular y circular** paramétricas. Suficiente para introducir obra real y para el golden de pórtico (feature-6). El resto de series (HEA/HEM/UPN/L/tubos) puede ampliarse después sin tocar la estructura.
- Todo en unidades internas (convertir desde mm/MPa en el borde, ver feature-1).

**Excluye**: armado, comprobación normativa (F4), pandeo. Solo propiedades geométricas/mecánicas para el FEM.

## Entradas de I+D

- Hallazgo #13 (materiales — **corregir a Código Estructural**), #7 (sobrecargas/ψ, se usan en feature-13), Área 4 §3 (secciones: A/Iy/Iz exactas, **J por β, no polar**; perfiles EN 10365 a verificar).

## Criterios de aceptación

- `Ecm` derivado con la fórmula del Código Estructural, con test que comprueba la fórmula (no valores mágicos sin origen).
- `J` de perfiles documentada como tabulada/β, no como momento polar.
- Secciones paramétricas de hormigón: `A`, `Iy`, `Iz` con test contra fórmula cerrada (rectángulo: `Iy = b·h³/12`).
- Cada valor normativo lleva comentario con su fuente (artículo/tabla) y marca de verificación.
- **Catálogo F1 completo:** series IPE e HEB enteras + hormigón rectangular y circular disponibles y consultables por `seccionId`.
- Unit tests en proyecto `node`.

## ⚠️ Decisión pendiente (heredada de feature-2): dónde vive el catálogo

> Anotado tras la auditoría de feature-2 (guardian-arquitectura). **Resolver al inicio de feature-3**, antes de cablear valores.

feature-2 definió los **tipos** `Material`/`Seccion` (mínimos `{ id, nombre, tipo }`) y los `Pilar`/`Viga` los referencian por `seccionId`/`materialId`, pero **`ModeloSchema` NO contiene colecciones `materiales[]`/`secciones[]`**. Hay que decidir explícitamente dónde reside el catálogo:

- **Opción A — biblioteca externa** (`/src/biblioteca`, fija e inmutable): el catálogo no se persiste con el `Modelo`; `seccionId`/`materialId` apuntan a entradas de la biblioteca. Coherente con `CLAUDE.md` (catálogos en `/src/biblioteca`). Simple, sin migración. Riesgo: un proyecto exportado depende de la versión de la biblioteca del que lo abra.
- **Opción B — catálogo en el `Modelo`** (`materiales: Material[]` / `secciones: Seccion[]` añadidos a `ModeloSchema`): el proyecto es autocontenido y portable. Exige **bump de `schemaVersion` y migración en feature-8**, y enriquecer `MaterialSchema`/`SeccionSchema` con sus propiedades.

Implicaciones que obligan a cerrar esto en feature-3:
- **feature-4 (validaciones referenciales):** necesita saber contra qué validar que un `seccionId`/`materialId` existe (¿biblioteca o array del modelo?).
- **feature-8 (persistencia):** si se elige B, esta feature ya toca `schemaVersion`.

## Notas / riesgos

- **No asumir EHE-08.** Si hay duda sobre un valor del Código Estructural, dejar `TODO VERIFICAR` y un valor candidato claramente marcado, nunca un número inventado.
- Perfiles metálicos: tablas largas; empezar con un subconjunto (IPE/HEB) y dejar la estructura para ampliar.
