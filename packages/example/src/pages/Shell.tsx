import { useLoaderData } from 'ssr-kit';

export const loader = () => ({ renderedBy: 'client-fetch' });

export default function Shell() {
  const { renderedBy } = useLoaderData<typeof loader>();
  return (
    <main>
      <h1>SPA 셸</h1>
      <p data-testid="shell">{renderedBy}</p>
    </main>
  );
}
