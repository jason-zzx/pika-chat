import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { searchTopicsAndMessages } from "@/lib/api/search";
import type { SearchResponse } from "@/lib/schemas/search";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import SearchResults from "./SearchResults";
import SidebarSearch from "./SidebarSearch";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/lib/api/search", () => ({
  searchTopicsAndMessages: vi.fn(),
}));

const mockedSearch = vi.mocked(searchTopicsAndMessages);

const FIXTURE: SearchResponse = {
  topics: [
    {
      id: "tpc_1",
      title: "Weekend planning",
      isFavorite: false,
      assistantId: "agt_1",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
  ],
  messages: [
    {
      messageId: "msg_1",
      groupId: "grp_1",
      topicId: "tpc_2",
      assistantId: "agt_1",
      topicTitle: "Hikes",
      role: "user",
      snippet: "Tell me about weekend hikes",
      createdAt: new Date("2026-01-01"),
    },
  ],
};

function renderInSidebar(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <SidebarProvider>{ui}</SidebarProvider>
    </QueryClientProvider>,
  );
}

describe("SidebarSearch", () => {
  it("emits query changes, clears on Escape and on the clear button", () => {
    const onQueryChange = vi.fn();
    renderInSidebar(<SidebarSearch query="week" onQueryChange={onQueryChange} />);

    const input = screen.getByRole("textbox", {
      name: "Search topics and messages",
    });
    fireEvent.change(input, { target: { value: "weekend" } });
    expect(onQueryChange).toHaveBeenLastCalledWith("weekend");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onQueryChange).toHaveBeenLastCalledWith("");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onQueryChange).toHaveBeenLastCalledWith("");
  });
});

describe("SearchResults", () => {
  beforeEach(() => {
    mockedSearch.mockResolvedValue(FIXTURE);
  });

  it("renders grouped hits and navigates on click", async () => {
    const onNavigate = vi.fn();
    renderInSidebar(<SearchResults query="weekend" onNavigate={onNavigate} />);

    // Debounced fetch (300ms), then both groups render.
    const topicLink = await screen.findByRole(
      "link",
      { name: "Weekend planning" },
      { timeout: 2000 },
    );
    expect(topicLink).toHaveAttribute("href", "/assistant/agt_1/tpc_1");
    // Topic title hits mark the matched term too (R7b).
    expect(topicLink.querySelector("mark")).toHaveTextContent("Weekend");

    const messageLink = screen.getByRole("link", {
      name: /Tell me about/,
    });
    expect(messageLink).toHaveAttribute(
      "href",
      "/assistant/agt_1/tpc_2?m=grp_1",
    );
    // The message item carries its topic title, and the matched term is
    // wrapped in <mark> rather than injected HTML.
    expect(messageLink).toHaveTextContent("Hikes");
    expect(messageLink.querySelector("mark")).toHaveTextContent("weekend");

    fireEvent.click(messageLink);
    expect(onNavigate).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(mockedSearch).toHaveBeenCalledWith("weekend");
    });
  });

  it("shows the empty state when nothing matches", async () => {
    mockedSearch.mockResolvedValue({ topics: [], messages: [] });
    renderInSidebar(<SearchResults query="zzz" onNavigate={vi.fn()} />);

    expect(
      await screen.findByText('No matches for "zzz"', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it("windows a long topic title around the match so truncate cannot hide it (R7b)", async () => {
    const longTitle = `${"a".repeat(40)}needle${"z".repeat(20)}`;
    mockedSearch.mockResolvedValue({
      topics: [
        {
          id: "tpc_1",
          title: longTitle,
          isFavorite: false,
          assistantId: "agt_1",
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
        },
      ],
      messages: [],
    });
    renderInSidebar(<SearchResults query="needle" onNavigate={vi.fn()} />);

    const topicLink = await screen.findByRole(
      "link",
      { name: /needle/ },
      { timeout: 2000 },
    );
    expect(topicLink.querySelector("mark")).toHaveTextContent("needle");
    // The slice keeps ~16 chars of head context plus the match and its tail,
    // ellipsized at the front — the full 40-char head must not render.
    expect(topicLink.textContent).toBe(
      `…${"a".repeat(16)}needle${"z".repeat(20)}`,
    );
    expect(topicLink.textContent).not.toContain("a".repeat(40));
  });
});
