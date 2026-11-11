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
      <h1>Gold prices</h1>
      <ul>
        {golds.map((gold) => (
          <li key={gold.id}>
            <Link to={`/gold/${gold.id}`}>{gold.name}</Link>
          </li>
        ))}
      </ul>
      <Link to="#memo-section">Jump to memo</Link>
      <label id="memo-section" htmlFor={inputId}>
        Memo
      </label>
      <input id={inputId} data-testid="memo" />
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        Clicked {count}
      </button>
    </main>
  );
}
