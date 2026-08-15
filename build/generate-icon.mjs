import { unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import pngToIco from 'png-to-ico';

const buildDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceLogo = path.join(buildDirectory, '..', 'public', 'logo.png');
const squareLogo = path.join(buildDirectory, 'icon-source.png');
const image = await loadImage(sourceLogo);
const canvas = createCanvas(256, 256);
const context = canvas.getContext('2d');
const scale = Math.min(256 / image.width, 256 / image.height);
const width = image.width * scale;
const height = image.height * scale;

context.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
writeFileSync(squareLogo, canvas.toBuffer('image/png'));

const icon = await pngToIco(squareLogo);

writeFileSync(path.join(buildDirectory, 'icon.ico'), icon);
unlinkSync(squareLogo);