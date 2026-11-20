import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  discoverProviderModels,
  syncProviderModels,
} from "@/lib/api/provider";
import type { Locale } from "@/i18n/locales";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import DiscoverModelsDialog from "./DiscoverModelsDialog";

vi.mock("@/lib/api/provider", () => ({
  discoverProviderModels: vi.fn(),
  syncProviderModels: vi.fn(),
}));

const discoverMock = vi.mocked(discoverProviderModels);
const syncMock = vi.mocked(syncProviderModels);

function renderDialog({
  existingModelIds = ["gpt-4o", "removed-upstream", "custom-model"],
  locale = "en",
  onOpenChange = vi.fn(),
}: {
  existingModelIds?: string[];
  locale?: Locale;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    onOpenChange,
    ...renderWithIntl(
      <QueryClientProvider client={client}>
        <DiscoverModelsDialog
          configId="cfg-1"
          configName="Relay"
          existingModelIds={existingModelIds}
          open
          onOpenChange={onOpenChange}
        />
      </QueryClientProvider>,
      { locale },
    ),
  };
}

describe("DiscoverModelsDialog", () => {
  beforeEach(() => {
    discoverMock.mockReset();
    syncMock.mockReset();
  });

  it("auto-fetches on open and splits into available and not-returned tabs with existing models checked", async () => {
    discoverMock.mockResolvedValue({
      modelIds: ["gpt-4o", "gpt-4.1", "o3"],
    });

    renderDialog();

    expect(screen.getByText("Fetching from upstream…")).toBeInTheDocument();
    expect(discoverMock).toHaveBeenCalledTimes(1);
    expect(discoverMock).toHaveBeenCalledWith("cfg-1");

    const availableTab = await screen.findByRole("tab", {
      name: "Available 3",
    });
    const missingTab = screen.getByRole("tab", { name: "Not returned 2" });
    expect(availableTab).toHaveAttribute("aria-selected", "true");
    expect(missingTab).toHaveAttribute("aria-selected", "false");

    expect(screen.getByRole("button", { name: /gpt-4o/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /gpt-4\.1/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).toBeDisabled();

    fireEvent.click(missingTab);
    expect(missingTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("button", { name: /removed-upstream/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /custom-model/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("syncs added and unchecked models in a single batch call", async () => {
    discoverMock.mockResolvedValue({
      modelIds: ["gpt-4o", "gpt-4.1", "o3"],
    });
    syncMock.mockResolvedValue({
      models: [],
      addedCount: 1,
      removedCount: 1,
    });
    const onOpenChange = vi.fn();

    renderDialog({ onOpenChange });

    await screen.findByRole("tab", { name: "Available 3" });
    fireEvent.click(screen.getByRole("button", { name: /gpt-4\.1/ }));
    expect(screen.getByRole("button", { name: "Add 1" })).toBeEnabled();

    fireEvent.click(screen.getByRole("tab", { name: "Not returned 2" }));
    fireEvent.click(screen.getByRole("button", { name: /removed-upstream/ }));

    const saveButton = screen.getByRole("button", { name: "Save (+1 / -1)" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(syncMock).toHaveBeenCalledTimes(1);
    });
    expect(syncMock).toHaveBeenCalledWith("cfg-1", {
      add: ["gpt-4.1"],
      remove: ["removed-upstream"],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("allows retrying when the initial fetch fails", async () => {
    discoverMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ modelIds: ["gpt-4o"] });

    renderDialog();

    expect(
      await screen.findByText("Unable to fetch models from upstream"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("tab", { name: "Available 1" }),
    ).toBeInTheDocument();
    expect(discoverMock).toHaveBeenCalledTimes(2);
  });

  it("warns when upstream returns zero models and scopes Uncheck all to filtered results", async () => {
    discoverMock.mockResolvedValue({ modelIds: [] });

    renderDialog({ existingModelIds: ["old-a", "old-b", "keep-c"] });

    await screen.findByRole("tab", { name: "Available 0" });
    expect(screen.getByText("Upstream returned no models.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Not returned 3" }));
    expect(
      screen.getByText(
        "Upstream returned 0 models. Check the endpoint before removing existing models.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search models…"), {
      target: { value: "old" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Uncheck all" }));

    expect(screen.getByRole("button", { name: "Remove 2" })).toBeEnabled();

    fireEvent.change(screen.getByPlaceholderText("Search models…"), {
      target: { value: "" },
    });
    expect(screen.getByRole("button", { name: /keep-c/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders zh-CN copy", async () => {
    discoverMock.mockResolvedValue({ modelIds: ["gpt-4o", "gpt-4.1"] });

    renderDialog({
      existingModelIds: ["gpt-4o", "legacy-1"],
      locale: "zh-CN",
    });

    expect(await screen.findByRole("tab", { name: "现有模型 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "未返回模型 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "从上游获取" })).toBeInTheDocument();
  });
});
