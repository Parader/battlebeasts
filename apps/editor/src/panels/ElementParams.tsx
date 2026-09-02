import type {
  ElementTypeDef,
  MapElementParams,
  MapElementParamValue,
} from "@battlebeasts/shared";

/**
 * Renders an element's parameter form straight from its catalog spec.
 *
 * Shared by the tool options (configuring the next placement) and the
 * inspector (editing an existing one), so a new element type gets both
 * surfaces for free.
 */
export function ParamFields({
  def,
  params,
  onChange,
}: {
  def: ElementTypeDef;
  params: MapElementParams;
  onChange: (key: string, value: MapElementParamValue) => void;
}) {
  if (!def.params.length) {
    return (
      <div className="muted" style={{ fontSize: 11 }}>
        No parameters.
      </div>
    );
  }

  return (
    <>
      {def.params.map((spec) => {
        const value = params[spec.key] ?? spec.default;

        if (spec.kind === "enum") {
          return (
            <div className="row" key={spec.key}>
              <label>{spec.label}</label>
              <select value={String(value)} onChange={(e) => onChange(spec.key, e.target.value)}>
                {spec.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        if (spec.kind === "boolean") {
          return (
            <div className="row" key={spec.key}>
              <label>{spec.label}</label>
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => onChange(spec.key, e.target.checked)}
              />
            </div>
          );
        }

        if (spec.kind === "number") {
          return (
            <div className="row" key={spec.key}>
              <label>{spec.label}</label>
              <input
                type="number"
                step={spec.step ?? 1}
                value={Number(value)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  onChange(spec.key, spec.min != null ? Math.max(spec.min, n) : n);
                }}
              />
            </div>
          );
        }

        return (
          <div className="row" key={spec.key}>
            <label>{spec.label}</label>
            <input value={String(value)} onChange={(e) => onChange(spec.key, e.target.value)} />
          </div>
        );
      })}
    </>
  );
}
