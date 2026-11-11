import { registerHarness, type HarnessAdapter } from "../../core/registry";
import { refreshAntigravityCliCatalog } from "./antigravityCliCatalog";
import { runAntigravityCliHelperPrompt } from "./antigravityCliHelper";
import {
  bindCliSession,
  forgetCliSession,
  sendCliTurn,
  stopCliSession,
} from "./antigravityCli";

export const antigravityCliAdapter: HarnessAdapter = {
  id: "antigravity-cli",
  live: true,
  canSteer: false,
  sendTurn: sendCliTurn,
  steerTurn: async (): Promise<void> => {
    throw new Error(
      "Antigravity CLI does not support steering in headless mode; queue a follow-up instead.",
    );
  },
  respondApproval: (): never => {
    throw new Error(
      "Antigravity CLI headless mode cannot answer interactive approvals.",
    );
  },
  cancelTurn: stopCliSession,
  stopSession: stopCliSession,
  forgetSession: forgetCliSession,
  bindSession: bindCliSession,
  refreshCatalog: refreshAntigravityCliCatalog,
  runHelperPrompt: runAntigravityCliHelperPrompt,
  commands: {
    discover: async () => [
      {
        name: "usage",
        invocation: "usage",
        description: "Read the CLI's model quota report",
        source: "antigravity-cli",
        aliases: ["quota"],
      },
      {
        name: "models",
        invocation: "models",
        description: "List installed CLI models",
        source: "antigravity-cli",
      },
      {
        name: "credits",
        invocation: "credits",
        description: "Read the CLI's account credit report",
        source: "antigravity-cli",
      },
    ],
  },
};

let registered = false;
export function ensureAntigravityCliRegistered(): void {
  if (registered) return;
  registerHarness(antigravityCliAdapter);
  registered = true;
}
