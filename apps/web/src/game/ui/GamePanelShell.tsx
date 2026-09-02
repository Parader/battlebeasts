import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: ReactNode;
  onClose?: () => void;
  /** When false, overlay click / Escape still use onClose but no Close control is shown. */
  showCloseButton?: boolean;
  /** Extra content inline with the title (e.g. talent points). */
  titleAside?: ReactNode;
  /** Extra controls in the header, rendered left of the close button. */
  headerActions?: ReactNode;
  /**
   * Render title / aside / actions / close floating above the panel box
   * instead of inside the parchment chrome.
   */
  floatingHeader?: boolean;
  /** Stretch the panel to nearly fill the viewport (talent constellation). */
  fullBleed?: boolean;
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
  titleAside,
  headerActions,
  floatingHeader = false,
  fullBleed = false,
  wide,
  maxWidthClass,
  maxHeightClass,
  footer,
  children,
  zClass = "z-40",
  ariaLabel,
  role = "dialog",
}: Props) {
  const width = fullBleed
    ? "max-w-none"
    : (maxWidthClass ?? (wide ? "max-w-4xl" : "max-w-md"));
  const height = fullBleed
    ? "h-[min(100dvh-1rem,100%)] max-h-[min(100dvh-1rem,100%)]"
    : maxHeightClass;

  const header = (
    <header
      className={[
        "bb-panel-header shrink-0",
        floatingHeader ? "bb-panel-header--float" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="bb-panel-header__lead">
        <div className="bb-panel-title-row">
          <h2 className="bb-panel-title">{title}</h2>
          {titleAside}
        </div>
        {subtitle ? <div className="bb-panel-sub">{subtitle}</div> : null}
      </div>
      {headerActions || (onClose && showCloseButton) ? (
        <div className="bb-panel-header__actions">
          {headerActions}
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
        </div>
      ) : null}
    </header>
  );

  return (
    <div
      className={`bb-overlay-dim fixed inset-0 ${zClass} flex items-center justify-center ${fullBleed ? "p-2" : "p-4"}`}
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
        className={[
          "relative z-10 flex w-full flex-col",
          width,
          floatingHeader ? "bb-panel-stack" : "",
          fullBleed ? "bb-panel-stack--constel" : "",
          floatingHeader || fullBleed ? height ?? "" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        {floatingHeader ? header : null}
        <div
          role={role}
          aria-modal
          aria-label={ariaLabel ?? title}
          className={[
            "bb-parchment bb-book-panel relative flex w-full flex-col min-h-0",
            floatingHeader ? "bb-book-panel--under-float flex-1" : "",
            fullBleed ? "bb-book-panel--constel flex-1" : "",
            floatingHeader || fullBleed ? "" : height ?? "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {!floatingHeader ? header : null}

          <div className="bb-panel-body min-h-0 flex-1 overflow-y-auto">{children}</div>

          {footer ? <footer className="bb-panel-footer shrink-0">{footer}</footer> : null}
        </div>
      </div>
    </div>
  );
}
