/**
 * Simple in-app notification sound. We synthesize a short WAV in-memory
 * (no external asset needed) and play it via expo-audio. Fires
 *   - "new" — a rising two-tone chirp (used when a new event is detected)
 *   - "ok"  — a single clean beep (used for confirmations)
 */
import { useEffect, useRef } from "react";
import { createAudioPlayer, AudioPlayer } from "expo-audio";
import { Platform } from "react-native";

function makeToneWav(frequencies: number[], durMs = 250, sampleRate = 22050): string {
  const total = Math.floor((sampleRate * durMs) / 1000);
  const numSamples = total * frequencies.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let idx = 44;
  frequencies.forEach((freq) => {
    for (let i = 0; i < total; i++) {
      const t = i / sampleRate;
      const envelope = Math.min(1, i / 300) * Math.min(1, (total - i) / 800);
      const sample = Math.sin(2 * Math.PI * freq * t) * envelope * 0.5;
      view.setInt16(idx, Math.max(-1, Math.min(1, sample)) * 32767, true);
      idx += 2;
    }
  });

  // Convert to base64 data URI
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(bytes).toString("base64");
  return `data:audio/wav;base64,${b64}`;
}

const NEW_TONE = makeToneWav([660, 990], 180);
const OK_TONE = makeToneWav([880], 200);

/** Returns a stable player.play("new" | "ok") function. Safe on web too. */
export function useNotificationSound() {
  const newRef = useRef<AudioPlayer | null>(null);
  const okRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    try {
      newRef.current = createAudioPlayer({ uri: NEW_TONE });
      okRef.current = createAudioPlayer({ uri: OK_TONE });
    } catch (e) {
      // ignore; e.g. web without user gesture
    }
    return () => {
      try { newRef.current?.remove(); } catch {}
      try { okRef.current?.remove(); } catch {}
    };
  }, []);

  return (kind: "new" | "ok" = "new") => {
    try {
      const p = kind === "ok" ? okRef.current : newRef.current;
      if (!p) return;
      p.seekTo(0);
      p.play();
    } catch (e) {
      if (Platform.OS !== "web") console.log("[sound] play err", e);
    }
  };
}
