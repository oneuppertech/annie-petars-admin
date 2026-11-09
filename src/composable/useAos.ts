import { nextTick } from 'vue'
import AOS from 'aos'
import 'aos/dist/aos.css'

let ready = false

/** Initialises AOS once. If you already call AOS.init() in main.ts, you can drop the ensureAos() calls. */
export function ensureAos() {
  if (ready) return
  AOS.init({
    duration: 650,
    easing: 'ease-out-cubic',
    once: true,
    offset: 24,
    disable: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  ready = true
}

/** Re-scan the DOM after async content renders so new [data-aos] nodes animate. */
export function refreshAos() {
  ensureAos()
  return nextTick(() => AOS.refreshHard())
}