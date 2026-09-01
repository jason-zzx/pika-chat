import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { listAssistantTree } from "@/lib/api/assistant";
import { createTopic } from "@/lib/api/topic";
import type { Assistant } from "@/lib/schemas/assistant";

import AssistantTree from "./AssistantTree";

const params = vi.hoisted(() => ({
  topicId: "topic-active" as string | undefined,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ topicId: params.topicId }),
  useRouter: () => ({ push: vi.fn() }),
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
  createTopic: vi.fn(),
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
    params.topicId = "topic-active";
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
            },
          ],
        }),
      ],
    });

    renderTree();

    expect(await screen.findByRole("button", { name: "Back to assistants" })).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Active topic" })).toBeVisible();
    expect(screen.queryByText("Play")).toBeNull();
    expect(screen.queryByRole("link", { name: "Other topic" })).toBeNull();
    expect(screen.queryByRole("link", { name: "New chat" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to assistants" }));
    expect(screen.getByRole("button", { name: "Open Play" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Active topic" })).toBeNull();
  });

  it("disables delete when there is only one assistant and enables it when there are two", async () => {
    params.topicId = undefined;
    const only = assistant({ id: "only", name: "Only one" });
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [only],
    });

    const { unmount } = renderTree();
    expect(await screen.findByRole("button", { name: "Open Only one" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Only one" }));
    const disabledDelete = screen.getByRole("button", { name: "Delete" });
    expect(disabledDelete).toBeDisabled();
    unmount();

    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [
        only,
        assistant({ id: "second", name: "Second" }),
      ],
    });
    renderTree();
    expect(await screen.findByRole("button", { name: "Open Only one" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Only one" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("surfaces an error when creating a topic fails", async () => {
    params.topicId = undefined;
    vi.mocked(listAssistantTree).mockResolvedValue({
      assistants: [assistant({ id: "only", name: "Work" })],
    });
    vi.mocked(createTopic).mockRejectedValue({
      error: { message: "Assistant not found" },
    });

    renderTree();
    expect(await screen.findByRole("button", { name: "Open Work" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Work" }));
    fireEvent.click(screen.getByRole("button", { name: "New topic" }));
    expect(await screen.findByText("Assistant not found")).toBeInTheDocument();
  });

});
