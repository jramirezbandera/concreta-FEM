/**
 * Los ejemplos de la app (`app/src/Inicio.tsx`), puestos al día con lo que el programa sabe hacer hoy:
 *
 *   bun scripts/ejemplos-app.ts          escribe ejemplos/app/<nombre>.json
 *
 * Salen de los proyectos de los que se copiaron (la skill, `ejemplos/` y los tres de A2), que no se
 * tocan: las pruebas y los bancos de validación los comparan con sus referencias. A cada uno:
 *  - los datos de la obra (`obra`): uso, materiales por tipo, datos de las armaduras y del terreno;
 *  - el emplazamiento, con el viento y el sismo del programa (`acciones`; la zona eólica escrita donde la
 *    provincia tiene más de una, como si el ingeniero la hubiera confirmado), en lugar de los casos de
 *    viento y de sismo metidos a mano con sus cargas;
 *  - los casos con su acción y su ψ por su nombre; el peso propio, sólo del programa (las cargas
 *    muertas, en su caso CM); la nieve en las cubiertas, con la sk del emplazamiento;
 *  - el peso propio de los forjados calculado (sin `pp` escrito) y sin las opciones de compilación
 *    de antes (las de por defecto);
 *  - un zuncho de 30 cm del canto del forjado en cada borde que no lo tiene («Vigas de borde» de la
 *    app: todo borde de forjado lleva el suyo).
 *
 * Los datos de la obra (el terreno, la ductilidad, la aspereza) son de ejemplo, no de un estudio:
 * sirven para que todo compile, calcule y se compruebe en la app.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aplicar } from "../src/editor/operaciones.ts";
import { serializar } from "../src/editor/serializar.ts";
import { operacionVigasBorde, proponerVigasBorde } from "../src/editor/vigasBorde.ts";

const RAIZ = join(import.meta.dirname, "..");
const leer = (f: string) => JSON.parse(readFileSync(join(RAIZ, f), "utf8"));
// biome-ignore lint: los proyectos se tratan como JSON
type J = any;

/** Los datos de las armaduras y del terreno de todos los ejemplos (de ejemplo, no de un estudio). */
const ARMADO_OBRA = { fyk: 500, recubrimiento: 30, exposicion: "XC2", flechaActiva: 400, recubrimientoZapatas: 50 };
const TERRENO = { tensionAdmisible: 200, pesoEspecifico: 18, rozamiento: 0.5, tierras: 0.5 };

/** Quita los casos (y sus cargas) que hace ahora el programa. */
function sinCasos(m: J, ids: string[]): void {
  m.casos = m.casos.filter((c: J) => !ids.includes(c.id));
  m.cargas = m.cargas.filter((c: J) => !ids.includes(c.caso));
}

const EJEMPLOS: Record<string, { de: string; poner: (p: J) => void }> = {
  // El pórtico de dos plantas de la skill
  ejemplo: {
    de: ".claude/skills/fem/ejemplo.json",
    poner: (p) => {
      const m = p.modelo;
      p.nombre = "Pórtico de dos plantas con losa";
      sinCasos(m, ["VX"]);
      // La cubierta, con su nieve (sk de Málaga capital, μ = 1)
      m.casos.push({ id: "S", nombre: "Nieve", accion: { tipo: "S", psi: "nieve-hasta-1000" } });
      m.cargas.push({ tipo: "superficie", id: "S-P2", caso: "S", planta: "P2", losa: "L-P2", q: [0, 0, -0.2] });
      m.acciones = {
        emplazamiento: { ine: "29067", municipio: "Málaga", altitud: 10 },
        viento: { zona: "A", aspereza: "IV" },
        sismo: { terreno: "II", mu: 2 },
      };
      p.obra = { uso: "A", materiales: { forjados: "HA-25", pilares: "HA-25", muros: "HA-25", zapatas: "HA-25" }, armado: ARMADO_OBRA, terreno: TERRENO };
    },
  },

  // La vivienda de Alhaurín el Grande
  vivienda: {
    de: "ejemplos/vivienda/proyecto.json",
    poner: (p) => {
      const m = p.modelo;
      // El reticular con casetón de hormigón y el peso propio calculado (era «perdido» con 4,5 escrito)
      for (const l of m.losas) {
        if (!l.reticular) continue;
        l.reticular.caseton = "hormigon";
        delete l.pp;
      }
      m.acciones = {
        emplazamiento: { ine: "29008", municipio: "Alhaurín el Grande", altitud: 240 },
        viento: { zona: "A", aspereza: "III" },
        sismo: { terreno: "II", mu: 2 },
      };
      p.obra = { uso: "G", materiales: { forjados: "HA-30", pilares: "HA-30", muros: "HA-30", zapatas: "HA-30" }, armado: ARMADO_OBRA, terreno: TERRENO };
    },
  },

  // El muestrario
  muestrario: {
    de: "ejemplos/muestrario/proyecto.json",
    poner: (p) => {
      const m = p.modelo;
      sinCasos(m, ["WX+", "WX-", "WY+", "WY-", "EX", "EY"]);
      for (const pn of m.panos ?? []) delete pn.pp;
      m.acciones = {
        emplazamiento: { ine: "18087", municipio: "Granada", altitud: 680 },
        viento: { aspereza: "IV" },
        sismo: { terreno: "II", mu: 2 },
      };
      p.obra = { uso: "A", materiales: { forjados: "HA-30", pilares: "HA-30", muros: "HA-30", zapatas: "HA-30" }, armado: ARMADO_OBRA, terreno: TERRENO };
    },
  },

  // La retícula con núcleo de A2
  nucleo: {
    de: "validacion/a2/agente/nucleo/proyecto.json",
    poner: (p) => {
      const m = p.modelo;
      delete p.opciones;
      sinCasos(m, ["V"]);
      // Los cuatro pilares que caían en las esquinas del núcleo: allí está el muro
      m.pilares = m.pilares.filter((x: J) => !((x.x === 6 || x.x === 12) && (x.y === 5 || x.y === 10)));
      // El hueco, el núcleo entero hasta el eje de su muro (era de 4,8 × 4,2 m a 40–60 cm del muro, con
      // un zuncho en cada lado libre y tiras de losa entre ellos y el muro)
      for (const l of m.losas) l.huecos = [[[6, 5], [12, 5], [12, 10], [6, 10]]];
      m.casos = [
        { id: "G", nombre: "Peso propio", pesoPropio: true, accion: { tipo: "G" } },
        { id: "CM", nombre: "Cargas muertas", accion: { tipo: "G" } },
        { id: "Q", nombre: "Uso residencial", accion: { tipo: "Q", psi: "uso-A" } },
        { id: "S", nombre: "Nieve", accion: { tipo: "S", psi: "nieve-hasta-1000" } },
      ];
      m.cargas.push(
        { tipo: "superficie", id: "CM-N1", caso: "CM", planta: "N1", losa: "L-N1", q: [0, 0, -1.5] },
        { tipo: "superficie", id: "S-N1", caso: "S", planta: "N1", losa: "L-N1", q: [0, 0, -0.4] },
      );
      // Una planta baja de 3 m sobre la rasante (era un sótano de 1,5 m, sin nada sobre el terreno para el viento)
      const c = m.plantas.find((x: J) => x.id === "C");
      c.altura = 3;
      delete c.tipo;
      m.acciones = {
        emplazamiento: { ine: "30030", municipio: "Murcia", altitud: 40 },
        viento: { zona: "B", aspereza: "IV" },
        sismo: { terreno: "II", mu: 2 },
      };
      p.obra = { uso: "A", materiales: { forjados: "HA-25", pilares: "HA-25", muros: "HA-25", zapatas: "HA-25" }, armado: ARMADO_OBRA, terreno: TERRENO };
    },
  },

  // La estructura de acero de 7 plantas: el pórtico del caso de validación 1-022, repetido a 6 m, con
  // vigas según Y y diagonales en los dos pórticos de los extremos (solo, según Y era un mecanismo)
  "1022": {
    de: "validacion/a2/agente/1022/proyecto.json",
    poner: (p) => {
      const m = p.modelo;
      p.nombre = "Estructura de acero de siete plantas";
      delete p.opciones;
      // Acero de verdad (E por defecto y su peso), con las mismas secciones
      m.materiales = [{ id: "S275", tipo: "acero" }, { id: "HA-25", tipo: "hormigon", fck: 25 }];
      for (const s of m.secciones) s.material = "S275";
      // La diagonal: un tubo de 139,7 × 8 mm
      m.secciones.push({ id: "CHS139x8", material: "S275", forma: "general", A: 0.003310, Iy: 7.20e-6, Iz: 7.20e-6, J: 1.44e-5 });
      const B = 6;
      m.pilares = m.pilares.flatMap((x: J) => [{ ...x, id: `${x.id}-A` }, { ...x, id: `${x.id}-B`, y: B }]);
      const xs: number[] = [...new Set<number>(m.pilares.map((x: J) => x.x))].sort((a, b) => a - b);
      const vigas: J[] = [];
      for (const v of m.vigas) {
        vigas.push({ ...v, id: `${v.id}-A` }, { ...v, id: `${v.id}-B`, puntos: v.puntos.map((q: number[]) => [q[0], B]) });
        for (const [k, x] of xs.entries()) vigas.push({ id: `${v.id}-Y${k + 1}`, planta: v.planta, puntos: [[x, 0], [x, B]], seccion: v.seccion });
      }
      m.vigas = vigas;
      // Una diagonal por planta en cada pórtico de extremo, alternando el sentido
      const plantas = m.plantas.map((x: J) => x.id);
      m.barras = [];
      for (let i = plantas.length - 1; i > 0; i--)
        for (const x of [xs[0]!, xs[xs.length - 1]!]) {
          const sube = (plantas.length - 1 - i) % 2 === 0;
          m.barras.push({ id: `D-${plantas[i - 1]}-${x === xs[0] ? "I" : "D"}`, inicio: { planta: plantas[i], x, y: sube ? 0 : B }, fin: { planta: plantas[i - 1], x, y: sube ? B : 0 }, seccion: "CHS139x8", liberaciones: { inicio: [false, false, false, false, true, true], fin: [false, false, false, false, true, true] } });
        }
      sinCasos(m, ["LAT"]);
      m.casos = [
        { id: "G", nombre: "Peso propio", pesoPropio: true, accion: { tipo: "G" } },
        { id: "CM", nombre: "Cargas muertas", accion: { tipo: "G" } },
        { id: "Q", nombre: "Uso administrativo", accion: { tipo: "Q", psi: "uso-B" } },
      ];
      // Cada pórtico carga la mitad de los 6 m entre los dos: 4 y 2 kN/m² por 3 m en sus vigas
      for (const v of m.vigas) {
        if (v.id.includes("-Y")) continue;
        m.cargas.push({ tipo: "viga", id: `CM-${v.id}`, caso: "CM", viga: v.id, ejes: "global", q: [0, 0, -12] });
        m.cargas.push({ tipo: "viga", id: `Q-${v.id}`, caso: "Q", viga: v.id, ejes: "global", q: [0, 0, -6] });
      }
      m.acciones = {
        emplazamiento: { ine: "04013", municipio: "Almería", altitud: 20 },
        viento: { aspereza: "IV" },
        sismo: { terreno: "II", mu: 2 },
      };
      p.obra = { uso: "B", materiales: { perfiles: "S275", zapatas: "HA-25" }, armado: ARMADO_OBRA, terreno: TERRENO };
    },
  },

  // El edificio objetivo de 7 plantas
  edificio: {
    de: "validacion/a2/agente/edificio/proyecto.json",
    poner: (p) => {
      const m = p.modelo;
      sinCasos(m, ["Vx", "Vy"]);
      // El hueco de la escalera, el recuadro entero entre los ejes 24–30 y 15–20 (era de 4,8 × 4,2 m a
      // 40–60 cm de las vigas: los zunchos de sus bordes dejaban tiras de 15 cm de losa contra las vigas
      // de los ejes 24 y 30, y la viga secundaria del eje 27 lo cruzaba por el aire)
      for (const l of m.losas) l.huecos = [[[24, 15], [30, 15], [30, 20], [24, 20]]];
      m.vigas = m.vigas.filter((v: J) => !v.id.startsWith("VS-x27-y15-"));
      // Los pilares, dimensionados para las plantas bajas (los de 30 × 50 y 40 × 40 en toda la altura
      // salían con ν de hasta 1,4): 60 × 60 en los tramos de N1 y N2 y 50 × 50 en los de N3 y N4
      m.secciones.push({ id: "P50x50", material: "HA-30", forma: "rectangular", b: 0.5, h: 0.5 }, { id: "P60x60", material: "HA-30", forma: "rectangular", b: 0.6, h: 0.6 });
      for (const x of m.pilares)
        x.tramos = [
          { planta: "N1", seccion: "P60x60" },
          { planta: "N2", seccion: "P60x60" },
          { planta: "N3", seccion: "P50x50" },
          { planta: "N4", seccion: "P50x50" },
        ];
      // Las cargas muertas, fuera del caso del peso propio
      for (const c of m.cargas) if (c.caso === "G") c.caso = "CM";
      m.casos = [
        { id: "G", nombre: "Peso propio", pesoPropio: true, accion: { tipo: "G" } },
        { id: "CM", nombre: "Cargas muertas", accion: { tipo: "G" } },
        { id: "Q", nombre: "Sobrecarga de uso", accion: { tipo: "Q", psi: "uso-A" } },
      ];
      m.acciones = {
        emplazamiento: { ine: "41091", municipio: "Sevilla", altitud: 10 },
        viento: { zona: "A", aspereza: "IV" },
        sismo: { terreno: "II", mu: 2 },
      };
      p.obra = { uso: "A", materiales: { forjados: "HA-30", pilares: "HA-30", muros: "HA-30", zapatas: "HA-30" }, armado: ARMADO_OBRA, terreno: TERRENO };
    },
  },
};

const salida = join(RAIZ, "ejemplos", "app");
mkdirSync(salida, { recursive: true });
/** Los zunchos de los bordes que no lo tienen: 30 cm por el canto de su forjado. */
function zunchos(p: J): J {
  for (const l of [...(p.modelo.losas ?? [])]) {
    if (l.cimentacion) continue;
    const pr = proponerVigasBorde(p.modelo, l.id, 0.3, l.espesor);
    if ("error" in pr || !pr.vigas.length) continue;
    const op = operacionVigasBorde(p.modelo, pr);
    const a = op && aplicar(p, op);
    if (a && !a.ok) throw new Error(`${l.id}: ${a.errores.map((x) => x.mensaje).join(" ")}`);
    if (a) p = a.proyecto;
  }
  return p;
}

for (const [k, e] of Object.entries(EJEMPLOS)) {
  let p = leer(e.de);
  delete p.$schema;
  delete p.armado;
  e.poner(p);
  p = zunchos(p);
  writeFileSync(join(salida, `${k}.json`), serializar(p));
  console.log(`ejemplos/app/${k}.json, de ${e.de}`);
}
