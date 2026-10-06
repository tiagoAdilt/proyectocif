import CryptoJS from "crypto-js";
const CHARS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
const N = CHARS.length;
function vigenereEncrypt(text: string, key: string): string {
  let result = "", ki = 0;
  for (let i = 0; i < text.length; i++) {
    const ci = CHARS.indexOf(text[i]);
    if (ci === -1) { result += text[i]; continue; }
    const shift = CHARS.indexOf(key[ki % key.length]);
    result += CHARS[(ci + (shift === -1 ? 0 : shift)) % N];
    ki++;
  }
  return result;
}
function vigenereDecrypt(text: string, key: string): string {
  let result = "", ki = 0;
  for (let i = 0; i < text.length; i++) {
    const ci = CHARS.indexOf(text[i]);
    if (ci === -1) { result += text[i]; continue; }
    const shift = CHARS.indexOf(key[ki % key.length]);
    result += CHARS[((ci - (shift === -1 ? 0 : shift)) % N + N) % N];
    ki++;
  }
  return result;
}

const PREFIX = 'CHAT2:';
export function esCifradoAutenticado(value: string): boolean { return value.startsWith(PREFIX); }
function base64(bytes: Uint8Array): string { return btoa(Array.from(bytes, x => String.fromCharCode(x)).join('')); }
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Formato inválido');
  return Uint8Array.from(atob(value), x => x.charCodeAt(0));
}
async function derive(vig: string, aes: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(JSON.stringify([vig, aes])), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'}, material,
    {name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function cifrar(texto: string, vig: string, aes: string): Promise<string> {
  if (!texto || !vig || !aes) throw new Error('Se requieren el mensaje y ambas claves.');
  const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(PREFIX)},
    await derive(vig,aes,salt), new TextEncoder().encode(vigenereEncrypt(texto,vig)));
  return PREFIX+[base64(salt),base64(iv),base64(new Uint8Array(data))].join('.');
}
export async function descifrar(value: string, vig: string, aes: string): Promise<string> {
  if (!value || !vig || !aes) throw new Error('Se requieren el mensaje y ambas claves.');
  if (esCifradoAutenticado(value)) {
    try {
      if(value.length > 100000) throw new Error('Mensaje demasiado grande');
      const parts=value.slice(PREFIX.length).split('.');
      if(parts.length!==3) throw new Error('Formato inválido');
      const [salt,iv,data]=parts.map(decode);
      if(salt.length!==16 || iv.length!==12 || data.length<17) throw new Error('Formato inválido');
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(PREFIX)},await derive(vig,aes,salt),data);
      return vigenereDecrypt(new TextDecoder('utf-8',{fatal:true}).decode(plain),vig);
    } catch { throw new Error('No se pudo verificar: claves incorrectas o mensaje alterado.'); }
  }
  // Compatibilidad exclusiva con el formato CryptoJS anterior. Nunca se afirma su integridad.
  if(!value.startsWith('U2FsdGVkX1')) throw new Error('Formato desconocido');
  const bytes=CryptoJS.AES.decrypt(value,aes);
  const plain=bytes.toString(CryptoJS.enc.Utf8);
  if(!plain) throw new Error('No se pudo descifrar el mensaje anterior.');
  return vigenereDecrypt(plain,vig);
}
export async function hashCifrado(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))), x=>x.toString(16).padStart(2,'0')).join('');
}
