import { queryOptions } from '@tanstack/react-query';

export interface GoldPrice {
  pricePerGram: number;
  at: string;
}

export const GOLD_PRICE_STALE_MS = 60_000;

/** 서버(로더 프리패치)와 클라(useQuery)가 같은 키·함수를 쓴다 */
export const goldPriceQuery = (fetchPrice: () => Promise<GoldPrice>) =>
  queryOptions({ queryKey: ['gold-price'], queryFn: fetchPrice, staleTime: GOLD_PRICE_STALE_MS });

export const fetchGoldPriceFromApi = async (): Promise<GoldPrice> => {
  const response = await fetch('/api/gold-price');
  if (!response.ok) throw new Error(`시세 API 실패: ${response.status}`);
  return response.json();
};
