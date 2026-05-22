/** Inline SVG icons — no emoji, no external deps. Stroke-based, 20x20 viewBox. */

interface IconProps {
  size?: number;
  className?: string;
}

function svg(d: string, props: IconProps = {}) {
  const s = props.size ?? 20;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
    >
      <path d={d} />
    </svg>
  );
}

/* Multi-path variant */
function svgMulti(paths: string[], props: IconProps = {}) {
  const s = props.size ?? 20;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
    >
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// ── Navigation ──────────────────────────────────────

export function IconOverview(p: IconProps) {
  return svgMulti([
    'M3 3h7v7H3z',
    'M14 3h7v7h-7z',
    'M3 14h7v7H3z',
    'M14 14h7v7h-7z',
  ], p);
}

export function IconSessions(p: IconProps) {
  return svgMulti([
    'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2',
    'M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z',
  ], p);
}

export function IconModels(p: IconProps) {
  return svgMulti([
    'M12 2L2 7l10 5 10-5-10-5z',
    'M2 17l10 5 10-5',
    'M2 12l10 5 10-5',
  ], p);
}

// ── Stats / KPI ─────────────────────────────────────

export function IconDollar(p: IconProps) {
  return svgMulti([
    'M12 1v22',
    'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  ], p);
}

export function IconClock(p: IconProps) {
  return svgMulti([
    'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0',
    'M12 6v6l4 2',
  ], p);
}

export function IconTrendUp(p: IconProps) {
  return svgMulti([
    'M23 6l-9.5 9.5-5-5L1 18',
    'M17 6h6v6',
  ], p);
}

export function IconActivity(p: IconProps) {
  return svg('M22 12h-4l-3 9L9 3l-3 9H2', p);
}

export function IconFile(p: IconProps) {
  return svgMulti([
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z',
    'M14 2v6h6',
  ], p);
}

export function IconGitCommit(p: IconProps) {
  return svgMulti([
    'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
    'M1.05 12H8',
    'M16 12h6.95',
  ], p);
}

export function IconToken(p: IconProps) {
  return svgMulti([
    'M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z',
    'M16 8L2 22',
    'M17.5 15H9',
  ], p);
}

export function IconFolder(p: IconProps) {
  return svg('M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z', p);
}

export function IconCalendar(p: IconProps) {
  return svgMulti([
    'M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
    'M16 2v4',
    'M8 2v4',
    'M3 10h18',
  ], p);
}

export function IconArrowLeft(p: IconProps) {
  return svgMulti([
    'M19 12H5',
    'M12 19l-7-7 7-7',
  ], p);
}

export function IconExternalLink(p: IconProps) {
  return svgMulti([
    'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
    'M15 3h6v6',
    'M10 14L21 3',
  ], p);
}

export function IconCircleDot(p: IconProps) {
  return svgMulti([
    'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0',
    'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  ], p);
}

export function IconHash(p: IconProps) {
  return svgMulti([
    'M4 9h16',
    'M4 15h16',
    'M10 3L8 21',
    'M16 3l-2 18',
  ], p);
}

export function IconMessageSquare(p: IconProps) {
  return svg('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z', p);
}

// ── Extra icons for insights ────────────────────────

export function IconBarChart(p: IconProps) {
  return svgMulti([
    'M12 20V10',
    'M18 20V4',
    'M6 20v-4',
  ], p);
}

export function IconDownload(p: IconProps) {
  return svgMulti([
    'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
    'M7 10l5 5 5-5',
    'M12 15V3',
  ], p);
}

export function IconZap(p: IconProps) {
  return svg('M13 2L3 14h9l-1 10 10-12h-9l1-10z', p);
}

export function IconTarget(p: IconProps) {
  return svgMulti([
    'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0',
    'M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0',
    'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ], p);
}

export function IconGitBranch(p: IconProps) {
  return svgMulti([
    'M6 3v12',
    'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M18 9a9 9 0 0 1-9 9',
  ], p);
}

export function IconBell(p: IconProps) {
  return svgMulti([
    'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9',
    'M13.73 21a2 2 0 0 1-3.46 0',
  ], p);
}

export function IconRefreshCw(p: IconProps) {
  return svgMulti([
    'M23 4v6h-6',
    'M1 20v-6h6',
    'M3.51 9a9 9 0 0 1 14.85-3.36L23 10',
    'M20.49 15a9 9 0 0 1-14.85 3.36L1 14',
  ], p);
}

export function IconHeart(p: IconProps) {
  return svg('M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z', p);
}

export function IconCpu(p: IconProps) {
  return svgMulti([
    'M18 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
    'M9 9h6v6H9z',
    'M9 1v3', 'M15 1v3', 'M9 20v3', 'M15 20v3',
    'M20 9h3', 'M20 14h3', 'M1 9h3', 'M1 14h3',
  ], p);
}
