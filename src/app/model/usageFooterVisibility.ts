import type { AppView } from "../../features/workspace/model/appViewTabs";

type FooterView = AppView | "workspace" | "settings" | "mono";

/** Local managers retain the footer in classic; inset app tabs share the outer footer. */
export function usageFooterVisible(inset: boolean, view: FooterView): boolean {
  if (view === "settings") return false;
  return inset || view === "workspace" || view === "tasks" || view === "kanban";
}
