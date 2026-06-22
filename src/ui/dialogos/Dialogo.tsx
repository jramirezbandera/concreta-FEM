import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import "./dialogos.css";

// Dialogo (Spec Diseno UI §5): envoltorio fino y controlado de Radix Dialog.
// Estructura header (titulo + cerrar) / body (scroll interno) / footer opcional.
// Estilado solo con tokens via .cx-dialog__*. Modal y accesible: incluye
// Dialog.Description (oculta) para evitar warnings de Radix por falta de
// descripcion accesible. La logica concreta (Grupos/Plantas, etc.) vive en los
// dialogos que envuelven a este.
export interface DialogoProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  titulo: string;
  children: ReactNode;
  pie?: ReactNode;
}

export function Dialogo({ open, onOpenChange, titulo, children, pie }: DialogoProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="cx-dialog__overlay" />
        <Dialog.Content className="cx-dialog__content">
          <div className="cx-dialog__header">
            <Dialog.Title className="cx-dialog__title">{titulo}</Dialog.Title>
            {/* Descripcion accesible no visible: satisface a11y de Radix sin
                ocupar espacio. El contenido ya explica el dialogo. */}
            <Dialog.Description className="cx-sr-only">{titulo}</Dialog.Description>
            <Dialog.Close className="cx-dialog__close" aria-label="Cerrar">
              ×
            </Dialog.Close>
          </div>
          <div className="cx-dialog__body">{children}</div>
          {pie ? <div className="cx-dialog__footer">{pie}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
