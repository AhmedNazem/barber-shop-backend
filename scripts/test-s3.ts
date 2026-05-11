import 'dotenv/config'
import { uploadImageVariants } from '../src/lib/s3'
import { resizeImage } from '../src/lib/resize'
import fs from 'fs/promises'
import path from 'path'

// Creates a minimal 100x100 white JPEG buffer for testing (no test image file needed)
async function makeDummyImage(): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 34, g: 197, b: 94 } }
  }).jpeg().toBuffer()
}

async function main() {
  console.log('Testing S3 connection and image resize pipeline...\n')

  // 1. Test resize
  console.log('Step 1 — Generating test image...')
  const dummy = await makeDummyImage()
  console.log(`  Original: ${dummy.length} bytes`)

  console.log('Step 2 — Resizing to 3 variants...')
  const variants = await resizeImage(dummy)
  console.log(`  thumb:  ${variants.thumb.length} bytes (400px WebP)`)
  console.log(`  medium: ${variants.medium.length} bytes (800px WebP)`)
  console.log(`  full:   ${variants.full.length} bytes (1600px WebP)`)

  // 2. Test S3 upload
  console.log('\nStep 3 — Uploading to S3...')
  const url = await uploadImageVariants('test/s3-pipeline-test', dummy)
  console.log(`\n✓ Upload successful!`)
  console.log(`  Stored URL (medium): ${url}`)
  console.log(`  Thumb URL:  ${url.replace('-md.webp', '-thumb.webp')}`)
  console.log(`  Full URL:   ${url.replace('-md.webp', '-full.webp')}`)
  console.log('\nOpen the URLs above in your browser to confirm the images are accessible.')
}

main().catch((err) => {
  console.error('✗ Test failed:', err.message)
  process.exit(1)
})
