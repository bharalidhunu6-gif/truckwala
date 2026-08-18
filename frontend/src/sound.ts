import { useCallback, useEffect, useRef } from "react";
import { createAudioPlayer, AudioPlayer } from "expo-audio";

const NOTIFICATION_SOUND = require("../assets/notification.mp3");

export function useNotificationSound() {
  const playerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    try {
      playerRef.current = createAudioPlayer(NOTIFICATION_SOUND);
    } catch (e) {
      console.log("[sound] init error", e);
    }

    return () => {
      try {
        playerRef.current?.remove();
      } catch {}
    };
  }, []);

 return useCallback(() => {
  try {
    const player = playerRef.current;

    if (!player) return;

    player.seekTo(0);
    player.play();
  } catch (e) {
    console.log("[sound] play error", e);
  }
}, []);
}