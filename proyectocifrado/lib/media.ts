export const MEDIA_BUCKET = 'chat-media';
export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const PREFIX = 'CHAT_MEDIA_V1:';
const types: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'video/webm', mp4: 'video/mp4' };
const allowed = new Set([...Object.values(types), 'audio/webm', 'audio/x-wav']);
export type MediaInfo = { version: 1; path: string; name: string; mime: string; size: number };
export function validarArchivo(file: File): string {
  const mime = file.type.split(';')[0].toLowerCase() || types[file.name.split('.').pop()?.toLowerCase() || ''];
  if (!allowed.has(mime)) throw new Error('Usá imágenes JPG, PNG o WebP; audio MP3, M4A, WAV, OGG o WebM; o video MP4 o WebM.');
  if (!file.size || file.size > MAX_MEDIA_BYTES) throw new Error('El archivo debe pesar entre 1 byte y 20 MB.');
  return mime;
}
export function describirArchivo(info: MediaInfo) { return PREFIX + JSON.stringify(info); }
export function leerArchivo(text: string, expectedPath?: string): MediaInfo | null {
  if (!text?.startsWith(PREFIX) || !expectedPath) return null;
  try {
    const value = JSON.parse(text.slice(PREFIX.length));
    if (value.version !== 1 || value.path !== expectedPath || !allowed.has(value.mime)
      || typeof value.name !== 'string' || value.name.length > 200
      || !Number.isInteger(value.size) || value.size < 1 || value.size > MAX_MEDIA_BYTES) return null;
    return value;
  } catch { return null; }
}
async function key(vig: string, aes: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(JSON.stringify([vig, aes])), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
// Layout: random salt (16), nonce (12), authenticated ciphertext + tag.
export async function cifrarArchivo(file: Blob, vig: string, aes: string, path: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(path) },
    await key(vig, aes, salt), await file.arrayBuffer());
  return new Blob([salt, iv, encrypted], { type: 'application/octet-stream' });
}
export async function descifrarArchivo(blob: Blob, info: MediaInfo, vig: string, aes: string): Promise<Blob> {
  if (blob.size !== info.size + 44) throw new Error('El tamaño del archivo no coincide.');
  const data = await blob.arrayBuffer();
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(16, 28), additionalData: new TextEncoder().encode(info.path) },
      await key(vig, aes, new Uint8Array(data.slice(0, 16))), data.slice(28));
    return new Blob([plain], { type: info.mime });
  } catch { throw new Error('No se pudo verificar el archivo: claves incorrectas o contenido alterado.'); }
}
