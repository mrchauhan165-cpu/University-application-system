import type { SVGProps } from 'react';

type Props = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: Props, children: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Home: (p: Props) => base(p, <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></>),
  File: (p: Props) => base(p, <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>),
  Plus: (p: Props) => base(p, <><path d="M12 5v14M5 12h14" /></>),
  Inbox: (p: Props) => base(p, <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" /></>),
  History: (p: Props) => base(p, <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></>),
  Bell: (p: Props) => base(p, <><path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" /><path d="M10.3 21a2 2 0 0 0 3.4 0" /></>),
  Search: (p: Props) => base(p, <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  Menu: (p: Props) => base(p, <><path d="M4 7h16M4 12h16M4 17h16" /></>),
  Close: (p: Props) => base(p, <><path d="M6 6l12 12M18 6 6 18" /></>),
  Check: (p: Props) => base(p, <><path d="m4 12.5 5 5L20 6.5" /></>),
  Chevron: (p: Props) => base(p, <><path d="m9 6 6 6-6 6" /></>),
  Down: (p: Props) => base(p, <><path d="m6 9 6 6 6-6" /></>),
  Users: (p: Props) => base(p, <><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16.5 5.2a3.2 3.2 0 0 1 0 5.6" /><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>),
  Building: (p: Props) => base(p, <><path d="M4 21V5.5L13 3v18" /><path d="M13 9h6.5V21" /><path d="M7.5 8h2M7.5 12h2M7.5 16h2M16 12.5h1M16 16.5h1" /><path d="M2.5 21h19" /></>),
  Layers: (p: Props) => base(p, <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /><path d="m3 17.5 9 5 9-5" /></>),
  Chart: (p: Props) => base(p, <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
  Settings: (p: Props) => base(p, <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  Shield: (p: Props) => base(p, <><path d="M12 3 4.5 6v6c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6z" /><path d="m9 12 2 2 4-4" /></>),
  Workflow: (p: Props) => base(p, <><rect x="3" y="3" width="7" height="5" rx="1.4" /><rect x="14" y="16" width="7" height="5" rx="1.4" /><path d="M6.5 8v5a3 3 0 0 0 3 3h4.5" /><path d="m12 13.5 2.5 2.5L12 18.5" /></>),
  Archive: (p: Props) => base(p, <><rect x="3" y="4" width="18" height="4" rx="1.2" /><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>),
  Download: (p: Props) => base(p, <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></>),
  Upload: (p: Props) => base(p, <><path d="M12 20V8" /><path d="m7 13 5-5 5 5" /><path d="M4 4h16" /></>),
  Lock: (p: Props) => base(p, <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>),
  Logout: (p: Props) => base(p, <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>),
  Info: (p: Props) => base(p, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>),
  Alert: (p: Props) => base(p, <><path d="M12 3 2.5 20h19z" /><path d="M12 9v4" /><path d="M12 16.5h.01" /></>),
  CheckCircle: (p: Props) => base(p, <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>),
  Clock: (p: Props) => base(p, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  XCircle: (p: Props) => base(p, <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>),
  Book: (p: Props) => base(p, <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z" /><path d="M4 18.5V5.5" /><path d="M8 7.5h8M8 11h5" /></>),
  Help: (p: Props) => base(p, <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7" /><path d="M12 17h.01" /></>),
  Eye: (p: Props) => base(p, <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12" /><circle cx="12" cy="12" r="2.8" /></>),
  Send: (p: Props) => base(p, <><path d="m21.5 3-9.5 18-2.4-7.1L2.5 11z" /><path d="M21.5 3 9.6 13.9" /></>),
  Undo: (p: Props) => base(p, <><path d="M3 10h10a5 5 0 0 1 0 10H8" /><path d="M3 10l4-4M3 10l4 4" /></>),
  Trash: (p: Props) => base(p, <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" /><path d="M10 11v6M14 11v6" /></>),
  Copy: (p: Props) => base(p, <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H5.5A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15H6" /></>),
  Filter: (p: Props) => base(p, <><path d="M3 5h18l-7 8.5V20l-4-2v-4.5z" /></>),
  Swap: (p: Props) => base(p, <><path d="M4 8h13" /><path d="m14 5 3 3-3 3" /><path d="M20 16H7" /><path d="m10 13-3 3 3 3" /></>),
};

export type IconName = keyof typeof Icon;
