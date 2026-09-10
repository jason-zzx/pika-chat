import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@/test-utils/render-with-intl";

import LocaleControl from "./LocaleControl";

const { setLocaleCookie } = vi.hoisted(() => ({
  setLocaleCookie: vi.fn<(locale: string) => Promise<void>>(),
}));

// The server action cannot run in jsdom; assert the wiring instead (locale
// value reaching the action is what the click flow depends on).
vi.mock("@/i18n/actions", () => ({ setLocaleCookie }));

async function openSelect(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return screen.findByRole("option", { name: "English" });
}

describe("LocaleControl", () => {
  beforeEach(() => {
    setLocaleCookie.mockReset();
    setLocaleCookie.mockResolvedValue(undefined);
  });

  it("shows the active locale's native label", () => {
    renderWithIntl(<LocaleControl />);

    const trigger = screen.getByRole("combobox", { name: "Language" });
    expect(trigger).toHaveTextContent("English");
  });

  it("localizes the control label while keeping native option labels", () => {
    renderWithIntl(<LocaleControl />, { locale: "zh-CN" });

    expect(screen.getByRole("combobox", { name: "语言" })).toHaveTextContent(
      "简体中文",
    );
  });

  it("persists the chosen locale through the server action", async () => {
    renderWithIntl(<LocaleControl />);

    const trigger = screen.getByRole("combobox", { name: "Language" });
    const english = await openSelect(trigger);
    await vi.waitFor(() => expect(english).toHaveFocus());

    fireEvent.keyDown(english, { key: "ArrowDown" });
    const chinese = screen.getByRole("option", { name: "简体中文" });
    await vi.waitFor(() => expect(chinese).toHaveFocus());
    fireEvent.keyDown(chinese, { key: "Enter" });

    expect(setLocaleCookie).toHaveBeenCalledTimes(1);
    expect(setLocaleCookie).toHaveBeenCalledWith("zh-CN");
  });

  it("does not call the action when the active locale is re-selected", async () => {
    renderWithIntl(<LocaleControl />);

    const trigger = screen.getByRole("combobox", { name: "Language" });
    const english = await openSelect(trigger);
    await vi.waitFor(() => expect(english).toHaveFocus());

    fireEvent.keyDown(english, { key: "Enter" });

    expect(setLocaleCookie).not.toHaveBeenCalled();
  });
});
