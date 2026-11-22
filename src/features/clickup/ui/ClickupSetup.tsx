import { useState, type JSX } from "react";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { ClickupError, clickupApi } from "../model/clickupApi";
import {
  MAX_CLICKUP_LISTS,
  parseClickupListRef,
  saveClickupConfig,
  type ClickupConfig,
} from "../model/clickupConfig";

const FIELD =
  "h-8 w-full rounded-md border border-stroke bg-content/[0.04] px-2.5 text-[13px] text-content outline-none transition-colors placeholder:text-content/35 focus-visible:border-accent disabled:opacity-50";
const BUTTON =
  "inline-flex h-8 items-center rounded-md bg-content/10 px-3 text-[13px] text-content transition-colors hover:bg-content/15 active:scale-96 disabled:opacity-50";
const QUIET =
  "inline-flex h-7 items-center rounded-md px-2 text-[12px] text-content/70 transition-colors hover:bg-content/10 hover:text-content active:scale-96";

function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function connectErrorText(error: unknown): string {
  if (error instanceof ClickupError) {
    if (error.kind === "auth") return "ClickUp didn't accept this token.";
    if (error.kind === "rateLimited") return `ClickUp is busy. Try again in ${error.retryAfterSeconds ?? 60} s.`;
  }
  return "Couldn't reach ClickUp.";
}

/**
 * Fork (L-381): connect with a personal token, pick the project ClickUp is tied
 * to, and add lists by link or ID. The token goes to Rust once and is kept in
 * the OS keychain; nothing here stores it.
 */
export function ClickupSetup({
  connected,
  config,
  projects,
  currentProject,
  onConnected,
  onDisconnected,
  onDone,
}: {
  connected: boolean;
  config: ClickupConfig;
  projects: readonly string[];
  currentProject: string | null;
  onConnected: () => void;
  onDisconnected: () => void;
  onDone: () => void;
}): JSX.Element {
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [listInput, setListInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const project = config.projectPath ?? currentProject ?? projects[0] ?? "";

  const connect = async (): Promise<void> => {
    if (connecting) return;
    setConnecting(true);
    setConnectError(null);
    try {
      await clickupApi.setToken(token);
      setToken("");
      onConnected();
    } catch (error) {
      setConnectError(connectErrorText(error));
    } finally {
      setConnecting(false);
    }
  };

  const addList = async (): Promise<void> => {
    if (adding) return;
    const id = parseClickupListRef(listInput);
    if (!id) {
      setListError("That isn't a ClickUp list link or ID.");
      return;
    }
    if (config.lists.some((list) => list.id === id)) {
      setListError("That list is already added.");
      return;
    }
    if (config.lists.length >= MAX_CLICKUP_LISTS) {
      setListError(`At most ${MAX_CLICKUP_LISTS} lists.`);
      return;
    }
    setAdding(true);
    setListError(null);
    try {
      const info = await clickupApi.list(id);
      saveClickupConfig({
        projectPath: config.projectPath ?? (project || null),
        lists: [...config.lists, { id, name: info.name || id }],
      });
      setListInput("");
    } catch (error) {
      setListError(
        error instanceof ClickupError && error.kind === "notFound"
          ? "ClickUp can't find that list, or your token can't see it."
          : connectErrorText(error),
      );
    } finally {
      setAdding(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    try {
      await clickupApi.disconnect();
    } catch {
      setConnectError("Couldn't remove the token. Try again.");
      return;
    }
    onDisconnected();
  };

  if (!connected) {
    return (
      <form
        className="mx-auto flex w-full max-w-md flex-col gap-3 p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <h2 className="text-[15px] font-medium text-content">Connect ClickUp</h2>
        <label className="flex flex-col gap-1.5 text-[12px] text-content/70">
          Personal API token
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            maxLength={200}
            disabled={connecting}
            onChange={(event) => setToken(event.target.value)}
            className={FIELD}
          />
        </label>
        <p className="text-[12px] text-content/50">
          In ClickUp, open Settings › Apps and generate a personal token. MonoCode keeps it in Windows Credential
          Manager on this computer.
        </p>
        {connectError ? (
          <p role="alert" className="text-[12.5px] text-red-400">
            {connectError}
          </p>
        ) : null}
        <div>
          <button type="submit" disabled={connecting || !token.trim()} className={BUTTON}>
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <h2 className="text-[15px] font-medium text-content">ClickUp settings</h2>
      <div className="flex flex-col gap-1.5 text-[12px] text-content/70">
        Project
        <SearchableSelect
          label="Project"
          value={project}
          placeholder="Choose a project"
          searchPlaceholder="Search projects"
          options={[
            ...(project && !projects.includes(project) ? [project] : []),
            ...projects,
          ].map((path) => ({ value: path, label: projectName(path), keywords: path }))}
          onChange={(path) => saveClickupConfig({ projectPath: path || null, lists: config.lists })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-content/70">Lists</span>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void addList();
          }}
        >
          <input
            aria-label="List link or ID"
            value={listInput}
            placeholder="Paste a list link or ID"
            disabled={adding}
            onChange={(event) => setListInput(event.target.value)}
            className={FIELD}
          />
          <button type="submit" disabled={adding || !listInput.trim()} className={BUTTON}>
            {adding ? "Adding…" : "Add"}
          </button>
        </form>
        {listError ? (
          <p role="alert" className="text-[12.5px] text-red-400">
            {listError}
          </p>
        ) : null}
        <ul className="flex flex-col">
          {config.lists.map((list) => (
            <li key={list.id} className="flex h-8 items-center gap-2 text-[13px] text-content/90">
              <span className="min-w-0 flex-1 truncate">{list.name}</span>
              <button
                type="button"
                className={QUIET}
                onClick={() =>
                  saveClickupConfig({
                    projectPath: config.projectPath,
                    lists: config.lists.filter((candidate) => candidate.id !== list.id),
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
      {connectError ? (
        <p role="alert" className="text-[12.5px] text-red-400">
          {connectError}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <button type="button" className={BUTTON} onClick={onDone}>
          Done
        </button>
        <button type="button" className={QUIET} onClick={() => void disconnect()}>
          Disconnect
        </button>
      </div>
    </div>
  );
}
