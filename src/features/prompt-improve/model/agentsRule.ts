import { readTextFile, writeTextFile } from "../../../platform/tauri/fs";
import { normalizeRule } from "./promptImproveStore";

/**
 * "Add to AGENTS.md" (fork, L-252): a rule the owner keeps repeating goes
 * into the project's AGENTS.md once, under `## Standing rules`, so every
 * agent reads it without being told again.
 */
const HEADING = "## Standing rules";

/** The file with `rule` added, keeping its line endings; unchanged if already there. */
export function appendStandingRule(content: string, rule: string): string {
  const text = rule.trim().replace(/\s+/g, " ");
  if (!text) return content;
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const key = normalizeRule(text);
  if (
    lines.some((line) => normalizeRule(line.replace(/^\s*[-*]\s*/, "")) === key)
  )
    return content;
  const bullet = `- ${text}`;
  const start = lines.findIndex((line) =>
    /^##\s+standing rules\s*$/i.test(line.trim()),
  );
  if (start === -1) {
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "")
      lines.pop();
    const lead = lines.length > 0 ? [...lines, ""] : [];
    return [...lead, HEADING, "", bullet, ""].join(eol);
  }
  let end = lines.findIndex(
    (line, index) => index > start && /^#{1,2}\s/.test(line),
  );
  if (end === -1) end = lines.length;
  let last = end - 1;
  while (last > start && lines[last]!.trim() === "") last -= 1;
  const insertAt = last === start ? start + 1 : last + 1;
  const insert = last === start ? ["", bullet] : [bullet];
  lines.splice(insertAt, 0, ...insert);
  return lines.join(eol);
}

function agentsPath(cwd: string): string {
  const root = cwd.replace(/[\\/]+$/, "");
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${separator}AGENTS.md`;
}

function isMissingFile(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /os error 2\b|no such file|cannot find the file/i.test(message);
}

export type AddRuleResult =
  { ok: true; path: string; created: boolean } | { ok: false; message: string };

export async function addRuleToAgentsFile(
  cwd: string,
  rule: string,
  io: {
    read: (path: string) => Promise<string>;
    write: (path: string, content: string) => Promise<void>;
  } = {
    read: readTextFile,
    write: writeTextFile,
  },
): Promise<AddRuleResult> {
  const path = agentsPath(cwd);
  let content = "";
  let created = false;
  try {
    content = await io.read(path);
  } catch (error) {
    if (!isMissingFile(error)) {
      return {
        ok: false,
        message: "Couldn't read AGENTS.md, so nothing was added.",
      };
    }
    created = true;
  }
  const next = appendStandingRule(content, rule);
  if (next === content) return { ok: true, path, created: false };
  try {
    await io.write(path, next);
  } catch {
    return {
      ok: false,
      message: "Couldn't save AGENTS.md. Check the file isn't read-only.",
    };
  }
  return { ok: true, path, created };
}
