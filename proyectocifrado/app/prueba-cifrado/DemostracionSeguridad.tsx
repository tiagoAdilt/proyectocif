'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { cifrar, descifrar } from '../../lib/cifrado';

type Comprobacion = { nombre: string; correcto: boolean };

export async function comprobarSeguridad() {
  const mensaje = 'Hola, este mensaje es una prueba de doble cifrado. 🔐';
  const vig = 'vigenere-de-demostracion';
  const aes = 'aes-de-demostracion';
  const cifrado = await cifrar(mensaje, vig, aes);
  const resultados: Comprobacion[] = [];
  resultados.push({ nombre: 'Las dos claves correctas recuperan el mensaje original', correcto: await descifrar(cifrado, vig, aes) === mensaje });
  async function rechaza(valor: string, claveVig: string, claveAes: string) {
    try { await descifrar(valor, claveVig, claveAes); return false; }
    catch { return true; }
  }
  resultados.push({ nombre: 'Una clave Vigenère incorrecta impide leer el mensaje', correcto: await rechaza(cifrado, vig + '-incorrecta', aes) });
  resultados.push({ nombre: 'Una clave AES incorrecta impide leer el mensaje', correcto: await rechaza(cifrado, vig, aes + '-incorrecta') });
  // Cambia un byte del contenido, conservando el formato y las claves originales.
  const partes = cifrado.slice('CHAT2:'.length).split('.');
  const contenido = atob(partes[2]);
  partes[2] = btoa(String.fromCharCode(contenido.charCodeAt(0) ^ 1) + contenido.slice(1));
  const alterado = 'CHAT2:' + partes.join('.');
  resultados.push({ nombre: 'Un byte alterado se rechaza incluso con las claves correctas', correcto: await rechaza(alterado, vig, aes) });
  resultados.push({ nombre: 'Cifrar otra vez el mismo texto produce un resultado diferente', correcto: await cifrar(mensaje, vig, aes) !== cifrado });
  return { mensaje, cifrado, alterado, resultados };
}

export default function DemostracionSeguridad() {
  const [prueba, setPrueba] = useState<Awaited<ReturnType<typeof comprobarSeguridad>> | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const ejecutando = useRef(false);
  async function ejecutar() {
    if (ejecutando.current) return;
    ejecutando.current = true;
    setOcupado(true); setError(''); setPrueba(null);
    try { setPrueba(await comprobarSeguridad()); }
    catch { setError('No se pudo completar la prueba. Abrí la aplicación en localhost o HTTPS y volvé a intentar.'); }
    finally { ejecutando.current = false; setOcupado(false); }
  }
  return (
    <section aria-labelledby="demostracion-titulo" className="w-full max-w-lg mb-6 rounded-xl border border-gray-700 bg-gray-900 p-6">
      <Link href="/chat" className="text-blue-400 underline">Volver a los chats</Link>
      <h2 id="demostracion-titulo" className="mt-5 text-xl font-semibold">Demostración de seguridad</h2>
      <p className="mt-2 text-sm text-gray-300">Texto → Vigenère → AES-GCM → mensaje cifrado. El destinatario revierte el proceso con ambas claves.</p>
      <p className="mt-3 text-sm text-gray-400">Esta prueba usa el mismo código de cifrado del chat, con claves de ejemplo. Se ejecuta en este navegador y no envía mensajes ni modifica tus conversaciones.</p>
      <button onClick={ejecutar} disabled={ocupado} className="mt-5 w-full rounded-lg bg-blue-600 p-3 font-medium hover:bg-blue-700 disabled:opacity-60">{ocupado ? 'Comprobando…' : 'Probar claves e integridad'}</button>
      <div aria-live="polite" aria-busy={ocupado}>
        {error && <p className="mt-4 text-red-400">{error}</p>}
        {prueba && <>
          <p className="mt-4 font-medium">{prueba.resultados.every(r => r.correcto) ? 'Las 5 comprobaciones pasaron.' : 'Hay comprobaciones que fallaron.'}</p>
          <ul className="mt-3 space-y-3 text-sm">{prueba.resultados.map(r => <li key={r.nombre} className={r.correcto ? 'text-green-400' : 'text-red-400'}>{r.correcto ? '✓ Correcto: ' : '✗ Falló: '}{r.nombre}</li>)}</ul>
          <details className="mt-5 text-sm">
            <summary className="cursor-pointer text-blue-400">Ver el mensaje y los cifrados de prueba</summary>
            <p className="mt-3">Original: {prueba.mensaje}</p>
            <p className="mt-3">Cifrado original:</p><code className="block break-all text-gray-300">{prueba.cifrado}</code>
            <p className="mt-3">Copia alterada que se rechazó:</p><code className="block break-all text-gray-300">{prueba.alterado}</code>
          </details>
        </>}
      </div>
      <p className="mt-5 text-xs leading-relaxed text-gray-400">Vigenère es una capa educativa. La protección criptográfica moderna y la detección de alteraciones las aporta AES-GCM. Estas comprobaciones no equivalen a una auditoría completa del sistema.</p>
    </section>
  );
}
