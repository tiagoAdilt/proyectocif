'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';

type Acceso = { id: string; fecha: string; accion: string; metodo: string | null; direccion_ip: string | null };
const acciones: Record<string, string> = {
  login: 'Inicio de sesión', logout: 'Cierre de sesión', user_signedup: 'Cuenta creada',
  user_updated_password: 'Contraseña actualizada', user_recovery_requested: 'Solicitud de recuperación',
  user_reauthenticate_requested: 'Confirmación de identidad solicitada', mfa_code_login: 'Acceso con segundo factor',
};

export default function HistorialAccesos({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Acceso[]>([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [limite, setLimite] = useState(5);
  const generation = useRef(0);
  const [consulta, setConsulta] = useState({ userId, reload });
  if (consulta.userId !== userId || consulta.reload !== reload) {
    setConsulta({ userId, reload }); setLimite(5); setLoading(true); setError(''); setRows([]);
  }
  useEffect(() => {
    const operation = ++generation.current;
    async function load() {
      try {
        const actor = await supabase.auth.getUser();
        if (actor.error || actor.data.user?.id !== userId) throw new Error('Tu sesión cambió. Volvé a iniciar sesión.');
        const result = await supabase.rpc('p06_mi_historial_accesos');
        if (operation !== generation.current) return;
        if (result.error) {
          if (result.error.code === 'PGRST202' || result.error.code === '42883') throw new Error('El historial todavía no está habilitado. Falta completar su configuración.');
          throw new Error('No pudimos cargar el historial. Revisá la conexión y volvé a intentar.');
        }
        const current = await supabase.auth.getUser();
        if (current.error || current.data.user?.id !== userId) throw new Error('Tu sesión cambió. Volvé a iniciar sesión.');
        if (operation === generation.current) setRows((result.data || []) as Acceso[]);
      } catch (e) { if (operation === generation.current) setError((e as Error).message); }
      finally { if (operation === generation.current) setLoading(false); }
    }
    void load();
    return () => { generation.current++; };
  }, [userId, reload]);

  const filtrados = rows;
  return <section id="actividad" aria-labelledby="history-title" className="panel-cuenta mt-8 rounded-2xl border border-slate-800 bg-gray-900 p-6 sm:p-8">
    <div className="flex flex-wrap gap-4 justify-between items-start">
      <div><h2 id="history-title" className="text-xl font-semibold">Historial de seguridad</h2>
        <p className="text-sm text-slate-300 mt-2">Acá podés ver cuándo ingresaste, cerraste sesión o cambiaste la seguridad de tu cuenta.</p></div>
      <button disabled={loading} onClick={() => setReload(v => v + 1)} className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-blue-200 hover:bg-slate-700 disabled:opacity-50">{loading ? 'Actualizando…' : 'Actualizar'}</button>
    </div>
    {loading ? <p role="status" className="mt-6 rounded-xl bg-slate-950/40 p-5 text-sm text-slate-300">Consultando actividad…</p> : error ? <p role="alert" className="historial-vacio text-amber-300">{error}</p> : filtrados.length === 0 ?
      <p className="historial-vacio">{rows.length ? 'No hay eventos de este tipo en el historial disponible.' : 'Todavía no hay actividad para mostrar. Los nuevos accesos aparecerán aquí.'}</p> : <>
      <ol className="mt-6 divide-y divide-slate-700">
        {filtrados.slice(0, limite).map(row => <li key={row.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{acciones[row.accion] || 'Actividad de la cuenta'}</p>

            {row.direccion_ip && <p className="mt-1 text-sm text-slate-300">IP: {row.direccion_ip}</p>}
          </div>
          <time dateTime={row.fecha} className="text-sm text-slate-300 sm:text-right">{new Date(row.fecha).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}</time>
        </li>)}
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-slate-300"><p role="status">Mostrando {Math.min(limite, filtrados.length)} de {filtrados.length} eventos</p>
        {limite < filtrados.length && <button className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-blue-200 hover:bg-slate-700 disabled:opacity-50" onClick={() => setLimite(n => n + 5)}>Ver más actividad ↓</button>}
        {limite > 5 && <button className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm text-blue-200 hover:bg-slate-700 disabled:opacity-50" onClick={() => setLimite(5)}>Ver menos</button>}
      </div></>}
    <p className="mt-6 text-sm leading-relaxed text-slate-300">Hasta 50 registros de los últimos 90 días. Pueden tardar en aparecer; este historial no es una lista de dispositivos conectados.</p>
    <p className="mt-4 text-sm text-slate-300">¿No reconocés una actividad? <a className="text-blue-300 underline underline-offset-4" href="#contrasena">Revisá tu contraseña</a>.</p>
  </section>;
}
