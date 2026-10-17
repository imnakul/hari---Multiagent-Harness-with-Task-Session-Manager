import { useRef, useState, useSyncExternalStore, type JSX } from "react";
import { projectName } from "../../../shared/lib/paths";
import { Popover } from "../../../shared/ui/Popover";
import { Bell, ExternalLink, X } from "../../../shared/ui/icons";
import { HARNESS_TITLE } from "../../sessions/model/session";
import {
  CENTER_KIND_LABEL,
  OPEN_NOTIFICATION_SESSION_EVENT,
  centerNotificationsSnapshot,
  dismissAllCenterNotifications,
  dismissCenterNotification,
  markCenterNotificationsRead,
  subscribeCenterNotifications,
  type CenterNotification,
} from "../model/notificationCenter";

const BUTTON =
  "flex w-10 items-center justify-center text-content/60 transition-colors hover:bg-content/10 hover:text-content";

export function relativeAge(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(at).toLocaleDateString();
}

function NotificationCard({
  item,
  expanded,
  onToggle,
  onOpenChat,
}: {
  item: CenterNotification;
  expanded: boolean;
  onToggle: () => void;
  onOpenChat: (sessionId: string) => void;
}): JSX.Element {
  const failed = item.kind === "automationFailed";
  const meta = [
    item.cwd ? projectName(item.cwd) : null,
    item.harness ? HARNESS_TITLE[item.harness] : null,
    item.model || null,
  ].filter((part): part is string => !!part);
  return (
    <li className="group relative">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="w-full rounded-lg px-2.5 py-2 pr-8 text-left transition-colors duration-100 hover:bg-content/[0.06] focus-visible:bg-content/[0.06] focus-visible:outline-none"
      >
        <span className="flex items-center gap-1.5 text-[11px]">
          <span className={failed ? "font-medium text-red-400" : "font-medium text-content/55"}>
            {CENTER_KIND_LABEL[item.kind]}
          </span>
          {!item.read ? (
            <span aria-label="Unread" className="size-1.5 rounded-full bg-accent" />
          ) : null}
          <span className="ml-auto shrink-0 text-content/40">{relativeAge(item.at)}</span>
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-content">{item.title}</span>
        {meta.length > 0 ? (
          <span className="mt-0.5 block truncate text-[11px] text-content/45">
            {meta.join(" · ")}
          </span>
        ) : null}
        {expanded && item.body ? (
          <span className="mt-1.5 block whitespace-pre-wrap break-words text-[12px] text-content/75">
            {item.body}
          </span>
        ) : null}
      </button>
      {expanded && item.sessionId ? (
        <div className="px-2.5 pb-2">
          <button
            type="button"
            onClick={() => item.sessionId && onOpenChat(item.sessionId)}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-content/10 px-2 text-[11.5px] text-content/75 transition-colors duration-100 hover:bg-content/10 hover:text-content active:scale-[0.97]"
          >
            <ExternalLink className="size-3" strokeWidth={1.75} />
            Open chat
          </button>
        </div>
      ) : null}
      <button
        type="button"
        title="Dismiss"
        aria-label={`Dismiss ${item.title}`}
        onClick={() => dismissCenterNotification(item.id)}
        className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-md text-content/45 opacity-0 transition-opacity duration-100 hover:bg-content/10 hover:text-content focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </li>
  );
}

/**
 * Title-bar bell with an unread dot and a glass panel listing the in-app
 * notification history (fork-only, L-91). Opening the panel marks entries read.
 */
export function NotificationBell(): JSX.Element {
  const items = useSyncExternalStore(
    subscribeCenterNotifications,
    centerNotificationsSnapshot,
    centerNotificationsSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const unread = items.some((item) => !item.read);

  const close = () => {
    setOpen(false);
    setExpandedId(null);
    markCenterNotificationsRead();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        title="Notifications"
        aria-label={unread ? "Notifications, unread" : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tauri-drag-region="false"
        onClick={() => (open ? close() : setOpen(true))}
        className={`relative ${BUTTON}`}
      >
        <Bell className="size-3.5" strokeWidth={1.75} />
        {unread ? (
          <span
            data-testid="notification-dot"
            className="absolute right-[13px] top-[calc(50%-8px)] size-1.5 rounded-full bg-accent"
          />
        ) : null}
      </button>
      {open ? (
        <Popover
          anchor={trigger}
          side="bottom"
          align="end"
          gap={4}
          width={340}
          maxHeight={480}
          role="dialog"
          aria-label="Notifications"
          onDismiss={close}
          className="flex flex-col overflow-hidden"
        >
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-stroke pl-3 pr-1.5">
            <span className="text-[12.5px] font-medium text-content">Notifications</span>
            {items.length > 0 ? (
              <button
                type="button"
                title="Dismiss all"
                aria-label="Dismiss all notifications"
                onClick={() => {
                  dismissAllCenterNotifications();
                  setExpandedId(null);
                }}
                className="ml-auto grid size-6 place-items-center rounded-md text-content/55 transition-colors duration-100 hover:bg-content/10 hover:text-content active:scale-[0.95]"
              >
                <X className="size-3.5" strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12px] text-content/45">No notifications</p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1">
              {items.map((item) => (
                <NotificationCard
                  key={item.id}
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId((id) => (id === item.id ? null : item.id))}
                  onOpenChat={(sessionId) => {
                    close();
                    window.dispatchEvent(
                      new CustomEvent(OPEN_NOTIFICATION_SESSION_EVENT, { detail: sessionId }),
                    );
                  }}
                />
              ))}
            </ul>
          )}
        </Popover>
      ) : null}
    </>
  );
}
