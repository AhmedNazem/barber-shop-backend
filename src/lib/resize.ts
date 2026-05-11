import sharp from 'sharp'

export type ImageVariants = {
  thumb:  Buffer // 400px — cards, avatars
  medium: Buffer // 800px — listings, shop cards
  full:   Buffer // 1600px — hero, detail pages
}

export async function resizeImage(input: Buffer): Promise<ImageVariants> {
  const [thumb, medium, full] = await Promise.all([
    sharp(input).resize(400,  undefined, { withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
    sharp(input).resize(800,  undefined, { withoutEnlargement: true }).webp({ quality: 82 }).toBuffer(),
    sharp(input).resize(1600, undefined, { withoutEnlargement: true }).webp({ quality: 85 }).toBuffer(),
  ])
  return { thumb, medium, full }
}
