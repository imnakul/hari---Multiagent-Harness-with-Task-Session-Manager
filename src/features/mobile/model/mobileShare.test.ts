import { describe, expect, it } from "vitest";
import { parseShareList, shareCaption, type ShareEntry } from "./mobileShare";

const text: ShareEntry = {
  id: "a",
  direction: "in",
  kind: "text",
  text: "Hello",
  at: 1,
  status: "done",
};

describe("Share history (L-279)", () => {
  it("keeps well-formed entries and the phone count", () => {
    const list = parseShareList({
      phones: 2,
      items: [
        text,
        { ...text, id: "f", kind: "file", text: undefined, name: "a.pdf", size: 10, path: "C:\\a.pdf" },
        { ...text, id: "" },
        { ...text, kind: "photo" },
        { ...text, status: "sent" },
        { ...text, id: "nofile", kind: "file", text: undefined },
        { ...text, id: "notext", text: undefined },
        { ...text, id: "badsize", size: -1 },
      ],
    });
    expect(list.phones).toBe(2);
    expect(list.items.map((entry) => entry.id)).toEqual(["a", "f", "badsize"]);
    expect(list.items[1]).toMatchObject({ name: "a.pdf", size: 10, path: "C:\\a.pdf" });
    expect(list.items[2]).not.toHaveProperty("size");
  });

  it("reads nothing from a broken answer", () => {
    expect(parseShareList(null)).toEqual({ items: [], phones: 0 });
    expect(parseShareList({ items: "x", phones: "1" })).toEqual({ items: [], phones: 0 });
  });

  it("says what each entry is, which way it went and whether it is waiting", () => {
    expect(shareCaption({ ...text, device: "Pixel" })).toBe("Text from Pixel");
    expect(shareCaption({ ...text, direction: "out", kind: "clipboard", status: "queued" })).toBe(
      "Clipboard to phone · waiting for the phone",
    );
    expect(
      shareCaption({ ...text, direction: "out", kind: "file", name: "a", status: "queued", device: "Pixel" }),
    ).toBe("File to Pixel · not fetched yet");
    expect(shareCaption({ ...text, direction: "out", kind: "link", status: "done" })).toBe("Link to phone");
  });
});
