"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useSidebar } from "@/components/ui/sidebar";

type CloseOnNavigateLinkProps = {
  href: string;
  children: ReactNode;
};

export default function CloseOnNavigateLink({
  href,
  children,
}: CloseOnNavigateLinkProps) {
  const { setOpenMobile } = useSidebar();

  return (
    <Link
      href={href}
      className="font-semibold tracking-tight"
      onClick={() => setOpenMobile(false)}
    >
      {children}
    </Link>
  );
}
