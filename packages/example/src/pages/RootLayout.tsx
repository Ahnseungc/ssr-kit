import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import {
  type HeadArgs,
  Link,
  type LoaderArgs,
  type Middleware,
  Outlet,
  type RouteError,
  useLoaderData,
  useNavigation,
  useRevalidate,
} from 'ssr-kit';

/** 모든 문서·데이터 요청에서 로더보다 먼저. 이후 로더는 같은 context 를 받는다 */
export const middleware: Middleware = ({ context }) => {
  context.requestStartedAt = Date.now();
};

export const loader = ({ context }: LoaderArgs) => ({
  renderedAt: new Date(),
  requestId: context.requestId,
});

export const head = (_: HeadArgs<typeof loader>) => ({
  title: 'ssr-kit 예제',
  meta: [{ name: 'description', content: 'ssr-kit 예제 앱' }],
});

export const ErrorBoundary = ({ error }: { error: RouteError }) => (
  <main data-testid="root-error">
    <h1>{error.status}</h1>
    <p>{error.message}</p>
  </main>
);

export default function RootLayout() {
  const { renderedAt } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const revalidate = useRevalidate();
  // 요청(서버)·앱(클라)마다 하나. 모듈 전역에 두면 서버에서 사용자 간 캐시가 섞인다
  const [queryClient] = useState(() => new QueryClient());
  return (
    <>
      <nav>
        <Link to="/">홈</Link>
        <Link to="/gold/1">순금</Link>
        <Link to="/gold/2" prefetch="viewport">
          18K
        </Link>
        <Link to="/old-gold/2">옛 주소</Link>
        <Link to="/gold/missing">없는 금</Link>
        <Link to="/boom">에러</Link>
        <Link to="/about">소개</Link>
        <Link to="/stream">스트리밍</Link>
        <Link to="/shell">셸</Link>
        <Link to="/external">외부</Link>
        <Link to="/query">쿼리</Link>
        <Link to="/admin">관리자</Link>
        <Link to="/guestbook">방명록</Link>
        <button type="button" onClick={revalidate}>
          새로고침
        </button>
      </nav>
      {navigation.state === 'loading' ? <p className="loading">불러오는 중…</p> : null}
      <p data-testid="rendered-at" hidden>
        {renderedAt instanceof Date ? 'date' : typeof renderedAt}
      </p>
      <p data-testid="rendered-ms" hidden>
        {renderedAt instanceof Date ? renderedAt.getTime() : 0}
      </p>
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    </>
  );
}
