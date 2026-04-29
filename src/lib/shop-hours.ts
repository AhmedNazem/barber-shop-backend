type HoursEntry = {
  dayOfWeek: number
  openTime: string
  closeTime: string
  isClosed: boolean
}

export function isShopOpen(hours: HoursEntry[], now: Date): boolean {
  // Convert to Baghdad time (GMT+3) by shifting the UTC timestamp
  const baghdad = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Baghdad' }))
  const dayOfWeek = baghdad.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const currentTime = `${baghdad.getHours().toString().padStart(2, '0')}:${baghdad.getMinutes().toString().padStart(2, '0')}`

  const today = hours.find(h => h.dayOfWeek === dayOfWeek)
  if (!today || today.isClosed) return false

  return currentTime >= today.openTime && currentTime < today.closeTime
}
