"use client";
/**
 * Copy text, also on plain-http pages. Browsers only expose navigator.clipboard in a secure context
 * (https or http://localhost); opening the app by its LAN IP over http leaves it undefined. There we
 * fall back to a hidden textarea + document.execCommand("copy"), which browsers still allow from a
 * click. Returns false when nothing was copied, so callers never claim "Copied" falsely.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof window !== "undefined" && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // permission denied or document not focused: try the fallback
    }
  }
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

/** Select an element's text so the person can press Ctrl+C / Cmd+C themselves. */
export function selectText(el: HTMLElement | null) {
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
