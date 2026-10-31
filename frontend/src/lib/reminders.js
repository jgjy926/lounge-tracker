// Phone notifications for trip deadlines. Android only: they are scheduled on the
// device, so they need no server and still fire when the app is closed. They are
// inexact on purpose: an exact alarm makes the plugin stop and send you to Android's
// "Alarms & reminders" settings, and a reminder a few minutes late doesn't matter.
import { LocalNotifications } from '@capacitor/local-notifications'
import { isNative } from './platform'
import { todayIso } from './dates'
import { buildReminders } from './trips'

const REMIND_HOUR = 9

const hash = (s) => {
  let h = 7
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(h) || 1
}

const at9am = (iso) => new Date(`${iso}T${String(REMIND_HOUR).padStart(2, '0')}:00:00`)

export const remindersSupported = () => isNative()

export async function remindersOn() {
  if (!isNative()) return false
  const { display } = await LocalNotifications.checkPermissions()
  return display === 'granted'
}

export async function askForReminders() {
  if (!isNative()) return false
  const { display } = await LocalNotifications.requestPermissions()
  return display === 'granted'
}

// Replaces everything scheduled, so a met requirement or a deleted trip drops out.
export async function syncReminders(doc) {
  if (!isNative()) return
  try {
    const { display } = await LocalNotifications.checkPermissions()
    if (display !== 'granted') return
    const { notifications } = await LocalNotifications.getPending()
    if (notifications.length) await LocalNotifications.cancel({ notifications: notifications.map((n) => ({ id: n.id })) })
    const now = new Date()
    const due = buildReminders(doc, todayIso())
      .map((r) => ({ ...r, at: at9am(r.date) }))
      .filter((r) => r.at > now)
    if (!due.length) return
    await LocalNotifications.schedule({
      notifications: due.map((r) => ({ id: hash(r.key), title: r.title, body: r.body, isExactNotification: false, schedule: { at: r.at, allowWhileIdle: true } })),
    })
  } catch (e) {
    console.warn('reminders skipped:', e.message)
  }
}

export async function sendTestReminder() {
  await LocalNotifications.schedule({
    notifications: [{ id: 1, title: 'Lounge Tracker', body: 'Trip reminders are working.', isExactNotification: false, schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true } }],
  })
}
