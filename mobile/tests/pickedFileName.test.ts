import { beforeEach, describe, expect, it, vi } from "vitest";

// Fork (L-375): a file picked in Share keeps the name the phone shows, not
// the number its content:// address ends in.

const displayName = vi.fn<(uri: string) => string | null>();

vi.mock("react-native", () => ({ Platform: { OS: "android" }, AppState: { addEventListener: vi.fn() } }));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => ({ displayName, supported: () => false }) }));

const { pickedFileName } = await import("@/features/liveUpdates/nativeLive");

const URI = "content://com.android.providers.downloads.documents/document/1565";

describe("pickedFileName", () => {
  beforeEach(() => {
    displayName.mockReset();
  });

  it("uses the provider's display name", () => {
    displayName.mockReturnValue("Invoice March.pdf");
    expect(pickedFileName(URI, "1565")).toBe("Invoice March.pdf");
    expect(displayName).toHaveBeenCalledWith(URI);
  });

  it("falls back when the provider has no name", () => {
    displayName.mockReturnValue(null);
    expect(pickedFileName(URI, "1565")).toBe("1565");
    displayName.mockReturnValue("  ");
    expect(pickedFileName(URI, "1565")).toBe("1565");
  });

  it("falls back when the lookup throws", () => {
    displayName.mockImplementation(() => {
      throw new Error("revoked");
    });
    expect(pickedFileName(URI, "1565")).toBe("1565");
  });
});
