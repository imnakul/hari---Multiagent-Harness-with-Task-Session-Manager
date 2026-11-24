import { useEffect, useRef, useState, type JSX } from "react";
import { Check, Copy, Loader } from "../../../shared/ui/icons";
import type { ClickupTask } from "../model/clickupApi";
import { copyClickupTask } from "../model/clickupSessionContext";

type CopyState = "idle" | "copying" | "copied" | "failed";

/**
 * Fork (L-390): copies a task's useful part (name, description, files) the way
 * a session gets it. Files are fetched first, so the button shows a spinner.
 */
export function ClickupCopyButton({
  task,
  label,
  className,
}: {
  task: Pick<ClickupTask, "id" | "name" | "markdownDescription">;
  label: string;
  className: string;
}): JSX.Element {
  const [state, setState] = useState<CopyState>("idle");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (state !== "copied" && state !== "failed") return;
    const timer = window.setTimeout(() => setState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = (): void => {
    if (state === "copying") return;
    setState("copying");
    copyClickupTask(task)
      .then(() => {
        if (alive.current) setState("copied");
      })
      .catch((error: unknown) => {
        console.warn("ClickUp: could not copy the task", error);
        if (alive.current) setState("failed");
      });
  };

  const title =
    state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy. Try again" : `${label} (name, description, files)`;
  return (
    <button
      type="button"
      aria-label={state === "copied" ? "Copied" : label}
      title={title}
      aria-busy={state === "copying"}
      onClick={(event) => {
        event.stopPropagation();
        copy();
      }}
      className={className}
    >
      {state === "copying" ? (
        <Loader aria-hidden className="size-3.5 animate-spin" />
      ) : state === "copied" ? (
        <Check aria-hidden className="size-3.5 text-emerald-400" strokeWidth={2} />
      ) : (
        <Copy aria-hidden className={`size-3.5 ${state === "failed" ? "text-red-400" : ""}`} strokeWidth={1.75} />
      )}
    </button>
  );
}
