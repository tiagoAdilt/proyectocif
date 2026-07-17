'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabase';

function evaluarContrasena(password: string) {
  let puntaje = 0;
  if (password.length >= 8) puntaje++;
  if (password.length >= 12) puntaje++;
  if (/[A-Z]/.test(password)) puntaje++;
  if (/[0-9]/.test(password)) puntaje++;
  if (/[^A-Za-z0-9]/.test(password)) puntaje++;

  if (puntaje <= 1) return { nivel: 'Muy debil', color: '#ef4444', ancho: '20%' };
  if (puntaje === 2) return { nivel: 'Debil', color: '#f97316', ancho: '40%' };
  if (puntaje === 3) return { nivel: 'Media', color: '#eab308', ancho: '60%' };
  if (puntaje === 4) return { nivel: 'Fuerte', color: '#3b82f6', ancho: '80%' };
  return { nivel: 'Muy fuerte', color: '#22c55e', ancho: '100%' };
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [esRegistro, setEsRegistro] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [cargando, setCargando] = useState(false);

  const fortaleza = password ? evaluarContrasena(password) : null;

  const handleSubmit = async () => {
    if (esRegistro && password.length < 8) {
      setMensaje('La contrasena debe tener al menos 8 caracteres.');
      return;
    }
    setCargando(true);
    setMensaje('');
    if (esRegistro) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setMensaje('Error: ' + error.message);
      else setMensaje('Registro exitoso. Ya podes iniciar sesion.');
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
          <button onClick={() => { setEsRegistro(false); setMensaje(''); }}
            className={`flex-1 py-2 rounded-lg text-sm ${!esRegistro ? 'bg-blue-600 text-white' : 'border border-gray-700 text-gray-400'}`}>
            Iniciar sesion
          </button>
          <button onClick={() => { setEsRegistro(true); setMensaje(''); }}
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
          className="w-full mt-1 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:border-blue-500" />

        {fortaleza && (
          <div className="mt-2 mb-4">
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div style={{ width: fortaleza.ancho, backgroundColor: fortaleza.color, height: '6px', borderRadius: '9999px', transition: 'all 0.3s' }}></div>
            </div>
            <p style={{ color: fortaleza.color }} className="text-xs mt-1">{fortaleza.nivel}</p>
            {password.length < 8 && <p className="text-xs text-gray-600 mt-1">Minimo 8 caracteres</p>}
          </div>
        )}

        {!fortaleza && <div className="mb-4" />}

        <button onClick={handleSubmit} disabled={cargando}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg text-sm disabled:opacity-50">
          {cargando ? 'Cargando...' : esRegistro ? 'Crear cuenta' : 'Ingresar'}
        </button>

        {mensaje && <p className="mt-4 text-sm text-center text-yellow-400">{mensaje}</p>}
      </div>
    </main>
  );
}