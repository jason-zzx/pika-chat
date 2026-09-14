import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteChatFile, getFileLimits, listChatFiles } from "@/lib/api/files";
import type { FileListResponse, ListedFile } from "@/lib/schemas/file";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import FilesScreen from "./FilesScreen";

vi.mock("@/lib/api/files", () => ({
  listChatFiles: vi.fn(),
  getFileLimits: vi.fn(),
  deleteChatFile: vi.fn(),
}));

const LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxAttachmentsPerMessage: 5,
  directUpload: false,
  usedBytes: 1024 * 1024,
  quotaBytes: 5 * 1024 * 1024 * 1024,
};

function file(overrides: Partial<ListedFile> = {}): ListedFile {
  return {
    id: "file-1",
    filename: "notes.txt",
    mediaType: "text/plain",
    sizeBytes: 1234,
    extractionStatus: "ok",
    createdAt: new Date(Date.UTC(2026, 0, 5)).toISOString(),
    referenced: false,
    ...overrides,
  };
}

function page(files: ListedFile[]): FileListResponse {
  return {
    files,
    totalCount: files.length,
    totalBytes: files.reduce((sum, entry) => sum + entry.sizeBytes, 0),
  };
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderWithIntl(
    <QueryClientProvider client={client}>
      <FilesScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listChatFiles).mockReset();
  vi.mocked(getFileLimits).mockReset().mockResolvedValue(LIMITS);
  vi.mocked(deleteChatFile).mockReset();
});

describe("FilesScreen", () => {
  it("shows storage usage and the attachment list", async () => {
    vi.mocked(listChatFiles).mockResolvedValue(page([file()]));
    renderScreen();

    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(
      screen.getByText("Used 1.0 MB of 5.0 GB (0%)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Attachments: 1")).toBeInTheDocument();
  });

  it("shows the empty state when there are no attachments", async () => {
    vi.mocked(listChatFiles).mockResolvedValue(page([]));
    renderScreen();

    expect(await screen.findByText("No attachments yet")).toBeInTheDocument();
  });

  it("refetches per category and shows a filtered empty state", async () => {
    vi.mocked(listChatFiles).mockImplementation(async ({ category }) =>
      category === "image" ? page([]) : page([file()]),
    );
    renderScreen();
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Images" }));

    expect(
      await screen.findByText("Nothing in this category"),
    ).toBeInTheDocument();
    expect(listChatFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0, category: "image" }),
    );
  });

  it("loads more within the active category and stops at the last page", async () => {
    const first = file({
      id: "file-1",
      filename: "one.png",
      mediaType: "image/png",
    });
    const second = file({
      id: "file-2",
      filename: "two.png",
      mediaType: "image/png",
    });
    vi.mocked(listChatFiles).mockImplementation(async ({ offset, category }) => {
      if (category !== "image") {
        return page([]);
      }
      return {
        files: offset === 0 ? [first] : [second],
        totalCount: 2,
        totalBytes: 0,
      };
    });
    renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Images" }));
    expect(await screen.findByText("one.png")).toBeInTheDocument();
    expect(listChatFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ offset: 0, category: "image" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("two.png")).toBeInTheDocument();
    await waitFor(() =>
      expect(listChatFiles).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 1, category: "image" }),
      ),
    );

    // Two image requests total: the last page adds no further fetch, and the
    // load-more control is gone.
    const imageCalls = vi
      .mocked(listChatFiles)
      .mock.calls.filter(([args]) => args.category === "image");
    expect(imageCalls.map(([args]) => args.offset)).toEqual([0, 1]);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Load more" }),
      ).toBeNull(),
    );
  });

  it("deletes an unreferenced attachment after confirmation", async () => {
    vi.mocked(listChatFiles)
      .mockResolvedValueOnce(page([file()]))
      .mockResolvedValue(page([]));
    vi.mocked(deleteChatFile).mockResolvedValue(undefined);
    renderScreen();
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete notes.txt" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteChatFile).toHaveBeenCalledWith("file-1"));
    expect(await screen.findByText("No attachments yet")).toBeInTheDocument();
  });

  it("surfaces a 409 conflict without closing the dialog", async () => {
    vi.mocked(listChatFiles).mockResolvedValue(page([file()]));
    vi.mocked(deleteChatFile).mockRejectedValue({
      error: { code: "CONFLICT", messageKey: "file.inUse" },
    });
    renderScreen();
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete notes.txt" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByText("This file is still used by a message"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("batch-deletes the selection and summarizes the skipped in-use file", async () => {
    const first = file({ id: "file-1", filename: "one.txt" });
    const second = file({ id: "file-2", filename: "two.txt" });
    vi.mocked(listChatFiles).mockResolvedValue(page([first, second]));
    vi.mocked(deleteChatFile)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({
        error: { code: "CONFLICT", messageKey: "file.inUse" },
      });
    renderScreen();
    expect(await screen.findByText("one.txt")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    expect(await screen.findByText("2 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteChatFile).toHaveBeenCalledTimes(2));
    expect(deleteChatFile).toHaveBeenCalledWith("file-1");
    expect(deleteChatFile).toHaveBeenCalledWith("file-2");
    expect(
      await screen.findByText("Deleted 1 · skipped 1 (in use)"),
    ).toBeInTheDocument();

    // Both the footer button and the dialog's X carry the name "Close";
    // the X is the one with the dialog-close slot.
    const closes = within(screen.getByRole("dialog")).getAllByRole("button", {
      name: "Close",
    });
    const closeButton = closes.find(
      (button) => button.getAttribute("data-slot") === "dialog-close",
    )!;
    fireEvent.click(closeButton);
    await waitFor(() =>
      expect(screen.queryByText("2 selected")).toBeNull(),
    );
  });

  it("clears the selection when the category changes", async () => {
    vi.mocked(listChatFiles).mockImplementation(async ({ category }) =>
      category === "image" ? page([]) : page([file()]),
    );
    renderScreen();
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select notes.txt" }),
    );
    expect(await screen.findByText("1 selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Images" }));
    expect(
      await screen.findByText("Nothing in this category"),
    ).toBeInTheDocument();
    expect(screen.queryByText("1 selected")).toBeNull();
  });
});
