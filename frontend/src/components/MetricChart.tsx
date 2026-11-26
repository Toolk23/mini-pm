import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { Annotation, DataGap, SeriesPoint } from '../api/types'
import { cssVar, useThemeValue } from './theme'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, MarkAreaComponent, MarkPointComponent, CanvasRenderer])

export interface ChartWindow { from: string; to: string; label: string; tone: 'base' | 'post' }

interface Props {
  points: SeriesPoint[]
  name: string
  control?: { points: SeriesPoint[]; name: string }
  annotations?: Annotation[]
  gaps?: DataGap[]
  windows?: ChartWindow[]
  highlightRelease?: string
  /** Подписывать только эти релизы (кандидаты детектора); остальные — бледные линии без подписи. */
  labelReleases?: string[]
  height?: number
  unit?: string
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
const DAY = 86400000

/** «29.06.2026–21.09.2026» → ['2026-06-29', '2026-09-21'] */
export function parsePeriod(p?: string): [string, string] | null {
  const m = p?.match(/(\d{2})\.(\d{2})\.(\d{4})\D+(\d{2})\.(\d{2})\.(\d{4})/)
  return m ? [`${m[3]}-${m[2]}-${m[1]}`, `${m[6]}-${m[5]}-${m[4]}`] : null
}

/**
 * График метрики: недельные значения (бледно), скользящее за 4 недели (светится), контроль,
 * релизы, разовые всплески «исключён», неполная последняя неделя пунктиром, разрывы учёта штриховкой,
 * окна «база / после».
 */
export default function MetricChart({ points, name, control, annotations = [], gaps = [], windows = [], highlightRelease, labelReleases, height = 400, unit = '' }: Props) {
  const theme = useThemeValue()

  const option = useMemo(() => {
    const c = {
      main: cssVar('--chart-main'), control: cssVar('--chart-control'), raw: cssVar('--chart-raw'),
      release: cssVar('--chart-release'), grid: cssVar('--chart-grid'), text: cssVar('--text'), text2: cssVar('--text-2'),
      text3: cssVar('--text-3'), danger: cssVar('--danger'), nodata: cssVar('--nodata'), surface: cssVar('--surface-solid'),
      border: cssVar('--border-strong'), success: cssVar('--success'), font: cssVar('--font'), mono: cssVar('--mono'),
    }
    let pts = points.filter((p) => p.value != null)
    if (!pts.length) return null
    // Ряды метрик приходят без rolling — считаем скользящее за 4 недели сами (то же правило, что у детектора).
    if (pts.every((p) => p.rolling == null) && pts.length >= 4) {
      pts = pts.map((p, i) => i < 3 ? p : { ...p, rolling: Math.round((pts.slice(i - 3, i + 1).reduce((s, x) => s + (x.value ?? 0), 0) / 4) * 10) / 10 })
    }
    const t0 = new Date(pts[0].week_start).getTime()
    const t1 = new Date(pts[pts.length - 1].week_start).getTime() + 6 * DAY
    const inRange = (iso: string) => { const t = new Date(iso).getTime(); return t >= t0 - 3 * DAY && t <= t1 }

    // Неполная последняя неделя — отдельный пунктирный хвост.
    const lastIncomplete = pts[pts.length - 1].incomplete
    const solidRolling = pts.filter((p, i) => p.rolling != null && !(lastIncomplete && i === pts.length - 1))
    const tailRolling = lastIncomplete && pts.length > 1 ? pts.slice(-2).filter((p) => p.rolling != null) : []

    const releaseLines = annotations
      .filter((a) => a.type === 'release' && inRange(a.date))
      .map((a) => {
        const hot = a.id === highlightRelease || (!highlightRelease && a.affects_metric)
        const labeled = hot || !labelReleases || labelReleases.includes(a.id)
        const li = labelReleases ? labelReleases.indexOf(a.id) : 0
        return {
          xAxis: a.date, name: a.id,
          lineStyle: { color: hot ? c.danger : c.release, width: hot ? 1.6 : 1, type: hot ? 'solid' : 'dashed', opacity: hot ? 1 : labeled ? .55 : .18 },
          label: {
            show: labeled,
            formatter: a.id, color: hot ? c.danger : c.text2, fontFamily: c.mono, fontSize: 11, fontWeight: hot ? 700 : 500,
            position: 'insideEndTop', distance: li % 2 ? 18 : 4,
            backgroundColor: hot ? 'rgba(255,95,109,.14)' : 'transparent', padding: hot ? [2, 6] : 0, borderRadius: 4,
          },
          emphasis: { label: { formatter: `${a.id}: ${a.description.slice(0, 70)}…` } },
        }
      })

    const gapAreas = gaps
      .filter((g) => !g.last_week && (g.from || g.until || g.to))
      .map((g) => {
        const from = g.from ?? new Date(t0).toISOString().slice(0, 10)
        const to = g.to ?? g.until ?? new Date(t1).toISOString().slice(0, 10)
        if (!g.from && g.until && new Date(g.until).getTime() <= t0) return null // разрыв до начала ряда — не на графике
        return [
          { xAxis: from, name: 'нет данных', itemStyle: { color: 'rgba(154,160,189,.10)', decal: { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 5], rotation: -Math.PI / 4, color: 'rgba(154,160,189,.22)' } },
            label: { color: c.nodata, fontFamily: c.mono, fontSize: 10, position: 'insideBottom' } },
          { xAxis: to },
        ]
      })
      .filter(Boolean)

    const windowAreas = windows.map((w) => [
      { xAxis: w.from, name: w.label, itemStyle: { color: w.tone === 'post' ? 'rgba(255,95,109,.07)' : 'rgba(143,125,255,.06)' },
        label: { color: w.tone === 'post' ? c.danger : c.text3, fontFamily: c.mono, fontSize: 10.5, position: 'insideTop', distance: 8 } },
      { xAxis: new Date(new Date(w.to).getTime() + 6 * DAY).toISOString().slice(0, 10) },
    ])

    const spikes = pts.filter((p) => p.spike).map((p) => ({
      coord: [p.week_start, p.value], value: p.value,
      label: { formatter: `всплеск ${p.value}\nисключён`, color: c.text2, fontSize: 10.5, lineHeight: 13, position: 'left', distance: 10, align: 'right' },
      itemStyle: { color: 'transparent', borderColor: c.text2, borderWidth: 1.5, borderType: 'dashed' },
      symbol: 'circle', symbolSize: 16,
    }))

    const series: Record<string, unknown>[] = [
      {
        name: `${name}, по неделям`, type: 'line', data: pts.map((p) => [p.week_start, p.value]), symbol: 'circle', symbolSize: 5,
        lineStyle: { color: c.raw, width: 1 }, itemStyle: { color: c.raw }, z: 2,
        markPoint: { data: spikes, animationDelay: 1600 },
        markArea: { silent: true, data: [...windowAreas, ...gapAreas] },
        markLine: { symbol: 'none', silent: false, data: releaseLines, animationDuration: 900, animationDelay: 1200 },
      },
      {
        name: `${name}, скользящее 4 нед.`, type: 'line', smooth: .35, showSymbol: false, z: 5,
        data: solidRolling.map((p) => [p.week_start, p.rolling]),
        lineStyle: { color: c.main, width: 3, shadowColor: c.main, shadowBlur: 18 },
        itemStyle: { color: c.main },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: c.main + '55' }, { offset: 1, color: c.main + '00' }]) },
        animationDuration: 2200, animationEasing: 'cubicOut',
      },
    ]
    if (tailRolling.length === 2) {
      series.push({
        name: 'неполная неделя', type: 'line', showSymbol: true, symbolSize: 7, z: 5,
        data: tailRolling.map((p) => [p.week_start, p.rolling]),
        lineStyle: { color: c.main, width: 2.5, type: [4, 4] }, itemStyle: { color: c.surface, borderColor: c.main, borderWidth: 2 },
        markPoint: { data: [{ coord: [tailRolling[1].week_start, tailRolling[1].rolling], symbol: 'none',
          label: { formatter: 'неполная\nнеделя', color: c.text3, fontSize: 10, lineHeight: 12, position: 'right', distance: 6 } }] },
        animationDelay: 2000, tooltip: { show: false },
      })
    }
    if (control) {
      series.push({
        name: `${control.name} (контроль), скользящее`, type: 'line', smooth: .35, showSymbol: false, z: 4,
        data: control.points.filter((p) => p.rolling != null).map((p) => [p.week_start, p.rolling]),
        lineStyle: { color: c.control, width: 2, type: [6, 4], shadowColor: c.control, shadowBlur: 8 }, itemStyle: { color: c.control },
        animationDuration: 2200, animationDelay: 300,
      })
    }

    return {
      backgroundColor: 'transparent',
      textStyle: { fontFamily: c.font },
      animationDuration: 1600,
      grid: { left: 8, right: 64, top: 64, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 14, itemHeight: 4, textStyle: { color: c.text2, fontSize: 12 },
        data: series.map((s) => s.name as string).filter((n) => n !== 'неполная неделя') },
      tooltip: {
        trigger: 'axis', backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontSize: 12.5 },
        extraCssText: 'border-radius:12px;backdrop-filter:blur(12px);box-shadow:0 12px 40px -8px rgba(0,0,0,.5);',
        axisPointer: { type: 'line', lineStyle: { color: c.border } },
        formatter: (items: { axisValue: number; seriesName: string; value: [string, number]; color: string }[]) => {
          const d = items[0] ? new Date(items[0].axisValue) : null
          const iso = d ? d.toISOString().slice(0, 10) : ''
          const p = pts.find((x) => x.week_start === iso)
          const rows = items.filter((i) => i.seriesName !== 'неполная неделя').map((i) =>
            `<div style="display:flex;gap:10px;justify-content:space-between"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${i.color};margin-right:6px"></span>${i.seriesName}</span><b>${Math.round(i.value[1] * 10) / 10}${unit}</b></div>`).join('')
          const flags = [p?.spike && '⚡ разовый всплеск — исключён из расчёта', p?.incomplete && '◌ неделя неполная', p?.comment].filter(Boolean)
          return `<div style="min-width:240px"><div style="color:${c.text3};margin-bottom:6px">неделя с ${d ? d.toLocaleDateString('ru-RU') : ''}</div>${rows}${flags.length ? `<div style="margin-top:6px;color:${c.text2};max-width:320px;white-space:normal">${flags.join('<br/>')}</div>` : ''}</div>`
        },
      },
      xAxis: {
        type: 'time', min: t0 - 3 * DAY, max: t1,
        axisLine: { lineStyle: { color: c.grid } }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { color: c.text3, fontSize: 11, formatter: (v: number) => fmt(new Date(v).toISOString()), hideOverlap: true },
      },
      yAxis: {
        type: 'value', scale: false, splitNumber: 4,
        // запас сверху под подписи всплесков и релизов
        max: (v: { max: number }) => Math.ceil((v.max * 1.22) / 10) * 10,
        axisLabel: { color: c.text3, fontSize: 11 }, splitLine: { lineStyle: { color: c.grid } },
      },
      series,
    }
  }, [points, control, annotations, gaps, windows, highlightRelease, labelReleases, name, unit, theme]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!option) return <div className="empty">Нет точек для графика</div>
  return <ReactECharts echarts={echarts} option={option} notMerge style={{ height, width: '100%' }} opts={{ renderer: 'canvas' }} />
}
