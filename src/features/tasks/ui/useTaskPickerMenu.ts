import { listen } from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  insertSavedPrompt,
  promptTokenAt,
  type PromptToken,
} from "../../prompts/model/savedPrompts";
import {
  rankPickerTasks,
  TASK_TRIGGER,
  taskPickerText,
  type TaskPickerRow,
} from "../taskPicker";
import {
  loadTasks,
  peekTasks,
  TASKS_CHANGED_EVENT,
  TASKS_CHANGED_TAURI_EVENT,
  type Task,
} from "../tasks";

export type TaskPickerMenuState = {
  open: boolean;
  query: string;
  matches: TaskPickerRow[];
  /** True when there is no Todo task for this project or Personal (shows a hint). */
  empty: boolean;
  active: number;
  setActive: (index: number) => void;
  pick: (row: TaskPickerRow) => void;
};

/**
 * All tasks for the picker, loaded on the first `#` (`enabled`) and again
 * whenever tasks change in this or another window. Null until loaded; a
 * failed load keeps the picker closed and logs a warning.
 */
function usePickerTaskList(enabled: boolean): Task[] | null {
  const [tasks, setTasks] = useState<Task[] | null>(() => peekTasks());
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const refresh = (): void => setRevision((value) => value + 1);
    window.addEventListener(TASKS_CHANGED_EVENT, refresh);
    let disposed = false;
    let stop: (() => void) | undefined;
    // Outside Tauri (tests, browser preview) there is no event bridge.
    Promise.resolve()
      .then(() => listen(TASKS_CHANGED_TAURI_EVENT, refresh))
      .then((unlisten) => {
        if (typeof unlisten !== "function") return;
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
      window.removeEventListener(TASKS_CHANGED_EVENT, refresh);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadTasks()
      .then((next) => {
        if (!cancelled) setTasks(next);
      })
      .catch((error: unknown) =>
        console.warn("Could not load tasks for #:", error),
      );
    return () => {
      cancelled = true;
    };
  }, [enabled, revision]);

  return tasks;
}

/**
 * The `#` task picker for a textarea composer in project `cwd` (L-180). Same
 * contract as `useSavedPromptMenu`: the host calls `sync` after input, clicks
 * and caret moves, routes keys through `onKeyDown` first, and renders
 * `<TaskPickerMenu state={menu} />`. `apply` writes the new text and caret.
 */
export function useTaskPickerMenu({
  cwd,
  apply,
}: {
  cwd: string | null | undefined;
  apply: (text: string, cursor: number) => void;
}): TaskPickerMenuState & {
  sync: (field: HTMLTextAreaElement) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  close: () => void;
} {
  const [wanted, setWanted] = useState(false);
  const tasks = usePickerTaskList(wanted);
  const [token, setToken] = useState<PromptToken | null>(null);
  const tokenRef = useRef<PromptToken | null>(null);
  const [active, setActive] = useState(0);
  const field = useRef<HTMLTextAreaElement | null>(null);
  // Escape hides the menu for this `#` until a new one is typed.
  const dismissedAt = useRef<number | null>(null);

  const matches = useMemo(
    () => (token && tasks ? rankPickerTasks(tasks, token.query, cwd) : []),
    [cwd, tasks, token],
  );
  const empty = useMemo(
    () => tasks !== null && rankPickerTasks(tasks, "", cwd, 1).length === 0,
    [cwd, tasks],
  );
  // A bare `#` with no tasks shows the hint; a query that matches nothing
  // closes the menu, so `#123`, `#fff` and `# Heading` read as normal text.
  const open =
    token !== null &&
    tasks !== null &&
    (matches.length > 0 || (empty && token.query === ""));

  const sync = useCallback((element: HTMLTextAreaElement) => {
    field.current = element;
    const next =
      element.selectionStart === element.selectionEnd
        ? promptTokenAt(
            element.value,
            element.selectionStart ?? 0,
            TASK_TRIGGER,
          )
        : null;
    if (next?.start !== dismissedAt.current) dismissedAt.current = null;
    const shown = next && dismissedAt.current === null ? next : null;
    if (shown) setWanted(true);
    const current = tokenRef.current;
    if (current?.query !== shown?.query || current?.start !== shown?.start)
      setActive(0);
    tokenRef.current = shown;
    setToken(shown);
  }, []);

  const close = useCallback(() => {
    tokenRef.current = null;
    setToken(null);
  }, []);

  const pick = useCallback(
    (row: TaskPickerRow) => {
      const element = field.current;
      if (!element || !token) return;
      const result = insertSavedPrompt(
        element.value,
        token,
        taskPickerText(row.task),
      );
      tokenRef.current = null;
      setToken(null);
      apply(result.text, result.cursor);
    },
    [apply, token],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || event.nativeEvent.isComposing) return false;
    const count = matches.length;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && count) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + count) % count);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissedAt.current = token?.start ?? null;
      tokenRef.current = null;
      setToken(null);
      return true;
    }
    if (
      (event.key === "Enter" || event.key === "Tab") &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      count
    ) {
      event.preventDefault();
      pick(matches[Math.min(active, count - 1)]!);
      return true;
    }
    return false;
  };

  return {
    open,
    query: token?.query ?? "",
    matches,
    empty,
    active,
    setActive,
    pick,
    sync,
    onKeyDown,
    close,
  };
}
