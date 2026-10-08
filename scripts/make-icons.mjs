#!/usr/bin/env node
/**
 * Build the installed-app icons from the logo.
 *
 *   node scripts/make-icons.mjs
 *
 * Reads apps/web/public/logo.png and writes the square icons a phone or desktop shows once the app
 * is installed. Re-run it after replacing the logo; the output is committed so a build needs no
 * image tooling.
 *
 * Maskable icons are cropped to whatever shape the platform likes (circle, squircle, rounded
 * square), so the logo sits inside the 80% safe zone with the background filling the rest.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'apps', 'web', 'public', 'logo.png');
const iconsDir = join(root, 'apps', 'web', 'public', 'icons');
const appDir = join(root, 'apps', 'web', 'src', 'app');

/** The sheet the logo is printed on: opaque, so the icon reads on any wallpaper. */
const BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 };

/** A square icon: the logo centred on the background, taking `coverage` of the width. */
async function square(size, coverage, out) {
  const logo = await sharp(source)
    .resize({ width: Math.round(size * coverage), fit: 'inside' })
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BACKGROUND } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(out);
  return out;
}

await mkdir(iconsDir, { recursive: true });
const written = await Promise.all([
  square(192, 0.8, join(iconsDir, 'icon-192.png')),
  square(512, 0.8, join(iconsDir, 'icon-512.png')),
  // Safe zone: the corners of a maskable icon can be cut away entirely.
  square(512, 0.6, join(iconsDir, 'icon-maskable-512.png')),
  square(180, 0.8, join(appDir, 'apple-icon.png')),
]);
for (const file of written)
  console.log('wrote', file.replace(root + '\\', '').replace(root + '/', ''));
