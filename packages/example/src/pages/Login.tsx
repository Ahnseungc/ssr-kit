import { type Href, useLocation, useNavigate } from 'ssr-kit';

export const head = () => ({ title: 'ssr-kit 로그인' });

export default function Login() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const next = new URLSearchParams(search).get('next') ?? '/';
  const handleLogin = () => {
    document.cookie = 'demo_auth=1; path=/; SameSite=Lax';
    // 같은 origin 경로만 따라간다 (오픈 리다이렉트 방지). 쿼리 값은 런타임 문자열이라 검사 후 Href 로 단언
    const sameOrigin = next.startsWith('/') && !next.startsWith('//');
    navigate(sameOrigin ? (next as Href) : '/');
  };
  return (
    <main>
      <h1>로그인</h1>
      <button type="button" onClick={handleLogin}>
        데모 로그인
      </button>
    </main>
  );
}
