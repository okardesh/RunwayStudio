import { desktopCapturer } from 'electron';

export async function captureFailureScreenshot(): Promise<{ image?: string; error?: string }> {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
    const image = sources[0]?.thumbnail;
    if (!image || image.isEmpty()) return { error: 'Desktop screenshot unavailable.' };
    return { image: `data:image/jpeg;base64,${image.toJPEG(60).toString('base64')}` };
  } catch { return { error: 'Desktop screenshot capture failed.' }; }
}
