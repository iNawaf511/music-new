import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, existsSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DOWNLOAD_DIR = join(__dirname, '../downloads');

const DISCORD_LIMIT_MB = 24;
const DISCORD_LIMIT_BYTES = DISCORD_LIMIT_MB * 1024 * 1024;

if (!existsSync(DOWNLOAD_DIR)) {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

const YTDLP_COMMON = [
  '--no-playlist',
  '--no-warnings',
  '--no-check-certificates',
  '--extractor-args', 'youtube:player_client=android',
];

function isTikTok(url) {
  return /tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/i.test(url);
}

async function downloadTikTok(url, format, outputPath) {
  const res = await fetch('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ url, web: '1', hd: '1' }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();

  if (data.code !== 0 || !data.data) {
    throw new Error(`TikTok API: ${data.msg || 'فشل جلب الرابط'}`);
  }

  const base = 'https://www.tikwm.com';
  const d = data.data;

  let mediaUrl;
  if (format === 'audio') {
    mediaUrl = d.music?.startsWith('http') ? d.music : base + d.music;
  } else {
    const vidPath = d.hdplay || d.play;
    mediaUrl = vidPath?.startsWith('http') ? vidPath : base + vidPath;
  }

  if (!mediaUrl) throw new Error('لم يُعثر على رابط تحميل');

  await execFileAsync('yt-dlp', [
    mediaUrl,
    '-o', outputPath,
    '--no-playlist', '-q', '--no-progress',
    '--no-check-certificates',
  ], { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });

  return {
    title: d.title?.slice(0, 80) || 'TikTok',
    sizeMB: (d.hd_size || d.size || 0) / 1024 / 1024,
  };
}

async function getDuration(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath,
    ], { timeout: 15000 });
    const info = JSON.parse(stdout);
    return parseFloat(info.format?.duration || '0');
  } catch {
    return 0;
  }
}

async function compressVideo(inputPath, outputPath, durationSec) {
  const targetBits = DISCORD_LIMIT_BYTES * 8 * 0.95;
  const audioBitrate = 96;
  const videoBitrate = Math.floor(targetBits / durationSec / 1000 - audioBitrate);

  if (videoBitrate < 100) throw new Error('المقطع طويل جداً للضغط تحت 24MB');

  await execFileAsync('ffmpeg', [
    '-i', inputPath,
    '-c:v', 'libx264',
    '-b:v', `${videoBitrate}k`,
    '-c:a', 'aac',
    '-b:a', `${audioBitrate}k`,
    '-movflags', '+faststart',
    '-y',
    outputPath,
  ], { timeout: 300000 });
}

async function compressAudio(inputPath, outputPath, durationSec) {
  const targetBits = DISCORD_LIMIT_BYTES * 8 * 0.95;
  const bitrateKbps = Math.min(192, Math.floor(targetBits / durationSec / 1000));
  const safeBitrate = Math.max(48, bitrateKbps);

  await execFileAsync('ffmpeg', [
    '-i', inputPath,
    '-c:a', 'libmp3lame',
    '-b:a', `${safeBitrate}k`,
    '-y',
    outputPath,
  ], { timeout: 300000 });
}

export async function getMediaInfo(url) {
  try {
    // Use separate --print calls to avoid tab-splitting ambiguity with titles
    const args = [
      '--no-playlist', '--no-check-certificates', '-q',
      '--extractor-args', 'youtube:player_client=android',
      '--print', '%(filesize_approx)s',
      '--print', '%(filesize)s',
      '--print', '%(title)s',
      '--print', '%(duration)s',
      url,
    ];
    const { stdout } = await execFileAsync('yt-dlp', args, {
      timeout: 25000,
      maxBuffer: 1024 * 256,
    });
    const lines = stdout.trim().split('\n');
    const rawApprox = lines[0]?.trim();
    const rawSize  = lines[1]?.trim();
    const title    = lines[2]?.trim() || 'Unknown';
    const duration = parseInt(lines[3]?.trim() || '0', 10) || 0;

    const sizeBytes = parseInt(rawApprox || rawSize || '0', 10) || 0;
    const sizeMB = sizeBytes / 1024 / 1024;

    return { title, sizeMB, duration, thumbnail: null };
  } catch {
    return null;
  }
}

export async function downloadMedia(url, format = 'both') {
  const timestamp = Date.now();
  const baseName = `media_${timestamp}`;
  let outputPath;
  let ytdlpArgs;

  // TikTok: use tikwm.com API (server IPs are blocked by TikTok directly)
  if (isTikTok(url)) {
    const ext = format === 'audio' ? 'mp3' : 'mp4';
    outputPath = join(DOWNLOAD_DIR, `${baseName}.${ext}`);
    try {
      const info = await downloadTikTok(url, format, outputPath);
      if (!existsSync(outputPath)) throw new Error('الملف لم يُنشأ');
      let stat = statSync(outputPath);
      if (stat.size > DISCORD_LIMIT_BYTES) {
        const duration = await getDuration(outputPath);
        if (duration < 1) throw new Error('تعذّر تحديد مدة الملف للضغط');
        const compressedPath = join(DOWNLOAD_DIR, `${baseName}_compressed.${ext}`);
        format === 'audio'
          ? await compressAudio(outputPath, compressedPath, duration)
          : await compressVideo(outputPath, compressedPath, duration);
        cleanupFile(outputPath);
        outputPath = compressedPath;
        stat = statSync(outputPath);
        if (stat.size > DISCORD_LIMIT_BYTES) {
          cleanupFile(outputPath);
          throw new Error(`حتى بعد الضغط الملف ${(stat.size/1024/1024).toFixed(1)}MB — جرّب صوت فقط 🎵`);
        }
      }
      return { path: outputPath, sizeMB: stat.size / (1024 * 1024) };
    } catch (err) {
      if (existsSync(outputPath)) cleanupFile(outputPath);
      throw new Error(err.message.includes('TikTok') || err.message.includes('MB') || err.message.includes('مدة') || err.message.includes('Ù')
        ? err.message
        : `فشل تحميل TikTok:\n\`\`\`\n${err.message}\n\`\`\``);
    }
  }

  const YTDLP_DL = [
    '--no-playlist', '--no-check-certificates', '--no-warnings',
    '-q', '--no-progress',
    '--extractor-args', 'youtube:player_client=android',
  ];

  if (format === 'audio') {
    outputPath = join(DOWNLOAD_DIR, `${baseName}.mp3`);
    ytdlpArgs = [
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      ...YTDLP_DL,
      '-o', outputPath, url,
    ];
  } else if (format === 'video') {
    outputPath = join(DOWNLOAD_DIR, `${baseName}.mp4`);
    ytdlpArgs = [
      '-f', 'bestvideo[ext=mp4]/bestvideo', '--no-audio',
      ...YTDLP_DL,
      '-o', outputPath, url,
    ];
  } else {
    outputPath = join(DOWNLOAD_DIR, `${baseName}.mp4`);
    ytdlpArgs = [
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      ...YTDLP_DL,
      '-o', outputPath, url,
    ];
  }

  try {
    await execFileAsync('yt-dlp', ytdlpArgs, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });

    if (!existsSync(outputPath)) {
      throw new Error('الملف لم يُنشأ - ربما الرابط غير مدعوم');
    }

    let stat = statSync(outputPath);
    let finalPath = outputPath;

    if (stat.size > DISCORD_LIMIT_BYTES) {
      console.log(`⚙️ الملف ${(stat.size / 1024 / 1024).toFixed(1)}MB — جاري الضغط...`);
      const duration = await getDuration(outputPath);

      if (duration < 1) throw new Error('تعذّر تحديد مدة الملف للضغط');

      const compressedPath = join(DOWNLOAD_DIR, `${baseName}_compressed.${format === 'audio' ? 'mp3' : 'mp4'}`);

      if (format === 'audio') {
        await compressAudio(outputPath, compressedPath, duration);
      } else {
        await compressVideo(outputPath, compressedPath, duration);
      }

      cleanupFile(outputPath);
      finalPath = compressedPath;

      if (!existsSync(finalPath)) throw new Error('فشل الضغط');
      stat = statSync(finalPath);

      if (stat.size > DISCORD_LIMIT_BYTES) {
        cleanupFile(finalPath);
        throw new Error(`حتى بعد الضغط الملف ${(stat.size/1024/1024).toFixed(1)}MB — المقطع طويل جداً. جرّب تحميل الصوت فقط 🎵`);
      }

      console.log(`✅ بعد الضغط: ${(stat.size / 1024 / 1024).toFixed(1)}MB`);
    }

    return { path: finalPath, sizeMB: stat.size / (1024 * 1024) };
  } catch (err) {
    if (existsSync(outputPath)) cleanupFile(outputPath);
    if (err.message.startsWith('فشل') || err.message.includes('MB') || err.message.includes('مدة')) {
      throw new Error(err.message);
    }
    // Surface yt-dlp stderr for debugging
    const detail = err.stderr?.slice(-300) || err.message;
    throw new Error(`فشل التحميل:\n\`\`\`\n${detail}\n\`\`\``);
  }
}

export function cleanupFile(filePath) {
  try {
    if (filePath && existsSync(filePath)) unlinkSync(filePath);
  } catch {}
}
