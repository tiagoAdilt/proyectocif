'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

export default function Entrada() {
  const router = useRouter();
  const [error, setError] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let activo = true;

    async function abrir() {
      try {
        const { data, error: fallo } = await supabase.auth.getSession();
        if (!activo) return;
        if (fallo) { setError(true); return; }
        router.replace(data.session ? '/chat' : '/login');
      } catch {
        if (activo) setError(true);
      }
    }

    void abrir();
    return () => { activo = false; };
  }, [router, intento]);

  return (
    <main className="min-h-dvh bg-gray-950 text-gray-100 flex items-center justify-center p-6">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-semibold">Sistema de Cifrado</h1>
        {error ? <>
          <p role="alert" className="text-gray-400">No pudimos comprobar tu sesión. Volvé a intentarlo.</p>
          <button onClick={() => { setError(false); setIntento(value => value + 1); }}
            className="bg-blue-600 rounded-lg px-4 py-2">Reintentar</button>
          <a href="/login" className="block text-blue-400 underline">Ir al inicio de sesión</a>
        </> : <p role="status" className="text-gray-400">Abriendo tu cuenta…</p>}
      </div>
    </main>
  );
}
