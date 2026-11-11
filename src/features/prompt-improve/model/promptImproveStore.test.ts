// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PROMPT_IMPROVE,
  EMPTY_PROMPT_MEMORY,
  RULE_SUGGEST_AT,
  applyLearned,
  clearPromptMemory,
  loadPromptImproveSettings,
  loadPromptMemory,
  memoryProjectKey,
  memoryProjectName,
  normalizeRule,
  parsePromptImproveSettings,
  parsePromptMemory,
  recordSentRewrite,
  removeProjectMemory,
  ruleSuggestion,
  savePromptImproveSettings,
  savePromptMemory,
  setProjectGlossary,
  setRuleState,
  type PromptMemory,
} from "./promptImproveStore";

const CWD = "E:\\work\\shop";
const KEY = memoryProjectKey(CWD);
const noLearned = { styles: [], terms: [], rules: [] };

function stateRule(
  memory: PromptMemory,
  times: number,
  text = "Never commit opencode.json",
): PromptMemory {
  let next = memory;
  for (let index = 0; index < times; index += 1) {
    next = applyLearned(next, {
      cwd: CWD,
      learned: { ...noLearned, rules: [text] },
      usedSamples: 0,
    });
  }
  return next;
}

afterEach(() => localStorage.clear());

describe("parsing stored values (L-252)", () => {
  it("falls back to defaults for junk", () => {
    expect(parsePromptImproveSettings("x")).toBe(DEFAULT_PROMPT_IMPROVE);
    expect(parsePromptMemory(null)).toBe(EMPTY_PROMPT_MEMORY);
  });
  it("keeps valid fields and drops invalid ones", () => {
    expect(
      parsePromptImproveSettings({
        enabled: false,
        effort: "huge",
        learn: 0,
        instructions: 5,
      }),
    ).toEqual({
      enabled: false,
      helper: null,
      instructions: "",
      learn: true,
      suggestRules: true,
    });
    const memory = parsePromptMemory({
      profile: "- short\n",
      projects: {
        k: {
          name: "shop",
          glossary: 3,
          rules: [{ text: " " }, { text: "x", count: -2, state: "bad" }],
        },
      },
      samples: [{ rewrite: "a", sent: "b" }, { rewrite: 1 }],
      accepted: 2.7,
      edited: -1,
    });
    expect(memory).toEqual({
      profile: "- short\n",
      projects: {
        k: { name: "shop", glossary: "", rules: [{ text: "x", count: 1 }] },
      },
      samples: [{ rewrite: "a", sent: "b", at: 0 }],
      accepted: 2,
      edited: 0,
    });
  });
  it("round-trips through storage and returns a stable value", () => {
    savePromptImproveSettings({ ...DEFAULT_PROMPT_IMPROVE, effort: "low" });
    expect(loadPromptImproveSettings().effort).toBe("low");
    expect(loadPromptImproveSettings()).toBe(loadPromptImproveSettings());
    savePromptMemory({ ...EMPTY_PROMPT_MEMORY, profile: "- terse" });
    expect(loadPromptMemory().profile).toBe("- terse");
    clearPromptMemory();
    expect(loadPromptMemory()).toEqual(EMPTY_PROMPT_MEMORY);
  });
});

describe("project names and rule matching", () => {
  it("names a project by its folder", () => {
    expect(memoryProjectName("E:\\work\\shop\\")).toBe("shop");
    expect(memoryProjectName("/home/me/site")).toBe("site");
  });
  it("matches rules regardless of case, quotes, spacing and a closing period", () => {
    expect(normalizeRule(' Never  commit "opencode.json". ')).toBe(
      "never commit opencode.json",
    );
  });
});

describe("applyLearned", () => {
  it("adds new style lines and glossary terms once", () => {
    const learned = {
      styles: ["Short numbered lists"],
      terms: ["Hari = phone app"],
      rules: [],
    };
    const once = applyLearned(EMPTY_PROMPT_MEMORY, {
      cwd: CWD,
      learned,
      usedSamples: 0,
    });
    const twice = applyLearned(once, {
      cwd: CWD,
      learned: {
        ...learned,
        styles: ["short numbered lists."],
        terms: ["hari: the phone app"],
      },
      usedSamples: 0,
    });
    expect(twice.profile).toBe("- Short numbered lists");
    expect(twice.projects[KEY]).toEqual({
      name: "shop",
      glossary: "Hari = phone app",
      rules: [],
    });
  });
  it("does not create a project entry when nothing project-specific was learned", () => {
    const next = applyLearned(EMPTY_PROMPT_MEMORY, {
      cwd: CWD,
      learned: noLearned,
      usedSamples: 0,
    });
    expect(next.projects).toEqual({});
  });
  it("drops the edit samples that were sent", () => {
    const memory: PromptMemory = {
      ...EMPTY_PROMPT_MEMORY,
      samples: [
        { rewrite: "a", sent: "b", at: 1 },
        { rewrite: "c", sent: "d", at: 2 },
      ],
    };
    expect(
      applyLearned(memory, { cwd: CWD, learned: noLearned, usedSamples: 1 })
        .samples,
    ).toEqual([{ rewrite: "c", sent: "d", at: 2 }]);
  });
  it("counts a rule once per prompt", () => {
    const next = applyLearned(EMPTY_PROMPT_MEMORY, {
      cwd: CWD,
      learned: {
        ...noLearned,
        rules: ["Never commit opencode.json", "never commit opencode.json."],
      },
      usedSamples: 0,
    });
    expect(next.projects[KEY]?.rules).toEqual([
      { text: "Never commit opencode.json", count: 1 },
    ]);
  });
});

describe("rule suggestions", () => {
  it(`offers a rule once it is stated in ${RULE_SUGGEST_AT} prompts`, () => {
    expect(
      ruleSuggestion(
        stateRule(EMPTY_PROMPT_MEMORY, RULE_SUGGEST_AT - 1).projects[KEY],
      ),
    ).toBeNull();
    expect(
      ruleSuggestion(
        stateRule(EMPTY_PROMPT_MEMORY, RULE_SUGGEST_AT).projects[KEY],
      )?.text,
    ).toBe("Never commit opencode.json");
  });
  it("Not now waits for the rule to come up again; Never and Added stop the offer", () => {
    const ready = stateRule(EMPTY_PROMPT_MEMORY, RULE_SUGGEST_AT);
    const snoozed = setRuleState(ready, CWD, "never commit opencode.json", {
      snooze: true,
    });
    expect(ruleSuggestion(snoozed.projects[KEY])).toBeNull();
    expect(
      ruleSuggestion(stateRule(snoozed, RULE_SUGGEST_AT).projects[KEY]),
    ).not.toBeNull();
    for (const state of ["never", "added"] as const) {
      const done = setRuleState(ready, CWD, "Never commit opencode.json", {
        state,
      });
      expect(ruleSuggestion(stateRule(done, 5).projects[KEY])).toBeNull();
    }
  });
  it("ignores unknown projects", () => {
    expect(
      setRuleState(EMPTY_PROMPT_MEMORY, CWD, "x", { state: "never" }),
    ).toBe(EMPTY_PROMPT_MEMORY);
    expect(ruleSuggestion(undefined)).toBeNull();
  });
});

describe("recordSentRewrite", () => {
  it("counts an unchanged rewrite as accepted", () => {
    const next = recordSentRewrite(EMPTY_PROMPT_MEMORY, {
      rewrite: "Fix it.\n",
      sent: "Fix it.",
      now: 1,
    });
    expect(next).toEqual({ ...EMPTY_PROMPT_MEMORY, accepted: 1 });
  });
  it("keeps an edited rewrite as a sample, at most eight", () => {
    let next = EMPTY_PROMPT_MEMORY;
    for (let index = 0; index < 10; index += 1) {
      next = recordSentRewrite(next, {
        rewrite: "Fix it.",
        sent: `Fix it ${index}.`,
        now: index,
      });
    }
    expect(next.edited).toBe(10);
    expect(next.samples).toHaveLength(8);
    expect(next.samples[0]).toEqual({
      rewrite: "Fix it.",
      sent: "Fix it 2.",
      at: 2,
    });
  });
  it("ignores an empty send", () => {
    expect(
      recordSentRewrite(EMPTY_PROMPT_MEMORY, {
        rewrite: "x",
        sent: " ",
        now: 1,
      }),
    ).toBe(EMPTY_PROMPT_MEMORY);
  });
});

describe("Settings edits", () => {
  it("edits a glossary and forgets a project", () => {
    const memory = applyLearned(EMPTY_PROMPT_MEMORY, {
      cwd: CWD,
      learned: { ...noLearned, terms: ["a = b"] },
      usedSamples: 0,
    });
    expect(
      setProjectGlossary(memory, KEY, "c = d").projects[KEY]?.glossary,
    ).toBe("c = d");
    expect(removeProjectMemory(memory, KEY).projects).toEqual({});
    expect(removeProjectMemory(memory, "missing")).toBe(memory);
  });
});
