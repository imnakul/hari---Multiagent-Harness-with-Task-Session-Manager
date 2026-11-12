import { homeDir } from "../../../../platform/tauri/fs";
import {
  setHarnessModels,
  type AgentModel,
} from "../../../../features/sessions/model/models";
import { AcpClient } from "../../core/acp";
import {
  killChild,
  resolveCommandCodeBinary,
  spawnChild,
  unwatchChild,
  watchChild,
} from "../../core/child";
import {
  commandCodeSessionId,
  modelsFromCommandCodeSession,
} from "./commandCodeProtocol";

const PROBE_ID = "monocode-command-code-probe";
const DISCOVERY_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 20_000;

let inflight: Promise<void> | null = null;

/** Fork (L-255): read the account's model list from a throwaway ACP session. */
export function refreshCommandCodeCatalog(): Promise<void> {
  if (inflight) return inflight;
  inflight = discoverCommandCodeModels()
    .then((models) => {
      if (models.length > 0) setHarnessModels("command-code", models);
    })
    .catch((error: unknown) => {
      console.debug("[monocode] command-code catalog", error);
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function discoverCommandCodeModels(
  workingDirectory?: string,
): Promise<AgentModel[]> {
  const { path } = await resolveCommandCodeBinary();
  const cwd = workingDirectory ?? (await homeDir());
  const probeId = `${PROBE_ID}-${crypto.randomUUID()}`;
  const acp = new AcpClient(probeId, {
    onRequest: (id, method) => {
      void acp
        .respondError(id, {
          code: -32601,
          message: `Method not found: ${method}`,
        })
        .catch(() => undefined);
    },
  });

  const stop = async () => {
    acp.close();
    unwatchChild(probeId);
    await killChild(probeId).catch(() => undefined);
  };

  watchChild(
    probeId,
    (line) => acp.pushLine(line),
    () => acp.close(new Error("Command Code catalog probe exited")),
  );

  try {
    await spawnChild(probeId, path, ["acp"], cwd, undefined, "command-code");
    return await withTimeout(
      DISCOVERY_TIMEOUT_MS,
      async () => {
        await acp.request(
          "initialize",
          {
            protocolVersion: 1,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false,
            },
            clientInfo: { name: "monocode", version: "0.1.0" },
          },
          REQUEST_TIMEOUT_MS,
        );
        const created = await acp.request<unknown>(
          "session/new",
          { cwd, mcpServers: [] },
          REQUEST_TIMEOUT_MS,
        );
        // The CLI advertises `session/close`; tidy the probe session so it
        // does not linger in Command Code's own session list.
        const sessionId = commandCodeSessionId(created);
        if (sessionId) {
          await acp
            .request("session/close", { sessionId }, REQUEST_TIMEOUT_MS)
            .catch(() => undefined);
        }
        return modelsFromCommandCodeSession(created);
      },
      () => {
        void stop();
      },
    );
  } finally {
    await stop();
  }
}

function withTimeout<T>(
  ms: number,
  run: () => Promise<T>,
  onTimeout: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error("Command Code model discovery timed out"));
    }, ms);
    void run().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
