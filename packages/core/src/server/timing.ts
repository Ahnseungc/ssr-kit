/** Server-Timing 측정값. dur 은 ms */
export interface TimingEntry {
  name: string;
  dur: number;
}

// RFC 9110 token 에 쓸 수 없는 문자는 '-' 로
const NON_TOKEN = /[^!#$%&'*+\-.^_`|~0-9A-Za-z]/g;
const DECIMALS = 10;

export const toTimingName = (name: string) => name.replace(NON_TOKEN, '-') || '-';

export const formatServerTiming = (entries: TimingEntry[]) =>
  entries
    .map(({ name, dur }) => `${toTimingName(name)};dur=${Math.round(dur * DECIMALS) / DECIMALS}`)
    .join(', ');

/** 요청 하나의 측정값 모음 */
export class RequestTiming {
  readonly entries: TimingEntry[] = [];

  add(name: string, dur: number) {
    this.entries.push({ name: toTimingName(name), dur });
  }

  /** 지금까지 측정한 값을 Server-Timing 헤더로 */
  apply(headers: Headers) {
    if (this.entries.length) headers.set('server-timing', formatServerTiming(this.entries));
  }
}

export const MIDDLEWARE_TIMING = 'mw';
export const SHELL_TIMING = 'shell';
export const loaderTimingName = (routeId: string) => `loader-${routeId}`;
