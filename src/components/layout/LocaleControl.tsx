"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setLocaleCookie } from "@/i18n/actions";
import { isLocale, LOCALE_LABELS, locales } from "@/i18n/locales";

/**
 * Language switcher for Settings → General. Persistence goes through a Server
 * Action that sets the NEXT_LOCALE cookie — a `document.cookie` write would
 * not re-render the server tree (next-intl #2162).
 */
export default function LocaleControl() {
  const locale = useLocale();
  const t = useTranslations("Layout");
  const [pending, startTransition] = useTransition();

  function selectLocale(next: string) {
    if (!isLocale(next) || next === locale) {
      return;
    }
    startTransition(() => {
      void setLocaleCookie(next);
    });
  }

  return (
    <Select
      value={locale}
      disabled={pending}
      onValueChange={(next) => {
        if (typeof next === "string") {
          selectLocale(next);
        }
      }}
    >
      <SelectTrigger aria-label={t("locale.label")} className="w-56">
        <SelectValue>{LOCALE_LABELS[locale]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {locales.map((value) => (
          <SelectItem key={value} value={value}>
            {LOCALE_LABELS[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
