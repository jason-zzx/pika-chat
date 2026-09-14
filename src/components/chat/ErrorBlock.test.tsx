import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ErrorBlock from "./ErrorBlock";

const PROVIDER_PAYLOAD = JSON.stringify(
  {
    message: "The model `foo` does not exist",
    type: "invalid_request_error",
    param: "model",
    code: "model_not_found",
  },
  null,
  2,
);

describe("ErrorBlock", () => {
  it("announces the error text", () => {
    render(<ErrorBlock text="Provider request failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Provider request failed",
    );
  });

  it("preserves the indentation of a JSON provider payload", () => {
    const { container } = render(<ErrorBlock text={PROVIDER_PAYLOAD} />);
    const body = container.querySelector("pre");
    // Whitespace must survive: indentation is what makes the payload readable.
    expect(body?.textContent).toBe(PROVIDER_PAYLOAD);
    expect(body?.className).toMatch(/\bwhitespace-pre-wrap\b/);
  });

  // A gateway can return a large error document; the block has to bound
  // itself rather than push the transcript and composer off-screen.
  it("caps its height and scrolls instead of growing without limit", () => {
    const { container } = render(
      <ErrorBlock text={JSON.stringify({ error: "x".repeat(20_000) })} />,
    );
    const body = container.querySelector("pre");
    expect(body?.className).toMatch(/\bmax-h-\S+/);
    expect(body?.className).toMatch(/\boverflow-auto\b/);
    // Long unbroken tokens must wrap, or the cap would not contain them.
    expect(body?.className).toMatch(/\bbreak-words\b/);
  });
});
