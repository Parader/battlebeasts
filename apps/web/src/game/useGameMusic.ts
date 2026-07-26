import { useEffect } from "react";
import { setMusicTrack, type MusicTrackId } from "./gameMusic";

/**
 * Drive hub / arena looping soundtrack from play phase.
 * `null` fades music out (loading gate, leave play).
 */
export function useGameMusic(track: MusicTrackId | null) {
  useEffect(() => {
    setMusicTrack(track);
    return () => setMusicTrack(null);
  }, [track]);
}
