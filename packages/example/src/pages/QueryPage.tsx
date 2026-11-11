import { dehydrate, HydrationBoundary, QueryClient, useQuery } from '@tanstack/react-query';
import { type LoaderArgs, useLoaderData } from 'ssr-kit';

import { currentGoldPrice } from '../data.server';
import { fetchGoldPriceFromApi, goldPriceQuery } from '../query';

/** TanStack Query 레시피: 로더에서 프리패치 → dehydrate → 컴포넌트에서 HydrationBoundary */
export const loader = async (_: LoaderArgs<'/query'>) => {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery(goldPriceQuery(currentGoldPrice));
  return { dehydrated: dehydrate(queryClient) };
};

const Price = () => {
  const { data, isFetching } = useQuery(goldPriceQuery(fetchGoldPriceFromApi));
  return (
    <p data-testid="query-price">
      {data ? `${data.pricePerGram.toLocaleString('ko-KR')}원` : '없음'}
      {isFetching ? ' (갱신 중)' : ''}
    </p>
  );
};

export default function QueryPage() {
  const { dehydrated } = useLoaderData<typeof loader>();
  return (
    <HydrationBoundary state={dehydrated}>
      <main>
        <h1>TanStack Query</h1>
        <Price />
      </main>
    </HydrationBoundary>
  );
}
