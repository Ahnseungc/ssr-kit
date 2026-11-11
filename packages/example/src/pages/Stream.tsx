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
  title: '실시간 시세',
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
      <span className="badge">셸 이후 +{streamedAfterMs}ms 에 스트리밍됨</span>
    </div>
  );
};

export default function Stream() {
  const { title, chart } = useLoaderData<typeof loader>();
  return (
    <main>
      <h1>{title}</h1>
      <p>제목은 셸과 함께 바로, 차트는 데이터가 준비되면 같은 응답으로 이어서 옵니다.</p>
      <Suspense
        fallback={
          <p className="skeleton" data-testid="chart-loading">
            차트 불러오는 중…
          </p>
        }
      >
        <Chart chart={chart} />
      </Suspense>
    </main>
  );
}
