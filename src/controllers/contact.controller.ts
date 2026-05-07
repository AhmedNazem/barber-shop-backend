import { Request, Response, NextFunction } from 'express'
import { prisma } from '@/config/prisma'
import { contactEmailQueue } from '@/jobs/contact-email.worker'

export async function submitContactHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, email, subject, message } = req.body as {
      name: string; email: string; subject: string; message: string
    }

    const record = await prisma.contactMessage.create({
      data: { name, email, subject, message },
    })

    await contactEmailQueue.add('send-contact-email', {
      id: record.id, name, email, subject, message,
    })

    res.status(201).json({ data: { id: record.id } })
  } catch (err) { next(err) }
}
