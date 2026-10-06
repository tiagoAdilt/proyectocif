'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
export function useDuracionPrivada(id?: string | null) {
 const [estado,setEstado]=useState<{id:string;valor:number;error:string}>({id:'',valor:86400,error:''});
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  if(!id)return;
  let active=true;
  async function cargar(){const r=await supabase.rpc('p10_retencion_privada',{p_conversacion:id});if(active)setEstado({id:id!,valor:r.error?86400:Number(r.data),error:r.error?'La duración configurable necesita activar el paso 10 en Supabase.':''});}
  void cargar();const timer=setInterval(()=>void cargar(),10000);
  return()=>{active=false;clearInterval(timer);};
 },[id]);
 async function guardar(valor:number){if(!id||busy)return;setBusy(true);try{const r=await supabase.rpc('p10_retencion_privada',{p_conversacion:id,p_segundos:valor});setEstado(prev=>r.error?{...prev,error:'No se pudo guardar la duración. Volvé a intentar.'}:{id,valor:Number(r.data),error:''});}finally{setBusy(false);}}
 return {valor:estado.id===id?estado.valor:86400,error:estado.id===id?estado.error:'',listo:estado.id===id&&!estado.error,busy,guardar};
}
