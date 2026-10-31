// What differs between the browser and the Android WebView.
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'

export const isNative = () => Capacitor.isNativePlatform()

// Open sheets register here so Android's Back closes them first.
const closers = []
export function pushBack(close) {
  closers.push(close)
  return () => {
    const i = closers.lastIndexOf(close)
    if (i >= 0) closers.splice(i, 1)
  }
}

export function installBackButton(goHome, isHome) {
  if (!isNative()) return
  CapApp.addListener('backButton', () => {
    if (closers.length) closers[closers.length - 1]()
    else if (!isHome()) goHome()
    else CapApp.minimizeApp() // background it, never kill it mid-sync
  })
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback for WebViews that block the async clipboard.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function registerServiceWorker() {
  if (isNative() || !import.meta.env.PROD || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}
