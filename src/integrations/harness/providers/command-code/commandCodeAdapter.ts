import {
  bindCommandCodeSession,
  cancelCommandCodeTurn,
  forgetCommandCodeSession,
  respondCommandCodeApproval,
  sendCommandCodeTurn,
  steerCommandCodeTurn,
  stopCommandCodeSession,
} from "./commandCode";
import { refreshCommandCodeCatalog } from "./commandCodeCatalog";
import { runCommandCodeHelperPrompt } from "./commandCodeHelper";
import { registerHarness, type HarnessAdapter } from "../../core/registry";

/** Fork (L-255): Command Code (`cmdc acp`) as a chat provider and AI helper. */
export const commandCodeAdapter: HarnessAdapter = {
  id: "command-code",
  live: true,
  sendTurn: sendCommandCodeTurn,
  steerTurn: steerCommandCodeTurn,
  cancelTurn: cancelCommandCodeTurn,
  respondApproval: respondCommandCodeApproval,
  stopSession: stopCommandCodeSession,
  forgetSession: forgetCommandCodeSession,
  bindSession: bindCommandCodeSession,
  refreshCatalog: refreshCommandCodeCatalog,
  runHelperPrompt: runCommandCodeHelperPrompt,
};

let registered = false;

export function ensureCommandCodeRegistered(): void {
  if (registered) return;
  registerHarness(commandCodeAdapter);
  registered = true;
}
