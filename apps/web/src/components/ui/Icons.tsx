/** Interface glyphs (line icons drawn for this UI; no third-party logos). */
type P = { size?: number };
const base = (size = 20) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true });

export const IconVision = ({ size }: P) => (
  <svg {...base(size)}><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const IconInspect = ({ size }: P) => (
  <svg {...base(size)}><rect x="4" y="3" width="13" height="17" rx="2" /><path d="M8 8h5M8 12h3" /><circle cx="16.5" cy="16.5" r="3" /><path d="m19 19 2.5 2.5" /></svg>
);
export const IconWrench = ({ size }: P) => (
  <svg {...base(size)}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3.6 17.2a1.6 1.6 0 0 0 2.3 2.3l5.7-5.7a4 4 0 0 0 5.2-5.4l-2.5 2.5-2.1-.4-.4-2.1 2.5-2.5Z" /></svg>
);
export const IconRoute = ({ size }: P) => (
  <svg {...base(size)}><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" /></svg>
);
export const IconLock = ({ size }: P) => (
  <svg {...base(size)}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);
export const IconShield = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 3 5 6v6c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const IconChain = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="9" width="7" height="7" rx="1.5" /><rect x="14" y="9" width="7" height="7" rx="1.5" /><path d="M10 12.5h4" /></svg>
);
export const IconClose = ({ size }: P) => (
  <svg {...base(size)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);

export const kindIcon = (kind: string, size = 20) =>
  kind === "vision" ? <IconVision size={size} /> : kind === "inspection" ? <IconInspect size={size} /> : kind === "maintenance" ? <IconWrench size={size} /> : <IconRoute size={size} />;
