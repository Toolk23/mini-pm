import { useEffect, useRef } from 'react'

/**
 * Живой фон v3 в духе hackfirst.io, но целиком кодом (без чужих видео):
 *  - «смерч» из мягкого дыма — шум с завихрением в маленьком canvas, растянутый со сглаживанием
 *    и размытый CSS-фильтром (.bg-field), поэтому без пиксельных ступенек;
 *  - клубы по углам экрана;
 *  - объём: клубы подсвечены сверху-слева и затенены снизу-справа (по градиенту плотности);
 *  - два слоя: 'back' — за контентом, 'front' — только углы поверх контента; при движении мыши
 *    и прокрутке слои смещаются с разной скоростью, и страница читается как глубина, а не плоская картинка;
 *  - дым тянется к курсору и бледнеет при прокрутке, чтобы не мешать читать.
 * Цвет — из --text (в тёмной теме светлый дым, в светлой — тёмный).
 * ~30 кадров/с, пауза на скрытой вкладке, при prefers-reduced-motion — один статичный кадр.
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

// Углы «дышат» — каждый со своей фазой: [u, v, фаза].
const CORNERS = [[0, 0, 0], [1, 0, 1.7], [0, 1, 3.1], [1, 1, 4.6]] as const

export default function BgField({ layer = 'back' }: { layer?: 'back' | 'front' }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const small = document.createElement('canvas')
    const sctx = small.getContext('2d')
    if (!ctx || !sctx) return

    const front = layer === 'front'
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
    const CELL = 6 // шаг сетки шума в CSS-пикселях (после размытия не виден)
    // Глубина слоя: передний сильнее уезжает за мышью и быстрее «течёт» при прокрутке.
    const DEPTH = front ? 36 : 12
    const SCROLL_FLOW = front ? 0.0035 : 0.0012
    const SEED = front ? 40 : 0
    let w = 0, h = 0, gw = 0, gh = 0, raf = 0, last = 0
    let ink: [number, number, number] = [233, 247, 252]
    let light = false
    let img: ImageData | null = null
    let dens = new Float32Array(0)
    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, on: 0, ton: 0 }

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
      // в фоновой вкладке/превью окно бывает нулевой ширины — без этого createImageData(0, …) роняет всё приложение
      w = Math.max(1, window.innerWidth || 1); h = Math.max(1, window.innerHeight || 1)
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      gw = Math.ceil(w / CELL); gh = Math.ceil(h / CELL)
      small.width = gw; small.height = gh
      img = sctx.createImageData(gw, gh)
      dens = new Float32Array(gw * gh)
    }

    const draw = (now: number) => {
      if (!img) return
      const t = now / 1000 + SEED
      mouse.x += (mouse.tx - mouse.x) * 0.06
      mouse.y += (mouse.ty - mouse.y) * 0.06
      mouse.on += (mouse.ton - mouse.on) * 0.05

      const sy = window.scrollY
      // дым бледнеет по мере прокрутки — на длинных страницах он лишь фон
      const scrollFade = 1 - Math.min(sy / 900, 1) * (front ? 0.35 : 0.55)
      const maxA = (light ? 0.22 : 0.38) * (front ? 0.7 : 1) * scrollFade
      const narrow = w < 760
      const [r, g, b] = ink
      const aspect = w / h
      const flow = sy * SCROLL_FLOW
      const cornerR = narrow ? 0.36 : 0.3
      const mouseOn = mouse.on > 0.01

      // 1) плотность дыма
      for (let j = 0; j < gh; j++) {
        const v = j / gh
        const cx = (narrow ? 0.62 : 0.5) + 0.07 * Math.sin(v * 3.2 + t * 0.6) + 0.03 * Math.sin(v * 9 - t * 1.3)
        const width = 0.07 + 0.2 * Math.pow(1 - v, 1.6)
        const swirl = front ? 0 : Math.sin(v * 10 - t * 2.2) * width * 0.9
        for (let i = 0; i < gw; i++) {
          const u = i / gw
          const k = j * gw + i
          // углы: мягкие клубы, которые медленно раздуваются и опадают
          let corner = 0
          for (const [cu, cv, ph] of CORNERS) {
            const rr = cornerR * (0.85 + 0.15 * Math.sin(t * 0.4 + ph))
            const du = (u - cu) * aspect * 0.6, dv = v - cv
            corner += Math.exp(-(du * du + dv * dv) / (rr * rr))
          }
          let env = corner * (front ? 1 : 0.6)
          if (!front) { const dxn = (u - cx) / width; env += Math.exp(-dxn * dxn) * 1.15 }
          if (front && env < 0.02) { dens[k] = 0; continue }
          const nx = (u + swirl * 0.35) * 6 * aspect
          const ny = v * 6 + t * 0.55 + flow
          const warp = noise(nx * 0.5 + t * 0.2, ny * 0.5)
          const d = fbm(nx + warp * 1.6, ny - warp * 1.2)
          let q = d * ((front ? 0 : 0.12) + env)
          if (mouseOn) {
            const mx = (u - mouse.x) * aspect, my = v - mouse.y
            q += Math.exp(-(mx * mx + my * my) * 30) * 0.45 * d * mouse.on * (front ? 0.3 : 1)
          }
          q = Math.max(0, q - 0.32) * 1.9
          dens[k] = q > 1 ? 1 : q
        }
      }

      // 2) объём: свет сверху-слева — край клуба, обращённый к свету, ярче, обратный — в тени
      const data = img.data
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          const k = j * gw + i
          const q = dens[k]
          const p = k * 4
          if (q <= 0) { data[p + 3] = 0; continue }
          const up = j > 1 && i > 1 ? dens[k - 2 * gw - 2] : q
          let shade = 0.78 + (q - up) * 2.4
          if (shade < 0.3) shade = 0.3; else if (shade > 1.5) shade = 1.5
          // в светлой теме дым — краска: тень гуще, свет прозрачнее
          const lum = light ? 2 - shade : shade
          data[p] = r; data[p + 1] = g; data[p + 2] = b
          const a = q * maxA * lum * 255
          data[p + 3] = a > 255 ? 255 : a
        }
      }
      sctx.putImageData(img, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(small, 0, 0, gw * CELL, gh * CELL)

      // 3) параллакс слоя: двигаем сам canvas (transform на элементе — на GPU, без перерисовки страницы)
      const px = (mouse.x - 0.5) * DEPTH * mouse.on, py = (mouse.y - 0.5) * DEPTH * mouse.on
      canvas.style.transform = `translate3d(${(-px).toFixed(1)}px, ${(-py).toFixed(1)}px, 0) scale(1.08)`
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
    if (finePointer && !reduce) { window.addEventListener('pointermove', onMove, { passive: true }); document.addEventListener('pointerleave', onLeave) }
    return () => {
      cancelAnimationFrame(raf); mo.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [layer])

  return <canvas ref={ref} className={`bg-field bg-field-${layer}`} aria-hidden />
}
