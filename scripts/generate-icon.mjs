import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = path.resolve(import.meta.dirname, '..')
const src = path.join(root, 'build', 'icon.png')
const square = path.join(root, 'build', 'icon-512.png')
const ico = path.join(root, 'build', 'icon.ico')
const favicon = path.join(root, 'public', 'favicon.ico')

await sharp(src).resize(512, 512, { fit: 'cover' }).png().toFile(square)
const buf = await pngToIco(square)
fs.writeFileSync(ico, buf)
fs.mkdirSync(path.dirname(favicon), { recursive: true })
fs.copyFileSync(ico, favicon)
console.log('Generated build/icon.ico and public/favicon.ico')
