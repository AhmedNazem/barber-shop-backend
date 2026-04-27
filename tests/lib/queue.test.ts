import { describe, it, expect, afterAll } from 'vitest'
import {
  hairAnalysisQueue,
  notificationQueue,
  loyaltyQueue,
  cleanupQueue,
} from '@/lib/queue'

afterAll(async () => {
  await Promise.all([
    hairAnalysisQueue.close(),
    notificationQueue.close(),
    loyaltyQueue.close(),
    cleanupQueue.close(),
  ])
})

describe('queues', () => {
  it('each queue has the correct name', () => {
    expect(hairAnalysisQueue.name).toBe('hair-analysis')
    expect(notificationQueue.name).toBe('notifications')
    expect(loyaltyQueue.name).toBe('loyalty')
    expect(cleanupQueue.name).toBe('cleanup')
  })

  it('is a singleton — same reference on repeated imports', async () => {
    const { hairAnalysisQueue: second } = await import('@/lib/queue')
    expect(hairAnalysisQueue).toBe(second)
  })

  it('can add a job and retrieve its id', async () => {
    const job = await hairAnalysisQueue.add('test-job', { imageKey: 'test.jpg' })
    expect(job.id).toBeDefined()
    // clean up
    await job.remove()
  })
})
