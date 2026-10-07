import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SidebarProvider } from "@/components/ui/sidebar";
import { searchTopicsAndMessages } from "@/lib/api/search";
import type { SearchResponse } from "@/lib/schemas/search";
import { useSearchDialogStore } from "@/stores/search-dialog-store";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import SearchDialog from "./SearchDialog";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

const nav = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
}));

vi.mock("@/lib/api/search", () => ({
  searchTopicsAndMessages: vi.fn(),
}));

const mockedSearch = vi.mocked(searchTopicsAndMessages);

// jsdom has no scrollIntoView; the keyboard-active row scrolls into view.
Element.prototype.scrollIntoView = vi.fn();

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
      createdAt: new Date("2026-01-02"),
    },
    {
      messageId: "msg_0",
      groupId: "grp_0",
      topicId: "tpc_2",
      assistantId: "agt_1",
      topicTitle: "Hikes",
      role: "assistant",
      snippet: "Earlier weekend hikes recap",
      createdAt: new Date("2026-01-01"),
    },
  ],
};

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <SearchDialog />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

/** Opens the dialog and types a query into the palette input. */
async function openAndType(query: string) {
  useSearchDialogStore.setState({ open: true });
  renderDialog();
  const input = await screen.findByRole("combobox", {
    name: "Search topics and messages",
  });
  fireEvent.change(input, { target: { value: query } });
  return input;
}

describe("SearchDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    useSearchDialogStore.setState({ open: false });
    mockedSearch.mockResolvedValue(FIXTURE);
  });

  it("opens on Ctrl+K from anywhere", async () => {
    renderDialog();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(useSearchDialogStore.getState().open).toBe(true);
  });

  it("renders grouped hits with <mark> highlighting after the debounce", async () => {
    await openAndType("weekend");

    // Debounced fetch (300ms), then both groups render.
    const topicRow = await screen.findByRole(
      "option",
      { name: "Weekend planning" },
      { timeout: 2000 },
    );
    expect(topicRow.querySelector("mark")).toHaveTextContent("Weekend");

    const messageRow = screen.getByRole("option", { name: /Tell me about/ });
    // The message row carries its topic title, and the matched term is
    // wrapped in <mark> rather than injected HTML.
    expect(messageRow).toHaveTextContent("Hikes");
    expect(messageRow.querySelector("mark")).toHaveTextContent("weekend");

    expect(mockedSearch).toHaveBeenCalledWith("weekend");
  });

  it("shows the empty state when nothing matches", async () => {
    mockedSearch.mockResolvedValue({ topics: [], messages: [] });
    await openAndType("zzz");

    expect(
      await screen.findByText('No matches for "zzz"', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it("windows a long topic title around the match so truncate cannot hide it", async () => {
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
    await openAndType("needle");

    const topicRow = await screen.findByRole(
      "option",
      { name: /needle/ },
      { timeout: 2000 },
    );
    expect(topicRow.querySelector("mark")).toHaveTextContent("needle");
    // The slice keeps ~16 chars of head context plus the match and its tail,
    // ellipsized at the front — the full 40-char head must not render.
    expect(topicRow.textContent).toBe(
      `…${"a".repeat(16)}needle${"z".repeat(20)}`,
    );
    expect(topicRow.textContent).not.toContain("a".repeat(40));
  });

  it("navigates the flat result list with arrow keys and selects with Enter", async () => {
    const input = await openAndType("weekend");
    await screen.findByRole("option", { name: "Weekend planning" }, { timeout: 2000 });

    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "search-palette-result-0",
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "search-palette-result-1",
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // Clamped at the last row (2 messages follow the topic).
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "search-palette-result-2",
    );
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "search-palette-result-1",
    );

    // Enter on the first message hit deep-links with the group id.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(nav.push).toHaveBeenCalledWith("/assistant/agt_1/tpc_2?m=grp_1");
    expect(useSearchDialogStore.getState().open).toBe(false);
  });

  it("ignores Enter when the input has been cleared (no stale jump)", async () => {
    const input = await openAndType("hikes");
    await screen.findByRole("option", { name: /Tell me about/ }, { timeout: 2000 });

    // Clearing the input unmounts the list; Enter must not navigate to an
    // invisible result kept alive by keepPreviousData.
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(nav.push).not.toHaveBeenCalled();
    expect(useSearchDialogStore.getState().open).toBe(true);
  });

  it("stashes the same-topic hit queue when a message hit is selected", async () => {
    await openAndType("hikes");

    const row = await screen.findByRole(
      "option",
      { name: /Tell me about/ },
      { timeout: 2000 },
    );
    fireEvent.click(within(row).getByRole("button"));

    expect(nav.push).toHaveBeenCalledWith("/assistant/agt_1/tpc_2?m=grp_1");
    expect(useSearchDialogStore.getState().open).toBe(false);
    // Reading order (createdAt asc, reversed from the API's desc) so the
    // navigator's prev/next matches the visual up/down direction.
    expect(window.sessionStorage.getItem("pika:search-hit-queue")).toBe(
      JSON.stringify({
        topicId: "tpc_2",
        hits: ["grp_0", "grp_1"],
        current: "grp_1",
      }),
    );
  });

  it("stashes no queue for a topic result or a single-hit topic", async () => {
    await openAndType("weekend");

    const topicRow = await screen.findByRole(
      "option",
      { name: "Weekend planning" },
      { timeout: 2000 },
    );
    fireEvent.click(within(topicRow).getByRole("button"));
    expect(nav.push).toHaveBeenCalledWith("/assistant/agt_1/tpc_1");
    expect(window.sessionStorage.getItem("pika:search-hit-queue")).toBeNull();
  });
});
