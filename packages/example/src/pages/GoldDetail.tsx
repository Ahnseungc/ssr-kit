import { type HeadArgs, type LoaderArgs, notFound, type RouteError, useLoaderData } from 'ssr-kit';

import { findGold } from '../data.server';

export const loader = async ({ params, headers }: LoaderArgs<'/gold/:id'>) => {
  const gold = await findGold(params.id);
  if (!gold) notFound();
  headers.set('Cache-Control', 'private, max-age=0');
  return { gold };
};

export const head = ({ data }: HeadArgs<typeof loader>) => ({ title: `${data.gold.name} 시세` });

export const ErrorBoundary = ({ error }: { error: RouteError }) => (
  <main data-testid="gold-error">
    <h1>금을 찾을 수 없어요</h1>
    <p>{error.status}</p>
  </main>
);

export default function GoldDetail() {
  const { gold } = useLoaderData<typeof loader>();
  return (
    <main>
      <h1>{gold.name}</h1>
      <p>1g {gold.pricePerGram.toLocaleString('ko-KR')}원</p>
    </main>
  );
}
