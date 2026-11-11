import { redirect } from 'ssr-kit';

export const loader = () => redirect('https://example.com/ssr-kit', 302);

export default function External() {
  return null;
}
