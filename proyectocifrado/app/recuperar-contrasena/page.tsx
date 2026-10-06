'use client';
import MarcaSeguridad from '../componentes/MarcaSeguridad';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Recovery = { client: SupabaseClient; userId: string; email: string };
type Start = { client: SupabaseClient; recovery: Recovery | null; invalid: boolean };

// Cliente aislado: abrir un enlace no reemplaza la cuenta de otra pestaña.
async function abrirEnlace(): Promise<Start> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: false, flowType: 'implicit', storageKey: 'chat-password-recovery' },
  });
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  const hasLink = hash.has('access_token') || hash.has('error') || query.has('error') || query.has('code');
  const access = hash.get('access_token'), refresh = hash.get('refresh_token'), type = hash.get('type');
  // Retirar credenciales de la barra e historial antes de cualquier llamada de red.
  if (window.location.hash || window.location.search) window.history.replaceState(null, '', window.location.pathname);
  if (!hasLink) return { client, recovery: null, invalid: false };
  if (type !== 'recovery' || !access || !refresh || hash.has('error') || query.has('error')) return { client, recovery: null, invalid: true };
  try {
    const result = await client.auth.setSession({ access_token: access, refresh_token: refresh });
    if (result.error || !result.data.session) return { client, recovery: null, invalid: true };
    const verified = await client.auth.getUser();
    if (verified.error || !verified.data.user) return { client, recovery: null, invalid: true };
    return { client, invalid: false, recovery: { client, userId: verified.data.user.id, email: verified.data.user.email || '' } };
  } catch { return { client, recovery: null, invalid: true }; }
}

export default function RecuperarContrasena() {
  const [phase, setPhase] = useState<'loading' | 'request' | 'change' | 'done'>('loading');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [repeat, setRepeat] = useState('');
  const [visible, setVisible] = useState(false), [busy, setBusy] = useState(false), [wait, setWait] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [clienteListo, setClienteListo] = useState(false);
  const client = useRef<SupabaseClient | null>(null), recovery = useRef<Recovery | null>(null);
  const init = useRef<Promise<Start> | null>(null), lock = useRef(false), alive = useRef(false);

  useEffect(() => {
    let active = true; alive.current = true;
    // Strict Mode puede ejecutar el efecto dos veces; el enlace se consume una sola vez.
    init.current ??= abrirEnlace();
    void init.current.then(result => {
      if (!active) return;
      client.current = result.client; recovery.current = result.recovery;
      setClienteListo(true);
      if (result.invalid) setError('El enlace no es válido, ya se usó o venció. Solicitá uno nuevo.');
      if (result.recovery) setEmail(result.recovery.email);
      setPhase(result.recovery ? 'change' : 'request');
    }).catch(() => { if (active) { setError('No se pudo iniciar la recuperación. Recargá la página e intentá nuevamente.'); setPhase('request'); } });
    return () => { active = false; alive.current = false; };
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function enviarEnlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || wait > 0 || !client.current) return;
    const destination = email.trim();
    if (!destination || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) { setError('Ingresá un correo válido.'); return; }
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await client.current.auth.resetPasswordForEmail(destination, { redirectTo: window.location.origin + '/recuperar-contrasena' });
      if (!alive.current) return;
      if (result.error) {
        if (result.error.code === 'over_email_send_rate_limit' || result.error.code === 'over_request_rate_limit') {
          setError('Se alcanzó el límite de envíos. Esperá unos minutos antes de volver a intentar.'); setWait(60);
        } else setError('No se pudo enviar el enlace. Revisá tu conexión; si persiste, el administrador debe revisar la configuración de correo.');
        return;
      }
      setNotice('Si hay una cuenta asociada a ese correo, recibirás un enlace para elegir una contraseña nueva. Revisá también spam.');
      setWait(60);
    } catch { if (alive.current) setError('No se pudo enviar la solicitud. Revisá tu conexión e intentá nuevamente.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !recovery.current || phase !== 'change') return;
    if (password.length < 12) { setError('Usá al menos 12 caracteres. Podés elegir una frase larga.'); return; }
    if (password !== repeat) { setError('Las contraseñas no coinciden.'); return; }
    lock.current = true; setBusy(true); setError('');
    const access = recovery.current;
    try {
      const verified = await access.client.auth.getUser();
      if (verified.error || verified.data.user?.id !== access.userId) {
        recovery.current = null; setPassword(''); setRepeat(''); setPhase('request');
        setError('La sesión de recuperación venció. Solicitá otro enlace.'); return;
      }
      const result = await access.client.auth.updateUser({ password });
      if (!alive.current) return;
      if (result.error) {
        if (result.error.code === 'same_password') setError('Elegí una contraseña diferente de la anterior.');
        else if (result.error.code === 'weak_password') setError('La contraseña no cumple los requisitos del servicio. Elegí una frase más larga y difícil de adivinar.');
        else setError('No se pudo actualizar la contraseña. Intentá nuevamente o solicitá otro enlace.');
        return;
      }
      recovery.current = null; setPassword(''); setRepeat(''); setVisible(false); setPhase('done');
      // Cerrar únicamente la sesión creada por el enlace, no las demás sesiones.
      await access.client.auth.signOut({ scope: 'local' });
    } catch { if (alive.current && recovery.current) setError('No se pudo completar la solicitud. Revisá tu conexión.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  const input = 'w-full mt-2 rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60';
  return <main className="auth-shell min-h-dvh bg-gray-950 text-slate-100 flex items-center justify-center p-5">
    <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-gray-900 p-6 sm:p-8">
      <p className="text-xs uppercase tracking-widest text-blue-400 mb-3">Sistema de Cifrado</p>
      <MarcaSeguridad />
        <h1 className="text-2xl font-semibold">{phase === 'change' ? 'Elegí tu nueva contraseña' : phase === 'done' ? 'Contraseña actualizada' : 'Recuperar mi cuenta'}</h1>
      {phase === 'loading' && <p role="status" className="mt-5 text-sm text-slate-400">Comprobando el enlace…</p>}
      {phase === 'request' && <>
        <p className="mt-3 text-sm text-slate-400">Ingresá el correo con el que te registraste. Te enviaremos un enlace para elegir una contraseña nueva.</p>
        <form onSubmit={enviarEnlace} className="mt-6 space-y-5">
          <div><label htmlFor="email" className="text-sm">Correo electrónico</label><input id="email" type="email" autoComplete="email" required disabled={busy} value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" className={input} /></div>
          <button disabled={busy || wait > 0 || !clienteListo} className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 py-3 font-medium text-sm disabled:opacity-50">{busy ? 'Enviando…' : wait > 0 ? 'Podés reenviar en ' + wait + ' s' : 'Enviar enlace por correo'}</button>
        </form>
      </>}
      {phase === 'change' && <>
        <p className="mt-3 text-sm text-slate-400 break-all">Vas a actualizar el acceso de {email}. No necesitás la contraseña anterior.</p>
        <form onSubmit={guardar} className="mt-6 space-y-5">
          <div><label htmlFor="password" className="text-sm">Nueva contraseña</label><input id="password" type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={12} required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} className={input} /><p className="text-xs text-slate-400 mt-2">Al menos 12 caracteres.</p></div>
          <div><label htmlFor="repeat" className="text-sm">Repetir contraseña</label><input id="repeat" type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={12} required disabled={busy} value={repeat} onChange={e => setRepeat(e.target.value)} className={input} /></div>
          <label className="flex gap-2 items-center text-sm text-slate-300"><input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} />Mostrar contraseñas</label>
          <button disabled={busy} className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 py-3 font-medium text-sm disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar nueva contraseña'}</button>
          <button type="button" disabled={busy} className="text-sm text-blue-300 underline" onClick={() => { recovery.current = null; setPassword(''); setRepeat(''); setError(''); setPhase('request'); }}>Solicitar otro enlace</button>
        </form>
      </>}
      {phase === 'done' && <p role="status" className="mt-4 text-sm text-emerald-300">Ya podés iniciar sesión con tu nueva contraseña.</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-emerald-300">{notice}</p>}
      <p className="mt-6 text-xs text-slate-400 leading-relaxed">Recuperar tu cuenta no cambia ni recupera las claves compartidas de tus conversaciones.</p>
      <Link prefetch={false} href="/login" className="inline-block mt-6 text-sm text-blue-300 hover:underline">← Volver al inicio de sesión</Link>
    </section>
  </main>;
}
