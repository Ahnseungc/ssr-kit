import 'ssr-kit';

declare module 'ssr-kit' {
  interface AppContext {
    requestId: string;
  }
}
