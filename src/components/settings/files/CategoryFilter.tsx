"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  FILE_LIST_CATEGORIES,
  type FileListCategory,
} from "@/lib/files/media-types";

type CategoryFilterProps = {
  value: FileListCategory | null;
  onChange: (value: FileListCategory | null) => void;
};

// Hoisted so the JSX carries no bare string literal (i18next/no-literal-string).
const ALL_FILTER_KEY = "all";

const FILTER_LABEL_KEYS = {
  image: "filterImage",
  document: "filterDocument",
  audio: "filterAudio",
  video: "filterVideo",
} as const;

/** Coarse type filter above the list. Switching resets pagination via the key. */
export default function CategoryFilter({
  value,
  onChange,
}: CategoryFilterProps) {
  const t = useTranslations("Settings.Files");
  const options: { key: FileListCategory | null; label: string }[] = [
    { key: null, label: t("filterAll") },
    ...FILE_LIST_CATEGORIES.map((category) => ({
      key: category,
      label: t(FILTER_LABEL_KEYS[category]),
    })),
  ];

  return (
    <div
      role="group"
      aria-label={t("filterLabel")}
      className="flex flex-wrap gap-1.5"
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Button
            key={option.key ?? ALL_FILTER_KEY}
            type="button"
            size="sm"
            variant={active ? "secondary" : "outline"}
            aria-pressed={active}
            onClick={() => onChange(option.key)}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
