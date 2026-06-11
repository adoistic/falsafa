/**
 * Date display. Years are signed integers; negative is BCE.
 * The atlas never pretends to more precision than the data carries:
 * `ca` renders as "c." and open ranges render as ranges.
 */
import type { YearSpan } from './schema.ts';

export function formatYear(year: number): string {
  return year < 0 ? `${-year} BCE` : `${year}`;
}

export function formatSpan(span: YearSpan): string {
  const ca = span.ca ? 'c. ' : '';
  if (span.to === undefined || span.to === span.from) {
    return `${ca}${formatYear(span.from)}`;
  }
  // Same era, CE: "827-833". Crossing year 1: both eras spelled out,
  // because "50 BCE-50" reads as two BCE dates.
  if (span.from > 0 && span.to > 0) {
    return `${ca}${span.from}–${span.to}`;
  }
  if (span.from < 0 && span.to > 0) {
    return `${ca}${-span.from} BCE–${span.to} CE`;
  }
  return `${ca}${formatYear(span.from)}–${formatYear(span.to)}`;
}

export function centuryOf(year: number): string {
  const n = year < 0 ? Math.ceil(-year / 100) : Math.ceil(year / 100);
  const ord =
    n % 10 === 1 && n % 100 !== 11 ? 'st'
    : n % 10 === 2 && n % 100 !== 12 ? 'nd'
    : n % 10 === 3 && n % 100 !== 13 ? 'rd'
    : 'th';
  return year < 0 ? `${n}${ord} century BCE` : `${n}${ord} century`;
}

export function lifeDates(born?: number, died?: number, ca?: boolean, fl?: string): string {
  if (born !== undefined && died !== undefined) {
    if (born < 0 && died > 0) {
      return `${ca ? 'c. ' : ''}${-born} BCE–${died} CE`;
    }
    return `${ca ? 'c. ' : ''}${formatYear(born)}–${formatYear(died)}`;
  }
  if (died !== undefined) return `d. ${ca ? 'c. ' : ''}${formatYear(died)}`;
  if (born !== undefined) return `b. ${ca ? 'c. ' : ''}${formatYear(born)}`;
  return fl ?? '';
}

/** Human label for a work's attribution when there is no named author. */
export const attributionLabel: Record<string, string> = {
  traditional: 'traditional attribution',
  anonymous: 'anonymous',
  misattributed: 'misattributed',
};
