'use client';

import { useState } from 'react';
import { cifrar, descifrar } from '../lib/cifrado';

export default function Home() {
  const [tab, setTab] = useState<'cifrar' | 'descifrar'>('cifrar');
  const [mensaje, setMensaje] = useState('');
  const [claveVig, setClaveVig] = useState('');
  const [claveAes, setClaveAes] = useState('');
  const [resultado, setResultado] = useState('');
  const [error, setError] = useState('');

  const handleCifrar = () => {
    try {
      setError('');
      const res = cifrar(mensaje, claveVig, claveAes);
      setResultado(res);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDescifrar = () => {
    try {
      setError('');
      const res = descifrar(mensaje, claveVig, claveAes);
      setResultado(res);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const copiar = () => {
    if (resultado) navigator.clipboard.writeText(resultado);
  };

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-semibold mb-1">Sistema de Cifrado</h1>
      <p className="text-gray-500 text-sm mb-8">E.E.T. N°3139 — Vigenère + AES</p>

      <div className="w-full max-w-lg bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="flex gap-2 mb-6">
          <button onClick={() => { setTab('cifrar'); setResultado(''); setError(''); }}
            className={`flex-1 py-2 rounded-lg text-sm ${tab === 'cifrar' ? 'bg-blue-600 text-white' : 'border border-gray-700 text-gray-400'}`}>
            Cifrar mensaje
          </button>
          <button onClick={() => { setTab('descifrar'); setResultado(''); setError(''); }}
            className={`flex-1 py-2 rounded-lg text-sm ${tab === 'descifrar' ? 'bg-blue-600 text-white' : 'border border-gray-700 text-gray-400'}`}>
            Descifrar mensaje
          </button>
        </div>

        <label className="text-xs text-gray-500">{tab === 'cifrar' ? 'Mensaje a cifrar' : 'Texto cifrado'}</label>
        <textarea value={mensaje} onChange={e => setMensaje(e.target.value)}
          className="w-full mt-1 mb-4 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm font-mono resize-none h-24 focus:outline-none focus:border-blue-500"
          placeholder={tab === 'cifrar' ? 'Escribí tu mensaje...' : 'Pegá el texto cifrado...'} />

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-gray-500">Clave Vigenère</label>
            <input value={claveVig} onChange={e => setClaveVig(e.target.value)}
              className="w-full mt-1 bg-gray-950 border border-gray-700 rounded-lg p-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="ej: salta2025" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Clave AES</label>
            <input value={claveAes} onChange={e => setClaveAes(e.target.value)}
              className="w-full mt-1 bg-gray-950 border border-gray-700 rounded-lg p-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="ej: mi-clave-secreta" />
          </div>
        </div>

        <button onClick={tab === 'cifrar' ? handleCifrar : handleDescifrar}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg text-sm mb-4">
          {tab === 'cifrar' ? 'Cifrar' : 'Descifrar'}
        </button>

        {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

        {resultado && (
          <>
            <label className="text-xs text-gray-500">Resultado</label>
            <div className="mt-1 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm font-mono break-all text-green-400">
              {resultado}
            </div>
            <button onClick={copiar}
              className="w-full mt-2 border border-gray-700 text-gray-400 py-2 rounded-lg text-sm hover:bg-gray-800">
              Copiar resultado
            </button>
          </>
        )}
      </div>
    </main>
  );
}