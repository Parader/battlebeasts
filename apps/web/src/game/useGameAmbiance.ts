import { useEffect } from "react";
import { setAmbianceTrack, type AmbianceTrackId } from "./gameAmbiance";

/**
 * Drive ambiance bed (separate from music).
 * Hub: `"village"` · Arena: `"arena"` · `null` fades out (loading / leave play).
 */
export function useGameAmbiance(track: AmbianceTrackId | null) {
  useEffect(() => {
    setAmbianceTrack(track);
    return () => setAmbianceTrack(null);
  }, [track]);
}
