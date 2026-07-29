import React from 'react';

/**
 * Jeu d'icônes maison, tracé à 24×24 et 1,6 px de trait.
 *
 * Pourquoi pas une bibliothèque : une dépendance d'icônes pèse plus lourd que
 * ces vingt tracés, et impose sa grille. Ici l'épaisseur et les arrondis sont
 * les mêmes partout, ce qui est précisément ce qui fait qu'un jeu d'icônes a
 * l'air d'un jeu et non d'une collection.
 */

type P = { size?: number; className?: string };
const svg = (path: React.ReactNode) =>
  function Icon({ size = 18, className }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
        className={className} aria-hidden focusable="false">
        {path}
      </svg>
    );
  };

export const IconDashboard = svg(<>
  <rect x="3" y="3" width="7.5" height="8.5" rx="2" />
  <rect x="13.5" y="3" width="7.5" height="5" rx="2" />
  <rect x="13.5" y="11" width="7.5" height="10" rx="2" />
  <rect x="3" y="14.5" width="7.5" height="6.5" rx="2" />
</>);

export const IconBuilds = svg(<>
  <path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z" />
  <path d="M12 21.5V12M20.5 7 12 12 3.5 7" />
</>);

export const IconProjects = svg(<>
  <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2c.6 0 1.2.3 1.6.8l1 1.4c.4.5 1 .8 1.6.8h5.6A2.5 2.5 0 0 1 21 10.5v6A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
</>);

export const IconLink = svg(<>
  <path d="M10 13.5a4 4 0 0 0 5.7.4l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
  <path d="M14 10.5a4 4 0 0 0-5.7-.4l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
</>);

export const IconTeam = svg(<>
  <circle cx="9" cy="8" r="3.2" />
  <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" />
  <path d="M16.5 5.4a3.2 3.2 0 0 1 0 6.2M18 14.4a6.2 6.2 0 0 1 3.2 5.6" />
</>);

export const IconKey = svg(<>
  <circle cx="8" cy="12" r="4" />
  <path d="M12 12h9M18 12v3.5M15.5 12v2.5" />
</>);

export const IconSettings = svg(<>
  <circle cx="12" cy="12" r="3" />
  <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15H3.2a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V4a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z" />
</>);

export const IconHelp = svg(<>
  <circle cx="12" cy="12" r="9" />
  <path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.1-2.5 3.7" />
  <path d="M12 17.2h.01" />
</>);

export const IconSearch = svg(<>
  <circle cx="11" cy="11" r="6.5" />
  <path d="m16 16 4.5 4.5" />
</>);

export const IconPlus = svg(<path d="M12 5v14M5 12h14" />);
export const IconCheck = svg(<path d="m4.5 12.5 5 5 10-11" />);
export const IconClose = svg(<path d="m6 6 12 12M18 6 6 18" />);
export const IconChevron = svg(<path d="m9 5 7 7-7 7" />);
export const IconChevronDown = svg(<path d="m5 9 7 7 7-7" />);
export const IconDownload = svg(<>
  <path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5" />
  <path d="M4 17.5v1A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-1" />
</>);
export const IconRerun = svg(<>
  <path d="M20 11.5A8 8 0 1 1 17.5 6" />
  <path d="M20.5 4v4.5H16" />
</>);
export const IconTrash = svg(<>
  <path d="M4 6.5h16M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
  <path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.5" />
</>);
export const IconStop = svg(<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />);
export const IconSun = svg(<>
  <circle cx="12" cy="12" r="4" />
  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
</>);
export const IconMoon = svg(<path d="M20 14.2A8.5 8.5 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2" />);
export const IconLogout = svg(<>
  <path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2" />
  <path d="M10 12h11M18 9l3 3-3 3" />
</>);
export const IconMenu = svg(<path d="M4 7h16M4 12h16M4 17h16" />);
export const IconClock = svg(<>
  <circle cx="12" cy="12" r="9" />
  <path d="M12 7v5.2l3.2 2" />
</>);
export const IconAlert = svg(<>
  <path d="M12 4.5 21 20H3z" />
  <path d="M12 10v4M12 17h.01" />
</>);
export const IconDoc = svg(<>
  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
  <path d="M14 3v5h5M9 13h6M9 17h4" />
</>);
export const IconGithub = svg(
  <path d="M12 2.5a9.5 9.5 0 0 0-3 18.5c.5.1.7-.2.7-.5v-1.7c-2.6.6-3.2-1.2-3.2-1.2-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.1-.2-4.3-1-4.3-4.6 0-1 .4-1.9 1-2.5-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.6 1a9 9 0 0 1 4.7 0c1.8-1.3 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.6.6.6 1 1.5 1 2.5 0 3.6-2.2 4.4-4.3 4.6.3.3.6.9.6 1.8v2.6c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.5" />,
);
