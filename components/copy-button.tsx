"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-mute transition hover:bg-panel-2 hover:text-ink"
    >
      {done ? "Copied" : label}
    </button>
  );
}
