import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { listAvailableModels } from "@/lib/api/provider";

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
  render(
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
      },
      {
        configId: "cfg-own",
        configName: "my-keys",
        modelId: "other-model",
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
});
