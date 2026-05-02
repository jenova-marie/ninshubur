/**
 * Single-line live progress bar for long-running CLI commands.
 *
 * Renders to stderr (so stdout JSON logs can still be piped to a
 * file / jq) using ANSI carriage-return + clear-line so each tick
 * overwrites the prior one in place — no scroll spam.
 *
 * No-ops when stderr isn't a TTY (CI, containers, redirected logs)
 * so the same code path works in both interactive and unattended
 * runs without producing junk output.
 */

const isTTY = process.stderr.isTTY ?? false;

export interface ProgressState {
  processed: number;
  total: number;
  /**
   * Extra key/value pairs rendered after the bar — kept short so
   * the line fits in a typical terminal width.
   */
  extras?: Record<string, string | number>;
}

const BAR_WIDTH = 24;
const FILL_CHAR = "▓";
const TRACK_CHAR = "░";
const CLEAR_LINE = "\x1b[2K";

function formatExtras(extras: Record<string, string | number>): string {
  return Object.entries(extras)
    .map(([key, value]) => `${key}=${value}`)
    .join(" · ");
}

export function renderProgress(state: ProgressState): void {
  if (!isTTY) return;

  const { processed, total, extras = {} } = state;
  const pct = total === 0 ? 0 : Math.min(1, processed / total);
  const filled = Math.round(pct * BAR_WIDTH);
  const bar = FILL_CHAR.repeat(filled) + TRACK_CHAR.repeat(BAR_WIDTH - filled);
  const pctStr = `${(pct * 100).toFixed(1)}%`.padStart(6);
  const counter = `${processed}/${total}`;
  const extraStr = formatExtras(extras);

  process.stderr.write(
    `${CLEAR_LINE}\r${bar} ${pctStr}  ${counter}  ${extraStr}`,
  );
}

/** Write a trailing newline so subsequent log output starts cleanly. */
export function endProgress(): void {
  if (!isTTY) return;
  process.stderr.write("\n");
}
