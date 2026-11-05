"use client";
/**
 * A searchable, grouped dropdown in the site's soft style. Keyboard: arrows move, Enter picks,
 * Escape closes, typing filters, Home/End jump. ARIA combobox + listbox pattern.
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SelectGroup = { label: string; options: string[] };

export function Select({
  label,
  value,
  onChange,
  groups,
  placeholder = "Choose…",
  searchPlaceholder = "Search",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  groups: SelectGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({ ...g, options: g.options.filter((o) => !q || o.toLowerCase().includes(q) || g.label.toLowerCase().includes(q)) }))
      .filter((g) => g.options.length);
  }, [groups, query]);
  const flat = useMemo(() => filtered.flatMap((g) => g.options), [filtered]);

  useEffect(() => {
    if (!open) return;
    const i = flat.indexOf(value);
    setActive(i >= 0 ? i : 0);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
    trigger.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(flat.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[active]) pick(flat[active]!); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
  };

  let i = -1;
  return (
    <div className="sel" ref={root}>
      <span className="t-label muted" id={`${id}-l`}>{label}</span>
      <button
        ref={trigger}
        type="button"
        className={`sel__trigger ${open ? "is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-l ${id}-v`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
      >
        <span id={`${id}-v`} className={value ? "" : "muted"}>{value || placeholder}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="sel__chev"><path d="m5.5 8 4.5 4.5L14.5 8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="sel__pop"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="sel__search">
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="m13.2 13.2 3.3 3.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              <input
                autoFocus
                role="combobox"
                aria-expanded="true"
                aria-controls={`${id}-list`}
                aria-activedescendant={flat[active] ? `${id}-o-${active}` : undefined}
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
              />
            </div>
            <ul ref={list} id={`${id}-list`} role="listbox" aria-labelledby={`${id}-l`} className="sel__list">
              {filtered.length === 0 && <li className="sel__none muted">No match</li>}
              {filtered.map((g) => (
                <li key={g.label} role="presentation">
                  <span className="sel__group">{g.label}</span>
                  <ul role="group" aria-label={g.label}>
                    {g.options.map((o) => {
                      i++;
                      const idx = i;
                      return (
                        <li
                          key={o}
                          id={`${id}-o-${idx}`}
                          data-i={idx}
                          role="option"
                          aria-selected={o === value}
                          className={`sel__opt ${idx === active ? "is-active" : ""} ${o === value ? "is-picked" : ""}`}
                          onPointerMove={() => setActive(idx)}
                          onClick={() => pick(o)}
                        >
                          <span>{o}</span>
                          {o === value && (
                            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.5 3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
