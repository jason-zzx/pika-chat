import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getFileLimits } from "@/lib/api/files";
import type { FileLimits } from "@/lib/schemas/file";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import UsageCard from "./UsageCard";

vi.mock("@/lib/api/files", () => ({ getFileLimits: vi.fn() }));

const LIMITS: FileLimits = {
  maxFileBytes: 20 * 1024 * 1024,
  maxAttachmentsPerMessage: 5,
  directUpload: false,
  usedBytes: 0,
  quotaBytes: null,
};

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderWithIntl(
    <QueryClientProvider client={client}>
      <UsageCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getFileLimits).mockReset();
});

describe("UsageCard", () => {
  it("shows a zero quota as a real cap rather than unlimited", async () => {
    vi.mocked(getFileLimits).mockResolvedValue({
      ...LIMITS,
      usedBytes: 0,
      quotaBytes: 0,
    });
    renderCard();

    expect(await screen.findByText("Used 0 B of 0 B (0%)")).toBeInTheDocument();
  });

  it("caps the percentage at 100 for usage over a zero quota", async () => {
    vi.mocked(getFileLimits).mockResolvedValue({
      ...LIMITS,
      usedBytes: 512,
      quotaBytes: 0,
    });
    renderCard();

    expect(
      await screen.findByText("Used 512 B of 0 B (100%)"),
    ).toBeInTheDocument();
  });

  it("shows only the used amount when the quota is unlimited", async () => {
    vi.mocked(getFileLimits).mockResolvedValue({
      ...LIMITS,
      usedBytes: 1024,
      quotaBytes: null,
    });
    renderCard();

    expect(await screen.findByText("Used 1.0 KB")).toBeInTheDocument();
    expect(screen.queryByText(/\(\d+%\)/)).toBeNull();
  });
});
