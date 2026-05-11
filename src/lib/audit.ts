interface AuditEntry {
  adminId: string
  action: string
  targetId: string
  targetType: 'shop' | 'user' | 'payment' | 'platform_config'
  detail?: Record<string, unknown>
}

export function auditLog(entry: AuditEntry) {
  console.log(JSON.stringify({ type: 'audit', timestamp: new Date().toISOString(), ...entry }))
}
