import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_PRESETS, type ThemePreference } from "@/lib/theme";
import { renderWithIntl } from "@/test-utils/render-with-intl";

import ThemePresetControl from "./ThemePresetControl";

const { updatePreference } = vi.hoisted(() => ({
  updatePreference: vi.fn(),
}));

let mockPreference: ThemePreference = { mode: "light", preset: "default" };

vi.mock("@/hooks/use-update-theme-preference", () => ({
  useUpdateThemePreference: () => ({
    preference: mockPreference,
    updatePreference,
  }),
}));

describe("ThemePresetControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreference = { mode: "light", preset: "default" };
  });

  it("renders one button per preset with the default selected", () => {
    renderWithIntl(
      <ThemePresetControl initialPreference={mockPreference} />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(THEME_PRESETS.length);
    expect(screen.getByRole("button", { name: "Default" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Ocean" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls the update hook with the clicked preset, preserving the mode", () => {
    mockPreference = { mode: "dark", preset: "default" };
    renderWithIntl(
      <ThemePresetControl initialPreference={mockPreference} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Paper" }));

    expect(updatePreference).toHaveBeenCalledWith({
      mode: "dark",
      preset: "paper",
    });
  });

  it("marks the current preset as selected", () => {
    mockPreference = { mode: "system", preset: "rose" };
    renderWithIntl(
      <ThemePresetControl initialPreference={mockPreference} />,
    );

    expect(screen.getByRole("button", { name: "Rose" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Default" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders localized preset names", () => {
    renderWithIntl(
      <ThemePresetControl initialPreference={mockPreference} />,
      { locale: "zh-CN" },
    );

    expect(
      screen.getByRole("button", { name: "深海" }),
    ).toBeInTheDocument();
  });
});
