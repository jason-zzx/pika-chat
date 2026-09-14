import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ListedFile } from "@/lib/schemas/file";
import { renderWithIntl, wrapWithIntl } from "@/test-utils/render-with-intl";

import FilesList from "./FilesList";

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

function renderList(
  files: ListedFile[],
  overrides: Partial<Parameters<typeof FilesList>[0]> = {},
) {
  return renderWithIntl(
    <FilesList
      files={files}
      selectedIds={new Set()}
      onToggleSelect={vi.fn()}
      onToggleAll={vi.fn()}
      onPreview={vi.fn()}
      onDelete={vi.fn()}
      {...overrides}
    />,
  );
}

describe("FilesList", () => {
  it("renders name, size, date, and the category badge", () => {
    renderList([file()]);

    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText("1.2 KB")).toBeInTheDocument();
    expect(screen.getByText("Jan 5, 2026")).toBeInTheDocument();
    expect(screen.getByText("Document")).toBeInTheDocument();
    expect(screen.queryByText("In use")).toBeNull();
  });

  it("renders a pending (sizeBytes 0) row without crashing", () => {
    renderList([file({ sizeBytes: 0, extractionStatus: "none" })]);

    expect(screen.getByText("0 B")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("marks a referenced row in use and disables its delete action", () => {
    renderList([file({ referenced: true })]);

    expect(screen.getByText("In use")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete notes.txt" }),
    ).toBeDisabled();
  });

  it("points a disabled delete action at the in-use badge for its reason", () => {
    renderList([file({ referenced: true })]);

    const deleteButton = screen.getByRole("button", {
      name: "Delete notes.txt",
    });
    const describedBy = deleteButton.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("In use");
  });

  it("keeps row actions always visible rather than hover-revealed", () => {
    renderList([file()]);

    const deleteButton = screen.getByRole("button", {
      name: "Delete notes.txt",
    });
    expect(deleteButton).toBeInTheDocument();
    expect(deleteButton.closest('[class*="opacity-0"]')).toBeNull();
    expect(deleteButton.closest('[class*="group-hover"]')).toBeNull();
  });

  it("previews an image through the callback", () => {
    const onPreview = vi.fn();
    renderList(
      [file({ mediaType: "image/png", filename: "pic.png" })],
      { onPreview },
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview pic.png" }));
    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "pic.png" }),
    );
  });

  it("opens a non-image attachment in a new tab", () => {
    renderList([file({ mediaType: "application/pdf", filename: "doc.pdf" })]);

    const link = screen.getByRole("link", { name: "Open doc.pdf" });
    expect(link).toHaveAttribute("href", "/api/files/file-1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  describe("selection", () => {
    it("disables the checkbox of an in-use row and points it at the badge", () => {
      renderList([file({ referenced: true })]);

      const checkbox = screen.getByRole("checkbox", {
        name: "Select notes.txt",
      });
      // Base UI renders a span with aria-disabled rather than a disabled input.
      expect(checkbox).toHaveAttribute("aria-disabled", "true");
      const describedBy = checkbox.getAttribute("aria-describedby");
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)).toHaveTextContent(
        "In use",
      );
    });

    it("checks select-all only when every deletable loaded row is selected", () => {
      const second = file({ id: "file-2", filename: "other.txt" });
      const props = {
        files: [file(), second],
        onToggleSelect: vi.fn(),
        onToggleAll: vi.fn(),
        onPreview: vi.fn(),
        onDelete: vi.fn(),
      };
      const { rerender } = renderList([file(), second], {
        selectedIds: new Set(["file-1"]),
      });

      const selectAll = screen.getByRole("checkbox", { name: "Select all" });
      expect(selectAll).toHaveAttribute("data-indeterminate", "");

      // The intl wrapper is not persisted across RTL rerenders.
      rerender(
        wrapWithIntl(
          <FilesList {...props} selectedIds={new Set(["file-1", "file-2"])} />,
        ),
      );

      const selectAllChecked = screen.getByRole("checkbox", {
        name: "Select all",
      });
      expect(selectAllChecked).toHaveAttribute("data-checked", "");
      expect(selectAllChecked).not.toHaveAttribute("data-indeterminate");
    });

    it("disables select-all when every loaded row is in use", () => {
      renderList([file({ referenced: true })]);

      expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });
  });
});
