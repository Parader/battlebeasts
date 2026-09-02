import { validateMapDoc, type MapDoc, type MapWarning } from "@battlebeasts/shared";
import { useEffect, useState } from "react";
import { describeSubjects } from "./describeEntity";
import { dismissWarning, docStore, restoreWarning, revealEntity, useEditor } from "../state/docStore";

/**
 * Live playability report.
 *
 * Debounced rather than computed inline: the impassable-gap check is O(n^2)
 * over colliders, and a gizmo drag commits an edit every frame. Running it on
 * each of those would stall the viewport on a map with a few hundred props.
 */
function useValidation(doc: MapDoc): { warnings: MapWarning[]; stale: boolean } {
  const [warnings, setWarnings] = useState<MapWarning[]>([]);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    setStale(true);
    const t = setTimeout(() => {
      setWarnings(validateMapDoc(doc));
      setStale(false);
    }, 400);
    return () => clearTimeout(t);
  }, [doc]);

  return { warnings, stale };
}

function Row({ w, doc, dismissed }: { w: MapWarning; doc: MapDoc; dismissed: boolean }) {
  const subjects = describeSubjects(doc, w.subjects);
  const isError = w.severity === "error";
  // Errors are real breakage (duplicate ids, missing spawns) -- muting one
  // would only hide a map that cannot load.
  const canMute = !isError;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 4,
        fontSize: 11,
        padding: "4px 6px",
        marginBottom: 3,
        borderRadius: 4,
        opacity: dismissed ? 0.55 : 1,
        background: dismissed ? "#2c2c2c" : isError ? "#3a1d1f" : "#3a301d",
        color: dismissed ? "#c9c9c9" : isError ? "#ffc9c9" : "#ffe1b0",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {subjects && (
          <button
            onClick={() => w.subjects[0] && revealEntity(w.subjects[0])}
            disabled={!w.subjects.length}
            title={w.subjects.length ? "Select and frame in the viewport" : undefined}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: 0,
              border: "none",
              background: "none",
              color: "inherit",
              font: "inherit",
              fontWeight: 600,
              cursor: w.subjects.length ? "pointer" : "default",
              textDecoration: w.subjects.length ? "underline dotted" : "none",
            }}
          >
            {subjects}
          </button>
        )}
        <div style={{ opacity: 0.85 }}>{w.message}</div>
      </div>

      {canMute && (
        <button
          onClick={() => (dismissed ? restoreWarning(w.key) : dismissWarning(w.key))}
          title={dismissed ? "Show this warning again" : "Dismiss — this one is intentional"}
          style={{
            flex: "0 0 auto",
            padding: "0 4px",
            border: "none",
            background: "none",
            color: "inherit",
            cursor: "pointer",
            fontSize: 12,
            lineHeight: 1.2,
          }}
        >
          {dismissed ? "↺" : "×"}
        </button>
      )}
    </div>
  );
}

export function Validation() {
  const { doc, showColliders } = useEditor();
  const { warnings, stale } = useValidation(doc);
  const [open, setOpen] = useState(true);
  const [showDismissed, setShowDismissed] = useState(false);

  const live = warnings.filter((w) => !w.suppressed);
  const dismissed = warnings.filter((w) => w.suppressed);
  const errors = live.filter((w) => w.severity === "error");
  const warns = live.filter((w) => w.severity === "warning");
  const clean = !live.length && !stale;

  return (
    <div className="section">
      <h3 style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          style={{ padding: "0 4px", fontSize: 10, background: "none", border: "none" }}
          onClick={() => setOpen(!open)}
        >
          {open ? "▾" : "▸"}
        </button>
        Playability
        <span className="spacer" />
        {stale ? (
          <span className="muted" style={{ fontSize: 10 }}>
            checking…
          </span>
        ) : (
          <span style={{ fontSize: 10, color: clean ? "var(--ok)" : errors.length ? "var(--danger)" : "var(--warn)" }}>
            {clean ? "clean" : `${errors.length} error · ${warns.length} warning`}
          </span>
        )}
      </h3>

      {open && (
        <>
          <button
            className={showColliders ? "active" : undefined}
            style={{ width: "100%", marginBottom: 6 }}
            onClick={() => docStore.setUi({ showColliders: !showColliders })}
            title="Toggle the collision overlay (C)"
          >
            {showColliders ? "Hide collision overlay" : "Show collision overlay"}
          </button>

          {clean && (
            <div className="muted" style={{ fontSize: 11 }}>
              No blocking problems found.
            </div>
          )}

          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {[...errors, ...warns].map((w) => (
              <Row key={w.key} w={w} doc={doc} dismissed={false} />
            ))}
          </div>

          {dismissed.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  className="muted"
                  style={{ flex: 1, textAlign: "left", fontSize: 11, background: "none", border: "none" }}
                  onClick={() => setShowDismissed(!showDismissed)}
                >
                  {showDismissed ? "▾" : "▸"} {dismissed.length} dismissed
                </button>
                <button
                  style={{ fontSize: 10 }}
                  onClick={() => restoreWarning()}
                  title="Show every dismissed warning again"
                >
                  restore all
                </button>
              </div>
              {showDismissed && (
                <div style={{ maxHeight: 160, overflowY: "auto", marginTop: 4 }}>
                  {dismissed.map((w) => (
                    <Row key={w.key} w={w} doc={doc} dismissed />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
