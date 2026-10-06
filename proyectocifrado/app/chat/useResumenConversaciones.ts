'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { leerArchivo } from '../../lib/media';

export type Resumen = {
  tipo: 'privado' | 'grupo'; destino_id: string; ultimo_id: string;
  ultima_fecha: string | null; ultimo_emisor: string; archivo: boolean; pendientes: number;
};
type Mensaje = { id: string; emisor_id: string; texto?: string; integro?: boolean | null; archivo_path?: string; destruir_en?: string | null };
type Activa = { tipo: 'privado' | 'grupo'; id: string; conversacionId?: string };

export function textoResumen(resumen: Resumen | undefined, mensaje?: Mensaje): string {
  if (!resumen) return '';
  if (mensaje && mensaje.id === resumen.ultimo_id && mensaje.integro !== false && typeof mensaje.texto === 'string') {
    const info = leerArchivo(mensaje.texto, mensaje.archivo_path);
    if (info) return info.mime.startsWith('image/') ? 'Imagen' : info.mime.startsWith('audio/') ? 'Audio' : 'Video';
    if (mensaje.archivo_path) return 'Archivo cifrado';
    return mensaje.texto.replace(/\s+/g, ' ').slice(0, 90) || 'Mensaje';
  }
  return resumen.archivo ? 'Archivo cifrado' : 'Mensaje cifrado';
}

export function idsLegibles(mensajes: Mensaje[], userId: string): string[] {
  return mensajes.filter(m => m.emisor_id !== userId && m.integro !== false && typeof m.texto === 'string'
    && (!m.destruir_en || Date.parse(m.destruir_en) > Date.now())).map(m => m.id);
}

export function useResumenConversaciones(userId: string | undefined, activa: Activa | null, mensajes: Mensaje[]) {
  const [resumenes, setResumenes] = useState<Resumen[]>([]);
  const [errorResumen, setErrorResumen] = useState('');
  const [errorLecturas, setErrorLecturas] = useState('');
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(v => v + 1), []);
  const [visible, setVisible] = useState(false);
  const leidos = useRef(new Set<string>());
  const actor = useRef(userId);
  const [cuentaResumen, setCuentaResumen] = useState(userId);
  if (cuentaResumen !== userId) {
    setCuentaResumen(userId); setResumenes([]); setErrorResumen(''); setErrorLecturas('');
  }
  useEffect(() => { actor.current = userId; leidos.current = new Set(); }, [userId]);

  useEffect(() => {
    const onVisible = () => { setVisible(document.visibilityState === 'visible' && document.hasFocus()); refresh(); };
    onVisible();
    const interval = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 10000);
    window.addEventListener('focus', onVisible); window.addEventListener('blur', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); window.removeEventListener('focus', onVisible); window.removeEventListener('blur', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    async function cargar() {
      try {
        const auth = await supabase.auth.getUser();
        if (!active || actor.current !== userId) return;
        if (auth.error || auth.data.user?.id !== userId) { setResumenes([]); throw new Error('La sesión cambió. Volvé a iniciar sesión.'); }
        const result = await supabase.rpc('p07_resumen_conversaciones');
        if (!active || actor.current !== userId) return;
        if (result.error) throw new Error(['PGRST202','42883'].includes(result.error.code)
          ? 'Para activar los contadores falta ejecutar el paso 7 en Supabase.'
          : 'No se pudieron actualizar los contadores. Reintentaremos en unos segundos.');
        const current = await supabase.auth.getUser();
        if (!active || actor.current !== userId) return;
        if (current.error || current.data.user?.id !== userId) { setResumenes([]); throw new Error('La sesión cambió. Volvé a iniciar sesión.'); }
        setResumenes((result.data || []) as Resumen[]); setErrorResumen('');
      } catch (e) { if (active) setErrorResumen(e instanceof Error ? e.message : 'No se pudo cargar la actividad.'); }
    }
    void cargar();
    return () => { active = false; };
  }, [userId, tick]);

  useEffect(() => {
    if (!userId || !activa || !visible) return;
    let active = true;
    const ids = [...new Set(idsLegibles(mensajes, userId))].filter(id => !leidos.current.has(activa.tipo + ':' + id));
    if (!ids.length) return;
    async function marcar() {
      try {
        const auth = await supabase.auth.getUser();
        if (!active || actor.current !== userId) return;
        if (auth.error || auth.data.user?.id !== userId) throw new Error('La sesión cambió. Volvé a iniciar sesión.');
        for (let offset = 0; offset < ids.length; offset += 250) {
          if (!active || actor.current !== userId || document.visibilityState !== 'visible' || !document.hasFocus()) return;
          const batch = ids.slice(offset, offset + 250);
          const result = activa!.tipo === 'grupo'
            ? await supabase.rpc('p07_marcar_grupo_leidos', { p_grupo: activa!.id, p_mensajes: batch })
            : await supabase.from('mensajes').update({ leido: true }).eq('conversacion_id', activa!.conversacionId!)
              .neq('emisor_id', userId!).in('id', batch).select('id');
          if (result.error) throw new Error('No se pudo guardar la lectura. El contador se actualizará cuando se reintente.');
          if (!active || actor.current !== userId) return;
          const confirmed = activa!.tipo === 'grupo' ? batch : (result.data || []).map((m: { id: string }) => m.id);
          if (confirmed.length !== batch.length) throw new Error('No se pudo confirmar la lectura de todos los mensajes. Se reintentará automáticamente.');
          confirmed.forEach((id: string) => leidos.current.add(activa!.tipo + ':' + id));
        }
        if (active) { setErrorLecturas(''); refresh(); }
      } catch (e) { if (active) setErrorLecturas(e instanceof Error ? e.message : 'No se pudo guardar la lectura.'); }
    }
    void marcar();
    return () => { active = false; };
    // Depend on identity fields rather than the newly constructed active object.
  }, [userId, activa?.id, activa?.tipo, activa?.conversacionId, mensajes, visible, tick, refresh]);

  const buscarResumen = (tipo: Resumen['tipo'], id: string) => resumenes.find(r => r.tipo === tipo && r.destino_id === id);
  const actividad = (tipo: Resumen['tipo'], id: string) => Date.parse(buscarResumen(tipo,id)?.ultima_fecha || '') || 0;
  const vistaPrevia = (tipo: Resumen['tipo'], id: string) => {
    const resumen = buscarResumen(tipo,id);
    const ultimo = activa?.tipo === tipo && activa.id === id ? mensajes.find(m => m.id === resumen?.ultimo_id) : undefined;
    return textoResumen(resumen, ultimo);
  };
  return { buscarResumen, actividad, vistaPrevia, error: errorResumen || errorLecturas, refresh };
}
