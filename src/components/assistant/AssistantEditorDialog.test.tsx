import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { type InputHTMLAttributes, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAssistant } from "@/lib/api/assistant";
import { listAvailableModels } from "@/lib/api/provider";
import type { Assistant } from "@/lib/schemas/assistant";
import { defaultModelMetadata } from "@/lib/schemas/provider";
import { renderWithIntl } from "@/test-utils/render-with-intl";

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

vi.mock("@/components/ui/emoji-picker", () => ({
  EmojiPicker: ({
    children,
    onEmojiSelect,
  }: {
    children?: ReactNode;
    onEmojiSelect?: (value: { emoji: string }) => void;
  }) => (
    <div>
      {children}
      <button
        type="button"
        role="gridcell"
        aria-label="Grinning face"
        onClick={() => onEmojiSelect?.({ emoji: "😀" })}
      >
        😀
      </button>
    </div>
  ),
  EmojiPickerSearch: (props: InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  EmojiPickerContent: () => null,
}));

function renderEditor(assistant: Assistant | null, locale?: "zh-CN") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <AssistantEditorDialog
        open
        onOpenChange={() => undefined}
        assistant={assistant}
      />
    </QueryClientProvider>,
    locale === undefined ? {} : { locale },
  );
}

describe("AssistantEditorDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows provenance on model options and can save with no model", async () => {
    vi.mocked(listAvailableModels).mockResolvedValue([
      {
        configId: "cfg-own",
        configName: "my-keys",
        modelId: "local-llama",
        provenance: "own",
        ownerName: null,
        ...defaultModelMetadata(),
      },
      {
        configId: "cfg-shared",
        configName: "instance-openai",
        modelId: "gpt-4o",
        provenance: "shared",
        ownerName: "operator",
        ...defaultModelMetadata(),
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
    expect(screen.queryByRole("textbox", { name: "Emoji" })).toBeNull();
    expect(screen.getByLabelText("Emoji")).toHaveTextContent("✨");
    const modelTrigger = screen.getByLabelText("Default model");
    await vi.waitFor(() => expect(modelTrigger).toBeEnabled());
    fireEvent.click(modelTrigger);
    expect(await screen.findByText("my-keys")).toBeInTheDocument();
    expect(screen.getByText("local-llama")).toBeInTheDocument();
    expect(
      screen.getByText("instance-openai (shared by operator)"),
    ).toBeInTheDocument();
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    expect(screen.getByText("No default model")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("Search models"), {
      key: "Enter",
    });
    expect(createAssistant).not.toHaveBeenCalled();

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
        ...defaultModelMetadata(),
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
    expect(screen.queryByRole("textbox", { name: "Emoji" })).toBeNull();
    expect(screen.getByLabelText("Emoji")).toHaveTextContent("🤖");
    fireEvent.click(screen.getByLabelText("Default model"));
    expect(await screen.findByText("No default model")).toBeInTheDocument();
  });

  it("updates the saved icon when an emoji is selected", async () => {
    vi.mocked(listAvailableModels).mockResolvedValue([]);
    vi.mocked(createAssistant).mockResolvedValue({
      id: "new",
      name: "Draft",
      icon: "😀",
      systemPrompt: null,
      defaultProviderConfigId: null,
      defaultModelId: null,
      topics: [],
    });

    renderEditor(null);

    const emojiTrigger = await screen.findByLabelText("Emoji");
    fireEvent.click(emojiTrigger);
    fireEvent.click(
      await screen.findByRole("gridcell", { name: "Grinning face" }),
    );
    expect(emojiTrigger).toHaveTextContent("😀");
    expect(createAssistant).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => {
      expect(createAssistant).toHaveBeenCalledWith({
        name: "Draft",
        icon: "😀",
        systemPrompt: null,
        defaultProviderConfigId: null,
        defaultModelId: null,
      });
    });
  });

  it("does not submit the form when Enter is pressed in emoji search", async () => {
    vi.mocked(listAvailableModels).mockResolvedValue([]);
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

    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "Draft" },
    });
    fireEvent.click(screen.getByLabelText("Emoji"));
    const search = await screen.findByLabelText("Search emoji");
    expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
    expect(createAssistant).not.toHaveBeenCalled();
  });

  it("renders its copy from the zh-CN catalog", async () => {
    vi.mocked(listAvailableModels).mockResolvedValue([]);

    renderEditor(null, "zh-CN");

    expect(await screen.findByText("新建助手")).toBeInTheDocument();
    expect(screen.getByLabelText("名称")).toBeInTheDocument();
    expect(screen.getByLabelText("默认模型")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("表情"));
    expect(await screen.findByLabelText("搜索表情")).toBeInTheDocument();
  });
});
