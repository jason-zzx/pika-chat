"use client";

import { useEffect } from "react";

import { discardComposerDrafts } from "@/stores/composer-store";

/**
 * Mounted by the auth layout, which only renders without a session: whether
 * the page was reached by sign-out, by a full load after expiry, or by a
 * mid-session soft redirect, the previous session's drafts are dropped here.
 */
export default function DiscardComposerDrafts() {
  useEffect(discardComposerDrafts, []);
  return null;
}
