import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { listAssistantTree } from "@/lib/api/assistant";
import { listFavoriteTopics, listTopicPage, setTopicFavorite } from "@/lib/api/topic";
import type { Assistant } from "@/lib/schemas/assistant";
import type { Topic } from "@/lib/schemas/topic";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import {
  markTopicStreaming,
  resetStreamingTopics,
  unmarkTopicStreaming,
} from "@/lib/streaming-topics";

import AssistantTree from "./AssistantTree";

const nav = vi.hoisted(() => ({
  pathname: "/",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/lib/api/assistant", () => ({
  listAssistantTree: vi.fn(),
  createAssistant: vi.fn(),
  updateAssistant: vi.fn(),
  deleteAssistant: vi.fn(),
}));

vi.mock("@/lib/api/topic", () => ({
  listTopicPage: vi.fn(),
  listFavoriteTopics: vi.fn(),
  renameTopic: vi.fn(),
  deleteTopic: vi.fn(),
  setTopicFavorite: vi.fn(),
}));

function topic(partial: Partial<Topic> & Pick<Topic, "id" | "title">): Topic {
  return {
    isFavorite: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...partial,
  };
}

function assistant(partial: Partial<Assistant> & Pick<Assistant, "id" | "name">): Assistant {
  return {
    icon: "✨",
    systemPrompt: null,
    defaultProviderConfigId: null,
    defaultModelId: null,
    topicCount: 0,
    ...partial,
  };
}

function renderTree(options?: { showUsers?: boolean }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SidebarProvider>
          <Sidebar>
            <AssistantTree showUsers={options?.showUsers ?? false} />
          </Sidebar>
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** Serves the topics through the two list endpoints, one page for non-favorites. */
function mockTopics(topics: Topic[]) {
  vi.mocked(listTopicPage).mockResolvedValue({
    topics: topics.filter((candidate) => !candidate.isFavorite),
    nextCursor: null,
  });
  vi.mocked(listFavoriteTopics).mockResolvedValue({
    topics: topics.filter((candidate) => candidate.isFavorite),
  });
}

/** Renders the assistant pane (not the home list) with the given topics. */
function renderPane(topics: Topic[]) {
  nav.pathname = "/assistant/only";
  vi.mocked(listAssistantTree).mockResolvedValue({
    assistants: [assistant({ id: "only", name: "Work", topicCount: topics.length })],
  });
  mockTopics(topics);
  return renderTree();
}

/** The collapse container a section toggle controls. */
function sectionContent(toggleName: string): HTMLElement {
  const id = screen
    .getByRole("button", { name: toggleName })
    .getAttribute("aria-controls");
  const content = id === null ? null : document.getElementById(id);
  if (!content) {
    throw new Error(`No collapse content for "${toggleName}"`);
  }
  return content;
}

describe("AssistantTree", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    resetStreamingTopics();
  });

  it("opens the active topic's assistant pane and hides other assistants", async () => {
    nav.pathname = "/assistant/a-active/topic-active";
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [
        assistant({ id: "a-active", name: "Work", topicCount: 1 }),
        assistant({ id: "a-other", name: "Play", topicCount: 1 }),
      ],
    });
    mockTopics([
      topic({
        id: "topic-active",
        title: "Active topic",
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      }),
    ]);

    renderTree();

    expect(await screen.findByRole("button", { name: "Back to assistants" })).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Active topic" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Active topic" })).toHaveAttribute(
      "href",
      "/assistant/a-active/topic-active",
    );
    expect(screen.queryByText("Play")).toBeNull();
    expect(screen.queryByRole("link", { name: "Other topic" })).toBeNull();
    expect(screen.queryByRole("link", { name: "New chat" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to assistants" }));
    expect(nav.push).toHaveBeenCalledWith("/");
  });

  it("disables delete when there is only one assistant and enables it when there are two", async () => {
    nav.pathname = "/assistant/only";
    const only = assistant({ id: "only", name: "Only one" });
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [only],
    });

    const { unmount } = renderTree();
    expect(await screen.findByRole("button", { name: "Delete" })).toBeDisabled();
    unmount();

    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [
        only,
        assistant({ id: "second", name: "Second" }),
      ],
    });
    renderTree();
    expect(await screen.findByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("does not show New topic on the home assistant list", async () => {
    nav.pathname = "/";
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [assistant({ id: "only", name: "Work" })],
    });

    renderTree();
    expect(await screen.findByText("Assistants")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New topic" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Work" })).toBeInTheDocument();
  });

  it("opens a fresh draft after deleting the topic being viewed", async () => {
    nav.pathname = "/assistant/a-active/topic-active";
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [
        assistant({ id: "a-active", name: "Work", topicCount: 1 }),
      ],
    });
    mockTopics([topic({ id: "topic-active", title: "Active topic" })]);

    renderTree();

    fireEvent.click(
      await screen.findByRole("button", { name: "Actions for Active topic" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith("/assistant/a-active");
    });
  });

  it("wraps the assistant emoji under Back when the pane header stacks", async () => {
    nav.pathname = "/assistant/only";
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [assistant({ id: "only", name: "Work", icon: "✨" })],
    });

    renderTree();
    expect(await screen.findByRole("button", { name: "Back to assistants" })).toBeInTheDocument();
    const name = screen.getByText("Work");
    expect(name.className).toContain("group-data-[collapsible=icon]:sr-only");
    expect(name.parentElement?.className).toContain("flex-wrap");
  });

  it("links New topic to the assistant draft URL without creating a row", async () => {
    nav.pathname = "/assistant/only";
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [assistant({ id: "only", name: "Work" })],
    });

    renderTree();
    expect(await screen.findByRole("link", { name: "New topic" })).toHaveAttribute(
      "href",
      "/assistant/only",
    );
  });

  it("replaces the assistant list with a settings pane on settings routes", async () => {
    nav.pathname = "/settings/general";
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [assistant({ id: "only", name: "Work" })],
    });

    renderTree({ showUsers: true });

    expect(screen.getByRole("button", { name: "Back to assistants" })).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute(
      "href",
      "/settings/general",
    );
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute(
      "href",
      "/settings/account",
    );
    expect(screen.getByRole("link", { name: "Providers" })).toHaveAttribute(
      "href",
      "/settings/providers",
    );
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute(
      "href",
      "/settings/users",
    );
    expect(screen.getByRole("link", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByText("Work")).toBeNull();
    expect(screen.queryByText("Assistants")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to assistants" }));
    expect(nav.push).toHaveBeenCalledWith("/");
  });

  it("hides the Users settings row for non-staff", () => {
    nav.pathname = "/settings/account";
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [assistant({ id: "only", name: "Work" })],
    });

    renderTree({ showUsers: false });

    expect(screen.getByRole("link", { name: "Account" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
  });

  it("renders a favorited topic inside the Favorite subsection only", async () => {
    renderPane([
      topic({ id: "t-fav", title: "Pinned", isFavorite: true }),
      topic({ id: "t-plain", title: "Plain" }),
    ]);

    expect(await screen.findByRole("button", { name: "Favorite" })).toBeInTheDocument();
    expect(
      within(sectionContent("Favorite")).getByRole("link", { name: "Pinned" }),
    ).toBeInTheDocument();
    // Not duplicated into the normal rows below the subsection.
    expect(screen.getAllByRole("link", { name: "Pinned" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Plain" })).toBeInTheDocument();
    expect(
      within(sectionContent("Favorite")).queryByRole("link", { name: "Plain" }),
    ).toBeNull();
  });

  it("marks a topic with a live background stream and clears the mark when it ends", async () => {
    renderPane([
      topic({ id: "t-streaming", title: "Busy" }),
      topic({ id: "t-idle", title: "Idle" }),
    ]);
    const busyLink = await screen.findByRole("link", { name: "Busy" });
    const idleLink = screen.getByRole("link", { name: "Idle" });

    expect(busyLink.querySelector(".animate-spin")).toBeNull();

    act(() => {
      markTopicStreaming("t-streaming");
    });
    expect(busyLink.querySelector(".animate-spin")).not.toBeNull();
    // Only the streaming topic carries the indicator.
    expect(idleLink.querySelector(".animate-spin")).toBeNull();

    act(() => {
      unmarkTopicStreaming("t-streaming");
    });
    expect(busyLink.querySelector(".animate-spin")).toBeNull();
  });

  it("keeps the Topics label when every topic is favorited", async () => {
    renderPane([topic({ id: "t-fav", title: "Pinned", isFavorite: true })]);

    expect(await screen.findByRole("button", { name: "Favorite" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Topics" })).toBeInTheDocument();
    expect(screen.queryByText("No topics yet")).toBeNull();
    // The Topics list is empty but still rendered under its label.
    expect(within(sectionContent("Topics")).queryByRole("link")).toBeNull();
    expect(
      within(sectionContent("Favorite")).getByRole("link", { name: "Pinned" }),
    ).toBeInTheDocument();
  });

  it("renders Favorite above Topics as a peer section, not nested under it", async () => {
    renderPane([
      topic({ id: "t-fav", title: "Pinned", isFavorite: true }),
      topic({ id: "t-plain", title: "Plain" }),
    ]);

    const favorite = await screen.findByRole("button", { name: "Favorite" });
    const topics = screen.getByRole("button", { name: "Topics" });

    // Favorite comes first in DOM order.
    expect(
      favorite.compareDocumentPosition(topics) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Same level: the two section wrappers are siblings, neither contains
    // the other's label, and both sit in the same scroll container.
    expect(favorite.parentElement?.parentElement).toBe(
      topics.parentElement?.parentElement,
    );
    expect(favorite.parentElement?.contains(topics)).toBe(false);
    expect(topics.parentElement?.contains(favorite)).toBe(false);
    // Peers look identical — no indentation/subordination of either label.
    expect(favorite.className).toBe(topics.className);
    // Icon-collapsed mode: SidebarGroupLabel only fades the label out, so a
    // label-turned-button must be display:none or it stays tab-reachable.
    expect(favorite.className).toContain("group-data-[collapsible=icon]:hidden");
  });

  it("hides the Favorite subsection when nothing is favorited", async () => {
    renderPane([topic({ id: "t-plain", title: "Plain" })]);

    expect(await screen.findByRole("link", { name: "Plain" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Topics" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Favorite" })).toBeNull();
  });

  it("collapsing Topics hides only the normal rows and leaves Favorite visible", async () => {
    renderPane([
      topic({ id: "t-fav", title: "Pinned", isFavorite: true }),
      topic({ id: "t-plain", title: "Plain" }),
    ]);

    const topics = await screen.findByRole("button", { name: "Topics" });
    expect(topics).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(topics);

    expect(topics).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Plain" })).toBeNull();
    // The Favorite section is a peer, so it survives a Topics collapse.
    expect(screen.getByRole("button", { name: "Favorite" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Pinned" })).toBeVisible();
  });

  it("collapsing Favorite hides only the favorited rows", async () => {
    renderPane([
      topic({ id: "t-fav", title: "Pinned", isFavorite: true }),
      topic({ id: "t-plain", title: "Plain" }),
    ]);

    const favorite = await screen.findByRole("button", { name: "Favorite" });
    fireEvent.click(favorite);

    expect(favorite).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Pinned" })).toBeNull();
    expect(screen.getByRole("link", { name: "Plain" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Topics" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("persists collapse toggles and re-applies them after mount", async () => {
    renderPane([topic({ id: "t-plain", title: "Plain" })]);
    fireEvent.click(await screen.findByRole("button", { name: "Topics" }));

    expect(
      JSON.parse(
        window.localStorage.getItem("pika.sidebar.topic-sections") ?? "null",
      ),
    ).toEqual({ topics: false, favorites: true });
  });

  it("toggles both sections independently and persists each flag", async () => {
    renderPane([
      topic({ id: "t-fav", title: "Pinned", isFavorite: true }),
      topic({ id: "t-plain", title: "Plain" }),
    ]);

    fireEvent.click(await screen.findByRole("button", { name: "Topics" }));
    // Favorite still toggles while Topics is collapsed.
    fireEvent.click(screen.getByRole("button", { name: "Favorite" }));

    const stored = () =>
      JSON.parse(
        window.localStorage.getItem("pika.sidebar.topic-sections") ?? "null",
      );
    expect(stored()).toEqual({ topics: false, favorites: false });
    expect(screen.getByRole("button", { name: "Topics" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "Favorite" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    // Re-expanding Topics leaves Favorite collapsed.
    fireEvent.click(screen.getByRole("button", { name: "Topics" }));

    expect(screen.getByRole("button", { name: "Topics" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: "Favorite" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(stored()).toEqual({ topics: true, favorites: false });
    expect(screen.queryByRole("link", { name: "Pinned" })).toBeNull();
    expect(screen.getByRole("link", { name: "Plain" })).toBeInTheDocument();
  });

  it("applies persisted collapse state after mount", async () => {
    window.localStorage.setItem(
      "pika.sidebar.topic-sections",
      JSON.stringify({ topics: false, favorites: false }),
    );
    renderPane([topic({ id: "t-fav", title: "Pinned", isFavorite: true })]);

    const topics = await screen.findByRole("button", { name: "Topics" });
    await waitFor(() => {
      expect(topics).toHaveAttribute("aria-expanded", "false");
    });
    expect(screen.queryByRole("link", { name: "Pinned" })).toBeNull();
  });

  it("toggles the favorite flag from the row's star button", async () => {
    vi.mocked(setTopicFavorite).mockResolvedValue(
      topic({ id: "t-plain", title: "Plain", isFavorite: true }),
    );
    renderPane([topic({ id: "t-plain", title: "Plain" })]);

    fireEvent.click(
      await screen.findByRole("button", { name: "Favorite Plain" }),
    );

    await waitFor(() => {
      expect(setTopicFavorite).toHaveBeenCalledWith("t-plain", {
        favorite: true,
      });
    });
  });

  it("toggles the favorite flag from the row menu", async () => {
    vi.mocked(setTopicFavorite).mockResolvedValue(
      topic({ id: "t-fav", title: "Pinned", isFavorite: false }),
    );
    renderPane([topic({ id: "t-fav", title: "Pinned", isFavorite: true })]);

    fireEvent.click(
      await screen.findByRole("button", { name: "Actions for Pinned" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unfavorite" }));

    await waitFor(() => {
      expect(setTopicFavorite).toHaveBeenCalledWith("t-fav", {
        favorite: false,
      });
    });
  });

  describe("pagination", () => {
    type ObserverRecord = { callback: IntersectionObserverCallback; target: Element | null };
    const observers: ObserverRecord[] = [];

    beforeEach(() => {
      observers.length = 0;
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          record: ObserverRecord;
          constructor(callback: IntersectionObserverCallback) {
            this.record = { callback, target: null };
            observers.push(this.record);
          }
          observe(target: Element) {
            this.record.target = target;
          }
          disconnect() {
            this.record.target = null;
          }
        },
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function intersect() {
      const live = observers.filter((record) => record.target);
      act(() => {
        for (const record of live) {
          record.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        }
      });
    }

    function pageOf(prefix: string, count: number, nextCursor: string | null) {
      return {
        topics: Array.from({ length: count }, (_, index) =>
          topic({ id: `${prefix}${index}`, title: `${prefix} ${index}` }),
        ),
        nextCursor,
      };
    }

    function renderPaged() {
      nav.pathname = "/assistant/only";
      vi.mocked(listAssistantTree).mockResolvedValue({
        assistants: [assistant({ id: "only", name: "Work", topicCount: 25 })],
      });
      vi.mocked(listFavoriteTopics).mockResolvedValue({ topics: [] });
      return renderTree();
    }

    it("loads the next page when the sentinel scrolls into view, then stops", async () => {
      vi.mocked(listTopicPage)
        .mockResolvedValueOnce(pageOf("a", 20, "c1"))
        .mockResolvedValueOnce(pageOf("b", 5, null));
      renderPaged();

      expect(await screen.findByRole("link", { name: "a 0" })).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: /^a \d+$/ })).toHaveLength(20);
      expect(listTopicPage).toHaveBeenCalledTimes(1);

      intersect();
      expect(await screen.findByRole("link", { name: "b 4" })).toBeInTheDocument();
      expect(listTopicPage).toHaveBeenLastCalledWith("only", "c1");

      intersect();
      expect(listTopicPage).toHaveBeenCalledTimes(2);
    });

    it("shows Retry after a failed page and Retry loads it", async () => {
      vi.mocked(listTopicPage)
        .mockResolvedValueOnce(pageOf("a", 20, "c1"))
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce(pageOf("b", 5, null));
      renderPaged();
      await screen.findByRole("link", { name: "a 0" });

      intersect();
      const retry = await screen.findByRole("button", { name: "Retry" });
      expect(screen.getAllByRole("link", { name: /^a \d+$/ })).toHaveLength(20);

      fireEvent.click(retry);
      expect(await screen.findByRole("link", { name: "b 0" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    });

    it("renders favorites from their own query, even when no page holds them", async () => {
      nav.pathname = "/assistant/only";
      vi.mocked(listAssistantTree).mockResolvedValue({
        assistants: [assistant({ id: "only", name: "Work", topicCount: 21 })],
      });
      vi.mocked(listTopicPage).mockResolvedValue(pageOf("a", 20, "c1"));
      vi.mocked(listFavoriteTopics).mockResolvedValue({
        topics: [topic({ id: "old", title: "Ancient", isFavorite: true })],
      });
      renderTree();

      expect(
        within(await screen.findByRole("button", { name: "Favorite" }).then(() => sectionContent("Favorite"))).getByRole("link", { name: "Ancient" }),
      ).toBeInTheDocument();
    });

    it("moves a topic into Favorites right away and rolls back on failure", async () => {
      vi.mocked(listTopicPage).mockResolvedValue({
        topics: [topic({ id: "t-plain", title: "Plain" })],
        nextCursor: null,
      });
      nav.pathname = "/assistant/only";
      vi.mocked(listAssistantTree).mockResolvedValue({
        assistants: [assistant({ id: "only", name: "Work", topicCount: 1 })],
      });
      vi.mocked(listFavoriteTopics).mockResolvedValue({ topics: [] });
      renderTree();

      let fail: (error: Error) => void = () => undefined;
      vi.mocked(setTopicFavorite).mockImplementation(
        () => new Promise<Topic>((_resolve, reject) => { fail = reject; }),
      );
      fireEvent.click(await screen.findByRole("button", { name: "Favorite Plain" }));
      expect(
        within(await screen.findByRole("button", { name: "Favorite" }).then(() => sectionContent("Favorite"))).getByRole("link", { name: "Plain" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: "Plain" })).toHaveLength(1);
      fail(new Error("nope"));
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Favorite" })).toBeNull();
      });
      expect(screen.getByRole("link", { name: "Plain" })).toBeInTheDocument();
    });
  });

  describe("row", () => {
    it("shows an age label for the topic", async () => {
      renderPane([topic({ id: "t1", title: "Old", updatedAt: new Date(Date.now() - 3 * 3_600_000) })]);
      const link = await screen.findByRole("link", { name: "Old" });
      expect(link).toHaveTextContent("3h");
    });

    it("long press opens the menu with the full title and does not navigate", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      renderPane([topic({ id: "t1", title: "A very long title" })]);
      const link = await screen.findByRole("link", { name: "A very long title" });
      const clicked = vi.fn((event: Event) => event.preventDefault());
      link.addEventListener("click", clicked);

      const row = link.closest("li") as HTMLElement;
      fireEvent.pointerDown(row, { pointerType: "touch", clientX: 5, clientY: 5 });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      const menu = await screen.findByRole("menu");
      expect(within(menu).getByText("A very long title")).toBeInTheDocument();

      fireEvent.pointerUp(row, { pointerType: "touch" });
      fireEvent.click(link);
      expect(clicked).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("a long-press cancelled by movement does not open the menu", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      renderPane([topic({ id: "t1", title: "Moving" })]);
      const link = await screen.findByRole("link", { name: "Moving" });
      const row = link.closest("li") as HTMLElement;
      fireEvent.pointerDown(row, { pointerType: "touch", clientX: 5, clientY: 5 });
      fireEvent.pointerMove(row, { pointerType: "touch", clientX: 40, clientY: 5 });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.queryByRole("menu")).toBeNull();
      vi.useRealTimers();
    });

    it("shows the full-title tooltip only when the title is truncated", async () => {
      renderPane([
        topic({ id: "t1", title: "Cut off title" }),
        topic({ id: "t2", title: "Fits" }),
      ]);
      const cut = await screen.findByRole("link", { name: "Cut off title" });
      const fits = screen.getByRole("link", { name: "Fits" });
      const widths = (title: HTMLElement, scroll: number) => {
        Object.defineProperty(title, "scrollWidth", { configurable: true, value: scroll });
        Object.defineProperty(title, "clientWidth", { configurable: true, value: 100 });
      };
      widths(within(cut).getByText("Cut off title"), 200);
      widths(within(fits).getByText("Fits"), 50);

      fireEvent.focus(fits);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(screen.queryByText("Fits", { selector: "[data-slot=tooltip-content]" })).toBeNull();

      fireEvent.focus(cut);
      expect(
        await screen.findByText("Cut off title", { selector: "[data-slot=tooltip-content]" }),
      ).toBeInTheDocument();
    });

    it("the click-opened menu has no title header", async () => {
      renderPane([topic({ id: "t1", title: "Plain title" })]);
      fireEvent.click(await screen.findByRole("button", { name: "Actions for Plain title" }));
      const menu = await screen.findByRole("menu");
      expect(within(menu).queryByText("Plain title")).toBeNull();
    });
  });

  describe("desktop shell server switcher", () => {
    afterEach(() => {
      delete window.pikaNative;
    });

    it("keeps the plain brand link in a browser", async () => {
      nav.pathname = "/";
      vi.mocked(listAssistantTree).mockResolvedValue({ assistants: [] });
      renderTree();

      expect(await screen.findByRole("link", { name: /Pika Chat/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Switch server/ })).toBeNull();
    });

    it("opens the native server menu from the sidebar header", async () => {
      nav.pathname = "/";
      const showServerMenu = vi.fn();
      window.pikaNative = {
        serverName: "Home lab",
        notify: vi.fn(),
        showServerMenu,
        openServers: vi.fn(),
      };
      vi.mocked(listAssistantTree).mockResolvedValue({ assistants: [] });
      renderTree();

      const trigger = await screen.findByRole("button", {
        name: "Switch server, current: Home lab",
      });
      expect(within(trigger).getByText("Home lab")).toBeTruthy();
      fireEvent.click(trigger);

      expect(showServerMenu).toHaveBeenCalledWith({
        x: expect.any(Number),
        y: expect.any(Number),
      });
    });
  });

  it("hides the topic list group when the sidebar collapses to icon mode", async () => {
    renderPane([topic({ id: "t1", title: "Alpha topic" })]);

    const topicLink = await screen.findByRole("link", { name: "Alpha topic" });
    expect(topicLink.closest("[data-slot=sidebar-group]")).toHaveClass(
      "group-data-[collapsible=icon]:hidden",
    );
  });

  it("renders topic loading placeholders with the same row height as topic items", async () => {
    nav.pathname = "/assistant/only";
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [assistant({ id: "only", name: "Work" })],
    });
    vi.mocked(listTopicPage).mockReturnValue(new Promise(() => {}));
    vi.mocked(listFavoriteTopics).mockResolvedValue({ topics: [] });

    const { container } = renderTree();
    await screen.findByRole("button", { name: "Back to assistants" });

    const skeletons = container.querySelectorAll("[data-slot=skeleton]");
    expect(skeletons.length).toBeGreaterThan(0);
    for (const bar of Array.from(skeletons)) {
      const row = bar.closest("[data-slot=sidebar-menu-item]")?.firstElementChild;
      expect(row).toHaveClass("h-10", "md:h-8");
    }
  });
});
