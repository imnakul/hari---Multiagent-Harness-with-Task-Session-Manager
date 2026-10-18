import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader } from "../../../shared/ui/icons";
import {
  gitDiscardFile,
  gitFileDiff,
  gitStageContents,
  gitStageFile,
  notifyGitChanged,
  subscribeGitChanged,
} from "../../../platform/tauri/fs";
import { buildUnifiedFile } from "../../source-control/model/unifiedDiff";
import { stageChunkText } from "../../files/editor/editorGit";
import { UnifiedDiffView } from "../../source-control/ui/UnifiedDiffView";
import {
  deriveGitFileDiffViewState,
  type GitFileDiffViewDerivedState,
  type LoadedGitDiff,
} from "./gitFileDiffViewState";

export {
  deriveGitFileDiffViewState,
  type GitFileDiffViewDerivedState,
  type LoadedGitDiff,
};

type Props = {
  cwd: string;
  path: string;
  kind?: "staged" | "unstaged";
  visible?: boolean;
};

export function GitFileDiffView({ cwd, path, kind = "unstaged", visible = true }: Props) {
  const [loaded, setLoaded] = useState<LoadedGitDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  const relative = useMemo(() => {
    if (!cwd || !path) return path;
    const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalizedPath = path.replace(/\\/g, "/");
    if (normalizedPath.startsWith(`${normalizedCwd}/`)) {
      return normalizedPath.slice(normalizedCwd.length + 1);
    }
    return path;
  }, [cwd, path]);

  const loadedRef = useRef<LoadedGitDiff | null>(loaded);
  loadedRef.current = loaded;

  useEffect(() => {
    if (!visible) return;
    if (!cwd || !relative) {
      setLoaded(null);
      setLoading(false);
      return;
    }

    let disposed = false;
    let generation = 0;

    const run = () => {
      const current = ++generation;
      setLoading(true);
      setError(null);
      void gitFileDiff(cwd, relative, kind)
        .then((diff) => {
          if (disposed || current !== generation) return;
          const unified =
            !diff.binary && !diff.tooLarge
              ? buildUnifiedFile(diff.original, diff.current)
              : null;
          setLoaded({
            binary: diff.binary,
            tooLarge: diff.tooLarge,
            original: diff.original,
            current: diff.current,
            unified,
          });
          setError(null);
          setLoading(false);
        })
        .catch((caught: unknown) => {
          if (disposed || current !== generation) return;
          setError(caught instanceof Error ? caught.message : String(caught));
          setLoaded(null);
          setLoading(false);
        });
    };

    run();
    let refreshFrame = 0;
    const scheduleRun = () => {
      if (refreshFrame) return;
      refreshFrame = window.requestAnimationFrame(() => {
        refreshFrame = 0;
        run();
      });
    };
    const unsub = subscribeGitChanged(scheduleRun);
    const onFocus = () => {
      if (!document.hidden) scheduleRun();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
      unsub();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [cwd, relative, kind, reloadKey, visible]);

  const state = useMemo(
    () =>
      deriveGitFileDiffViewState({
        loading,
        loaded,
        error,
        relative,
        path,
        kind,
      }),
    [loading, loaded, error, relative, path, kind],
  );

  const isStaged = kind === "staged";

  const onStageFile = useCallback(async () => {
    setBusy(true);
    try {
      await gitStageFile(cwd, relative);
      notifyGitChanged();
    } finally {
      setBusy(false);
    }
  }, [cwd, relative]);

  const onDiscardFile = useCallback(async () => {
    setBusy(true);
    try {
      await gitDiscardFile(cwd, relative);
      notifyGitChanged();
    } finally {
      setBusy(false);
    }
  }, [cwd, relative]);

  const onStageHunk = useCallback(
    async (_id: string, pos: number) => {
      const currentLoaded = loadedRef.current;
      if (!currentLoaded) return;
      const next = stageChunkText(
        currentLoaded.original,
        currentLoaded.current,
        pos,
      );
      if (next == null) return;
      setBusy(true);
      try {
        await gitStageContents(cwd, relative, next);
        notifyGitChanged();
      } finally {
        setBusy(false);
      }
    },
    [cwd, relative],
  );

  if (state.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <AlertCircle className="size-5 text-red-400" strokeWidth={1.75} />
        <p className="text-[13px] font-medium text-content">Couldn’t load diff</p>
        <p className="max-w-md text-[12px] text-content/60">{state.error}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-2 rounded border border-content/15 px-3 py-1 text-xs text-content/80 hover:bg-content/5 active:bg-content/10"
        >
          Retry
        </button>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Loader className="size-5 animate-spin text-content/40" strokeWidth={1.75} />
      </div>
    );
  }

  return (
    <UnifiedDiffView
      files={[state.model]}
      fill
      busyId={busy ? relative : null}
      focusPath={path}
      onStageFile={!isStaged ? onStageFile : undefined}
      onDiscardFile={!isStaged ? onDiscardFile : undefined}
      onStageHunk={!isStaged ? onStageHunk : undefined}
    />
  );
}
