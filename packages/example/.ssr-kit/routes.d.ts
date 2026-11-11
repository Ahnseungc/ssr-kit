// ssr-kit 가 생성한 파일. 직접 수정하지 말 것 (ssrKit({ routesDts }))
import 'ssr-kit';

declare module 'ssr-kit' {
  interface Register {
    routes:
      | "/"
      | "/gold/:id"
      | "/old-gold/:id"
      | "/boom"
      | "/about"
      | "/stream"
      | "/external"
      | "/query"
      | "/admin"
      | "/login"
      | "/shell";
  }
}
