"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTemporaryTopicStore } from "@/stores/temporary-topic-store";

type CloseOnNavigateLinkProps = {
  href: string;
  children: ReactNode;
  tooltip: string;
};

export default function CloseOnNavigateLink({
  href,
  children,
  tooltip,
}: CloseOnNavigateLinkProps) {
  const { isMobile, state, setOpenMobile } = useSidebar();

  const link = (
    <Link
      href={href}
      className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight"
      onClick={() => {
        setOpenMobile(false);
        useTemporaryTopicStore.getState().requestLeaveTemporaryTopic();
      }}
    >
      {children}
    </Link>
  );

  return (
    <Tooltip>
      <TooltipTrigger delay={0} render={link} />
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== "collapsed" || isMobile}
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
