import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: ReactNode;
  onClose?: () => void;
  /** When false, overlay click / Escape still use onClose but no Close control is shown. */
  showCloseButton?: boolean;
  wide?: boolean;
  maxWidthClass?: string;
  maxHeightClass?: string;
  footer?: ReactNode;
  children: ReactNode;
  /** Higher stacking for nested confirms / loading. */
  zClass?: string;
  ariaLabel?: string;
  role?: "dialog" | "alertdialog";
};

/** Shared modal shell — header / type / footer match arena lobby. */
export function GamePanelShell({
  title,
  subtitle,
  onClose,
  showCloseButton = true,
  wide,
  maxWidthClass,
  maxHeightClass,
  footer,
  children,
  zClass = "z-40",
  ariaLabel,
  role = "dialog",
}: Props) {
  const width = maxWidthClass ?? (wide ? "max-w-4xl" : "max-w-md");

  return (
    <div
      className={`bb-overlay-dim fixed inset-0 ${zClass} flex items-center justify-center p-4`}
      data-ui-overlay
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onClose) onClose();
      }}
      role="presentation"
    >
      <div
        role={role}
        aria-modal
        aria-label={ariaLabel ?? title}
        className={[
          "bb-parchment bb-book-panel relative z-10 flex w-full flex-col",
          width,
          maxHeightClass ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bb-panel-header shrink-0">
          <div>
            <h2 className="bb-panel-title">{title}</h2>
            {subtitle ? <div className="bb-panel-sub">{subtitle}</div> : null}
          </div>
          {onClose && showCloseButton ? (
            <button
              type="button"
              className="bb-btn-close"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          ) : null}
        </header>

        <div className="bb-panel-body min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer ? <footer className="bb-panel-footer shrink-0">{footer}</footer> : null}
      </div>
    </div>
  );
}
