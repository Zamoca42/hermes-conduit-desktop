/** The line icons from the mockups (24-unit grid, 1.7 stroke). */
const paths = {
  chats: <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2H9l-5 4z" />,
  bots: (
    <>
      <circle cx="9" cy="9" r="3" />
      <circle cx="16.5" cy="9.5" r="2.5" />
      <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5M14 15c2.5-.6 5 .7 6 3.5" />
    </>
  ),
  tasks: <path d="M4 7l2 2 3-3M4 16l2 2 3-3M12 8h8M12 17h8" />,
  pulse: <path d="M3 12h4l2-5 4 10 2-5h6" />,
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  minimize: <path d="M6 12h12" />,
  maximize: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  close: <path d="M7 7l10 10M17 7L7 17" />,
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  code: <path d="M8 8l-4 4 4 4M16 8l4 4-4 4" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  spinner: <path d="M12 4a8 8 0 108 8" />,
  attach: <path d="M12 5v14M5 12h14" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </>
  )
} as const

export type IconName = keyof typeof paths

export function Icon({ name, style }: { name: IconName; style?: React.CSSProperties }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true" style={style}>
      {paths[name]}
    </svg>
  )
}
