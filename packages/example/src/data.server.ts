// 서버 전용 모듈. 클라이언트 번들에 들어가면 빌드가 실패해야 한다
export const SERVER_ONLY_SECRET = 'ssr-kit-server-only-secret';

export interface Gold {
  id: string;
  name: string;
  pricePerGram: number;
}

const golds: Gold[] = [
  { id: '1', name: '순금 24K', pricePerGram: 152_000 },
  { id: '2', name: '18K', pricePerGram: 114_000 },
];

export const listGolds = async () => {
  void SERVER_ONLY_SECRET;
  return golds;
};

export const findGold = async (id: string) => golds.find((gold) => gold.id === id) ?? null;
