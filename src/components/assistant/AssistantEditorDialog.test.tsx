import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createAssistant } from "@/lib/api/assistant";
import { listAvailableModels } from "@/lib/api/provider";
import type { Assistant } from "@/lib/schemas/assistant";

import AssistantEditorDialog from "./AssistantEditorDialog";

vi.mock("@/lib/api/provider", () => ({
  listAvailableModels: vi.fn(),
}));

vi.mock("@/lib/api/assistant", () => ({
  listAssistantTree: vi.fn(),
  createAssistant: vi.fn(),
  updateAssistant: vi.fn(),
  deleteAssistant: vi.fn(),
}));

function renderEditor(assistant: Assistant | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AssistantEditorDialog
        open
        onOpenChange={() => undefined}
        assistant={assistant}
      />
    </QueryClientProvider>,
  );
}

describe("AssistantEditorDialog", () => {
  it("shows provenance on model options and can save with no model", async () => {
    vi.mocked(listAvailableModels).mockResolvedValue([
      {
        configId: "cfg-own",
        configName: "my-keys",
        modelId: "local-llama",
        provenance: "own",
        ownerName: null,
      },
      {
        configId: "cfg-shared",
        configName: "instance-openai",
        modelId: "gpt-4o",
        provenance: "shared",
        ownerName: "operator",
      },
    ]);
    vi.mocked(createAssistant).mockResolvedValue({
      id: "new",
      name: "Draft",
      icon: "✨",
      systemPrompt: null,
      defaultProviderConfigId: null,
      defaultModelId: null,
      topics: [],
    });

    renderEditor(null);

    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Default model"));
    expect(
      await screen.findByText("local-llama · my-keys"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("gpt-4o · instance-openai (shared by operator)"),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => {
      expect(createAssistant).toHaveBeenCalledWith({
        name: "Draft",
        icon: "✨",
        systemPrompt: null,
        defaultProviderConfigId: null,
        defaultModelId: null,
      });
    });
  });

  it("shows an unavailable notice and nothing preselected for a stale model", async () => {
    vi.mocked(listAvailableModels).mockResolvedValue([
      {
        configId: "cfg-own",
        configName: "my-keys",
        modelId: "local-llama",
        provenance: "own",
        ownerName: null,
      },
    ]);

    renderEditor({
      id: "stale",
      name: "Pinned",
      icon: "🤖",
      systemPrompt: null,
      defaultProviderConfigId: "gone",
      defaultModelId: "gpt-4o",
      topics: [],
    });

    expect(
      await screen.findByText(
        "The previously selected model is no longer available.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Default model"));
    expect(await screen.findByText("No default model")).toBeInTheDocument();
  });
});
