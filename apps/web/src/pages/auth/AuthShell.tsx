import type { ReactNode } from "react";
import { Link } from "react-router";
import { APP_DISPLAY_NAME, APP_TAGLINE } from "@/brand";
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
  return (
    <section className={`bb-auth-shell bb-auth-shell--${layout}`}>
      <AuthBackdrop />

      <div className="bb-auth-shell__content">
        <header className="bb-auth-brand">
          <p className="bb-auth-brand__eyebrow">Online arena</p>
          <h1 className="bb-auth-brand__title">{APP_DISPLAY_NAME}</h1>
          <p className="bb-auth-brand__tag">{subtitle}</p>
          <div className="bb-brass-rule bb-auth-brand__rule" />
        </header>

        {layout === "center" ? (
          <div className="bb-auth-center-body">{children}</div>
        ) : (
          <div className="bb-auth-panel bb-leather-frame">{children}</div>
        )}

        {showBack && (
          <Link to="/" className="bb-auth-back">
            Back
          </Link>
        )}
      </div>
    </section>
  );
}
