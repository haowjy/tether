// Stroke icons for the chrome, drawn in currentColor on a 24-unit grid.
import type { ComponentChildren } from "preact";

function Icon({ size = 20, children }: { size?: number | undefined; children: ComponentChildren }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const ChevronLeft = () => <Icon><path d="M15 5l-7 7 7 7" /></Icon>;
export const ChevronRight = ({ size }: { size?: number | undefined }) => <Icon size={size}><path d="M9 5l7 7-7 7" /></Icon>;
export const Plus = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>;
export const Close = ({ size }: { size?: number | undefined }) => <Icon size={size}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const ToBottom = () => <Icon><path d="M12 4v12M6 10l6 6 6-6M5 20h14" /></Icon>;
export const Refresh = () => <Icon size={18}><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></Icon>;
export const Lock = () => <Icon size={28}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Icon>;
export const Keyboard = () => (
  <Icon>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </Icon>
);
export const Folder = () => <Icon><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icon>;
export const FileIcon = () => <Icon><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Icon>;
export const ImageIcon = () => <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-9 9" /></Icon>;
export const Film = () => <Icon><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9.5v5l4-2.5z" /></Icon>;
export const Gear = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Icon>
);
export const Upload = () => <Icon><path d="M12 15V4M7 9l5-5 5 5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></Icon>;
export const Eye = () => <Icon><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Icon>;
export const EyeOff = () => <Icon><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Icon>;
export const Wrap = () => <Icon><path d="M3 6h18M3 12h15a3 3 0 0 1 0 6h-4M14 15l-3 3 3 3M3 18h6" /></Icon>;
export const Play = () => <Icon><path d="M7 4.5v15l12-7.5z" /></Icon>;
/** `[⊞]`: the extended panel (plan.md "Layout"); the file manager is its first part. */
export const Panel = () => <Icon><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></Icon>;
export const History = () => <Icon size={14}><path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v4h4" /><path d="M12 7v5l3 2" /></Icon>;
