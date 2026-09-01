"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { persistTheme } from "@/components/layout/use-theme-sync";
import { Button } from "@/components/ui/button";
import type { ThemeMode } from "@/lib/theme";

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

type ThemeControlProps = {
  initialMode: ThemeMode;
};

export default function ThemeControl({ initialMode }: ThemeControlProps) {
  const router = useRouter();
  const [mode, setMode] = useState<ThemeMode>(initialMode);

  function onSelect(next: ThemeMode) {
    setMode(next);
    persistTheme(next);
    router.refresh();
  }

  return (
    <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-1">
      {MODES.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={mode === option.value ? "secondary" : "ghost"}
          role="radio"
          aria-checked={mode === option.value}
          onClick={() => onSelect(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
