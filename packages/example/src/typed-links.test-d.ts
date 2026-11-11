// pnpm typecheck 가 검사하는 타입 테스트. 런타임에 import 되지 않는다
import { href, type Href, type LinkProps, useNavigate } from 'ssr-kit';

const valid: Href[] = ['/', '/gold/1', '/gold/1?tab=a#x', '/about', '#memo', 'https://example.com'];

// @ts-expect-error 없는 경로 (gold 오타)
const typo: Href = '/gol/1';
// @ts-expect-error 등록된 패턴만 받는다
const unknown: LinkProps['to'] = '/nope';

const goldHref: Href = href('/gold/:id', { id: '1' });
// @ts-expect-error 필수 파라미터 id 누락
href('/gold/:id', {});
// @ts-expect-error 등록되지 않은 패턴
href('/gol/:id', { id: '1' });

export const useTypedNavigate = () => {
  const navigate = useNavigate();
  navigate('/about');
  // @ts-expect-error navigate 도 Href 만 받는다
  navigate('/abuot');
};

export const samples = [valid, typo, unknown, goldHref];
