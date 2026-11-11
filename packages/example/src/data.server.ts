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

export const currentGoldPrice = async () => ({
  pricePerGram: 152_000,
  at: '2026-11-11T09:00:00.000Z',
});

export const findGold = async (id: string) => golds.find((gold) => gold.id === id) ?? null;

export interface GuestbookEntry {
  id: number;
  message: string;
  createdAt: Date;
}

// 예제라 메모리에 둔다. 서버를 다시 띄우면 비워진다
const guestbook: GuestbookEntry[] = [];

export const listGuestbook = async () => [...guestbook].reverse();

export const addGuestbookEntry = async (message: string) => {
  const entry = { id: guestbook.length + 1, message, createdAt: new Date() };
  guestbook.push(entry);
  return entry;
};
