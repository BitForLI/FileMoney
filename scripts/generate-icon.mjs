import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

await sharp(fileURLToPath(new URL('../build/icon.svg', import.meta.url)))
  .resize(512, 512)
  .png()
  .toFile(fileURLToPath(new URL('../build/icon.png', import.meta.url)))
