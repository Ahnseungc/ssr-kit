import {
  type HeadArgs,
  Link,
  type LoaderArgs,
  Outlet,
  type RouteError,
  useLoaderData,
  useNavigation,
} from 'ssr-kit';

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
        <Link to="/shell">셸</Link>
      </nav>
      {navigation.state === 'loading' ? <p className="loading">불러오는 중…</p> : null}
      <p data-testid="rendered-at" hidden>
        {renderedAt instanceof Date ? 'date' : typeof renderedAt}
      </p>
      <Outlet />
    </>
  );
}
