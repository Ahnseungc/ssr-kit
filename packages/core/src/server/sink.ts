import type { ReactNode } from 'react';

export type ErrorPhase = 'middleware' | 'loader' | 'shell' | 'stream' | 'data';

export interface TreeRenderOptions {
  method: string;
  status: number;
  headers: Headers;
  bootstrapModules: string[];
  /** window.__SSRK 로 보낼 값. 안의 Promise 는 스트리밍된다 */
  data: unknown;
  dev: boolean;
  nonce?: string;
  /** true 면 Suspense 까지 모두 끝난 뒤 보낸다 */
  isBot: boolean;
  renderTimeout: number;
  report: (phase: ErrorPhase, error: unknown) => void;
  /** 상태·헤더를 내보내기 직전(셸 준비 시점). Server-Timing 등 마지막 헤더 추가용 */
  onHead?: (headers: Headers) => void;
  /** 셸 렌더 실패. 대체 응답을 쓰고 끝나면 resolve */
  onShellError: (error: unknown) => Promise<void> | void;
}

/**
 * 응답을 쓰는 곳. 런타임마다 구현이 다르다
 * (Node 스트림: server/stream.tsx, Web 스트림: edge/index.tsx).
 */
export interface RenderSink {
  /** 상태·헤더 확정. end 또는 renderTree 전에 한 번 */
  writeHead(status: number, headers: Headers): void;
  /** 본문 없이(또는 문자열 본문으로) 끝낸다 */
  end(body?: string): void;
  /** 연결 종료 감지 */
  signal: AbortSignal;
  /** React 트리를 스트리밍. 셸이 나가면(또는 대체 응답이 끝나면) resolve */
  renderTree(tree: ReactNode, options: TreeRenderOptions): Promise<void>;
}

export const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
