import { useEffect } from "react";
import { loadShareBarEnabled } from "../../settings/model/settings";
import { setShareBarShortcut } from "../model/shareBar";

/** Fork (L-320): every workspace window reports the setting on boot; the backend ignores repeats. */
export function useShareBarShortcut(): void {
  useEffect(() => {
    void setShareBarShortcut(loadShareBarEnabled()).catch((reason: unknown) =>
      console.warn("Share bar: could not claim its shortcut", reason),
    );
  }, []);
}
