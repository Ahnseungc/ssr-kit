import 'ssr-kit';

declare module 'ssr-kit' {
  interface AppContext {
    requestId: string;
    /** 루트 미들웨어가 붙임 */
    requestStartedAt?: number;
    /** /admin 미들웨어가 붙임 */
    user?: string;
  }
}
