import { type ReactNode, useSyncExternalStore } from "react";
import { basename } from "../../../platform/tauri/fs";
import { projectKey } from "../../../shared/lib/paths";
import { looksLikeProject } from "../../projects/model/recents";
import {
  loadTabGroupLabels,
  resolveTabGroupLabel,
  subscribeTabGroupLabels,
} from "../../workspace/model/tabGroups";
import {
  loadGridArcadeEnabled,
  subscribeGridArcadeEnabled,
} from "../../settings/model/settings";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { TerminalGridBackground } from "../../terminal/ui/TerminalGridBackground";
import { MessageSquarePlus } from "../../../shared/ui/icons";

type Props = {
  cwd: string;
  composer?: ReactNode;
  hasChatBackground?: boolean;
  /** Temporary chats (sidechat) show this instead of the work prompt. */
  notice?: { title: string; body: string };
};

export function EmptySession({ cwd, composer, hasChatBackground, notice }: Props) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const arcadeEnabled = useSyncExternalStore(
    subscribeGridArcadeEnabled,
    loadGridArcadeEnabled,
    () => true,
  );
  const getProjectLabel = () =>
    looksLikeProject(cwd)
      ? resolveTabGroupLabel(
          projectKey(cwd),
          loadTabGroupLabels(),
          basename(cwd),
        )
      : null;
  const project = useSyncExternalStore(
    subscribeTabGroupLabels,
    getProjectLabel,
    getProjectLabel,
  );
  const title = project
    ? `What should we work on in ${project}?`
    : "What should we work on?";

  return (
    <div
      ref={lockOverscroll}
      className="@container relative flex h-full min-h-0 overflow-y-auto overscroll-none"
    >
      {arcadeEnabled && !hasChatBackground ? <TerminalGridBackground /> : null}
      {composer ? (
        // Same box as the docked composer (max-w-4xl, p-1.5), so the input
        // keeps its width when the first message docks it. The spacers center
        // it when there's room. Once the pane is narrower than the composer
        // (or too short), the bottom spacer gives way so the input sits where
        // it will dock, and the title drops so it reads as the docked composer.
        <div className="pointer-events-none relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col px-1.5 pt-6 pb-1.5">
          <div aria-hidden className="flex-[1_1_0px]" />
          <div className="pointer-events-auto mb-4 shrink-0 px-2.5 @max-4xl:hidden">
            {notice ? <div className="flex flex-col items-center gap-2 text-center"><MessageSquarePlus className="size-5 text-content/40" strokeWidth={1.5}/><h1 className="text-lg text-content">{notice.title}</h1><p className="max-w-md text-[13px] leading-relaxed text-content/50">{notice.body}</p></div> : <h1
              className="truncate text-lg text-content"
              title={project ? cwd : undefined}
            >
              {title}
            </h1>}
          </div>

          <div className="pointer-events-auto w-full shrink-0">{composer}</div>
          <div aria-hidden className="flex-[1_1_1.125rem] @max-4xl:hidden" />
        </div>
      ) : null}
    </div>
  );
}
