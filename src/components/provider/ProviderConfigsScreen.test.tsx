import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/test-utils/render-with-intl";

import ProviderConfigsScreen from "./ProviderConfigsScreen";

vi.mock("@/lib/api/provider", () => ({
  listProviderConfigs: vi.fn().mockResolvedValue({ own: [], shared: [] }),
  createProviderConfig: vi.fn(),
  updateProviderConfig: vi.fn(),
  deleteProviderConfig: vi.fn(),
  discoverProviderModels: vi.fn(),
  addProviderModel: vi.fn(),
  updateProviderModel: vi.fn(),
  removeProviderModel: vi.fn(),
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
    expect(
      screen.queryByRole("checkbox", { name: "Share with the instance" }),
    ).toBeNull();
  });

  it("shows the share toggle when canShare is true", () => {
    renderScreen(true);
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

    expect(
      screen.getByRole("checkbox", { name: "共享给实例" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建" })).toBeInTheDocument();
  });
});
