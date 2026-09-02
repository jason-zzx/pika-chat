import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { listAssistantTree } from "@/lib/api/assistant";
import type { Assistant } from "@/lib/schemas/assistant";

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
}));

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

function renderTree() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SidebarProvider>
          <Sidebar>
            <AssistantTree />
          </Sidebar>
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("AssistantTree", () => {
  it("opens the active topic's assistant pane and hides other assistants", async () => {
    nav.pathname = "/assistant/a-active/topic-active";
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [
        assistant({
          id: "a-active",
          name: "Work",
          topics: [
            {
              id: "topic-active",
              title: "Active topic",
              createdAt: new Date("2026-01-01"),
              updatedAt: new Date("2026-01-01"),
            },
          ],
        }),
        assistant({
          id: "a-other",
          name: "Play",
          topics: [
            {
              id: "topic-other",
              title: "Other topic",
              createdAt: new Date("2026-01-02"),
              updatedAt: new Date("2026-01-02"),
            },
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
});
