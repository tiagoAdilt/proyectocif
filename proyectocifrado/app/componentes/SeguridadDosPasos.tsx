'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { nombreAutenticador } from './nombreAutenticador';

type Factor = { id: string; friendly_name?: string; status: string };
type Alta = { id: string; qr: string; secret: string };

export default function SeguridadDosPasos({ userId }: { userId: string }) {
  const [factores, setFactores] = useState<Factor[]>([]);
  const [alta, setAlta] = useState<Alta | null>(null), [codigo, setCodigo] = useState('');
  const [quitar, setQuitar] = useState<string | null>(null);
  const [factorPrueba, setFactorPrueba] = useState('');
  const [error, setError] = useState(''), [aviso, setAviso] = useState('');
  const [busy, setBusy] = useState(false), [listo, setListo] = useState(false), [entendido, setEntendido] = useState(false);
  const lock = useRef(false), alive = useRef(false);
  async function identidad() {
    const r = await supabase.auth.getUser();
    if (r.error || r.data.user?.id !== userId || !alive.current) throw new Error('La sesión cambió. Volvé a iniciar sesión.');
  }
  async function cargar() {
    await identidad();
    const r = await supabase.auth.mfa.listFactors();
    if (r.error) throw r.error;
    if (alive.current) { setFactores(r.data.all.filter(f => f.factor_type === 'totp')); setListo(true); }
  }
  async function ejecutar(accion: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setAviso('');
    try { await identidad(); await accion(); }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'No se pudo completar. Revisá la conexión e intentá otra vez.'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true;
    void cargar().catch(() => { if (alive.current) setError('No pudimos cargar tus autenticadores. Pulsá Actualizar.'); });
    return () => { alive.current = false; };
  }, [userId]);

  async function agregar() {
    // La activación se habilita solamente después de instalar la protección del servidor.
    const db = await supabase.rpc('p09_mfa_permitido');
    if (db.error || db.data !== true) throw new Error('Primero debe instalarse el paso 09 de seguridad en Supabase o verificarse el segundo factor.');
    const current = await supabase.auth.mfa.listFactors();
    if (current.error) throw current.error;
    if (current.data.totp.length >= 2) throw new Error('Ya tenés dos autenticadores. Eliminá uno antes de agregar otro.');
    if (current.data.all.some(f => f.factor_type === 'totp' && f.status === 'unverified')) throw new Error('Hay una configuración pendiente. Actualizá la lista y cancelala antes de comenzar otra.');
    const r = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'Mensajería cifrada', friendlyName: current.data.totp.length ? 'Autenticador de respaldo' : 'Autenticador principal' });
    if (r.error) throw r.error;
    if (r.data.type !== 'totp' || !alive.current) return;
    setAlta({ id: r.data.id, qr: r.data.totp.qr_code, secret: r.data.totp.secret }); setCodigo(''); setEntendido(false);
  }
  async function confirmarAlta() {
    if (!alta || !entendido || !/^\d{6}$/.test(codigo)) return;
    const r = await supabase.auth.mfa.challengeAndVerify({ factorId: alta.id, code: codigo });
    if (r.error) throw new Error('No se confirmó el código. Revisá que uses el autenticador recién agregado y el código actual.');
    if (!alive.current) return;
    setAlta(null); setCodigo(''); await cargar(); setAviso('Autenticador confirmado. Ya podés usarlo para verificar tu ingreso.');
  }
  async function eliminar(id: string, verificado: boolean) {
    if (verificado) {
      if (!/^\d{6}$/.test(codigo)) throw new Error('Ingresá el código actual de uno de tus autenticadores confirmados.');
      const proof = await supabase.auth.mfa.challengeAndVerify({ factorId: factorPrueba, code: codigo });
      if (proof.error) throw new Error('Código incorrecto o vencido. No se eliminó el autenticador.');
    }
    const r = await supabase.auth.mfa.unenroll({ factorId: id });
    if (r.error) throw r.error;
    if (!alive.current) return;
    setAlta(null); setQuitar(null); setCodigo('');
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) { window.location.replace('/login'); return; }
    await cargar(); setAviso('Autenticador eliminado.');
  }
  const activos = factores.filter(f => f.status === 'verified');
  const boton = 'min-h-11 rounded-lg border border-slate-600 px-4 py-2 text-sm disabled:opacity-50';
  return <section id="seguridad" aria-labelledby="dos-pasos-title" className="panel-cuenta mt-6 rounded-2xl border border-slate-800 bg-gray-900 p-6 sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="dos-pasos-title" className="text-lg font-semibold">Verificación en dos pasos (2FA)</h2><button disabled={busy || !!alta} onClick={() => void ejecutar(cargar)} className={boton}>Actualizar</button></div>
    <p className="mt-3 text-sm text-slate-300">Además de tu contraseña, un código temporal protege el ingreso a tu cuenta. No cambia las claves de tus conversaciones.</p>
    <p className="estado-seguridad mt-3" data-activo={activos.length > 0}>{!listo ? 'Comprobando…' : activos.length ? '✓ Protección activada' : alta ? 'Configuración en curso' : 'Sin activar'}</p>
    {aviso && <p role="status" className="mt-3 text-emerald-300">{aviso}</p>}
    {error && <p role="alert" className="mt-3 text-red-300">{error}</p>}
    {!alta && <>
      <ul className="mt-4 space-y-3">{factores.map(f => <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-950 p-3"><span className="break-words">{nombreAutenticador(f.friendly_name)} · {f.status === 'verified' ? 'Confirmado' : 'Pendiente'}</span><button disabled={busy || !!quitar} className={boton} onClick={() => { if (f.status === 'verified') { setQuitar(f.id); setFactorPrueba(f.id); setCodigo(''); } else void ejecutar(() => eliminar(f.id, false)); }}>{f.status === 'verified' ? 'Quitar autenticador' : 'Cancelar configuración'}</button></li>)}</ul>
      {!quitar && activos.length < 2 && <button disabled={busy || !listo} onClick={() => void ejecutar(agregar)} className={boton + ' mt-4 bg-blue-600'}>{activos.length ? 'Agregar autenticador de respaldo' : 'Activar 2FA'}</button>}
      {!quitar && activos.length === 1 && <p className="mt-2 text-sm leading-relaxed text-slate-300">Configurá otra aplicación autenticadora, preferentemente en otro dispositivo, por si perdés acceso a la principal.</p>}
    </>}
    {alta && <form className="mt-5 space-y-4" onSubmit={e => { e.preventDefault(); void ejecutar(confirmarAlta); }}>
      <p>En tu aplicación autenticadora, elegí agregar una cuenta y escaneá este QR.</p>
      {/* El SVG se muestra como imagen, nunca se inyecta como HTML. */}
      <img src={alta.qr.startsWith('data:image/') ? alta.qr : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(alta.qr)} alt="QR privado para vincular tu autenticador" className="h-52 w-52 max-w-full rounded bg-white p-2" />
      <details><summary className="cursor-pointer text-blue-300">Estoy usando el mismo celular / ingresar clave manualmente</summary><p className="mt-2 text-sm">Elegí clave de configuración en tu autenticador, tipo basado en tiempo (TOTP), y escribí esta clave. No la compartas.</p><code className="mt-2 block break-all select-all">{alta.secret}</code></details>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={entendido} onChange={e => setEntendido(e.target.checked)} className="mt-1" />Entiendo que debo conservar acceso al autenticador. Después agregaré uno de respaldo en otro dispositivo o guardaré una copia segura en mi autenticador.</label>
      <label className="block" htmlFor="mfa-setup-code">Código de seis dígitos</label><input id="mfa-setup-code" required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} disabled={busy} value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))} className="w-full rounded-lg bg-gray-950 border border-slate-600 p-3 text-lg" />
      <div className="flex flex-wrap gap-3"><button disabled={busy || !entendido || codigo.length !== 6} className={boton + ' bg-blue-600'}>Confirmar activación</button><button type="button" disabled={busy} className={boton} onClick={() => void ejecutar(() => eliminar(alta.id, false))}>Cancelar</button></div>
    </form>}
    {quitar && <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); void ejecutar(() => eliminar(quitar, true)); }}>
      <p>{activos.length === 1 ? 'Al quitar el último autenticador, la cuenta dejará de pedir el segundo factor.' : 'Este autenticador dejará de servir para ingresar.'} Confirmá con el código de un autenticador disponible.</p>
      <label className="block">Autenticador para confirmar<select value={factorPrueba} disabled={busy} onChange={e => { setFactorPrueba(e.target.value); setCodigo(''); }} className="mt-2 w-full rounded-lg border border-slate-600 bg-gray-950 p-3">{activos.map(f => <option key={f.id} value={f.id}>{nombreAutenticador(f.friendly_name)}</option>)}</select></label><label className="block" htmlFor="mfa-remove-code">Código de ese autenticador</label><input id="mfa-remove-code" required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={codigo} disabled={busy} onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))} className="w-full rounded-lg border border-slate-600 bg-gray-950 p-3 text-lg" />
      <div className="flex flex-wrap gap-3"><button disabled={busy || codigo.length !== 6} className={boton + ' text-red-300'}>Confirmar eliminación</button><button type="button" disabled={busy} onClick={() => { setQuitar(null); setCodigo(''); }} className={boton}>Cancelar</button></div>
    </form>}
    <p className="mt-5 rounded-xl border border-slate-700 bg-slate-950/30 p-4 text-sm leading-relaxed text-slate-300">Si configuraste un autenticador de respaldo, podés usarlo cuando pierdas acceso al principal. Si perdés acceso a ambos autenticadores, contactá al administrador para revisar las opciones de recuperación. El correo para restablecer la contraseña no elimina el 2FA.</p>
  </section>;
}
