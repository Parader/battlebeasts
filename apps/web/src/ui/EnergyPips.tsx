import { ENERGY_MAX_PIPS, clampEnergy } from "@battlebeasts/shared";

/**
 * The local player's Energy, as a row of discrete pips.
 *
 * Segments rather than a continuous bar because every cost is a whole number
 * of pips: "can I afford this" is a counting question, and a percentage makes
 * you do arithmetic mid-fight to answer it. The pip being earned fills
 * partially so the bar still reads as alive between whole pips.
 */
export function EnergyPips({ energy }: { energy: number }) {
  const value = clampEnergy(energy);

  return (
    <div className="bb-energy" aria-label={`Energy ${Math.floor(value)} of ${ENERGY_MAX_PIPS}`}>
      {Array.from({ length: ENERGY_MAX_PIPS }, (_, i) => {
        // Each pip owns the interval [i, i+1); its fill is how far in we are.
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <span key={i} className="bb-energy__pip">
            {fill > 0 ? (
              <span className="bb-energy__pip-fill" style={{ width: `${fill * 100}%` }} />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
