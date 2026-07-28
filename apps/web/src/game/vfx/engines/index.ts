import type { CastEngine } from "./types";
import { chargeHandEngine } from "./chargeHand";
import { muzzleLeadEngine } from "./muzzleLead";
import { bridgedAoeEngine } from "./bridgedAoe";
import type { CastEngine as CastEngineName } from "../profiles/types";

const NONE: CastEngine = { onPhaseChange() {} };
const COMBAT_FX_ONLY: CastEngine = { onPhaseChange() {} };

export const castEngines: Record<CastEngineName, CastEngine> = {
  none: NONE,
  muzzleLead: muzzleLeadEngine,
  chargeHand: chargeHandEngine,
  bridgedAoe: bridgedAoeEngine,
  combatFxOnly: COMBAT_FX_ONLY,
};

export type { CastEngineContext, PlayerCastPose } from "./types";
export { chargeHandEngine, muzzleLeadEngine, bridgedAoeEngine };
