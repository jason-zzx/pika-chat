import { describe, expect, it } from "vitest";

import {
  CITATION_DIRECTIVE,
  SEARCH_QUERY_GUIDANCE,
  buildChatInstructions,
} from "@/server/ai/instructions";

// A moment where the UTC date and the Asia/Shanghai date differ, so the
// timezone argument is observably honored.
const EVENING_UTC = new Date("2026-09-15T20:00:00Z");
const UTC = "UTC";
const UTC_DATE_LINE = "Current date: Tuesday, September 15, 2026.";

describe("buildChatInstructions", () => {
  const now = EVENING_UTC;

  it("always carries the current date, even without a system prompt or search", () => {
    expect(buildChatInstructions({ now, timeZone: UTC })).toBe(UTC_DATE_LINE);
  });

  it("renders the date in the request's own time zone", () => {
    expect(buildChatInstructions({ now, timeZone: "Asia/Shanghai" })).toBe(
      "Current date: Wednesday, September 16, 2026.",
    );
  });

  it("falls back to the server zone for an unknown zone string", () => {
    expect(buildChatInstructions({ now, timeZone: "Not/AZone" })).toBe(
      buildChatInstructions({ now }),
    );
  });

  it("puts the assistant prompt before the date line", () => {
    const result = buildChatInstructions({
      systemPrompt: "Be helpful.",
      now,
      timeZone: UTC,
    });
    expect(result.indexOf("Be helpful.")).toBeLessThan(
      result.indexOf("Current date:"),
    );
  });

  it("ignores a blank system prompt", () => {
    expect(
      buildChatInstructions({ systemPrompt: "   ", now, timeZone: UTC }),
    ).toBe(UTC_DATE_LINE);
  });

  it("adds the query guidance and citation directive only when search is enabled", () => {
    const withoutSearch = buildChatInstructions({ now, timeZone: UTC });
    expect(withoutSearch).not.toContain(SEARCH_QUERY_GUIDANCE);
    expect(withoutSearch).not.toContain(CITATION_DIRECTIVE);

    const withSearch = buildChatInstructions({
      searchEnabled: true,
      now,
      timeZone: UTC,
    });
    expect(withSearch).toContain(SEARCH_QUERY_GUIDANCE);
    expect(withSearch).toContain(CITATION_DIRECTIVE);
    // Guidance tells the model to read the date above, so the date must
    // precede it; the citation directive stays last.
    expect(withSearch.indexOf("Current date:")).toBeLessThan(
      withSearch.indexOf(SEARCH_QUERY_GUIDANCE),
    );
    expect(withSearch.indexOf(SEARCH_QUERY_GUIDANCE)).toBeLessThan(
      withSearch.indexOf(CITATION_DIRECTIVE),
    );
  });

  it("composes prompt, date, guidance and citation for a tool-mode turn", () => {
    const result = buildChatInstructions({
      systemPrompt: "Be helpful.",
      searchEnabled: true,
      now,
      timeZone: "Asia/Shanghai",
    });
    expect(result).toContain("Be helpful.");
    expect(result).toContain("Current date: Wednesday, September 16, 2026.");
    expect(result).toContain(SEARCH_QUERY_GUIDANCE);
    expect(result).toContain(CITATION_DIRECTIVE);
  });
});