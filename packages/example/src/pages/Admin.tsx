import { type LoaderArgs, type Middleware, redirect, useLoaderData } from 'ssr-kit';

const AUTH_COOKIE = 'demo_auth=1';

/** 데모 가드: 쿠키가 없으면 로그인으로. 문서·데이터(클라 이동) 요청 모두 로더보다 먼저 실행된다 */
export const middleware: Middleware = ({ request, context }) => {
  const cookies = request.headers.get('cookie')?.split(/;\s*/) ?? [];
  if (!cookies.includes(AUTH_COOKIE)) redirect(`/login?next=${request.url.pathname}`);
  context.user = 'demo';
};

export const loader = ({ context }: LoaderArgs) => ({
  user: context.user ?? '-',
  sawRequestStart: typeof context.requestStartedAt === 'number',
});

export const head = () => ({ title: 'ssr-kit admin' });

export default function Admin() {
  const { user, sawRequestStart } = useLoaderData<typeof loader>();
  return (
    <main>
      <h1>Admin</h1>
      <p data-testid="admin-user">{user}</p>
      <p data-testid="admin-context">{sawRequestStart ? 'context-ok' : 'context-missing'}</p>
    </main>
  );
}
