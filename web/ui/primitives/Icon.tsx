import type { SVGAttributes } from "preact";

const PATHS = {
  home: <path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z" />,
  back: <path d="m14 5-7 7 7 7" />,
  sessions: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 9v11" /></>,
  folder: <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11H3Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  keyboard: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M7 16h10" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
  terminal: <path d="m4 7 5 5-5 5m8 0h8" />,
  file: <path d="M5 3h9l5 5v13H5ZM14 3v6h5" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1m0-14.2L17 7M7 17l-2.1 2.1" /></>,
  upload: <path d="M12 15V4M7 9l5-5 5 5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />,
  check: <path d="m5 12 5 5 9-10" />,
  alert: <><path d="M12 4 3 20h18Z" /><path d="M12 10v4M12 17h.01" /></>,
  up: <path d="M12 19V5M5 12l7-7 7 7" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m21 16-5-5-9 9" /></>,
  film: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9.5v5l4-2.5z" /></>,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
} as const;

export type IconName = keyof typeof PATHS;
export type IconSize = 16 | 20 | 24;

interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "size"> {
  name: IconName;
  size?: IconSize;
}

/** One owned set of stroke icons on a 24-unit grid, drawn in the current text colour. Decorative: name the control, not the icon. */
export function Icon({ name, size = 20, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
