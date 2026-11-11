import { Suspense, use } from 'react';
import { type LoaderArgs, useLoaderData } from 'ssr-kit';

const SLOW_MS = 400;

const slowChart = () =>
  new Promise<{ points: number[]; at: Date }>((resolve) =>
    setTimeout(() => resolve({ points: [151_200, 152_000, 152_800], at: new Date() }), SLOW_MS),
  );

export const loader = (_: LoaderArgs<'/stream'>) => ({ title: '실시간 시세', chart: slowChart() });

const Chart = ({ chart }: { chart: Promise<{ points: number[]; at: Date }> }) => {
  const { points, at } = use(chart);
  return (
    <p data-testid="chart">
      {points.join(' → ')} ({at instanceof Date ? 'date' : typeof at})
    </p>
  );
};

export default function Stream() {
  const { title, chart } = useLoaderData<typeof loader>();
  return (
    <main>
      <h1>{title}</h1>
      <Suspense fallback={<p data-testid="chart-loading">차트 불러오는 중…</p>}>
        <Chart chart={chart} />
      </Suspense>
    </main>
  );
}
