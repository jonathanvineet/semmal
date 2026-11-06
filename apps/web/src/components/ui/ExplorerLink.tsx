"use client";
/** A short hash or address that opens the right block explorer in a new tab. */
export function ExplorerLink({ href, value, label, n = 8 }: { href: string | null; value?: string | null; label?: string; n?: number }) {
  const text = label ?? (value ? (value.length > n * 2 + 2 ? `${value.slice(0, n)}…${value.slice(-6)}` : value) : "—");
  if (!href) return <span className="mono">{text}</span>;
  return (
    <a className="link mono xl" href={href} target="_blank" rel="noreferrer" title={value ?? undefined}>
      {text} <span aria-hidden="true">↗</span>
    </a>
  );
}
