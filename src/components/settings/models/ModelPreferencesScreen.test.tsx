import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getModelPreferences,
  updateModelPreferences,
} from "@/lib/api/account";
import { listAvailableModels } from "@/lib/api/provider";
import {
  defaultModelMetadata,
  type AvailableModel,
} from "@/lib/schemas/provider";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import ModelPreferencesScreen from "./ModelPreferencesScreen";

vi.mock("@/lib/api/provider", () => ({
  listAvailableModels: vi.fn(),
}));

vi.mock("@/lib/api/account", () => ({
  getModelPreferences: vi.fn(),
  updateModelPreferences: vi.fn(),
}));

const OWN_MODEL: AvailableModel = {
  configId: "cfg-own",
  configName: "my-keys",
  modelId: "local-llama",
  provenance: "own",
  ownerName: null,
  ...defaultModelMetadata(),
};
const SHARED_MODEL: AvailableModel = {
  configId: "cfg-shared",
  configName: "instance-openai",
  modelId: "gpt-4o",
  provenance: "shared",
  ownerName: "operator",
  ...defaultModelMetadata(),
};

function renderScreen(locale?: "zh-CN") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <ModelPreferencesScreen />
    </QueryClientProvider>,
    locale === undefined ? {} : { locale },
  );
}

describe("ModelPreferencesScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAvailableModels).mockResolvedValue([
      OWN_MODEL,
      SHARED_MODEL,
    ]);
    vi.mocked(getModelPreferences).mockResolvedValue({});
    vi.mocked(updateModelPreferences).mockResolvedValue({});
  });

  it("renders the four purpose rows and saves a picked model immediately", async () => {
    renderScreen();

    expect(await screen.findByText("Default chat model")).toBeInTheDocument();
    expect(screen.getByText("Title generation model")).toBeInTheDocument();
    expect(screen.getByText("Context compression model")).toBeInTheDocument();
    expect(screen.getByText("Translation model")).toBeInTheDocument();

    const triggers = await screen.findAllByRole("button", {
      name: "Select a model",
    });
    expect(triggers).toHaveLength(4);
    const firstTrigger = triggers[0];
    if (!firstTrigger) {
      throw new Error("expected four model picker triggers");
    }
    fireEvent.click(firstTrigger);
    fireEvent.click(await screen.findByText("gpt-4o"));

    await vi.waitFor(() => {
      expect(updateModelPreferences).toHaveBeenCalledWith(
        {
          chat: { providerConfigId: "cfg-shared", modelId: "gpt-4o" },
        },
        expect.anything(),
      );
    });
  });

  it("shows the stored preferences in the pickers", async () => {
    vi.mocked(getModelPreferences).mockResolvedValue({
      chat: { providerConfigId: "cfg-own", modelId: "local-llama" },
      translation: { providerConfigId: "cfg-shared", modelId: "gpt-4o" },
    });

    renderScreen();

    expect((await screen.findAllByText("local-llama")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("gpt-4o").length).toBeGreaterThan(0);
  });

  it("clears one slot via the picker's clear row", async () => {
    vi.mocked(getModelPreferences).mockResolvedValue({
      chat: { providerConfigId: "cfg-own", modelId: "local-llama" },
    });

    renderScreen();

    const trigger = await screen.findByRole("button", { name: "local-llama" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText("No default model"));

    await vi.waitFor(() => {
      expect(updateModelPreferences).toHaveBeenCalledWith(
        { chat: null },
        expect.anything(),
      );
    });
  });

  it("resets all four slots at once", async () => {
    vi.mocked(getModelPreferences).mockResolvedValue({
      chat: { providerConfigId: "cfg-own", modelId: "local-llama" },
      title: { providerConfigId: "cfg-own", modelId: "local-llama" },
    });

    renderScreen();

    const reset = await screen.findByRole("button", { name: "Reset all" });
    await vi.waitFor(() => expect(reset).toBeEnabled());
    fireEvent.click(reset);

    await vi.waitFor(() => {
      // An empty object clears every slot: the server replaces the whole
      // preference set, and unset slots read back as no preference.
      expect(updateModelPreferences).toHaveBeenCalledWith(
        {},
        expect.anything(),
      );
    });
  });

  it("renders its copy from the zh-CN catalog", async () => {
    renderScreen("zh-CN");

    expect(await screen.findByText("默认聊天模型")).toBeInTheDocument();
    expect(screen.getByText("标题生成模型")).toBeInTheDocument();
    expect(screen.getByText("上下文压缩模型")).toBeInTheDocument();
    expect(screen.getByText("翻译模型")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "全部重置" }),
    ).toBeInTheDocument();
  });
});
