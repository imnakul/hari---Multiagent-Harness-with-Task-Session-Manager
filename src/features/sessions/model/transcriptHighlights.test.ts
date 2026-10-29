// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  afterScrollSettles,
  findTextRange,
  pulseTranscriptMatch,
  scrollSmoothly,
  textMatchRanges,
  transcriptMutationNeedsRepaint,
  transcriptWordRanges,
} from "./transcriptHighlights";

describe("transcriptMutationNeedsRepaint", () => {
  function record(
    target: Node,
    extra: Partial<MutationRecord> = {},
  ): MutationRecord {
    return { target, removedNodes: [], ...extra } as MutationRecord;
  }

  it("ignores streaming changes in items that cannot contain the query", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div data-transcript-search-item><p>unrelated output</p></div>`;
    const item = root.firstElementChild as HTMLElement;

    expect(transcriptMutationNeedsRepaint([record(item)], "needle")).toBe(false);
  });

  it("repaints when a mutated item contains the query", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div data-transcript-search-item><p>found the NEEDLE here</p></div>`;
    const text = root.querySelector("p")?.firstChild as Text;

    expect(transcriptMutationNeedsRepaint([record(text)], "needle")).toBe(true);
  });

  it("repaints structural changes outside a searchable item", () => {
    const root = document.createElement("div");

    expect(transcriptMutationNeedsRepaint([record(root)], "needle")).toBe(true);
  });

  it("repaints when an in-place text change removes the query", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div data-transcript-search-item><p>all done</p></div>`;
    const text = root.querySelector("p")?.firstChild as Text;

    expect(
      transcriptMutationNeedsRepaint(
        [record(text, { type: "characterData", oldValue: "deploy failed" })],
        "failed",
      ),
    ).toBe(true);
  });

  it("repaints when a character edit breaks a cross-node match", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-transcript-search-item>
        <p><span>nee</span><span>dle</span></p>
      </div>
    `;
    const text = root.querySelector("span")?.firstChild as Text;

    expect(
      transcriptMutationNeedsRepaint(
        [record(text, { type: "characterData", oldValue: "nee" })],
        "needle",
      ),
    ).toBe(true);
  });

  it("repaints node removals that could drop a match", () => {
    const root = document.createElement("div");
    const item = document.createElement("div");
    item.setAttribute("data-transcript-search-item", "");
    root.append(item);

    expect(
      transcriptMutationNeedsRepaint(
        [record(item, { type: "childList", removedNodes: [document.createTextNode("needle")] })],
        "needle",
      ),
    ).toBe(true);
  });

  it("uses the same unicode case folding as the highlighter", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div data-transcript-search-item><p>ſ</p></div>`;

    expect(transcriptMutationNeedsRepaint([record(root.firstChild!)], "s")).toBe(
      true,
    );
  });

  it("does nothing without a query", () => {
    const root = document.createElement("div");
    expect(transcriptMutationNeedsRepaint([record(root)], "  ")).toBe(false);
  });
});

describe("transcriptWordRanges", () => {
  it("highlights only matching words, including text split by formatting", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-transcript-search-item>
        <pre data-selectable-agent-response="one">Hey can you check the notes?</pre>
      </div>
      <div data-transcript-search-item data-transcript-search-current="true">
        <div data-selectable-agent-response="two"><p>Hey <strong>can</strong> you review it?</p></div>
        <button>Hey can you</button>
      </div>
    `;

    const result = transcriptWordRanges(root, "hey can you");
    expect(result.matches.map((range) => range.toString())).toEqual([
      "Hey can you",
      "Hey can you",
    ]);
    expect(result.current).toBe(result.matches[1]);
  });

  it("treats punctuation in a query literally", () => {
    const root = document.createElement("div");
    root.innerHTML = `<div data-transcript-search-item><pre data-selectable-agent-response="one">foo.bar fooXbar</pre></div>`;
    expect(
      transcriptWordRanges(root, "foo.bar").matches.map((range) =>
        range.toString(),
      ),
    ).toEqual(["foo.bar"]);
  });
});

describe("pulseTranscriptMatch (L-188)", () => {
  function rect(left: number, top: number, width: number, height: number) {
    return { left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
  }

  it("rings each line of the match inside the scroller, then removes itself", () => {
    vi.useFakeTimers();
    try {
      const scroller = document.createElement("div");
      document.body.append(scroller);
      scroller.getBoundingClientRect = () => rect(100, 50, 400, 300);
      const range = {
        getClientRects: () => [rect(120, 80, 60, 16), rect(0, 0, 0, 0), rect(104, 96, 30, 16)],
      } as unknown as Range;

      pulseTranscriptMatch(range, scroller);
      const layer = document.querySelector<HTMLElement>(".transcript-find-pulse-layer");
      expect(layer?.style.left).toBe("100px");
      const rings = [...(layer?.children ?? [])] as HTMLElement[];
      expect(rings).toHaveLength(2);
      expect(rings[0].style.left).toBe("18px");
      expect(rings[0].style.top).toBe("29px");
      expect(rings[0].style.width).toBe("64px");

      vi.advanceTimersByTime(2000);
      expect(document.querySelector(".transcript-find-pulse-layer")).toBeNull();
      scroller.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops early when cleaned up", () => {
    const scroller = document.createElement("div");
    const range = { getClientRects: () => [] } as unknown as Range;
    const stop = pulseTranscriptMatch(range, scroller);
    expect(document.querySelector(".transcript-find-pulse-layer")).not.toBeNull();
    stop();
    expect(document.querySelector(".transcript-find-pulse-layer")).toBeNull();
  });
});

describe("findTextRange (L-192)", () => {
  it("matches a quote across elements, ignoring whitespace", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>first line</p>\n<p>second <b>bold</b> line</p>";
    const range = findTextRange(root, "line second  bold");
    expect(range?.toString()).toBe("line\nsecond bold");
  });

  it("returns null when the quote is missing or blank", () => {
    const root = document.createElement("div");
    root.textContent = "some reply";
    expect(findTextRange(root, "absent")).toBeNull();
    expect(findTextRange(root, "   ")).toBeNull();
  });
});

describe("textMatchRanges (L-192)", () => {
  it("finds every case-insensitive match", () => {
    const root = document.createElement("div");
    root.innerHTML = "<span>Fix the Panel</span><span>panel width</span>";
    const ranges = textMatchRanges(root, "panel");
    expect(ranges.map((range) => range.toString())).toEqual(["Panel", "panel"]);
    expect(textMatchRanges(root, "  ")).toEqual([]);
  });
});

describe("scrollSmoothly (L-192)", () => {
  it("jumps close to a far target, then glides", () => {
    const scroller = document.createElement("div");
    Object.defineProperty(scroller, "clientHeight", { value: 400 });
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    scrollSmoothly(scroller, 5000);
    expect(scroller.scrollTop).toBe(4400);
    expect(scrollTo).toHaveBeenCalledWith({ top: 5000, behavior: "smooth" });
  });

  it("jumps straight there when reduced motion is on", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    try {
      const scroller = document.createElement("div");
      const scrollTo = vi.fn();
      scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
      scrollSmoothly(scroller, 300);
      expect(scroller.scrollTop).toBe(300);
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("afterScrollSettles (L-192)", () => {
  it("waits until scrolling stops, and can be cancelled", () => {
    vi.useFakeTimers();
    try {
      const scroller = document.createElement("div");
      const run = vi.fn();
      afterScrollSettles(scroller, run, 100);
      vi.advanceTimersByTime(80);
      scroller.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(80);
      expect(run).not.toHaveBeenCalled();
      vi.advanceTimersByTime(30);
      expect(run).toHaveBeenCalledTimes(1);

      const other = vi.fn();
      afterScrollSettles(scroller, other, 100)();
      vi.advanceTimersByTime(200);
      expect(other).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pulseTranscriptMatch element target (L-192)", () => {
  it("rings the element's box", () => {
    const scroller = document.createElement("div");
    scroller.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }) as DOMRect;
    const target = document.createElement("div");
    target.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 100, height: 40, right: 110, bottom: 60 }) as DOMRect;
    const stop = pulseTranscriptMatch(target, scroller);
    const rings = document.querySelectorAll<HTMLElement>(".transcript-find-pulse");
    expect(rings).toHaveLength(1);
    expect(rings[0]!.style.width).toBe("104px");
    stop();
  });
});
