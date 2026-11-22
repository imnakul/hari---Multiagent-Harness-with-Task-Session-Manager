import type { JSX } from "react";
import { ChevronDown, Flag } from "../../../shared/ui/icons";
import type { ClickupCustomField, ClickupMember, ClickupTask } from "../model/clickupApi";
import { PRIORITY_INFO, readableTextOn, type ClickupGroup, type ClickupGroupBy } from "../model/clickupViewState";

/** Fork (L-381): small pieces shared by the ClickUp List, Table and Board. */

const MAX_AVATARS = 3;

export function ClickupAvatars({ members }: { members: readonly ClickupMember[] }): JSX.Element | null {
  const shown = members.slice(0, MAX_AVATARS);
  const extra = members.length - shown.length;
  if (shown.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center -space-x-1">
      {shown.map((member) => (
        <span
          key={member.id}
          title={member.username}
          className="grid size-5 place-items-center rounded-full border border-stroke bg-content/15 text-[9px] text-content/80"
          style={member.color ? { backgroundColor: member.color, color: readableTextOn(member.color) } : undefined}
        >
          {member.initials || member.username.slice(0, 2).toUpperCase()}
        </span>
      ))}
      {extra > 0 ? <span className="pl-1.5 text-[10.5px] text-content/55">+{extra}</span> : null}
    </span>
  );
}

export function ClickupPriorityFlag({
  priority,
  withLabel = false,
}: {
  priority: ClickupTask["priority"];
  withLabel?: boolean;
}): JSX.Element | null {
  if (priority === null) return null;
  const info = PRIORITY_INFO[priority];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-content/70" title={`${info.label} priority`}>
      <Flag aria-hidden className="size-3.5" style={{ color: info.color }} strokeWidth={2} />
      {withLabel ? info.label : <span className="sr-only">{info.label} priority</span>}
    </span>
  );
}

/** ClickUp's status pill: the status colour as the fill, upper-case name. */
export function ClickupStatusPill({ name, color }: { name: string; color: string | null }): JSX.Element {
  return (
    <span
      className="inline-flex h-5 max-w-full items-center rounded px-1.5 text-[10.5px] font-semibold uppercase tracking-wide"
      style={color ? { backgroundColor: color, color: readableTextOn(color) } : undefined}
    >
      <span className="truncate">{name}</span>
    </span>
  );
}

/** A custom field value; drop-down options keep their colour as a filled chip (Severity S2/S3). */
export function ClickupFieldValue({ field, now }: { field: ClickupCustomField; now: number }): JSX.Element {
  const text = field.type === "date" ? shortDate(Number(field.text), now) : field.text;
  if (field.color) {
    return (
      <span
        className="inline-flex h-5 max-w-full items-center rounded px-1.5 text-[11px] font-medium"
        style={{ backgroundColor: field.color, color: readableTextOn(field.color) }}
        title={`${field.name}: ${text}`}
      >
        <span className="truncate">{text}</span>
      </span>
    );
  }
  return (
    <span className="block truncate text-content/75" title={`${field.name}: ${text}`}>
      {text}
    </span>
  );
}

/** "Today", "Yesterday", "3 Oct", or "3 Oct 2025" outside this year. */
export function shortDate(ms: number | null, now: number): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return "";
  const date = new Date(ms);
  const today = new Date(now);
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(date) - day(today)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  if (days === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** The group's name as ClickUp shows it: a status pill, a priority flag, or plain text. */
export function ClickupGroupLabel({ group, groupBy }: { group: ClickupGroup; groupBy: ClickupGroupBy }): JSX.Element {
  if (groupBy === "status") return <ClickupStatusPill name={group.label} color={group.color} />;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {groupBy === "priority" ? (
        <Flag aria-hidden className="size-3.5 shrink-0" style={{ color: group.color ?? undefined }} strokeWidth={2} />
      ) : null}
      <span className="min-w-0 truncate">{group.label}</span>
    </span>
  );
}

/** Collapsible group header for List and Table. */
export function ClickupGroupHeader({
  group,
  groupBy,
  collapsed,
  onToggle,
}: {
  group: ClickupGroup;
  groupBy: ClickupGroupBy;
  collapsed: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-clickup-group={group.key}
      aria-expanded={!collapsed}
      aria-label={`${group.label}, ${group.tasks.length} tasks`}
      onClick={onToggle}
      className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-[12px] font-medium text-content/80 transition-colors duration-100 hover:bg-content/5 hover:text-content"
    >
      <ChevronDown
        aria-hidden
        className={`size-3 shrink-0 text-content/45 transition-transform duration-150 motion-reduce:transition-none ${collapsed ? "-rotate-90" : ""}`}
      />
      <ClickupGroupLabel group={group} groupBy={groupBy} />
      <span className="shrink-0 tabular-nums text-content/45">{group.tasks.length}</span>
    </button>
  );
}
