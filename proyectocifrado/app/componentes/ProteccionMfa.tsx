'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import { nombreAutenticador } from './nombreAutenticador';
import MarcaSeguridad from './MarcaSeguridad';

type Factor = { id: string; friendly_name?: string };
export async function comprobarAccesoMfa() {
  const user = await supabase.auth.getUser();
  if (user.error || !user.data.user) throw new Error('Iniciá sesión nuevamente.');
  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) throw factors.error;
  const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level.error) throw level.error;
  return { userId: user.data.user.id, factores: factors.data.totp,
    requerido: (factors.data.all.some(f => f.status === 'verified') || level.data.nextLevel === 'aal2') && level.data.currentLevel !== 'aal2' };
}

export default function ProteccionMfa({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<'cargando' | 'permitido' | 'codigo' | 'error'>('cargando');
  const [factores, setFactores] = useState<Factor[]>([]);
  const [factor, setFactor] = useState(''), [codigo, setCodigo] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const actor = useRef<string | null>(null), revision = useRef(0), lock = useRef(false);

  useEffect(() => {
    let activo = true;
    async function revisar() {
      const version = ++revision.current;
      try {
        const result = await comprobarAccesoMfa();
        if (!activo || version !== revision.current) return;
        if (actor.current && actor.current !== result.userId) { window.location.replace('/login'); return; }
        actor.current = result.userId;
        setFactores(result.factores);
        setFactor(prev => result.factores.some(f => f.id === prev) ? prev : result.factores[0]?.id || '');
        setEstado(result.requerido ? 'codigo' : 'permitido');
        setError('');
      } catch {
        if (activo && version === revision.current) { setEstado('error'); setError('No pudimos comprobar tu sesión. Revisá la conexión y reintentá.'); }
      }
    }
    void revisar();
    let deferred: ReturnType<typeof setTimeout> | undefined;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!activo) return;
      revision.current++;
      if (event === 'SIGNED_OUT' || (actor.current && session?.user.id !== actor.current)) {
        setEstado('cargando'); setCodigo(''); setFactores([]); window.location.replace('/login'); return;
      }
      // No llamar a Auth dentro de su propio callback: se ejecuta fuera del bloqueo.
      clearTimeout(deferred);
      deferred = setTimeout(() => { if (activo) void revisar(); }, 0);
    });
    window.addEventListener('focus', revisar);
    const timer = setInterval(revisar, 30000);
    return () => { activo = false; revision.current++; clearTimeout(deferred); clearInterval(timer); window.removeEventListener('focus', revisar); data.subscription.unsubscribe(); };
  }, [retry]);

  async function verificar() {
    if (lock.current || !factor || !/^\d{6}$/.test(codigo)) return;
    lock.current = true; setBusy(true); setError('');
    const version = revision.current;
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({ factorId: factor, code: codigo });
      if (result.error) throw result.error;
      setCodigo(''); setRetry(v => v + 1);
    } catch { if (version === revision.current) setError('Código incorrecto o vencido. Usá el código actual del autenticador.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function salir() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setCodigo('');
    try { const r = await supabase.auth.signOut(); if (r.error) throw r.error; window.location.replace('/login'); }
    catch { setError('No se pudo cerrar sesión. Revisá tu conexión y volvé a intentar.'); }
    finally { lock.current = false; setBusy(false); }
  }

  if (estado === 'permitido') return children;
  return <main className="auth-shell min-h-dvh bg-gray-950 text-white flex items-center justify-center p-4">
    <section className="w-full max-w-md rounded-xl border border-slate-700 bg-gray-900 p-6">
      <MarcaSeguridad /><p className="etiqueta-acceso">Último paso para ingresar</p><h1 className="text-2xl font-semibold">Confirmá que sos vos</h1>
      {estado === 'cargando' ? <p role="status" className="mt-4">Comprobando sesión…</p> : <>
        {estado === 'codigo' && <form className="mt-4 space-y-4" onSubmit={e => { e.preventDefault(); void verificar(); }}>
          <p>Abrí tu autenticador e ingresá el código de seis números para continuar a tus conversaciones.</p>
          {factores.length === 1 ? <div className="factor-tarjeta"><span className="factor-punto" aria-hidden="true" />{nombreAutenticador(factores[0].friendly_name)}</div> : <label className="block">Elegí tu autenticador<select disabled={busy} value={factor} onChange={e => { setFactor(e.target.value); setCodigo(''); }} className="mt-2 w-full rounded-lg bg-gray-950 border border-slate-600 p-3">{factores.map((f, i) => <option key={f.id} value={f.id}>{nombreAutenticador(f.friendly_name, i)}</option>)}</select></label>}
          {!factores.length && <p>No hay un autenticador TOTP disponible. Consultá al administrador para revisar el método configurado.</p>}
          <label className="block" htmlFor="mfa-login-code">Código temporal</label>
          <input id="mfa-login-code" aria-describedby="codigo-ayuda" placeholder="000000" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required disabled={busy} value={codigo} onChange={e => { setCodigo(e.target.value.replace(/\D/g, '')); setError(''); }} className="codigo-temporal w-full rounded-lg border border-slate-600 bg-gray-950 p-3" />
          <p id="codigo-ayuda" className="ayuda-codigo">Podés escribir o pegar el código. Si cambió, usá el nuevo.</p>
          <button disabled={busy || !factor || codigo.length !== 6} className="w-full rounded-lg bg-blue-600 p-3 disabled:opacity-50">{busy ? 'Verificando…' : 'Verificar y entrar al chat'}</button>
          <details className="text-sm text-slate-300"><summary className="cursor-pointer">¿Necesitás ayuda para entrar?</summary><p className="mt-2">Elegí tu autenticador de respaldo en la lista. Si perdiste ambos, necesitás contactar al administrador y acreditar que la cuenta es tuya. Recuperar la contraseña por correo no desactiva esta protección.</p></details>
        </form>}
        {estado === 'error' && <button onClick={() => setRetry(v => v + 1)} className="mt-4 rounded-lg bg-blue-600 p-3">Reintentar</button>}
        {error && <p role="alert" className="mt-4 text-red-300">{error}</p>}
        <button disabled={busy} onClick={salir} className="mt-5 min-h-11 text-blue-300 underline">Volver al inicio de sesión</button>
      </>}
    </section>
  </main>;
}
