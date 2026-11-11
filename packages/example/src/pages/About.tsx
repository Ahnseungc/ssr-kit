import { useLocation } from 'ssr-kit';

const TALL_PAGE_PX = 3000;

export const head = () => ({ title: 'About ssr-kit' });

export default function About() {
  // ?tall: 스크롤 복원 E2E 용으로 SSR 단계부터 긴 페이지
  const { search } = useLocation();
  return (
    <main>
      <h1>About</h1>
      <p>A route without a loader</p>
      {search.includes('tall') ? <div style={{ height: TALL_PAGE_PX }} /> : null}
    </main>
  );
}
