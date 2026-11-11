import { useId, useState } from 'react';
import { Link, type LoaderArgs, useLoaderData } from 'ssr-kit';

import { listGolds } from '../data.server';

export const loader = async (_: LoaderArgs<'/'>) => ({ golds: await listGolds() });

export default function Home() {
  const { golds } = useLoaderData<typeof loader>();
  const [count, setCount] = useState(0);
  const inputId = useId();
  return (
    <main>
      <h1>금 시세</h1>
      <ul>
        {golds.map((gold) => (
          <li key={gold.id}>
            <Link to={`/gold/${gold.id}`}>{gold.name}</Link>
          </li>
        ))}
      </ul>
      <label htmlFor={inputId}>메모</label>
      <input id={inputId} data-testid="memo" />
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        눌림 {count}
      </button>
    </main>
  );
}
