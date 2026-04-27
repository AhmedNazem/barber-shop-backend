declare global {
  namespace Express {
    interface Request {
      requestId: string
      user?: {
        id: string
        role: string
        shopId?: string
        isVip?: boolean
      }
    }
  }
}

export {}
