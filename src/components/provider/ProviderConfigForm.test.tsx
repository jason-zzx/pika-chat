import { fireEvent, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CreateProviderConfigInput, OwnProviderConfig } from "@/lib/schemas/provider";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import ProviderConfigForm from "./ProviderConfigForm";

type Initial = Pick<
  OwnProviderConfig,
  "name" | "baseUrl" | "apiFormat" | "visibility"
>;

function renderForm(
  props: Partial<ComponentProps<typeof ProviderConfigForm>> = {},
) {
  const onSubmit = vi.fn<(input: CreateProviderConfigInput) => Promise<void>>();
  renderWithIntl(
    <ProviderConfigForm
      idPrefix="test"
      canShare={false}
      pending={false}
      submitLabel="Create"
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

function trigger(): HTMLElement {
  return screen.getByRole("combobox");
}

function baseUrlInput(): HTMLInputElement {
  return screen.getByLabelText("Base URL");
}

function apiKeyInput(): HTMLInputElement {
  return screen.getByLabelText("API key");
}

function openFormatList(): void {
  // Base UI's popup needs real pointer events, which jsdom lacks; the
  // combobox's own keyboard path opens it without them.
  fireEvent.keyDown(trigger(), { key: "ArrowDown" });
}

const STORED: Record<"claude" | "google", Initial> = {
  claude: {
    name: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiFormat: "claude",
    visibility: "private",
  },
  google: {
    name: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiFormat: "google",
    visibility: "private",
  },
};

describe("ProviderConfigForm", () => {
  it("defaults a new provider to openai-compatible", () => {
    renderForm();

    expect(trigger()).toHaveTextContent("OpenAI compatible");
    expect(baseUrlInput()).toHaveAttribute(
      "placeholder",
      "https://api.openai.com/v1",
    );
    expect(apiKeyInput()).not.toBeRequired();
  });

  it("offers every format in the dropdown", () => {
    renderForm();

    openFormatList();

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["OpenAI compatible", "Claude (Anthropic)", "Google (Gemini)"]);
  });

  it("shows the stored claude format and its endpoint", () => {
    renderForm({ initial: STORED.claude });

    expect(trigger()).toHaveTextContent("Claude (Anthropic)");
    expect(baseUrlInput()).toHaveAttribute(
      "placeholder",
      "https://api.anthropic.com/v1",
    );
  });

  it("shows the stored google format and its endpoint", () => {
    renderForm({ initial: STORED.google });

    expect(trigger()).toHaveTextContent("Google (Gemini)");
    expect(baseUrlInput()).toHaveAttribute(
      "placeholder",
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });

  it("never requires a key when editing, whichever format is stored", () => {
    renderForm({ initial: STORED.claude });

    expect(apiKeyInput()).not.toBeRequired();
  });

  it("submits the default format and the format's base URL when the field is blank", () => {
    const { onSubmit } = renderForm();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "local",
      baseUrl: "https://api.openai.com/v1",
      apiFormat: "openai-compatible",
      apiKey: null,
      visibility: "private",
    });
  });

  it("sends the typed base URL when the operator provides one", () => {
    const { onSubmit } = renderForm();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "relay" },
    });
    fireEvent.change(baseUrlInput(), {
      target: { value: "https://relay.example.com/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://relay.example.com/v1" }),
    );
  });

  it("keeps the stored key out of an edit submission when left blank", () => {
    const { onSubmit } = renderForm({ initial: STORED.claude });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const submitted = onSubmit.mock.calls[0]?.[0];
    expect(submitted).not.toHaveProperty("apiKey");
  });
});
