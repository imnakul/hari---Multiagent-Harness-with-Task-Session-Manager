import type { JSX } from "react";
import { SearchableSelect, type SearchableSelectOption } from "../../../shared/ui/SearchableSelect";
import type { ClickupMember } from "../model/clickupApi";

/** Fork (L-381): multi-select of a list's members, on the app's shared dropdown. */
export function ClickupAssigneePicker({
  members,
  value,
  disabled,
  onChange,
}: {
  members: readonly ClickupMember[];
  value: readonly number[];
  disabled: boolean;
  onChange: (ids: number[]) => void;
}): JSX.Element {
  // Assignees who aren't list members (removed from the list since) stay visible so they can be unassigned.
  const strangers = value.filter((id) => !members.some((member) => member.id === id));
  const options: SearchableSelectOption[] = [
    { value: "", label: "No one" },
    ...members.map((member) => ({ value: String(member.id), label: member.username, keywords: member.email })),
    ...strangers.map((id) => ({ value: String(id), label: `Member ${id}` })),
  ];
  return (
    <SearchableSelect
      label="Assignees"
      value=""
      options={options}
      disabled={disabled}
      searchable={members.length > 7}
      searchPlaceholder="Search members"
      emptyLabel="No members to pick from"
      multiple={{
        values: value.map(String),
        summary: (count) => `${count} people`,
        onToggle: (picked) => {
          const id = Number(picked);
          if (!Number.isFinite(id)) return;
          onChange(value.includes(id) ? value.filter((entry) => entry !== id) : [...value, id]);
        },
      }}
      onChange={() => onChange([])}
    />
  );
}
