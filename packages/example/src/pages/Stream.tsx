import { Suspense, use } from 'react';
import { type LoaderArgs, useLoaderData } from 'ssr-kit';

const DEFAULT_DELAY_MS = 400;
const MAX_DELAY_MS = 3_000;

interface ChartData {
  points: number[];
  at: Date;
  /** 셸을 보낸 뒤 이 데이터가 준비되기까지 (서버 기준) */
  streamedAfterMs: number;
}

/** ?delay=1500 처럼 지연을 바꿀 수 있다 (데모 녹화용) */
const delayOf = (url: URL) => {
  const value = Number(url.searchParams.get('delay'));
  return Number.isFinite(value) && value > 0 ? Math.min(value, MAX_DELAY_MS) : DEFAULT_DELAY_MS;
};

const slowChart = (delay: number, startedAt: number) =>
  new Promise<ChartData>((resolve) =>
    setTimeout(
      () =>
        resolve({
          points: [151_200, 152_000, 152_800],
          at: new Date(),
          streamedAfterMs: Date.now() - startedAt,
        }),
      delay,
    ),
  );

export const loader = ({ request }: LoaderArgs<'/stream'>) => ({
  title: 'Live prices',
  // await 하지 않고 Promise 그대로 → 셸을 먼저 보내고 준비되면 스트리밍
  chart: slowChart(delayOf(request.url), Date.now()),
});

const Chart = ({ chart }: { chart: Promise<ChartData> }) => {
  const { points, at, streamedAfterMs } = use(chart);
  return (
    <div className="chart">
      <strong data-testid="chart">
        {points.join(' → ')} ({at instanceof Date ? 'date' : typeof at})
      </strong>
      <span className="badge">streamed +{streamedAfterMs}ms after the shell</span>
    </div>
  );
};

export default function Stream() {
  const { title, chart } = useLoaderData<typeof loader>();
  return (
    <main>
      <h1>{title}</h1>
      <p>
        The title arrives with the shell. The chart streams into the same response when its data is
        ready.
      </p>
      <Suspense
        fallback={
          <p className="skeleton" data-testid="chart-loading">
            Loading chart…
          </p>
        }
      >
        <Chart chart={chart} />
      </Suspense>
    </main>
  );
}
