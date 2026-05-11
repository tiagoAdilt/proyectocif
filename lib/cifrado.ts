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
export function cifrar(texto: string, claveVig: string, claveAes: string): string {
  if (!texto || !claveVig || !claveAes) throw new Error("Se requieren el mensaje y ambas claves.");
  return CryptoJS.AES.encrypt(vigenereEncrypt(texto, claveVig), claveAes).toString();
}
export function descifrar(textoCifrado: string, claveVig: string, claveAes: string): string {
  if (!textoCifrado || !claveVig || !claveAes) throw new Error("Se requieren el texto cifrado y ambas claves.");
  const bytes = CryptoJS.AES.decrypt(textoCifrado, claveAes);
  const paso1 = bytes.toString(CryptoJS.enc.Utf8);
  if (!paso1) throw new Error("Clave AES incorrecta o texto invalido.");
  return vigenereDecrypt(paso1, claveVig);
}
