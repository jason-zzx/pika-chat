"use client";

/**
 * Dedicated surface for error text, including upstream provider payloads.
 *
 * Provider errors arrive as indented JSON (see `describeProviderError`), so the
 * body is rendered in a monospace block with whitespace preserved and lines
 * wrapped. The block is height-capped and scrolls internally: a gateway that
 * returns a large error document must not be able to push the transcript, the
 * composer, or the message actions off-screen.
 */
type ErrorBlockProps = {
  text: string;
};

export default function ErrorBlock({ text }: ErrorBlockProps) {
  return (
    <div
      role="alert"
      className="w-full min-w-0 overflow-hidden rounded-lg border border-destructive/40 bg-destructive/5"
    >
      <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-destructive">
        {text}
      </pre>
    </div>
  );
}
