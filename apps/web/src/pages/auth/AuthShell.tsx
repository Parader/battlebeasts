import type { ReactNode } from "react";
import { Link } from "react-router";
import { APP_TAGLINE } from "@/brand";
import { isDesktopApp, quitDesktopApp } from "@/lib/desktop";
import { AuthBackdrop } from "./AuthBackdrop";

type Props = {
  children: ReactNode;
  /** Optional supporting line under the brand (defaults to app tagline). */
  subtitle?: string;
  /** Show a compact back link to home. */
  showBack?: boolean;
  /** Layout: form panel on the right (login) vs centered hero (home). */
  layout?: "split" | "center";
};

export function AuthShell({
  children,
  subtitle = APP_TAGLINE,
  showBack = false,
  layout = "split",
}: Props) {
  const desktop = isDesktopApp();

  return (
    <section className={`bb-auth-shell bb-auth-shell--${layout}`}>
      <AuthBackdrop />

      <div className="bb-auth-shell__content">
        {layout === "center" ? (
          <header className="bb-auth-brand">
            <p className="bb-auth-brand__tag">{subtitle}</p>
          </header>
        ) : (
          <div />
        )}

        {layout === "center" ? (
          <div className="bb-auth-center-body">{children}</div>
        ) : (
          <div className="bb-auth-panel bb-leather-frame">{children}</div>
        )}

        <div className="bb-auth-chrome">
          {showBack ? (
            <Link to="/" className="bb-auth-back">
              Back
            </Link>
          ) : (
            <span />
          )}
          {desktop ? (
            <button
              type="button"
              className="bb-btn-ink bb-auth-quit"
              onClick={() => void quitDesktopApp()}
            >
              Quit game
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
