import { useEffect, useRef } from 'react'

/**
 * Живой фон v3: сетка точек, по которой медленно идут «волны» яркости,
 * а иногда из случайной точки расходится кольцо-пинг (как засечка радара).
 * Монохромный цвет берётся из --text, поэтому одинаково работает в тёмной и светлой теме.
 * Рисуем в canvas ~30 кадров/с, на паузе, когда вкладка скрыта; при prefers-reduced-motion — один статичный кадр.
 */
export default function BgField() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
    const STEP = 24
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0
    let rgb = '233,247,252'
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 }
    const pings: { x: number; y: number; t0: number }[] = []
    let nextPing = 0

    const readColor = () => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--text)'
      document.body.appendChild(probe)
      const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)
      probe.remove()
      if (m && m.length >= 3) rgb = `${m[0]},${m[1]},${m[2]}`
    }
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      w = window.innerWidth; h = window.innerHeight
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = (now: number) => {
      const t = now / 1000
      ctx.clearRect(0, 0, w, h)
      // мышь догоняет курсор с инерцией — без рывков
      mouse.x += (mouse.tx - mouse.x) * 0.12
      mouse.y += (mouse.ty - mouse.y) * 0.12

      if (!reduce && now > nextPing) {
        pings.push({ x: Math.random() * w, y: Math.random() * h, t0: t })
        nextPing = now + 2400 + Math.random() * 2000
      }
      while (pings.length && t - pings[0].t0 > 4) pings.shift()

      const cols = Math.ceil(w / STEP) + 1, rows = Math.ceil(h / STEP) + 1
      const ox = (w % STEP) / 2, oy = (h % STEP) / 2
      for (let j = 0; j < rows; j++) {
        const y = oy + j * STEP
        for (let i = 0; i < cols; i++) {
          const x = ox + i * STEP
          // две медленные волны под разными углами → «дышащее» поле
          const wv = Math.sin(x * 0.006 + t * 0.5) * Math.cos(y * 0.008 - t * 0.35) + Math.sin((x + y) * 0.004 - t * 0.6)
          let a = 0.07 + Math.max(0, wv) * 0.16
          for (const p of pings) {
            const age = t - p.t0, r = age * 260
            const d = Math.abs(Math.hypot(x - p.x, y - p.y) - r)
            if (d < 30) a += (1 - d / 30) * 0.5 * (1 - age / 4)
          }
          if (finePointer) {
            const md = Math.hypot(x - mouse.x, y - mouse.y)
            if (md < 160) a += (1 - md / 160) * 0.45
          }
          const s = a > 0.2 ? 2 : 1.5
          ctx.fillStyle = `rgba(${rgb},${Math.min(a, 0.6).toFixed(3)})`
          ctx.fillRect(x - s / 2, y - s / 2, s, s)
        }
      }
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 33) return
      last = now
      draw(now)
    }
    const start = () => { cancelAnimationFrame(raf); if (reduce) draw(0); else raf = requestAnimationFrame(loop) }
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else start() }
    const onMove = (e: PointerEvent) => { mouse.tx = e.clientX; mouse.ty = e.clientY }
    const onLeave = () => { mouse.tx = -9999; mouse.ty = -9999 }
    const onResize = () => { resize(); if (reduce) draw(0) }

    // тема меняется атрибутом data-theme на <html> — перечитываем цвет точек
    const mo = new MutationObserver(() => { readColor(); if (reduce) draw(0) })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    readColor(); resize(); start()
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVis)
    if (finePointer) { window.addEventListener('pointermove', onMove, { passive: true }); document.addEventListener('pointerleave', onLeave) }
    return () => {
      cancelAnimationFrame(raf); mo.disconnect()
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return <canvas ref={ref} className="bg-field" aria-hidden />
}
