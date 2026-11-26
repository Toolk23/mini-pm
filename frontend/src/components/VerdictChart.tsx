import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { Measurement, SeriesPoint } from '../api/types'
import { cssVar, useThemeValue } from './theme'

echarts.use([LineChart, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, CanvasRenderer])

/**
 * «До / после хотфикса»: история KES (скользящее) + синтетические недели после исправления,
 * линия базы и порог успеха. Контроль — Astra.
 */
export default function VerdictChart({ history, control, m, thresholdPct = -10, height = 320 }:
  { history: SeriesPoint[]; control?: SeriesPoint[]; m: Measurement; thresholdPct?: number; height?: number }) {
  const theme = useThemeValue()
  const option = useMemo(() => {
    const c = { main: cssVar('--chart-main'), ctrl: cssVar('--chart-control'), grid: cssVar('--chart-grid'), t2: cssVar('--text-2'), t3: cssVar('--text-3'),
      text: cssVar('--text'), surface: cssVar('--surface-solid'), border: cssVar('--border-strong'), ok: cssVar('--success'), bad: cssVar('--danger'),
      warm: cssVar('--warm'), mono: cssVar('--mono'), font: cssVar('--font') }
    const ok = m.verdict === 'confirmed'
    const tone = ok ? c.ok : c.bad
    const hist = history.filter((p) => p.rolling != null).map((p) => [p.week_start, p.rolling])
    // Как в бэкенде (effect.measure): скользящее за 4 недели только по неделям после хотфикса —
    // последняя точка равна after_rolling_4w из вердикта.
    const roll = (vals: number[]) => vals.map((_, i) => (i < 3 ? null : Math.round((vals.slice(i - 3, i + 1).reduce((s, v) => s + v, 0) / 4) * 10) / 10))
    const kesRoll = roll(m.weeks.map((w) => w.value))
    const after = m.weeks.map((w, i) => [w.week_start, kesRoll[i]]).filter((p) => p[1] != null)
    const raw = m.weeks.map((w) => [w.week_start, w.value])
    const ctrlHist = (control ?? []).filter((p) => p.rolling != null).map((p) => [p.week_start, p.rolling])
    const ctrlRoll = roll(m.weeks.map((w) => w.control))
    const ctrlAfter = m.weeks.map((w, i) => [w.week_start, ctrlRoll[i]]).filter((p) => p[1] != null)
    const base = m.baseline_mean ?? 0
    const thr = Math.round(base * (1 + thresholdPct / 100) * 10) / 10
    return {
      backgroundColor: 'transparent', textStyle: { fontFamily: c.font }, animationDuration: 1400,
      grid: { left: 8, right: 90, top: 40, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 14, itemHeight: 4, textStyle: { color: c.t2 } },
      tooltip: { trigger: 'axis', backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text },
        valueFormatter: (v: number) => (v == null ? '—' : String(Math.round(v * 10) / 10)) },
      xAxis: { type: 'time', axisLine: { lineStyle: { color: c.grid } }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { color: c.t3, fontSize: 11, formatter: (v: number) => new Date(v).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }), hideOverlap: true } },
      yAxis: { type: 'value', min: 0, axisLabel: { color: c.t3, fontSize: 11 }, splitLine: { lineStyle: { color: c.grid } } },
      series: [
        { name: 'KES, скользящее (история)', type: 'line', smooth: .35, showSymbol: false, data: hist, lineStyle: { color: c.main, width: 2.5 }, itemStyle: { color: c.main },
          markLine: { symbol: 'none', silent: true, data: [
            { yAxis: base, lineStyle: { color: c.t2, type: 'dashed' }, label: { formatter: `база ${base}`, color: c.t2, fontFamily: c.mono, fontSize: 11, position: 'end' } },
            { yAxis: thr, lineStyle: { color: tone, type: [2, 4], opacity: .8 }, label: { formatter: `успех ≥ ${thr}`, color: tone, fontFamily: c.mono, fontSize: 11, position: 'end' } },
          ] },
          markArea: { silent: true, data: [[{ xAxis: m.weeks[0]?.week_start, name: 'после хотфикса', itemStyle: { color: ok ? 'rgba(62,224,161,.07)' : 'rgba(255,95,109,.07)' },
            label: { color: tone, fontFamily: c.mono, fontSize: 10.5, position: 'insideTop' } }, { xAxis: m.weeks[m.weeks.length - 1]?.week_start }]] } },
        { name: 'после хотфикса, по неделям', type: 'line', data: raw, symbolSize: 5, lineStyle: { color: tone, width: 1, opacity: .45 },
          itemStyle: { color: tone, opacity: .6 }, animationDelay: 700 },
        { name: 'после хотфикса, скользящее 4 нед.', type: 'line', smooth: .35, data: after, symbolSize: 7,
          lineStyle: { color: tone, width: 3, shadowColor: tone, shadowBlur: 16 }, itemStyle: { color: tone }, animationDelay: 1100,
          endLabel: { show: true, formatter: () => `${m.after_rolling_4w}`, color: tone, fontFamily: c.mono, fontWeight: 700 } },
        ...(ctrlHist.length ? [{ name: 'Astra (контроль)', type: 'line', smooth: .35, showSymbol: false, data: [...ctrlHist, ...ctrlAfter],
          lineStyle: { color: c.ctrl, width: 1.6, type: [6, 4] }, itemStyle: { color: c.ctrl } }] : []),
      ],
    }
  }, [history, control, m, thresholdPct, theme]) // eslint-disable-line react-hooks/exhaustive-deps
  return <ReactECharts echarts={echarts} option={option} notMerge style={{ height, width: '100%' }} />
}
