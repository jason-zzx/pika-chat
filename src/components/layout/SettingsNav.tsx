"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type SettingsTab = {
  href: string;
  label: string;
  staffOnly?: boolean;
};

const TABS: SettingsTab[] = [
  { href: "/settings/general", label: "General" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/providers", label: "Providers" },
  { href: "/settings/users", label: "Users", staffOnly: true },
];

type SettingsNavProps = {
  showUsers: boolean;
};

export default function SettingsNav({ showUsers }: SettingsNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings" className="flex flex-wrap gap-1">
      {TABS.filter((tab) => !tab.staffOnly || showUsers).map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
