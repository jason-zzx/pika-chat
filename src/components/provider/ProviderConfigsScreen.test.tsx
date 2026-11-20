import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  discoverProviderModels,
  listProviderConfigs,
} from "@/lib/api/provider";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import ProviderConfigsScreen from "./ProviderConfigsScreen";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/api/provider", () => ({
  listProviderConfigs: vi.fn().mockResolvedValue({ own: [], shared: [] }),
  createProviderConfig: vi.fn(),
  updateProviderConfig: vi.fn(),
  deleteProviderConfig: vi.fn(),
  discoverProviderModels: vi.fn(),
  addProviderModel: vi.fn(),
  updateProviderModel: vi.fn(),
  removeProviderModel: vi.fn(),
  syncProviderModels: vi.fn(),
}));

function renderScreen(canShare: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithIntl(
    <QueryClientProvider client={client}>
      <ProviderConfigsScreen canShare={canShare} />
    </QueryClientProvider>,
  );
}

describe("ProviderConfigsScreen", () => {
  it("hides the share toggle when canShare is false", () => {
    renderScreen(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Add a provider" }),
    );
    expect(
      screen.queryByRole("checkbox", { name: "Share with the instance" }),
    ).toBeNull();
  });

  it("shows the share toggle when canShare is true", () => {
    renderScreen(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Add a provider" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Share with the instance" }),
    ).toBeInTheDocument();
  });

  it("renders its copy from the zh-CN catalog", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWithIntl(
      <QueryClientProvider client={client}>
        <ProviderConfigsScreen canShare />
      </QueryClientProvider>,
      { locale: "zh-CN" },
    );

    fireEvent.click(screen.getByRole("button", { name: "添加服务商" }));

    expect(
      screen.getByRole("checkbox", { name: "共享给实例" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建" })).toBeInTheDocument();
  });

  it("renders '从上游获取' and fetches models automatically on click", async () => {
    vi.mocked(listProviderConfigs).mockResolvedValueOnce({
      own: [
        {
          id: "cfg-1",
          name: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          apiFormat: "openai-compatible",
          visibility: "private",
          enabled: true,
          apiKeyLastFour: "1234",
          models: [],
        },
      ],
      shared: [],
    });
    vi.mocked(discoverProviderModels).mockResolvedValueOnce({
      modelIds: ["gpt-4o"],
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWithIntl(
      <QueryClientProvider client={client}>
        <ProviderConfigsScreen canShare={false} />
      </QueryClientProvider>,
      { locale: "zh-CN" },
    );

    const fetchButton = await screen.findByRole("button", {
      name: "从上游获取",
    });
    fireEvent.click(fetchButton);

    await waitFor(() => {
      expect(discoverProviderModels).toHaveBeenCalledWith("cfg-1");
    });
    expect(
      await screen.findByRole("tab", { name: "现有模型 1" }),
    ).toBeInTheDocument();
  });
});
