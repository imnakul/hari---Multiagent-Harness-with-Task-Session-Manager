import { ComputerHub } from "@/features/pc/ComputerHub";

// Fork (Hari, L-279, L-288): the Computer hub on its Share tab. Kept as its own
// route for monocode://share (the share sheet, the tile) and notifications.
export default function ShareScreen() {
  return <ComputerHub initial="share" />;
}
