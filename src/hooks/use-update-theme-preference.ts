"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { persistTheme } from "@/components/layout/use-theme-sync";
import { toast } from "@/components/ui/toast";
import { updateThemePreference } from "@/lib/api/account";
import { apiErrorMessageFromUnknown } from "@/lib/api/error-message";
import type { ThemePreference } from "@/lib/theme";

/**
 * Shared theme preference mutation: optimistic local apply (dark class,
 * data-theme, three-segment cookie), background PATCH to
 * /api/account/preferences, router.refresh() so the server tree re-reads the
 * DB, and a toast + full local revert on failure. Used by ThemeControl
 * (sidebar + settings page) and the preset picker.
 */
export function useUpdateThemePreference(initialPreference: ThemePreference) {
  const router = useRouter();
  const tErrors = useTranslations("Errors");
  const [preference, setPreference] = useState(initialPreference);
  const [prevInitial, setPrevInitial] = useState(initialPreference);
  if (
    prevInitial.mode !== initialPreference.mode ||
    prevInitial.preset !== initialPreference.preset
  ) {
    setPrevInitial(initialPreference);
    setPreference(initialPreference);
  }
  const [, startTransition] = useTransition();

  function updatePreference(next: ThemePreference) {
    const previous = preference;
    if (next.mode === previous.mode && next.preset === previous.preset) {
      return;
    }
    setPreference(next);
    persistTheme(next);
    startTransition(async () => {
      try {
        await updateThemePreference({
          themeMode: next.mode,
          themePreset: next.preset,
        });
        router.refresh();
      } catch (error) {
        setPreference(previous);
        persistTheme(previous);
        toast.add({
          type: "error",
          title: apiErrorMessageFromUnknown(
            error,
            tErrors,
            "actions.updateTheme",
          ),
        });
      }
    });
  }

  return { preference, updatePreference };
}
