import { useLocation, useNavigate } from 'ssr-kit';

export const head = () => ({ title: 'ssr-kit 로그인' });

export default function Login() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const next = new URLSearchParams(search).get('next') ?? '/';
  const handleLogin = () => {
    document.cookie = 'demo_auth=1; path=/; SameSite=Lax';
    // 같은 origin 경로만 따라간다 (오픈 리다이렉트 방지)
    navigate(next.startsWith('/') && !next.startsWith('//') ? next : '/');
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
