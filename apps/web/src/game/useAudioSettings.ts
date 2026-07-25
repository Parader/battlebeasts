import { useEffect, useState } from "react";
import {
  getAudioSettings,
  setAudioSettings,
  subscribeAudioSettings,
  type AudioSettings,
} from "./audioSettings";

export function useAudioSettings() {
  const [settings, setSettings] = useState<AudioSettings>(() => getAudioSettings());

  useEffect(() => subscribeAudioSettings(setSettings), []);

  return {
    settings,
    setMaster: (master: number) => setAudioSettings({ master }),
    setMusic: (music: number) => setAudioSettings({ music }),
    setEffects: (effects: number) => setAudioSettings({ effects }),
    setAll: (patch: Partial<AudioSettings>) => setAudioSettings(patch),
  };
}
