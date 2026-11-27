import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { api } from '../api/client'
import { cssVar, useThemeValue } from './theme'
import { ErrorBox, Loading, NoData, useApi } from './ui'
import { CountUp } from './live'

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer])

/** Живой запрос к API Яндекс.Метрики (тестовый счётчик команды) — обязательная интеграция. */
export default function MetrikaLivePanel() {
  const live = useApi(() => api.metrikaLive('30daysAgo', 'today'))
  const theme = useThemeValue()
  const d = live.data

  const option = useMemo(() => {
    if (!d?.ok || !d.rows?.length) return null
    const c = { main: cssVar('--chart-main'), ctrl: cssVar('--chart-control'), grid: cssVar('--chart-grid'), t3: cssVar('--text-3'),
      text: cssVar('--text'), surface: cssVar('--surface-solid'), border: cssVar('--border-strong') }
    return {
      grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
      tooltip: { trigger: 'axis', backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text } },
      xAxis: { type: 'category', data: d.rows.map((r) => r.date.slice(5)), axisLabel: { color: c.t3, fontSize: 10 }, axisLine: { lineStyle: { color: c.grid } }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: c.t3, fontSize: 10 }, splitLine: { lineStyle: { color: c.grid } } },
      series: [
        { name: 'Визиты', type: 'bar', data: d.rows.map((r) => r.visits ?? 0), barMaxWidth: 18,
          itemStyle: { borderRadius: [6, 6, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: c.main }, { offset: 1, color: c.main + '33' }]) },
          animationDelay: (i: number) => i * 40 },
        { name: 'Посетители', type: 'line', smooth: true, data: d.rows.map((r) => r.users ?? 0), symbol: 'none',
          lineStyle: { color: c.ctrl, width: 2 }, itemStyle: { color: c.ctrl } },
      ],
    }
  }, [d, theme]) // eslint-disable-line react-hooks/exhaustive-deps

  if (live.loading) return <Loading label="Запрашиваю API Метрики…" />
  if (live.error) return <ErrorBox error={live.error} onRetry={live.reload} />
  if (!d?.ok) {
    return (
      <NoData title="Счётчик не подключён на этом стенде">
        <div className="muted">Бэкенд ответил: <code>{d?.error ?? 'нет ответа'}</code>. Анализ кейса идёт на датасете Softline;
          живой запрос показываем на тестовом счётчике команды, когда задан токен.</div>
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={live.reload}>Запросить ещё раз</button>
      </NoData>
    )
  }
  return (
    <div className="stack">
      <div className="row" style={{ gap: 24 }}>
        <div><div className="stat-label">Визиты за 30 дней</div><div className="stat-value" style={{ fontSize: 32 }}><CountUp value={Number(d.totals?.visits ?? 0)} /></div></div>
        <div><div className="stat-label">Посетители</div><div className="stat-value" style={{ fontSize: 32 }}><CountUp value={Number(d.totals?.users ?? 0)} /></div></div>
        <span className="row faint"><span className="live-dot" /> счётчик {d.counter_id} · ответ API получен сейчас</span>
      </div>
      {option && <ReactECharts echarts={echarts} option={option} notMerge style={{ height: 220 }} />}
      {d.request && (
        <code className="faint" style={{ wordBreak: 'break-all' }}>
          GET {d.request.url}?{Object.entries(d.request.params).filter(([k]) => k !== 'ids').map(([k, v]) => `${k}=${v}`).join('&')}
        </code>
      )}
    </div>
  )
}
