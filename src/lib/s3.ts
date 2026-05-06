import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { env } from '@/config/env'
import fs from 'fs/promises'
import path from 'path'

// ─── Local dev fallback (no S3 credentials) ───────────────────────────────────

const LOCAL_PREFIX = 'local://'
const LOCAL_DIR    = path.resolve(process.cwd(), 'tmp', 'uploads')

async function localUpload(key: string, buffer: Buffer): Promise<string> {
  const dest = path.join(LOCAL_DIR, key)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.writeFile(dest, buffer)
  return `${LOCAL_PREFIX}${key}`
}

async function localDownload(key: string): Promise<Buffer> {
  return fs.readFile(path.join(LOCAL_DIR, key))
}

// ─── S3 ───────────────────────────────────────────────────────────────────────

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
    return localUpload(key, buffer)
  }

  await getClient().send(new PutObjectCommand({
    Bucket: env.AWS_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }))

  return `https://${env.AWS_BUCKET_NAME}.s3.${env.AWS_REGION}.amazonaws.com/${key}`
}

export async function downloadFromS3(key: string): Promise<Buffer> {
  if (key.startsWith(LOCAL_PREFIX)) {
    return localDownload(key.slice(LOCAL_PREFIX.length))
  }

  const res = await getClient().send(new GetObjectCommand({
    Bucket: env.AWS_BUCKET_NAME!,
    Key: key,
  }))
  if (!res.Body) throw new Error('Empty S3 response')
  const chunks: Uint8Array[] = []
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
