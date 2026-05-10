import { Queue, Worker, Job } from 'bullmq'
import { Resend } from 'resend'
import { redisClient } from '@/lib/redis'

const QUEUE_NAME = 'contact-email'
const connection = redisClient

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
}

export const contactEmailQueue = new Queue(QUEUE_NAME, { connection, defaultJobOptions })

export type ContactEmailJobData = {
  id:      string
  name:    string
  email:   string
  subject: string
  message: string
}

async function processJob(job: Job<ContactEmailJobData>) {
  const { name, email, subject, message } = job.data

  const resend = new Resend(process.env['RESEND_API_KEY'])
  await resend.emails.send({
    from:    process.env['EMAIL_FROM'] ?? 'BarberOS <onboarding@resend.dev>',
    to:      process.env['EMAIL_TO']   ?? '',
    replyTo: email,
    subject: `[Contact] ${subject}`,
    html:    `<p><strong>From:</strong> ${name} &lt;${email}&gt;</p><p>${message.replace(/\n/g, '<br>')}</p>`,
  })
}

export function startContactEmailWorker() {
  const worker = new Worker<ContactEmailJobData>(QUEUE_NAME, processJob, { connection, concurrency: 2 })

  worker.on('completed', (job) => console.log(`[contact-email] job ${job.id} completed`))
  worker.on('failed',    (job, err) => console.error(`[contact-email] job ${job?.id} failed after ${job?.attemptsMade} attempts:`, err.message))
  worker.on('error',     (err) => console.error('[contact-email] worker error:', err.message))

  return worker
}
