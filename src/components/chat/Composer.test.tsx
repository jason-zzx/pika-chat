import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { listAvailableModels } from "@/lib/api/provider";
import { listSearchProviders } from "@/lib/api/search-provider";
import {
  defaultModelMetadata,
  type AvailableModel,
} from "@/lib/schemas/provider";

import Composer from "./Composer";

vi.mock("@/lib/api/provider", () => ({
  listAvailableModels: vi.fn(),
}));

vi.mock("@/lib/api/search-provider", () => ({
  listSearchProviders: vi.fn().mockResolvedValue({ providers: [] }),
  upsertSearchProvider: vi.fn(),
  deleteSearchProvider: vi.fn(),
  reorderSearchProviders: vi.fn(),
}));

function renderComposer(options?: {
  inFlight?: boolean;
  canSend?: boolean;
  draft?: string;
  models?: AvailableModel[];
  reasoningEffort?: string | null;
}) {
  vi.mocked(listAvailableModels).mockResolvedValue(options?.models ?? []);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onSend = vi.fn();
  const onStop = vi.fn();
  const onReasoningEffortChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <Composer
        draft={options?.draft ?? "hello"}
        onDraftChange={() => undefined}
        model={{ configId: "cfg", modelId: "local-llama" }}
        onModelChange={() => undefined}
        showAssistantPicker={false}
        inFlight={options?.inFlight ?? false}
        canSend={options?.canSend ?? true}
        onSend={onSend}
        onStop={onStop}
        reasoningEffort={options?.reasoningEffort ?? null}
        onReasoningEffortChange={onReasoningEffortChange}
      />
    </QueryClientProvider>,
  );
  return { onSend, onStop, onReasoningEffortChange };
}

describe("Composer", () => {
  it("sends with the in-box control and Enter, and inserts a newline with Shift+Enter", () => {
    const { onSend } = renderComposer();

    const textarea = screen.getByRole("textbox", { name: "Message" });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it("replaces send with stop while a turn is in flight", () => {
    const { onStop } = renderComposer({ inFlight: true, canSend: false });

    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("keeps the model picker on the send row inside the composer box", () => {
    renderComposer();

    const send = screen.getByRole("button", { name: "Send" });
    const box = send.closest(".rounded-2xl");
    expect(box).toBeInstanceOf(HTMLElement);
    if (!(box instanceof HTMLElement)) {
      return;
    }
    expect(
      within(box).getByRole("button", { name: "Select a model" }),
    ).toBeInTheDocument();
  });

  it("matches the composer shell fill while a turn is in flight", () => {
    renderComposer({ inFlight: true, canSend: false });

    const textarea = screen.getByRole("textbox", { name: "Message" });
    expect(textarea).toHaveClass("disabled:bg-transparent");
    expect(textarea).toHaveClass("dark:disabled:bg-transparent");
    const stop = screen.getByRole("button", { name: "Stop" });
    const box = stop.closest(".rounded-2xl");
    expect(box).toBeInstanceOf(HTMLElement);
    if (!(box instanceof HTMLElement)) {
      return;
    }
    expect(
      within(box).getByRole("button", { name: "Select a model" }),
    ).toBeInTheDocument();
  });

  it("does not draw a split line above the composer box", () => {
    renderComposer();
    const send = screen.getByRole("button", { name: "Send" });
    const form = send.closest("form");
    expect(form).toBeInstanceOf(HTMLFormElement);
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    expect(form.className).not.toMatch(/border-t/);
  });

  it("offers three search modes and links to settings when the tool mode has no providers", async () => {
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Web search mode" }));

    expect(
      await screen.findByRole("button", { name: /Off/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Model built-in/ }),
    ).toBeEnabled();
    // No providers configured (mocked above): the tool mode dead-ends into a
    // settings link instead of silently failing at send time.
    expect(
      screen.getByRole("button", { name: /Search tool/ }),
    ).toBeDisabled();
    expect(screen.getByRole("link", { name: "Add one in settings" })).toHaveAttribute(
      "href",
      "/settings/search",
    );
  });

  it("enables the search tool mode when a provider is configured", async () => {
    vi.mocked(listSearchProviders).mockResolvedValue({
      providers: [
        {
          provider: "tavily",
          baseUrl: null,
          apiKeyLastFour: "1234",
          position: 0,
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Web search mode" }));

    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Search tool/ }),
      ).toBeEnabled(),
    );
  });

  it("does not show expand for a short draft", () => {
    renderComposer();
    expect(
      screen.queryByRole("button", { name: "Expand composer" }),
    ).not.toBeInTheDocument();
  });

  it("hides reasoning effort when the selected model does not reason", async () => {
    renderComposer({
      models: [
        {
          configId: "cfg",
          configName: "my-keys",
          modelId: "local-llama",
          provenance: "own",
          ownerName: null,
          ...defaultModelMetadata(),
        },
      ],
    });
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "local-llama" }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole("combobox", { name: "Reasoning effort" }),
    ).not.toBeInTheDocument();
  });

  it("shows Auto plus stored effort options for a reasoning model", async () => {
    renderComposer({
      models: [
        {
          configId: "cfg",
          configName: "my-keys",
          modelId: "local-llama",
          provenance: "own",
          ownerName: null,
          ...defaultModelMetadata({
            reasoning: true,
            reasoningOptions: ["low", "high"],
          }),
        },
      ],
    });
    const effort = await screen.findByRole("combobox", {
      name: "Reasoning effort",
    });
    expect(effort).toHaveAttribute("title", "Auto");
    fireEvent.click(effort);
    expect(await screen.findByRole("option", { name: "Auto" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "low" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "high" })).toBeInTheDocument();
  });

  it("places expand on the send row, left of send, with no extra row above the textarea", () => {
    const scroll = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    const client = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 200;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 48;
      },
    });

    try {
      renderComposer({ draft: "line\n".repeat(12) });

      const expand = screen.getByRole("button", { name: "Expand composer" });
      const send = screen.getByRole("button", { name: "Send" });
      expect(send.parentElement).toContainElement(expand);
      expect(expand.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      const box = send.closest(".rounded-2xl");
      expect(box).toBeInstanceOf(HTMLElement);
      if (!(box instanceof HTMLElement)) {
        return;
      }
      expect(box.firstElementChild).toHaveAttribute("aria-label", "Message");
    } finally {
      if (scroll) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", scroll);
      }
      if (client) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", client);
      }
    }
  });
});
