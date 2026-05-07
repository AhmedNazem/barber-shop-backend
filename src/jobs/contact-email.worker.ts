import { Queue, Worker, Job } from 'bullmq'
import { redisClient } from '@/lib/redis'

const QUEUE_NAME = 'contact-email'
const connection = redisClient

export const contactEmailQueue = new Queue(QUEUE_NAME, { connection })

export type ContactEmailJobData = {
  id:      string
  name:    string
  email:   string
  subject: string
  message: string
}

async function processJob(job: Job<ContactEmailJobData>) {
  const { name, email, subject, message } = job.data
  // No email provider configured yet — log for now
  console.log(`[contact-email] From: ${name} <${email}> | Subject: ${subject} | ${message.slice(0, 80)}`)
}

export function startContactEmailWorker() {
  const worker = new Worker<ContactEmailJobData>(QUEUE_NAME, processJob, { connection })

  worker.on('completed', (job) => console.log(`[contact-email] job ${job.id} completed`))
  worker.on('failed',    (job, err) => console.error(`[contact-email] job ${job?.id} failed:`, err.message))
  worker.on('error',     (err) => console.error('[contact-email] worker error:', err.message))

  return worker
}
