import { UserRole } from '@prisma/client'

declare global {
  namespace Express {
    interface Request {
      requestId: string
      user?: {
        id: string
        role: UserRole
        shopId?: string
      }
    }
  }
}
