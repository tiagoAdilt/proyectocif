'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export const PLAZOS = [{ valor:3600, texto:'1 hora' },{ valor:86400, texto:'24 horas' },{ valor:604800, texto:'7 días' },{ valor:0, texto:'Sin vencimiento' }];
export const nombrePlazo = (valor: number | null) => PLAZOS.find(p => p.valor === (valor || 0))?.texto || 'Sin vencimiento';
export const vencido = (fecha?: string | null) => !!fecha && Date.parse(fecha) <= Date.now();
export const plazosPermitidos = (maximo: number | null) => PLAZOS.filter(p => p.valor > 0 && (!maximo || p.valor < maximo));

export function usePlazoGrupo(grupoId?: string) {
  const [maximo,setMaximo] = useState<number | null>(null);
  const [cargado,setCargado] = useState('');
  const [plazo,setPlazo] = useState('grupo');
  const [error,setError] = useState('');
  const [version,setVersion] = useState(0);
  const [grupoActual, setGrupoActual] = useState(grupoId);
  if (grupoActual !== grupoId) {
    setGrupoActual(grupoId); setPlazo('grupo'); setError(''); setCargado(''); setMaximo(null);
  }
  useEffect(() => {
    if (!grupoId) return;
    let active=true, pending=false;
    const cargar=async () => {
      if (pending || document.visibilityState==='hidden') return;
      pending=true;
      try {
        const result=await supabase.from('grupos').select('retencion_segundos').eq('id',grupoId).maybeSingle();
        if (!active) return;
        if (result.error || !result.data) throw new Error(result.error?.code==='42703' || result.error?.code==='PGRST204'
          ? 'Falta activar el paso 8 en Supabase para enviar mensajes de grupo.' : 'No se pudo consultar el plazo del grupo. Volvé a intentar.');
        const value=result.data.retencion_segundos as number | null;
        setMaximo(value); setCargado(grupoId); setError('');
        setPlazo(prev=>prev==='grupo' || plazosPermitidos(value).some(p=>String(p.valor)===prev) ? prev : 'grupo');
      } catch(e) { if(active) { setError(e instanceof Error ? e.message : 'No se pudo cargar el plazo.'); setCargado(''); } }
      finally { pending=false; }
    };
    void cargar(); const timer=setInterval(()=>void cargar(),10000);
    const volver=()=>void cargar(); window.addEventListener('focus',volver);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',volver);};
  },[grupoId,version]);
  return { maximo,plazo,setPlazo,error,listo:!!grupoId && cargado===grupoId && !error,
    segundos:plazo==='grupo' ? null : Number(plazo), actualizar:()=>setVersion(v=>v+1) };
}

export function ConfigurarRetencion({ grupoId,admin,userId,onChanged }: { grupoId:string;admin:boolean;userId:string;onChanged:()=>void }) {
  const plazo=usePlazoGrupo(grupoId);
  const [nuevo,setNuevo]=useState('0'),[busy,setBusy]=useState(false),[aviso,setAviso]=useState('');
  const [limiteActual, setLimiteActual] = useState(plazo.maximo);
  if (limiteActual !== plazo.maximo) {
    setLimiteActual(plazo.maximo); setNuevo(String(plazo.maximo || 0));
  }
  async function guardar() {
    if (busy) return;
    setBusy(true);setAviso('');
    try {
      const actor=await supabase.auth.getUser();
      if (actor.error || actor.data.user?.id!==userId) throw new Error('La sesión cambió. Volvé a iniciar sesión.');
      const result=await supabase.rpc('p08_configurar_retencion',{p_grupo:grupoId,p_segundos:Number(nuevo)});
      if(result.error)throw new Error(result.error.message);
      setAviso('Duración guardada. Se aplica a los próximos mensajes.'); plazo.actualizar();onChanged();
    }catch(e){setAviso(e instanceof Error ? e.message : 'No se pudo guardar.');}
    finally{setBusy(false);}
  }
  return <section className="border-t border-slate-700 py-5">
    <h3 className="font-medium">Duración de los mensajes</h3>
    <p className="my-2 text-sm text-slate-300">El tiempo empieza al enviar. Los mensajes anteriores conservan su duración.</p>
    {plazo.error ? <p role="alert" className="text-sm text-amber-300">{plazo.error}</p> : !plazo.listo ? <p className="text-sm">Consultando plazo…</p> : admin ? <div className="flex gap-2">
      <label className="flex-1 text-sm">Duración máxima del grupo
        <select value={nuevo} disabled={busy} onChange={e=>setNuevo(e.target.value)} className="mt-2 block w-full rounded-lg border border-slate-600 bg-gray-950 p-3">
          {PLAZOS.map(p=><option key={p.valor} value={p.valor}>{p.texto}</option>)}
        </select>
      </label>
      <button disabled={busy || Number(nuevo)===(plazo.maximo || 0)} onClick={()=>void guardar()} className="self-end rounded-lg border border-slate-600 px-4 py-3 text-sm disabled:opacity-50">{busy?'Guardando…':'Guardar'}</button>
    </div> : <p className="text-sm text-blue-200">Duración máxima del grupo: {nombrePlazo(plazo.maximo)}</p>}
    <p className="mt-3 text-xs text-slate-400">Esta duración se usa por defecto para los nuevos mensajes del grupo. Cada integrante puede elegir una menor para sus envíos. No se pueden borrar copias guardadas fuera de la aplicación.</p>
    {aviso && <p role="status" className="mt-3 text-sm text-blue-200">{aviso}</p>}
  </section>;
}
