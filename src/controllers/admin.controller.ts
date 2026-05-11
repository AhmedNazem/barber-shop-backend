import { Request, Response, NextFunction } from 'express'
import { ok } from '@/lib/response'
import { approveShop, rejectShop, suspendShop, listUsers, getUser, changeUserRole, suspendUser, deleteUser, getSuspendPreview, listPendingShops } from '@/services/admin.service'
import { getPlatformConfig, updatePlatformConfig, testSmsConfig } from '@/services/platform-config.service'
import { unblockUser } from '@/services/reliability.service'
import { prisma } from '@/config/prisma'
import { auditLog } from '@/lib/audit'

// ─── Shop management ──────────────────────────────────────────────────────────

export async function approveShopHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await approveShop(req.params['id']!)
    auditLog({ adminId: req.user!.id, action: 'shop.approve', targetId: req.params['id']!, targetType: 'shop' })
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function rejectShopHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await rejectShop(req.params['id']!, req.body.reason, req.body.reasonAr)
    auditLog({ adminId: req.user!.id, action: 'shop.reject', targetId: req.params['id']!, targetType: 'shop', detail: { reason: req.body.reason } })
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function suspendShopHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await suspendShop(req.params['id']!, req.body.reason)
    auditLog({ adminId: req.user!.id, action: 'shop.suspend', targetId: req.params['id']!, targetType: 'shop', detail: { reason: req.body.reason } })
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function suspendPreviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getSuspendPreview(req.params['id']!))
  } catch (err) { next(err) }
}

export async function listPendingShopsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const page  = Math.max(1, parseInt(String(req.query['page']  ?? '1'),  10))
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '20'), 10)))
    ok(res, await listPendingShops({ page, limit }))
  } catch (err) { next(err) }
}

// ─── Platform config ──────────────────────────────────────────────────────────

export async function getPlatformConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getPlatformConfig())
  } catch (err) { next(err) }
}

export async function updatePlatformConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await updatePlatformConfig(req.body)
    auditLog({ adminId: req.user!.id, action: 'platform_config.update', targetId: 'platform_config', targetType: 'platform_config', detail: req.body })
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function testSmsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await testSmsConfig(req.body.phone)
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

// ─── User management ──────────────────────────────────────────────────────────

export async function listUsersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const page  = Math.max(1, parseInt(String(req.query['page']  ?? '1'),  10))
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query['limit'] ?? '20'), 10)))
    const role  = req.query['role'] as string | undefined
    ok(res, await listUsers({ role, page, limit }))
  } catch (err) { next(err) }
}

export async function getUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    ok(res, await getUser(req.params['id']!))
  } catch (err) { next(err) }
}

export async function changeRoleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await changeUserRole(req.params['id']!, req.body.role)
    auditLog({ adminId: req.user!.id, action: 'user.role_change', targetId: req.params['id']!, targetType: 'user', detail: { newRole: req.body.role } })
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function suspendUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await suspendUser(req.params['id']!)
    auditLog({ adminId: req.user!.id, action: 'user.suspend', targetId: req.params['id']!, targetType: 'user' })
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function deleteUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deleteUser(req.params['id']!)
    auditLog({ adminId: req.user!.id, action: 'user.delete', targetId: req.params['id']!, targetType: 'user' })
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

// ─── Reliability / VIP ────────────────────────────────────────────────────────

export async function unblockUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await unblockUser(req.params['id']!)
    auditLog({ adminId: req.user!.id, action: 'user.unblock', targetId: req.params['id']!, targetType: 'user' })
    ok(res, { ok: true })
  } catch (err) { next(err) }
}

export async function grantVipHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const adminId = req.user!.id
    await prisma.user.update({
      where: { id: req.params['id']! },
      data:  { isVip: true, vipGrantedAt: new Date(), vipGrantedBy: adminId },
    })
    auditLog({ adminId, action: 'user.vip_grant', targetId: req.params['id']!, targetType: 'user' })
    ok(res, { ok: true })
  } catch (err) { next(err) }
}
