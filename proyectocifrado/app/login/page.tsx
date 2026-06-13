'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [esRegistro, setEsRegistro] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [cargando, setCargando] = useState(false);

  const handleSubmit = async () => {
    setCargando(true);
    setMensaje('');
    if (esRegistro) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setMensaje('Error: ' + error.message);
      else setMensaje('Registro exitoso. Ya podés iniciar sesion.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMensaje('Error: ' + error.message);
      else window.location.href = '/chat';
    }
    setCargando(false);
  };

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-gray-900 rounded-xl border border-gray-800 p-8">
        <h1 className="text-2xl font-semibold mb-1 text-center">Sistema de Cifrado</h1>
        <p className="text-gray-500 text-sm mb-8 text-center">E.E.T. N°3139</p>
        <div className="flex gap-2 mb-6">
          <button onClick={() => setEsRegistro(false)}
            className={`flex-1 py-2 rounded-lg text-sm ${!esRegistro ? 'bg-blue-600 text-white' : 'border border-gray-700 text-gray-400'}`}>
            Iniciar sesion
          </button>
          <button onClick={() => setEsRegistro(true)}
            className={`flex-1 py-2 rounded-lg text-sm ${esRegistro ? 'bg-blue-600 text-white' : 'border border-gray-700 text-gray-400'}`}>
            Registrarse
          </button>
        </div>
        <label className="text-xs text-gray-500">Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)}
          type="email" placeholder="tu@email.com"
          className="w-full mt-1 mb-4 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:border-blue-500" />
        <label className="text-xs text-gray-500">Contrasena</label>
        <input value={password} onChange={e => setPassword(e.target.value)}
          type="password" placeholder="••••••••"
          className="w-full mt-1 mb-6 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:border-blue-500" />
        <button onClick={handleSubmit} disabled={cargando}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg text-sm disabled:opacity-50">
          {cargando ? 'Cargando...' : esRegistro ? 'Crear cuenta' : 'Ingresar'}
        </button>
        {mensaje && <p className="mt-4 text-sm text-center text-yellow-400">{mensaje}</p>}
      </div>
    </main>
  );
}