import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteSearchProvider,
  listSearchProviders,
  reorderSearchProviders,
  upsertSearchProvider,
} from "@/lib/api/search-provider";
import type { SearchProviderSetting } from "@/lib/schemas/search-provider";

import SearchProvidersScreen from "./SearchProvidersScreen";

vi.mock("@/lib/api/search-provider", () => ({
  listSearchProviders: vi.fn(),
  upsertSearchProvider: vi.fn(),
  deleteSearchProvider: vi.fn(),
  reorderSearchProviders: vi.fn(),
}));

function setting(
  provider: SearchProviderSetting["provider"],
  position: number,
): SearchProviderSetting {
  return {
    provider,
    baseUrl: null,
    apiKeyLastFour: "1234",
    position,
    updatedAt: new Date().toISOString(),
  };
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SearchProvidersScreen />
    </QueryClientProvider>,
  );
}

async function cardOf(name: string): Promise<HTMLElement> {
  const label = await screen.findByText(name);
  const card = label.closest("article");
  expect(card).not.toBeNull();
  if (card === null) {
    throw new Error(`no card for ${name}`);
  }
  return card;
}

beforeEach(() => {
  vi.mocked(listSearchProviders).mockReset();
  vi.mocked(upsertSearchProvider).mockReset().mockResolvedValue(setting("tavily", 0));
  vi.mocked(deleteSearchProvider).mockReset().mockResolvedValue(undefined);
  vi.mocked(reorderSearchProviders)
    .mockReset()
    .mockResolvedValue({ providers: [] });
});

describe("SearchProvidersScreen", () => {
  it("shows every provider: configured ones in fallback order, the rest as add forms", async () => {
    vi.mocked(listSearchProviders).mockResolvedValue({
      providers: [setting("exa", 0), setting("tavily", 1)],
    });
    renderScreen();

    expect(await screen.findByText("Exa")).toBeInTheDocument();
    expect(screen.getByText("Tavily")).toBeInTheDocument();
    expect(screen.getByText("Firecrawl")).toBeInTheDocument();
    expect(screen.getByText("Brave Search")).toBeInTheDocument();

    // Configured providers mask the stored key in the input placeholder.
    expect(
      within(await cardOf("Exa")).getByLabelText("API key"),
    ).toHaveAttribute("placeholder", "····1234");
  });

  it("keeps Add disabled until a key is entered, then submits key and base URL", async () => {
    vi.mocked(listSearchProviders).mockResolvedValue({ providers: [] });
    renderScreen();

    expect(
      await screen.findByText("No search providers yet"),
    ).toBeInTheDocument();

    const card = await cardOf("Tavily");
    const addButton = within(card).getByRole("button", { name: "Add" });
    expect(addButton).toBeDisabled();

    fireEvent.change(within(card).getByLabelText("API key"), {
      target: { value: "  tvly-secret  " },
    });
    expect(addButton).toBeEnabled();
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(upsertSearchProvider).toHaveBeenCalledWith("tavily", {
        apiKey: "tvly-secret",
        baseUrl: null,
      });
    });
  });

  it("omits the API key on save when the masked field is left empty", async () => {
    vi.mocked(listSearchProviders).mockResolvedValue({
      providers: [setting("tavily", 0)],
    });
    renderScreen();

    const card = await cardOf("Tavily");
    const input = within(card).getByLabelText("API key");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(within(card).getByLabelText("Base URL (optional)"), {
      target: { value: "https://proxy.example.com" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(upsertSearchProvider).toHaveBeenCalledWith("tavily", {
        baseUrl: "https://proxy.example.com",
      });
    });
  });

  it("reorders with up/down buttons and persists the new order", async () => {
    vi.mocked(listSearchProviders).mockResolvedValue({
      providers: [setting("tavily", 0), setting("exa", 1)],
    });
    renderScreen();

    const moveDown = await screen.findByRole("button", {
      name: "Move Tavily down",
    });
    expect(
      screen.getByRole("button", { name: "Move Tavily up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Exa down" }),
    ).toBeDisabled();

    fireEvent.click(moveDown);
    await waitFor(() => {
      expect(reorderSearchProviders).toHaveBeenCalledWith({
        providers: ["exa", "tavily"],
      });
    });
  });

  it("deletes a configured provider", async () => {
    vi.mocked(listSearchProviders).mockResolvedValue({
      providers: [setting("tavily", 0)],
    });
    renderScreen();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete" }),
    );
    await waitFor(() => {
      expect(deleteSearchProvider).toHaveBeenCalledWith("tavily");
    });
  });

  it("surfaces a load failure", async () => {
    vi.mocked(listSearchProviders).mockRejectedValue({
      error: { code: "INTERNAL", message: "boom" },
    });
    renderScreen();

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });
});
