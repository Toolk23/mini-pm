import { useEffect, useRef } from 'react'

/**
 * Живой фон v3 в духе hackfirst.io, но целиком кодом (без чужих видео):
 *  - пиксельный «смерч» из дыма — шум с завихрением, нарисованный в маленьком canvas и растянутый без сглаживания;
 *  - редкие вспышки глитча — горизонтальные полосы сдвигаются, по экрану пробегают штрихи;
 *  - дым тянется к курсору и бледнеет при прокрутке, чтобы не мешать читать.
 * Цвет — из --text (в тёмной теме светлый дым, в светлой — тёмный).
 * ~30 кадров/с, пауза на скрытой вкладке, при prefers-reduced-motion — один статичный кадр без глитча.
 */

// Быстрый value-noise на таблице перестановок.
const PERM = (() => {
  const p = Array.from({ length: 256 }, (_, i) => i)
  let s = 1337
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]] }
  const out = new Uint8Array(512)
  for (let i = 0; i < 512; i++) out[i] = p[i & 255]
  return out
})()
const fade = (t: number) => t * t * (3 - 2 * t)
function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const X = xi & 255, Y = yi & 255
  const a = PERM[PERM[X] + Y] / 255, b = PERM[PERM[X + 1] + Y] / 255
  const c = PERM[PERM[X] + Y + 1] / 255, d = PERM[PERM[X + 1] + Y + 1] / 255
  const u = fade(xf), v = fade(yf)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
const fbm = (x: number, y: number) => noise(x, y) * 0.65 + noise(x * 2.1 + 17, y * 2.1 + 9) * 0.35

export default function BgField() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const small = document.createElement('canvas')
    const sctx = small.getContext('2d')
    if (!ctx || !sctx) return

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
    const CELL = 7 // размер «пикселя» дыма в CSS-пикселях
    let w = 0, h = 0, gw = 0, gh = 0, raf = 0, last = 0
    let ink: [number, number, number] = [233, 247, 252]
    let light = false
    let img: ImageData | null = null
    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, on: 0, ton: 0 }
    let glitchUntil = 0, nextGlitch = performance.now() + 2500
    let bands: { y: number; hh: number; dx: number }[] = []
    let streaks: { x: number; y: number; len: number; a: number }[] = []

    const readColor = () => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--text)'
      document.body.appendChild(probe)
      const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g)
      probe.remove()
      if (m && m.length >= 3) ink = [+m[0], +m[1], +m[2]]
      light = document.documentElement.dataset.theme === 'light'
    }
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      w = window.innerWidth; h = window.innerHeight
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      gw = Math.ceil(w / CELL); gh = Math.ceil(h / CELL)
      small.width = gw; small.height = gh
      img = sctx.createImageData(gw, gh)
    }

    const draw = (now: number) => {
      if (!img) return
      const t = now / 1000
      mouse.x += (mouse.tx - mouse.x) * 0.06
      mouse.y += (mouse.ty - mouse.y) * 0.06
      mouse.on += (mouse.ton - mouse.on) * 0.05

      // дым бледнеет по мере прокрутки — на длинных страницах он лишь фон
      const scrollFade = 1 - Math.min(window.scrollY / 900, 1) * 0.55
      const maxA = (light ? 0.2 : 0.34) * scrollFade
      const narrow = w < 760
      const data = img.data
      const [r, g, b] = ink
      const aspect = w / h

      for (let j = 0; j < gh; j++) {
        const v = j / gh
        // ось смерча гуляет; к верху воронка шире
        const cx = (narrow ? 0.62 : 0.5) + 0.07 * Math.sin(v * 3.2 + t * 0.6) + 0.03 * Math.sin(v * 9 - t * 1.3)
        const width = 0.07 + 0.2 * Math.pow(1 - v, 1.6)
        const swirl = Math.sin(v * 10 - t * 2.2) * width * 0.9
        for (let i = 0; i < gw; i++) {
          const u = i / gw
          // завихрённый шум: координаты сдвигаются по спирали и «текут» вверх
          const nx = (u + swirl * 0.35) * 6 * aspect
          const ny = v * 6 + t * 0.55
          const warp = noise(nx * 0.5 + t * 0.2, ny * 0.5)
          let d = fbm(nx + warp * 1.6, ny - warp * 1.2)
          const dxn = (u - cx) / width
          const env = Math.exp(-dxn * dxn)
          let dens = d * (0.12 + env * 1.15)
          // курсор подтягивает дым
          if (mouse.on > 0.01) {
            const mx = (u - mouse.x) * aspect, my = v - mouse.y
            const md = mx * mx + my * my
            dens += Math.exp(-md * 30) * 0.45 * d * mouse.on
          }
          // контраст: тёмные провалы, яркие клубы
          dens = Math.max(0, dens - 0.32) * 1.9
          if (dens > 1) dens = 1
          // мелкие искры в плотных местах, как шум на видео
          if (dens > 0.55 && ((i * 73856093) ^ (j * 19349663) ^ Math.floor(t * 12)) % 23 === 0) dens = 1
          const k = (j * gw + i) * 4
          data[k] = r; data[k + 1] = g; data[k + 2] = b
          data[k + 3] = dens * maxA * 255
        }
      }
      sctx.putImageData(img, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(small, 0, 0, gw * CELL, gh * CELL)

      // глитч: раз в несколько секунд на 200–350 мс полосы сдвигаются и пробегают штрихи
      if (!reduce) {
        if (now > nextGlitch) {
          glitchUntil = now + 200 + Math.random() * 150
          nextGlitch = now + 4500 + Math.random() * 4500
          bands = Array.from({ length: 3 + Math.floor(Math.random() * 4) }, () => ({
            y: Math.random() * h, hh: 4 + Math.random() * 26, dx: (Math.random() - 0.5) * 220,
          }))
          streaks = Array.from({ length: 14 + Math.floor(Math.random() * 16) }, () => ({
            x: Math.random() * w, y: Math.random() * h, len: 20 + Math.random() * 180, a: 0.15 + Math.random() * 0.45,
          }))
        }
        if (now < glitchUntil) {
          const sx = canvas.width / w
          for (const bd of bands) {
            ctx.drawImage(canvas, 0, bd.y * sx, canvas.width, bd.hh * sx, bd.dx, bd.y, w, bd.hh)
          }
          for (const s of streaks) {
            ctx.fillStyle = `rgba(${r},${g},${b},${(s.a * scrollFade).toFixed(3)})`
            ctx.fillRect(s.x + (Math.random() - 0.5) * 30, s.y, s.len, 1 + (Math.random() < 0.3 ? 1 : 0))
          }
        }
      }
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (now - last < 33) return
      last = now
      draw(now)
    }
    const start = () => { cancelAnimationFrame(raf); if (reduce) draw(4000); else raf = requestAnimationFrame(loop) }
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else start() }
    const onMove = (e: PointerEvent) => { mouse.tx = e.clientX / w; mouse.ty = e.clientY / h; mouse.ton = 1 }
    const onLeave = () => { mouse.ton = 0 }
    const onResize = () => { resize(); if (reduce) draw(4000) }
    const onScroll = () => { if (reduce) draw(4000) }

    const mo = new MutationObserver(() => { readColor(); if (reduce) draw(4000) })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    readColor(); resize(); start()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onVis)
    if (finePointer) { window.addEventListener('pointermove', onMove, { passive: true }); document.addEventListener('pointerleave', onLeave) }
    return () => {
      cancelAnimationFrame(raf); mo.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  return <canvas ref={ref} className="bg-field" aria-hidden />
}
