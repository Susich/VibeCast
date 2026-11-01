import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M8 5.8c0-1.1 1.2-1.8 2.1-1.2l10 6.2c.9.5.9 1.9 0 2.4l-10 6.2c-.9.6-2.1-.1-2.1-1.2V5.8Z" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <rect x="6" y="5" width="4" height="14" rx="1.4" />
      <rect x="14" y="5" width="4" height="14" rx="1.4" />
    </svg>
  );
}

export function SkipBackIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="M6 5v14" />
        <path d="M18 6.5v11L9 12l9-5.5Z" fill="currentColor" stroke="none" />
      </>
    ),
  });
}

export function SkipForwardIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="M18 5v14" />
        <path d="M6 6.5v11L15 12 6 6.5Z" fill="currentColor" stroke="none" />
      </>
    ),
  });
}

export function SearchIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.2 4.2" />
      </>
    ),
  });
}

export function MusicIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="M9 18V5.5l10-2v12" />
        <circle cx="6.5" cy="18" r="2.5" />
        <circle cx="16.5" cy="15.5" r="2.5" />
      </>
    ),
  });
}

export function DiscIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
  });
}

export function UsersIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 19c.4-2.8 2.5-4.4 5.5-4.4s5.1 1.6 5.5 4.4" />
        <path d="M16 5.4a3.1 3.1 0 0 1 0 5.2M17.5 14.8c1.8.5 2.9 1.9 3.1 4.2" />
      </>
    ),
  });
}

export function ListMusicIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="M4 6h9M4 10h9M4 14h6" />
        <path d="M18 4v11.5" />
        <circle cx="15.5" cy="18" r="2.5" />
      </>
    ),
  });
}

export function SettingsIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
  });
}

export function WifiOffIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="m3 3 18 18" />
        <path d="M8.5 8.6A12 12 0 0 1 21 9.8M3 9.8a12 12 0 0 1 2.6-.8M6.4 13.2a8 8 0 0 1 4-1.2M17.5 13.1a8 8 0 0 1 1.9.5M9.6 16.6a4 4 0 0 1 4.8.1" />
        <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
      </>
    ),
  });
}

export function RefreshIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="M20 5v5h-5" />
        <path d="M19.2 14a7.5 7.5 0 1 1-1.6-6.5L20 10" />
      </>
    ),
  });
}

export function DownloadIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="M12 3v12" />
        <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
        <path d="M4 20h16" />
      </>
    ),
  });
}

export function VolumeIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="M4 9.5v5h3l4.5 3.5V6L7 9.5H4Z" />
        <path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11" />
      </>
    ),
  });
}

export function VolumeOffIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="M4 9.5v5h3l4.5 3.5V6L7 9.5H4Z" />
        <path d="m16 9.5 5 5M21 9.5l-5 5" />
      </>
    ),
  });
}

export function XIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
  });
}

export function CheckIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="m4 12.5 5 5L20 6.5" />
      </>
    ),
  });
}

export function FolderIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="M3.5 7.5A2 2 0 0 1 5.5 5h4l2 2.5h7a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z" />
      </>
    ),
  });
}

export function TrashIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 13h9.4l.8-13M10 11v5M14 11v5" />
      </>
    ),
  });
}

export function LinkIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="M10 13.5a4 4 0 0 0 5.6 0l2.9-2.9a4 4 0 1 0-5.7-5.7L11.5 6" />
        <path d="M14 10.5a4 4 0 0 0-5.6 0l-2.9 2.9a4 4 0 1 0 5.7 5.7l1.3-1.1" />
      </>
    ),
  });
}

export function SmartphoneIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
        <path d="M10 5h4M11 18.8h2" />
      </>
    ),
  });
}

export function ServerIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <rect x="3" y="4" width="18" height="6.5" rx="2" />
        <rect x="3" y="13.5" width="18" height="6.5" rx="2" />
        <path d="M7 7.2h.01M7 16.8h.01" />
      </>
    ),
  });
}

export function SpinnerIcon(props: IconProps) {
  return (
    <svg width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2.4" opacity=".2" />
      <path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function QueueIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <path d="M4 7h11M4 12h11M4 17h7" />
        <path d="m16 15 5 3-5 3v-6Z" fill="currentColor" stroke="none" />
      </>
    ),
  });
}

export function ChevronLeftIcon(props: IconProps) {
  return base({
    ...props,
    children: <path d="m15 5-7 7 7 7" />,
  });
}

export function ChevronRightIcon(props: IconProps) {
  return base({
    ...props,
    children: <path d="m9 5 7 7-7 7" />,
  });
}

export function RadioIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
        <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.7 4.7a10.4 10.4 0 0 0 0 14.6M19.3 4.7a10.4 10.4 0 0 1 0 14.6" />
      </>
    ),
  });
}

export function OverlayIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <rect x="11" y="11" width="8" height="8" rx="1.5" fill="currentColor" opacity="0.3" />
        <path d="M11 11h8v8h-8z" />
      </>
    ),
  });
}

export function ExpandIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </>
    ),
  });
}

export function PaletteIcon(props: IconProps) {
  return base({
    ...props,
    children: (
      <>
        <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
        <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
        <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
        <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
      </>
    ),
  });
}
