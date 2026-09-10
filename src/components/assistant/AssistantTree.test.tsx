import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { listAssistantTree } from "@/lib/api/assistant";
import { setTopicFavorite } from "@/lib/api/topic";
import type { Assistant } from "@/lib/schemas/assistant";
import type { Topic } from "@/lib/schemas/topic";
import { renderWithIntl } from "@/test-utils/render-with-intl";

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
  renameTopic: vi.fn(),
  deleteTopic: vi.fn(),
  setTopicFavorite: vi.fn(),
  generateTopicTitle: vi.fn(),
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
    topics: [],
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

/** Renders the assistant pane (not the home list) with the given topics. */
function renderPane(topics: Topic[]) {
  nav.pathname = "/assistant/only";
  vi.mocked(listAssistantTree).mockResolvedValue({
    assistants: [assistant({ id: "only", name: "Work", topics })],
  });
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
  });

  it("opens the active topic's assistant pane and hides other assistants", async () => {
    nav.pathname = "/assistant/a-active/topic-active";
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [
        assistant({
          id: "a-active",
          name: "Work",
          topics: [
            topic({
              id: "topic-active",
              title: "Active topic",
              createdAt: new Date("2026-01-01"),
              updatedAt: new Date("2026-01-01"),
            }),
          ],
        }),
        assistant({
          id: "a-other",
          name: "Play",
          topics: [
            topic({
              id: "topic-other",
              title: "Other topic",
              createdAt: new Date("2026-01-02"),
              updatedAt: new Date("2026-01-02"),
            }),
          ],
        }),
      ],
    });

    renderTree();

    expect(await screen.findByRole("button", { name: "Back to assistants" })).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Active topic" })).toBeVisible();
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
        assistant({
          id: "a-active",
          name: "Work",
          topics: [
            topic({
              id: "topic-active",
              title: "Active topic",
            }),
          ],
        }),
      ],
    });

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

  it("keeps the Topics label when every topic is favorited", async () => {
    renderPane([topic({ id: "t-fav", title: "Pinned", isFavorite: true })]);

    expect(await screen.findByRole("button", { name: "Topics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Favorite" })).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: "Topics" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plain" })).toBeInTheDocument();
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
});
