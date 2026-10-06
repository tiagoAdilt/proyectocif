'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { ConfigurarRetencion } from './PlazoGrupo';

type Contacto = { id: string; username: string };
type Miembro = { usuario_id: string; rol: string; usuario: { username: string } | null };
type Invitacion = { id: string; receptor_id: string; receptor: { username: string } | null };
type Props = {
  grupo: { id: string; nombre: string }; userId: string; contactos: Contacto[];
  onClose: () => void; onRename: (id: string, nombre: string) => void;
  onLeft: (id: string) => void; onPolicyChanged: () => void;
};

export default function InformacionGrupo({ grupo, userId, contactos, onClose, onRename, onLeft, onPolicyChanged }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false), locked = useRef(false);
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [invitaciones, setInvitaciones] = useState<Invitacion[]>([]);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [nombre, setNombre] = useState(grupo.nombre);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [aviso, setAviso] = useState('');
  const [confirmar, setConfirmar] = useState<{ id: string; nombre: string } | 'salir' | null>(null);
  const admin = miembros.some(m => m.usuario_id === userId && m.rol === 'admin');
  const disponible = contactos.filter(c => !miembros.some(m => m.usuario_id === c.id)
    && !invitaciones.some(i => i.receptor_id === c.id));

  async function verificarSesion() {
    const { data, error } = await supabase.auth.getUser();
    if (error || data.user?.id !== userId) throw new Error('Tu sesión cambió. Cerrá esta ventana e iniciá sesión nuevamente.');
  }

  async function cargar(isActive = () => mounted.current) {
    if (isActive()) { setLoading(true); setMiembros([]); setInvitaciones([]); setSeleccion([]); }
    try {
      await verificarSesion();
      const members = await supabase.from('grupo_miembros')
        .select('usuario_id, rol, usuario:usuarios(username)').eq('grupo_id', grupo.id);
      if (members.error) throw new Error('No se pudieron cargar los integrantes. Volvé a intentar.');
      const lista = (members.data || []) as unknown as Miembro[];
      if (!lista.some(m => m.usuario_id === userId)) throw new Error('Ya no pertenecés a este grupo o no está disponible.');
      let pendientes: Invitacion[] = [];
      if (lista.some(m => m.usuario_id === userId && m.rol === 'admin')) {
        const result = await supabase.from('invitaciones_grupo')
          .select('id, receptor_id, receptor:usuarios!invitaciones_grupo_receptor_id_fkey(username)')
          .eq('grupo_id', grupo.id).eq('estado', 'pendiente');
        if (result.error) throw new Error('No se pudieron cargar las invitaciones. Volvé a intentar.');
        pendientes = (result.data || []) as unknown as Invitacion[];
      }
      await verificarSesion();
      if (isActive()) { setMiembros(lista); setInvitaciones(pendientes); }
    } finally { if (isActive()) setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const element = dialog.current;
    element?.showModal();
    void cargar(() => active).catch(e => { if (active) setError(e.message); });
    return () => { active = false; mounted.current = false; element?.close(); };
    // Parent mounts a new dialog for each group and account.
  }, []);

  async function ejecutar(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setAviso('');
    try { await verificarSesion(); if (mounted.current) await action(); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'No se pudo completar la operación.'); }
    finally { locked.current = false; if (mounted.current) { setBusy(false); setConfirmar(null); } }
  }

  async function guardarNombre() {
    const value = nombre.trim();
    if (!value || value.length > 80) { setError('El nombre debe tener entre 1 y 80 caracteres.'); return; }
    await ejecutar(async () => {
      const result = await supabase.from('grupos').update({ nombre: value }).eq('id', grupo.id).select('id, nombre').maybeSingle();
      if (result.error || !result.data) throw new Error('No se pudo cambiar el nombre. Comprobá que sigas siendo administrador.');
      if (mounted.current) { onRename(grupo.id, result.data.nombre); setAviso('Nombre actualizado.'); }
    });
  }

  async function invitar() {
    const ids = seleccion.filter(id => disponible.some(c => c.id === id));
    if (!ids.length || ids.length > 50) { setError('Elegí entre 1 y 50 contactos.'); return; }
    await ejecutar(async () => {
      const { error } = await supabase.rpc('p04_invitar_grupo', { p_grupo: grupo.id, p_invitados: ids });
      if (error) throw new Error(error.message);
      if (!mounted.current) return;
      setSeleccion([]); setAviso('Invitaciones enviadas. Aparecerán en Solicitudes y deberán aceptarlas.');
      await cargar();
    });
  }

  async function confirmarAccion() {
    if (!confirmar) return;
    const action = confirmar;
    await ejecutar(async () => {
      const { error } = action === 'salir'
        ? await supabase.rpc('p04_salir_grupo', { p_grupo: grupo.id })
        : await supabase.rpc('p04_quitar_miembro', { p_grupo: grupo.id, p_usuario: action.id });
      if (error) throw new Error(error.message);
      if (!mounted.current) return;
      if (action === 'salir') { onLeft(grupo.id); return; }
      setAviso('Integrante eliminado del grupo.');
      await cargar();
    });
  }

  const button = 'rounded-lg border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed';
  return <dialog ref={dialog} aria-labelledby="grupo-info-title"
    onCancel={e => { e.preventDefault(); if (!locked.current) onClose(); }}
    className="m-auto w-[calc(100%_-_2rem)] max-w-xl max-h-[85dvh] overflow-y-auto rounded-2xl border border-slate-700 bg-gray-900 p-6 text-white shadow-xl backdrop:bg-black/70">
    <header className="flex items-start justify-between gap-4">
      <div><h2 id="grupo-info-title" className="text-xl font-semibold">Información del grupo</h2>
        <p className="mt-1 text-slate-300 break-words">{grupo.nombre}</p></div>
      <button autoFocus disabled={busy} onClick={onClose} className={button}>Cerrar</button>
    </header>
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-950 p-3 text-sm text-red-200">{error}</p>}
    {aviso && <p role="status" className="mt-4 rounded-lg bg-emerald-950 p-3 text-sm text-emerald-200">{aviso}</p>}
    <div className="my-5 flex items-center justify-between gap-3">
      <p className="text-sm text-slate-300">{loading ? 'Cargando información…' : `${miembros.length} integrantes${miembros.length ? ' · ' + (admin ? 'Sos administrador' : 'Sos miembro') : ''}`}</p>
      <button disabled={busy || loading} onClick={() => void ejecutar(() => cargar())} className={button}>Actualizar</button>
    </div>
    {!loading && miembros.length > 0 && <>
      <ConfigurarRetencion grupoId={grupo.id} admin={admin} userId={userId} onChanged={onPolicyChanged} />
      {admin && <form onSubmit={e => { e.preventDefault(); void guardarNombre(); }} className="border-t border-slate-700 py-5">
        <label htmlFor="grupo-info-nombre" className="block font-medium mb-2">Nombre del grupo</label>
        <div className="flex gap-2"><input id="grupo-info-nombre" value={nombre} maxLength={80} disabled={busy}
          onChange={e => setNombre(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-gray-950 p-3" />
          <button disabled={busy || nombre.trim() === grupo.nombre || !nombre.trim()} className={button}>Guardar</button></div>
      </form>}
      <section className="border-t border-slate-700 py-5" aria-label="Integrantes">
        <h3 className="font-medium mb-3">Integrantes</h3>
        <ul className="space-y-2">{miembros.map(m => <li key={m.usuario_id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-800 p-3">
          <div className="min-w-0"><p className="break-words">{m.usuario?.username || 'Usuario'}{m.usuario_id === userId ? ' (vos)' : ''}</p>
            <span className={m.rol === 'admin' ? 'text-xs text-blue-300' : 'text-xs text-slate-300'}>{m.rol === 'admin' ? 'Administrador' : 'Miembro'}</span></div>
          {admin && m.usuario_id !== userId && <button disabled={busy} className={button + ' text-red-300'}
            onClick={() => setConfirmar({ id: m.usuario_id, nombre: m.usuario?.username || 'este integrante' })}>Quitar</button>}
        </li>)}</ul>
      </section>
      {admin && <section className="border-t border-slate-700 py-5" aria-label="Invitaciones">
        <h3 className="font-medium">Invitar contactos</h3>
        <p className="mt-1 mb-3 text-sm text-slate-300">Se unirán cuando acepten la invitación en Solicitudes.</p>
        {!disponible.length ? <p className="text-sm text-slate-400">No hay contactos disponibles para invitar.</p> : <>
          <div className="max-h-44 overflow-y-auto space-y-2">{disponible.map(c => <label key={c.id} className="flex items-center gap-3 rounded-lg bg-slate-800 p-3">
            <input type="checkbox" disabled={busy} checked={seleccion.includes(c.id)} onChange={() => setSeleccion(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])} />{c.username}
          </label>)}</div>
          <button disabled={busy || !seleccion.length} onClick={() => void invitar()} className={button + ' mt-3 bg-blue-700'}>Enviar invitaciones ({seleccion.length})</button>
        </>}
        <h4 className="mt-5 mb-2 text-sm font-medium">Invitaciones pendientes</h4>
        {!invitaciones.length ? <p className="text-sm text-slate-400">No hay invitaciones pendientes.</p> : <ul className="space-y-2">{invitaciones.map(i => <li key={i.id} className="text-sm text-amber-200">{i.receptor?.username || 'Contacto'} · Esperando respuesta</li>)}</ul>}
      </section>}
      <section className="border-t border-slate-700 pt-5">
        <p className="text-sm text-slate-300 mb-3">Al salir, dejás de tener acceso al grupo desde la aplicación.</p>
        <button disabled={busy} onClick={() => setConfirmar('salir')} className={button + ' text-red-300'}>Salir del grupo</button>
      </section>
    </>}
    {confirmar && <section role="alert" className="sticky bottom-0 mt-5 rounded-xl border border-amber-700 bg-gray-950 p-4">
      <h3 className="font-semibold">{confirmar === 'salir' ? '¿Salir del grupo?' : `¿Quitar a ${confirmar.nombre}?`}</h3>
      <p className="mt-2 text-sm text-slate-300">{confirmar === 'salir'
        ? 'Si sos el último integrante, se eliminará el grupo y sus mensajes. Si sos el único administrador y quedan integrantes, otro asumirá ese rol.'
        : 'Ya no podrá consultar ni enviar mensajes en este grupo. Esto no borra lo que haya leído o descargado antes.'}</p>
      <div className="mt-4 flex gap-2"><button disabled={busy} onClick={() => void confirmarAccion()} className={button + ' text-red-300'}>{busy ? 'Procesando…' : 'Confirmar'}</button>
        <button disabled={busy} onClick={() => setConfirmar(null)} className={button}>Cancelar</button></div>
    </section>}
  </dialog>;
}
