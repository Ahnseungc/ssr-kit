import type { AppContext } from '../core/types';
import type { ServerBuild } from './build';
import type { HandleOptions } from './request';
import type { ErrorPhase } from './sink';

/** 어댑터 공통 옵션. Req 는 어댑터 원본 요청 */
export interface AdapterOptions<Req> {
  /** prod: `dist/server/entry.js` 의 build, dev: `await dev.getBuild()` */
  build: ServerBuild;
  getContext?: (req: Req) => AppContext | Promise<AppContext>;
  /** 기본: 검색엔진·SNS 미리보기 UA. false 면 항상 스트리밍 */
  isBot?: ((req: Req) => boolean) | false;
  /** ms */
  renderTimeout?: number;
  getNonce?: (req: Req) => string | undefined;
  onError?: (error: unknown, info: { url: string; phase: ErrorPhase }) => void;
}

const DEFAULT_RENDER_TIMEOUT_MS = 10_000;
const BOT_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|kakaotalk-scrap|daum|yeti|twitterbot|slackbot|linkedinbot|discordbot|whatsapp|telegrambot|applebot|bingpreview|googlebot|naver/i;

/** 어댑터 옵션 → handleRequest 옵션. userAgent 는 기본 봇 판별용 */
export const toHandleOptions = <Req>(
  options: AdapterOptions<Req>,
  req: Req,
  userAgent: string | undefined,
  unmatched: HandleOptions['unmatched'],
): HandleOptions => {
  const { getContext, isBot } = options;
  const detectBot = isBot === false ? () => false : (isBot ?? (() => BOT_UA.test(userAgent ?? '')));
  return {
    getContext: getContext ? () => getContext(req) : undefined,
    isBot: detectBot(req),
    renderTimeout: options.renderTimeout ?? DEFAULT_RENDER_TIMEOUT_MS,
    nonce: options.getNonce?.(req),
    onError: options.onError,
    unmatched,
  };
};
