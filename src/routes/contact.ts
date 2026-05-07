import { Router } from 'express'
import { z } from 'zod'
import { validate } from '@/middleware/validate'
import { submitContactHandler } from '@/controllers/contact.controller'

const contactSchema = z.object({
  name:    z.string().min(1).max(100),
  email:   z.string().email(),
  subject: z.enum(['general', 'booking', 'partnership', 'technical', 'complaint']),
  message: z.string().min(1).max(2000),
})

export const contactRouter = Router()

contactRouter.post('/', validate(contactSchema), submitContactHandler)
