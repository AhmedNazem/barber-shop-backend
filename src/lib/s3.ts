import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { env } from '@/config/env'

let _client: S3Client | null = null

function getClient(): S3Client {
  if (!_client) {
    _client = new S3Client({
      region: env.AWS_REGION ?? 'us-east-1',
      credentials: env.AWS_ACCESS_KEY_ID
        ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY! }
        : undefined,
    })
  }
  return _client
}

export async function uploadToS3(key: string, buffer: Buffer, mimeType: string): Promise<string> {
  if (!env.AWS_BUCKET_NAME || !env.AWS_ACCESS_KEY_ID) {
    throw new Error('S3 credentials not configured (AWS_BUCKET_NAME, AWS_ACCESS_KEY_ID)')
  }

  await getClient().send(new PutObjectCommand({
    Bucket: env.AWS_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }))

  return `https://${env.AWS_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com/${key}`
}
