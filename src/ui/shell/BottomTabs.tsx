import * as Tabs from "@radix-ui/react-tabs";
import { vistaStore, type Pestana } from "../../estado";

// Bottom tabs (Spec Diseno UI §2 / §3.1): la firma CYPECAD. 4 solapas tipo
// carpeta cableadas a vistaStore.pestanaActiva. Isovalores se habilita en F3 (mapa de
// color de la losa). A la derecha, badge normativo: la norma vigente es el Codigo
// Estructural (RD 470/2021), NO EHE-08 (ver MEMORY del proyecto). Etiquetas en espanol.

interface TabDef {
  valor: Pestana;
  num: string;
  etiqueta: string;
  deshabilitada?: boolean;
  title?: string;
}

const TABS: TabDef[] = [
  { valor: "entradaPilares", num: "1", etiqueta: "Entrada de pilares" },
  { valor: "entradaVigas", num: "2", etiqueta: "Entrada de vigas" },
  { valor: "resultados", num: "3", etiqueta: "Resultados" },
  {
    valor: "isovalores",
    num: "4",
    etiqueta: "Isovalores",
    title: "Mapa de color de la losa (flecha, Mx, My)",
  },
];

export function BottomTabs() {
  const pestana = vistaStore((s) => s.pestanaActiva);
  const setPestana = vistaStore((s) => s.setPestanaActiva);

  return (
    <Tabs.Root
      className="cx-tabs"
      value={pestana}
      onValueChange={(v) => setPestana(v as Pestana)}
      activationMode="manual"
    >
      <Tabs.List className="cx-tabs__list" aria-label="Modo de trabajo">
        {TABS.map((t) => (
          <Tabs.Trigger
            key={t.valor}
            value={t.valor}
            className="cx-tab"
            disabled={t.deshabilitada}
            title={t.title}
          >
            <span className="cx-tab__num">{t.num}</span>
            {t.etiqueta}
          </Tabs.Trigger>
        ))}
      </Tabs.List>

      <span className="cx-tabs__spacer" />
      <span className="cx-tabs__norma">Código Estructural · CTE DB-SE</span>
    </Tabs.Root>
  );
}
