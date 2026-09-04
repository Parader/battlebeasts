import { assetUrl } from "../assetUrl";

/**
 * Ability id → file under public/icons/spells (lowercase, some renamed art).
 * Missing files fall back to a tinted placeholder via onError.
 */
const SPELL_ICON_FILE: Record<string, string> = {
  bolt: "bolt.png",
  arcThread: "arcthread.png",
  soulMark: "soulmark.png",
  voidDisc: "voiddisc.png",
  runicShard: "runicshard.png",
  orbitingWisp: "orbitingwisp.png",
  astralChain: "astralchain.png",
  undergroundPulse: "undergroundpulse.png",
  slipstream: "slipstream.png",
  soulRelay: "soulrelay.png",
  crushingSigil: "crushingsigil.png",
  gravityWell: "grasp.png",
  prismLance: "icelance.png",
  soulSever: "grasp.png",
  arcBlade: "crescent.png",
  bloomingPath: "bloomingpath.png",
  shrooms: "sporeshrooms.png",
  iceLance: "icelance.png",
  crescent: "crescent.png",
  smash: "jumpslam.png",
  frostBall: "frostball.png",
  poisonDart: "poisondart.png",
  magmaOrbs: "magmaballs.png",
  surge: "surge.png",
  spiritForm: "spiritform.png",
  riftFissure: "riftfissure.png",
  handShield: "handshield.png",
  barrier: "barrier.png",
  counter: "counter.png",
  revenge: "revenge.png",
  dash: "dash.png",
  portal: "teleport.png",
  decoy: "decoy.png",
  gust: "pushback.png",
  grasp: "grasp.png",
  lifeLeech: "lifeleech.png",
  chainJump: "chainhook.png",
  spikes: "spikes.png",
  poisonCloud: "poisoncloud.png",
  silenceSweep: "silence.png",
  smokeBomb: "smokebomb.png",
  holyGround: "holyground.png",
  firewall: "firewall.png",
  fireball: "fireball.png",
  volcano: "volcano.png",
  protectionBubble: "protectionbubble.png",
  bloodRush: "bloodrush.png",
  frostMist: "frostmist.png",
  healBeam: "healbeam.png",
  groove: "groove.png",
};

export function spellIconUrl(abilityId: string): string | null {
  const file = SPELL_ICON_FILE[abilityId];
  if (!file) return null;
  return assetUrl(`icons/spells/${file}`);
}

type Props = {
  abilityId: string;
  size?: number;
  className?: string;
  /** Soften / dim (locked cards). */
  faded?: boolean;
  alt?: string;
};

export function SpellIcon({ abilityId, size = 48, className, faded, alt = "" }: Props) {
  const src = spellIconUrl(abilityId);
  const style = {
    width: size,
    height: size,
    ...(faded ? { opacity: 0.42 } : null),
  };
  if (!src) {
    return (
      <span
        className={["bb-spell-icon bb-spell-icon--missing", className].filter(Boolean).join(" ")}
        style={style}
        aria-hidden={alt ? undefined : true}
        title={alt || undefined}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      className={["bb-spell-icon", className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden={alt ? undefined : true}
    />
  );
}
