import type { ClickupListInfo, ClickupMember, ClickupTask } from "./clickupApi";

/** Test fixtures for the ClickUp models. */
export const MEMBER_ANA: ClickupMember = {
  id: 1,
  username: "Ana",
  email: "ana@example.com",
  initials: "A",
  color: "",
  profilePicture: null,
};
export const MEMBER_BEN: ClickupMember = { ...MEMBER_ANA, id: 2, username: "Ben", email: "ben@example.com", initials: "B" };

export const LIST_INFO: ClickupListInfo = {
  id: "9001",
  name: "Sprint",
  permissionLevel: null,
  statuses: [
    { status: "to do", type: "open", color: "#aaa", orderindex: 0 },
    { status: "in progress", type: "custom", color: "#bbb", orderindex: 1 },
    { status: "complete", type: "closed", color: "#ccc", orderindex: 2 },
  ],
};

export function makeTask(id: string, patch: Partial<ClickupTask> = {}): ClickupTask {
  return {
    id,
    name: `Task ${id}`,
    markdownDescription: null,
    status: { status: "to do", type: "open", color: "#aaa" },
    priority: null,
    assignees: [],
    startDate: null,
    dueDate: null,
    dateUpdated: 1000,
    dateCreated: null,
    dateClosed: null,
    customId: null,
    tags: [],
    customFields: [],
    url: `https://app.clickup.com/t/${id}`,
    listId: "9001",
    ...patch,
  };
}
