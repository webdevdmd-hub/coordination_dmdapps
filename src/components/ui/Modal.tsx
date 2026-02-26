import { createPortal } from 'react-dom';

import { DraggablePanel } from '@/components/ui/DraggablePanel';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  size?: ModalSize;
  portal?: boolean;
  overlayClassName?: string;
  panelClassName?: string;
};

type ModalHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

type ModalTextProps = {
  children: React.ReactNode;
  className?: string;
};

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-lg',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-4xl',
};

export function Modal({
  open,
  onClose,
  children,
  ariaLabel = 'Dialog',
  size = 'lg',
  portal = false,
  overlayClassName = '',
  panelClassName = '',
}: ModalProps) {
  if (!open) {
    return null;
  }

  const content = (
    <div
      data-modal-overlay="true"
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-[var(--modal-padding)] py-[var(--modal-padding)] backdrop-blur ${overlayClassName}`}
      onClick={onClose}
    >
      <DraggablePanel
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`relative w-full ${sizeClasses[size]} overflow-hidden rounded-[var(--modal-radius)] border border-border/60 bg-surface/95 p-[var(--modal-padding)] shadow-floating ${panelClassName}`}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </DraggablePanel>
    </div>
  );

  if (portal && typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }

  return content;
}

export function ModalHeader({ title, description, actions, className = '' }: ModalHeaderProps) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-[var(--modal-section-gap)] ${className}`}
    >
      <div className="min-w-0 cursor-move select-none" data-drag-handle="true">
        {typeof title === 'string' ? <ModalTitle>{title}</ModalTitle> : title}
        {description ? (
          typeof description === 'string' ? (
            <ModalDescription className="mt-[var(--modal-section-gap)]">
              {description}
            </ModalDescription>
          ) : (
            <div className="mt-[var(--modal-section-gap)]">{description}</div>
          )
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </div>
  );
}

export function ModalTitle({ children, className = '' }: ModalTextProps) {
  return (
    <h3
      className={`font-display text-[var(--modal-title-size)] leading-tight text-text ${className}`}
    >
      {children}
    </h3>
  );
}

export function ModalDescription({ children, className = '' }: ModalTextProps) {
  return <p className={`text-[var(--modal-body-size)] text-muted ${className}`}>{children}</p>;
}
