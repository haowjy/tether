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
export const KeyboardHide = () => (
  <Icon>
    <rect x="2.5" y="3.5" width="19" height="11" rx="2" />
    <path d="M6 7.5h.01M10 7.5h.01M14 7.5h.01M18 7.5h.01M7 11h10M9 18l3 3 3-3" />
  </Icon>
);
