// Turn frames captured with upright.record() in the viewer (a JSON array of JPEG data URLs) into a GIF and an MP4.
//   node tools/clip.mjs frames.json docs/walk   -> docs/walk.gif, docs/walk.mp4
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const [src, out, fps = '30', width = '720'] = process.argv.slice(2);
const raw = fs.readFileSync(src, 'utf8');
const frames = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
const dir = 'tmp/frames';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
frames.forEach((d, i) => fs.writeFileSync(`${dir}/${String(i).padStart(5, '0')}.jpg`, Buffer.from(d.split(',')[1], 'base64')));
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', fps, '-i', `${dir}/%05d.jpg`, ...a]);
ff('-vf', `scale=${width}:-2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', `${out}.mp4`);
ff('-vf', `fps=${Math.min(+fps, 20)},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, `${out}.gif`);
console.log(`${frames.length} frames -> ${out}.gif (${(fs.statSync(`${out}.gif`).size / 1e6).toFixed(1)} MB), ${out}.mp4`);
