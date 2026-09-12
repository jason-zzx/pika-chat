import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@/test-utils/render-with-intl";
import type { StagedAttachment } from "@/stores/composer-store";

import AttachmentChip from "./AttachmentChip";

function stagedAttachment(
  overrides: Partial<StagedAttachment> = {},
): StagedAttachment {
  const filename = overrides.filename ?? "photo.png";
  const mediaType = overrides.mediaType ?? "image/png";
  return {
    id: "att-1",
    file: new File(["pixels"], filename, { type: mediaType }),
    filename,
    mediaType,
    sizeBytes: 2048,
    status: "ready",
    url: "/api/files/file-1",
    ...overrides,
  };
}

function renderChip(attachment: StagedAttachment) {
  return renderWithIntl(
    <AttachmentChip
      attachment={attachment}
      onRemove={() => undefined}
      onRetry={() => undefined}
    />,
  );
}

describe("AttachmentChip image preview", () => {
  it("renders a thumbnail served by the files route once the upload is ready", () => {
    const { container } = renderChip(stagedAttachment());

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("src", "/api/files/file-1");
  });

  it("shows the spinner instead of a thumbnail while uploading", () => {
    const { container } = renderChip(
      stagedAttachment({ status: "uploading", url: undefined }),
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Uploading…")).toBeInTheDocument();
  });

  it("keeps the category icon for non-image attachments", () => {
    const { container } = renderChip(
      stagedAttachment({
        filename: "notes.txt",
        mediaType: "text/plain",
      }),
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });
});
