import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { listAvailableModels } from "@/lib/api/provider";
import { defaultModelMetadata } from "@/lib/schemas/provider";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import ModelPicker from "./ModelPicker";

vi.mock("@/lib/api/provider", () => ({
  listAvailableModels: vi.fn(),
}));

function renderPicker(options?: {
  allowClear?: boolean;
  value?: { configId: string; modelId: string } | null;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onChange = vi.fn();
  renderWithIntl(
    <QueryClientProvider client={client}>
      <ModelPicker
        value={options?.value ?? null}
        onChange={onChange}
        allowClear={options?.allowClear}
      />
    </QueryClientProvider>,
  );
  return { onChange };
}

describe("ModelPicker", () => {
  it("groups by provider config and filters by provider name and model id", async () => {
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
        configId: "cfg-own",
        configName: "my-keys",
        modelId: "other-model",
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
        ...defaultModelMetadata({
          contextTokens: 128000,
          inputModalities: ["text", "image"],
        }),
      },
    ]);

    const { onChange } = renderPicker();
    const trigger = await screen.findByRole("button", {
      name: "Select a model",
    });
    await vi.waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);

    expect(await screen.findByText("my-keys")).toBeInTheDocument();
    expect(
      screen.getByText("instance-openai (shared by operator)"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No default model")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search models"), {
      target: { value: "openai" },
    });
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    expect(screen.queryByText("local-llama")).not.toBeInTheDocument();

    // Model search can be nested inside the composer or assistant edit form.
    expect(
      fireEvent.keyDown(screen.getByLabelText("Search models"), { key: "Enter" }),
    ).toBe(false);

    fireEvent.change(screen.getByLabelText("Search models"), {
      target: { value: "my-keys" },
    });
    expect(screen.getByText("local-llama")).toBeInTheDocument();
    expect(screen.getByText("other-model")).toBeInTheDocument();
    expect(screen.queryByText("gpt-4o")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("local-llama"));
    expect(onChange).toHaveBeenCalledWith({
      configId: "cfg-own",
      modelId: "local-llama",
    });
  });

  it("shows a clear row only when allowClear is set", async () => {
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

    const { onChange } = renderPicker({ allowClear: true });
    const trigger = await screen.findByRole("button", {
      name: "Select a model",
    });
    await vi.waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText("No default model"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("marks image-output models with an image-generation icon", async () => {
    vi.mocked(listAvailableModels).mockResolvedValue([
      {
        configId: "cfg-own",
        configName: "my-keys",
        modelId: "gpt-image-1",
        provenance: "own",
        ownerName: null,
        ...defaultModelMetadata({ outputModalities: ["image", "text"] }),
      },
      {
        configId: "cfg-own",
        configName: "my-keys",
        modelId: "plain-chat",
        provenance: "own",
        ownerName: null,
        ...defaultModelMetadata(),
      },
    ]);

    renderPicker();
    const trigger = await screen.findByRole("button", {
      name: "Select a model",
    });
    await vi.waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);

    const imageRow = await screen.findByRole("button", { name: /gpt-image-1/ });
    expect(imageRow).toHaveAccessibleName(/Image generation/);
    const plainRow = screen.getByRole("button", { name: /plain-chat/ });
    expect(plainRow).not.toHaveAccessibleName(/Image generation/);
  });

  it("falls back to the anonymous owner label for a shared config without an owner name", async () => {
    vi.mocked(listAvailableModels).mockResolvedValue([
      {
        configId: "cfg-shared",
        configName: "instance-openai",
        modelId: "gpt-4o",
        provenance: "shared",
        ownerName: null,
        ...defaultModelMetadata(),
      },
    ]);

    renderPicker();
    const trigger = await screen.findByRole("button", {
      name: "Select a model",
    });
    await vi.waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);

    expect(
      await screen.findByText("instance-openai (shared by another user)"),
    ).toBeInTheDocument();
  });

  it("shows a 1M context label, hides labels under 1M, and renders vision and reasoning as icons", async () => {
    vi.mocked(listAvailableModels).mockResolvedValue([
      {
        configId: "cfg-own",
        configName: "my-keys",
        modelId: "small-context",
        provenance: "own",
        ownerName: null,
        ...defaultModelMetadata({ contextTokens: 200_000 }),
      },
      {
        configId: "cfg-own",
        configName: "my-keys",
        modelId: "image-only",
        provenance: "own",
        ownerName: null,
        ...defaultModelMetadata({
          contextTokens: 200_000,
          inputModalities: ["text", "image"],
        }),
      },
      {
        configId: "cfg-own",
        configName: "my-keys",
        modelId: "big-context",
        provenance: "own",
        ownerName: null,
        ...defaultModelMetadata({
          contextTokens: 1_048_576,
          inputModalities: ["text", "image"],
          reasoning: true,
          reasoningOptions: ["low", "medium", "high"],
        }),
      },
    ]);

    renderPicker();
    const trigger = await screen.findByRole("button", {
      name: "Select a model",
    });
    await vi.waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);

    expect(screen.getByText("1M")).toBeInTheDocument();
    expect(screen.queryByText("200K")).not.toBeInTheDocument();
    expect(screen.queryByText("1M · vision")).not.toBeInTheDocument();

    expect(screen.getAllByTitle("Vision")).toHaveLength(2);
    expect(screen.getAllByTitle("Vision")[0]).toHaveAccessibleName("Vision");

    const bigRow = screen.getByRole("button", { name: /big-context/ });
    expect(bigRow).toHaveAccessibleName(/Vision/);
    expect(bigRow).toHaveAccessibleName(/Reasoning/);

    const imageRow = screen.getByRole("button", { name: /image-only/ });
    expect(imageRow).toHaveAccessibleName(/Vision/);
    expect(imageRow).not.toHaveAccessibleName(/Reasoning/);
    expect(imageRow).not.toHaveAccessibleName(/1M/);

    expect(screen.queryByText("vision")).not.toBeInTheDocument();
    expect(screen.queryByText("reasoning")).not.toBeInTheDocument();
  });
});
