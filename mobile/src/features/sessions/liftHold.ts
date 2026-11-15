import { Platform } from "react-native";
import { makeMutable } from "react-native-reanimated";

/**
 * Fork (Hari, L-309): on Android, the photo picker, camera and file picker
 * open over the app and the keyboard is dropped at once, without its slide,
 * so the composer fell in one frame just before the picker covered it. While
 * this is true, keyboard lifts keep their place; once it's false again they
 * glide to wherever the keyboard is by then.
 */
export const liftHeld = makeMutable(false);

/** Long enough after a picker answers for a keyboard raised again to start. */
const SETTLE_MS = 450;
let holder = 0;

/**
 * Holds the composer where it is until the returned release is called
 * (Android only). L-310: the composer's full-screen image uses it too.
 */
export function holdLift(): () => void {
  if (Platform.OS !== "android") return () => {};
  const mine = ++holder;
  liftHeld.set(true);
  return () => {
    setTimeout(() => {
      // A later hold keeps its own.
      if (holder === mine) liftHeld.set(false);
    }, SETTLE_MS);
  };
}

/** Runs a picker with the composer held where it is (Android only). */
export async function withLiftHeld<T>(run: () => Promise<T>): Promise<T> {
  const release = holdLift();
  try {
    return await run();
  } finally {
    release();
  }
}
