'use client';

import { useState, useEffect, useRef } from 'react';
import './movil.css';
import { supabase } from '../../lib/supabase';
import { cifrar, descifrar, esCifradoAutenticado, hashCifrado } from '../../lib/cifrado';
import DOMPurify from 'dompurify';
import { z } from 'zod';
import { AdjuntarMedia, MensajeMedia } from './Media';
import InformacionGrupo from './InformacionGrupo';
import { useResumenConversaciones } from './useResumenConversaciones';
import { useDuracionPrivada } from './DuracionPrivada';
import { PLAZOS, usePlazoGrupo, nombrePlazo, vencido } from './PlazoGrupo';
import { MEDIA_BUCKET, cifrarArchivo, describirArchivo, validarArchivo } from '../../lib/media';

const mensajeSchema = z.string().min(1, 'El mensaje no puede estar vacio').max(2000, 'El mensaje es demasiado largo');
const claveSchema = z.string().min(3, 'La clave debe tener al menos 3 caracteres');

function CheckStatus({ enviado, leido }: { enviado: boolean, leido: boolean }) {
  if (leido) return <span className="text-blue-400 text-xs">✓✓</span>;
  if (enviado) return <span className="text-gray-500 text-xs">✓✓</span>;
  return <span className="text-gray-600 text-xs">✓</span>;
}

function tiempoRelativo(fecha: string | null | undefined) {
  if (!fecha) return 'sin conexion registrada';
  const ahora = new Date();
  const d = new Date(fecha);
  const diffMs = ahora.getTime() - d.getTime();
  const seg = Math.floor(diffMs / 1000);
  if (seg < 60) return 'activo hace un momento';
  const min = Math.floor(seg / 60);
  if (min < 60) return `activo hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `activo hace ${horas} h`;

  const mismoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const ayer = new Date(ahora);
  ayer.setDate(ahora.getDate() - 1);
  if (mismoDia(d, ayer)) {
    const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    return `activo ayer a las ${hora}`;
  }

  const dias = Math.floor(horas / 24);
  if (dias < 7) return `activo hace ${dias} d`;

  const fechaStr = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return `activo el ${fechaStr}`;
}

type Vista = 'chats' | 'buscar' | 'solicitudes' | 'grupos';

export default function ChatPage() {
  const [usuario, setUsuario] = useState<any>(null);
  const sesionCerradaRef = useRef(false);
  const identidadSesionRef = useRef<string | null>(null);
  const [sesionBloqueada, setSesionBloqueada] = useState(false);
  const [errorCierre, setErrorCierre] = useState('');
  const cerrandoSesionRef = useRef(false);
  const [contactos, setContactos] = useState<any[]>([]);
  const [solicitudesPendientes, setSolicitudesPendientes] = useState<any[]>([]);
  const [invitacionesGrupo, setInvitacionesGrupo] = useState<any[]>([]);
  const [errorGrupos, setErrorGrupos] = useState('');
  const [avisoGrupos, setAvisoGrupos] = useState('');
  const [creandoGrupo, setCreandoGrupo] = useState(false);
  const creandoGrupoRef = useRef(false);
  const [respondiendoInvitacion, setRespondiendoInvitacion] = useState<string | null>(null);
  const respuestaInvitacionRef = useRef(false);
  const [contactoSeleccionado, setContactoSeleccionado] = useState<any>(null);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [mostrarClaves, setMostrarClaves] = useState(false);
  const [claveVig, setClaveVig] = useState('');
  const [claveAes, setClaveAes] = useState('');
  const [clavesConfiguradas, setClavesConfiguradas] = useState(false);
  const [conversacionId, setConversacionId] = useState<string | null>(null);
  const [errorMensaje, setErrorMensaje] = useState('');
  const [vista, setVista] = useState<Vista>('chats');
  const [busqueda, setBusqueda] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [miUsername, setMiUsername] = useState('');
  const [busquedaChats, setBusquedaChats] = useState('');
  const [busquedaGrupos, setBusquedaGrupos] = useState('');

  // --- Estado para "escribiendo..." ---
  const [otroEscribiendo, setOtroEscribiendo] = useState<string | null>(null);
  const canalActivoRef = useRef<any>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ultimoBroadcastRef = useRef<number>(0);
  const operacionChatRef = useRef(0);
  const configurandoRef = useRef<number | null>(null);
  const [configurando, setConfigurando] = useState(false);
  const cierreCanalRef = useRef<Promise<void>>(Promise.resolve());

  const cerrarCanalChat = () => {
    const anterior = canalActivoRef.current;
    canalActivoRef.current = null;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (anterior) {
      cierreCanalRef.current = cierreCanalRef.current.then(async () => {
        try {
          const estado = await supabase.removeChannel(anterior);
          if (estado !== 'ok') anterior.teardown();
        } catch {
          anterior.teardown();
        }
      });
    }
    return cierreCanalRef.current;
  };

  const invalidarChat = () => {
    operacionChatRef.current++;
    configurandoRef.current = null;
    setConfigurando(false);
    setMensaje('');
    void cerrarCanalChat();
  };

  useEffect(() => {
    return () => {
      operacionChatRef.current++;
      void cerrarCanalChat();
    };
  }, []);

  // --- Estado para gestion de grupos ---
  const [mostrarMiembros, setMostrarMiembros] = useState(false);

  // --- Estado para chat grupal ---
  const [grupos, setGrupos] = useState<any[]>([]);
  const [grupoSeleccionado, setGrupoSeleccionado] = useState<any>(null);
  const grupoActualRef = useRef<string | null>(null);
  useEffect(() => { grupoActualRef.current = grupoSeleccionado?.id || null; }, [grupoSeleccionado?.id]);
  const [mostrarCrearGrupo, setMostrarCrearGrupo] = useState(false);
  const [nombreNuevoGrupo, setNombreNuevoGrupo] = useState('');
  const [miembrosNuevoGrupo, setMiembrosNuevoGrupo] = useState<string[]>([]);

  const plazoGrupo = usePlazoGrupo(grupoSeleccionado?.id);
  const duracionPrivada = useDuracionPrivada(grupoSeleccionado ? null : conversacionId);
  useEffect(() => {
    const retirarVencidos = () => setMensajes(prev => {
      const vigentes=prev.filter(m=>!vencido(m.destruir_en));
      return vigentes.length===prev.length ? prev : vigentes;
    });
    const timer=setInterval(retirarVencidos,1000);
    window.addEventListener('focus',retirarVencidos);
    return()=>{clearInterval(timer);window.removeEventListener('focus',retirarVencidos);};
  },[]);
  const activaResumen = clavesConfiguradas
    ? grupoSeleccionado ? { tipo: 'grupo' as const, id: grupoSeleccionado.id }
      : contactoSeleccionado && conversacionId ? { tipo: 'privado' as const, id: contactoSeleccionado.id, conversacionId } : null
    : null;
  const resumen = useResumenConversaciones(usuario?.id, activaResumen, mensajes);
  const ultimoMensajeId = mensajes[mensajes.length - 1]?.id;
  useEffect(() => { resumen.refresh(); }, [ultimoMensajeId, resumen.refresh]);
  const filaResumen = (tipo: 'privado' | 'grupo', id: string) => {
    const item = resumen.buscarResumen(tipo, id);
    if (!item?.ultimo_id) return null;
    const pendientes = Number(item?.pendientes || 0);
    return <div className="mt-2 flex items-center gap-2 min-w-0">
      <p className="min-w-0 flex-1 truncate text-xs text-slate-300">{resumen.vistaPrevia(tipo,id)}</p>
      {item?.ultima_fecha && <time dateTime={item.ultima_fecha} className="shrink-0 text-xs text-slate-400">{new Date(item.ultima_fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} {new Date(item.ultima_fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</time>}
      {pendientes > 0 && <span aria-label={pendientes + ' mensajes sin leer'} className="shrink-0 min-w-6 rounded-full bg-blue-600 px-2 py-1 text-center text-xs font-semibold text-white">{pendientes > 99 ? '99+' : pendientes}</span>}
    </div>;
  };

  // --- Estado de presencia (en linea / ultima vez) ---
  const [usuariosOnline, setUsuariosOnline] = useState<Set<string>>(new Set());

  const marcoChatRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const ajustar = () => {
      if (!marcoChatRef.current) return;
      // El zoom del usuario conserva su comportamiento nativo.
      if (window.innerWidth < 768 && viewport && viewport.scale === 1) {
        marcoChatRef.current.style.height = viewport.height + 'px';
      } else marcoChatRef.current.style.removeProperty('height');
    };
    ajustar();
    viewport?.addEventListener('resize', ajustar);
    window.addEventListener('resize', ajustar);
    return () => { viewport?.removeEventListener('resize', ajustar); window.removeEventListener('resize', ajustar); };
  }, [usuario]);

  const volverALista = () => {
    invalidarChat();
    setContactoSeleccionado(null); setGrupoSeleccionado(null); setConversacionId(null);
    setMensajes([]); setClaveVig(''); setClaveAes(''); setClavesConfiguradas(false);
    setMostrarClaves(false); setMostrarMiembros(false); setOtroEscribiendo(null);
  };

  const mensajesRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimeout = () => {
    if (sesionCerradaRef.current) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      void cerrarSesion();
    }, 15 * 60 * 1000);
  };

  useEffect(() => {
    let montado = true;
    const { data: escucha } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (!montado || sesionCerradaRef.current) return;
      const id = sesion?.user.id;
      if (evento === 'SIGNED_OUT' || (evento === 'INITIAL_SESSION' && !id) ||
          (id && identidadSesionRef.current && id !== identidadSesionRef.current)) {
        bloquearSesion();
        window.location.replace('/login');
        return;
      }
      if (id) identidadSesionRef.current = id;
    });
    supabase.auth.getUser().then(({ data }) => {
      if (!montado || sesionCerradaRef.current) return;
      if (data.user && identidadSesionRef.current && data.user.id !== identidadSesionRef.current) {
        bloquearSesion(); window.location.replace('/login'); return;
      }
      if (!data.user) window.location.replace('/login');
      else {
        identidadSesionRef.current = data.user.id;
        setUsuario(data.user);
        cargarContactos(data.user.id);
        cargarSolicitudes(data.user.id);
        cargarGrupos(data.user.id);
        supabase.from('usuarios').select('username').eq('id', data.user.id).single()
          .then(({ data: u }) => { if (u) setMiUsername(u.username); });
      }
    });
    return () => { montado = false; escucha.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    resetTimeout();
    window.addEventListener('mousemove', resetTimeout);
    window.addEventListener('keydown', resetTimeout);
    window.addEventListener('pointerdown', resetTimeout);
    return () => {
      window.removeEventListener('mousemove', resetTimeout);
      window.removeEventListener('keydown', resetTimeout);
      window.removeEventListener('pointerdown', resetTimeout);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Heartbeat: actualiza mi ultima_conexion apenas entro y cada 30 segundos
  useEffect(() => {
    if (!usuario) return;
    const actualizarUltimaConexion = () => {
      supabase.from('usuarios').update({ ultima_conexion: new Date().toISOString() }).eq('id', usuario.id);
    };
    actualizarUltimaConexion();
    const interval = setInterval(actualizarUltimaConexion, 30000);
    return () => clearInterval(interval);
  }, [usuario]);

  // Presencia en tiempo real: quien esta conectado ahora mismo
  useEffect(() => {
    if (!usuario) return;
    const canal = supabase.channel('presencia-global', {
      config: { presence: { key: usuario.id } },
    });
    canal.on('presence', { event: 'sync' }, () => {
      const estado = canal.presenceState();
      setUsuariosOnline(new Set(Object.keys(estado)));
    });
    canal.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await canal.track({ conectado_en: new Date().toISOString() });
      }
    });
    return () => {
      supabase.removeChannel(canal);
    };
  }, [usuario]);

  useEffect(() => {
    if (mensajesRef.current) {
      mensajesRef.current.scrollTop = mensajesRef.current.scrollHeight;
    }
  }, [mensajes]);

  async function cargarContactos(miId: string) {
    const { data } = await supabase
      .from('solicitudes_contacto')
      .select(`
        id,
        emisor_id,
        receptor_id,
        emisor:usuarios!solicitudes_contacto_emisor_id_fkey(id, username, email, ultima_conexion),
        receptor:usuarios!solicitudes_contacto_receptor_id_fkey(id, username, email, ultima_conexion)
      `)
      .eq('estado', 'aceptado')
      .or(`emisor_id.eq.${miId},receptor_id.eq.${miId}`);

    if (data) {
      const lista = data.map(s => s.emisor_id === miId ? s.receptor : s.emisor);
      setContactos(lista);
    }
  };

  async function cargarSolicitudes(miId: string) {
    const { data } = await supabase
      .from('solicitudes_contacto')
      .select(`
        id,
        emisor:usuarios!solicitudes_contacto_emisor_id_fkey(id, username, email)
      `)
      .eq('receptor_id', miId)
      .eq('estado', 'pendiente');

    if (data) setSolicitudesPendientes(data);
  };

  const buscarUsuarios = async () => {
    if (!busqueda || !usuario) return;
    setBuscando(true);
    const { data } = await supabase
      .from('usuarios')
      .select('*')
      .ilike('email', `%${busqueda}%`)
      .neq('id', usuario.id)
      .limit(5);
    if (data) setResultadosBusqueda(data);
    setBuscando(false);
  };

  const enviarSolicitud = async (receptorId: string) => {
    if (!usuario) return;
    const { error } = await supabase
      .from('solicitudes_contacto')
      .insert({ emisor_id: usuario.id, receptor_id: receptorId });
    if (error) alert('Error: ' + error.message);
    else alert('Solicitud enviada.');
    setResultadosBusqueda([]);
    setBusqueda('');
  };

  const responderSolicitud = async (solicitudId: string, accion: 'aceptado' | 'rechazado') => {
    await supabase
      .from('solicitudes_contacto')
      .update({ estado: accion })
      .eq('id', solicitudId);
    if (usuario) {
      cargarSolicitudes(usuario.id);
      cargarContactos(usuario.id);
    }
  };

  const seleccionarContacto = (contacto: any) => {
    invalidarChat();
    setGrupoSeleccionado(null);
    setContactoSeleccionado(contacto);
    setClavesConfiguradas(false);
    setMensajes([]);
    setConversacionId(null);
    setClaveVig('');
    setClaveAes('');
    setErrorMensaje('');
    setOtroEscribiendo(null);
    setMostrarMiembros(false);
    setVista('chats');
  };

  // --- Grupos ---

  async function cargarInvitaciones(miId: string) {
    const { data, error } = await supabase.from('invitaciones_grupo')
      .select('id, grupo_id, emisor_id, estado, grupo:grupos(id, nombre), emisor:usuarios!invitaciones_grupo_emisor_id_fkey(username)')
      .eq('receptor_id', miId).eq('estado', 'pendiente').order('created_at');
    if (error) {
      setErrorGrupos(error.code === 'PGRST205' || error.code === '42P01'
        ? 'Las invitaciones todavía no están habilitadas. Completá la actualización de la base.'
        : 'No se pudieron cargar las invitaciones: ' + error.message);
      return;
    }
    setInvitacionesGrupo(data || []);
    setErrorGrupos('');
  };

  const responderInvitacionGrupo = async (invitacion: any, aceptar: boolean) => {
    if (!usuario || respuestaInvitacionRef.current) return;
    respuestaInvitacionRef.current = true;
    setRespondiendoInvitacion(invitacion.id);
    try {
      const { error } = await supabase.rpc('p04_responder_invitacion', {
        p_invitacion: invitacion.id, p_aceptar: aceptar,
      });
      if (error) { setErrorGrupos(error.message); return; }
      await Promise.all([cargarInvitaciones(usuario.id), cargarGrupos(usuario.id)]);
      if (aceptar) {
        setAvisoGrupos('Invitación aceptada. Elegí el grupo y acordá las claves con sus miembros.');
        setVista('grupos');
      } else setAvisoGrupos('Invitación rechazada.');
    } catch (error: any) { setErrorGrupos(error.message); }
    finally { respuestaInvitacionRef.current = false; setRespondiendoInvitacion(null); }
  };

  // Realtime acelera el aviso; el refresco recupera eventos perdidos y cambios de miembros.
  useEffect(() => {
    if (!usuario) return;
    let activo = true;
    let cargando = false;
    const refrescar = async () => {
      if (!activo || cargando || document.visibilityState === 'hidden') return;
      cargando = true;
      try {
        await Promise.all([cargarInvitaciones(usuario.id), cargarGrupos(usuario.id),
          cargarSolicitudes(usuario.id), cargarContactos(usuario.id)]);
      } catch { setErrorGrupos('No se pudo actualizar la lista. Reintentaremos en unos segundos.'); }
      finally { cargando = false; }
    };
    void refrescar();
    const intervalo = setInterval(() => void refrescar(), 10000);
    const alVolver = () => void refrescar();
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    const canal = supabase.channel('invitaciones-' + usuario.id + '-' + crypto.randomUUID())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invitaciones_grupo',
        filter: 'receptor_id=eq.' + usuario.id }, () => void refrescar())
      .subscribe(status => { if (status === 'SUBSCRIBED') void refrescar(); });
    return () => {
      activo = false;
      clearInterval(intervalo);
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
      void supabase.removeChannel(canal).then(status => { if (status !== 'ok') canal.teardown(); });
    };
  }, [usuario?.id]);

  useEffect(() => {
    if (!usuario) return;
    let activo = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!activo || data.user?.id !== usuario.id) return;
      if (vista === 'grupos') void cargarGrupos(usuario.id);
      if (vista === 'solicitudes') void cargarInvitaciones(usuario.id);
    });
    return () => { activo = false; };
  }, [vista, usuario?.id]);

  async function cargarGrupos(miId: string) {
    const { data } = await supabase
      .from('grupo_miembros')
      .select('grupo:grupos(id, nombre, creador_id)')
      .eq('usuario_id', miId);
    if (data) {
      const lista = [...new Map(data.map((g: any) => g.grupo).filter(Boolean).map((g: any) => [g.id, g])).values()];
      setGrupos(lista);
      const actual = grupoActualRef.current;
      const actualizado = lista.find((g: any) => g.id === actual);
      if (actualizado) setGrupoSeleccionado((prev: any) => prev?.id === actual && prev.nombre !== actualizado.nombre ? { ...prev, nombre: actualizado.nombre } : prev);
      if (actual && !lista.some((g: any) => g.id === actual)) {
        invalidarChat(); setGrupoSeleccionado(null); setClavesConfiguradas(false); setMensajes([]);
        setAvisoGrupos('Ya no pertenecés al grupo seleccionado.');
      }
    }
  };

  const toggleMiembroNuevoGrupo = (id: string) => {
    setMiembrosNuevoGrupo(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  const crearGrupo = async () => {
    if (!usuario || creandoGrupoRef.current) return;
    if (!nombreNuevoGrupo.trim()) { setErrorGrupos('Poné un nombre para el grupo.'); return; }
    if (miembrosNuevoGrupo.length === 0) { setErrorGrupos('Elegí al menos un contacto para invitar.'); return; }
    creandoGrupoRef.current = true;
    setCreandoGrupo(true); setErrorGrupos(''); setAvisoGrupos('');
    try {
      const { error } = await supabase.rpc('p04_crear_grupo', {
        p_nombre: nombreNuevoGrupo.trim(), p_invitados: miembrosNuevoGrupo,
      });
      if (error) { setErrorGrupos('No se pudo crear el grupo: ' + error.message); return; }
      setNombreNuevoGrupo(''); setMiembrosNuevoGrupo([]); setMostrarCrearGrupo(false);
      await cargarGrupos(usuario.id);
      setAvisoGrupos('Grupo creado. Tus contactos recibirán una invitación en Solicitudes.');
    } catch (error: any) { setErrorGrupos(error.message); }
    finally { creandoGrupoRef.current = false; setCreandoGrupo(false); }
  };

  const salirDeGrupo = async (grupo: any) => {
    if (!usuario) return;
    if (!confirm('¿Salir de "' + grupo.nombre + '"? Si sos el último miembro, se eliminará el grupo y sus mensajes.')) return;
    const { error } = await supabase.rpc('p04_salir_grupo', { p_grupo: grupo.id });
    if (error) { setErrorGrupos(error.message); return; }
    if (grupoSeleccionado?.id === grupo.id) {
      invalidarChat(); setGrupoSeleccionado(null); setClavesConfiguradas(false); setMensajes([]);
    }
    await cargarGrupos(usuario.id);
  };

  const abrirMiembros = () => setMostrarMiembros(true);


  const seleccionarGrupo = (grupo: any) => {
    invalidarChat();
    setConversacionId(null);
    setContactoSeleccionado(null);
    setGrupoSeleccionado(grupo);
    setClavesConfiguradas(false);
    setMensajes([]);
    setClaveVig('');
    setClaveAes('');
    setErrorMensaje('');
    setOtroEscribiendo(null);
    setMostrarMiembros(false);
    setVista('grupos');
  };

  const cambiarClaves = () => {
    invalidarChat();
    setMensaje(mensaje);
    setClavesConfiguradas(false);
    setMensajes([]);
    setClaveVig(''); setClaveAes(''); setMostrarClaves(false);
    setErrorMensaje(''); setOtroEscribiendo(null); setMostrarMiembros(false);
  };

  const configurarClavesGrupo = async () => {
    if (configurandoRef.current !== null || clavesConfiguradas) return;
    const vigResult = claveSchema.safeParse(claveVig);
    const aesResult = claveSchema.safeParse(claveAes);
    if (!vigResult.success) { alert('Clave Vigenere invalida: ' + vigResult.error.issues[0].message); return; }
    if (!aesResult.success) { alert('Clave AES invalida: ' + aesResult.error.issues[0].message); return; }
    if (!grupoSeleccionado) return;

    const operacion = ++operacionChatRef.current;
    configurandoRef.current = operacion;
    setConfigurando(true);
    try {
      await cargarMensajesGrupo(grupoSeleccionado.id, claveVig, claveAes, operacion);
      if (operacion !== operacionChatRef.current) return;
      await suscribirMensajesGrupo(grupoSeleccionado.id, claveVig, claveAes, operacion);
      if (operacion !== operacionChatRef.current) return;
      setClavesConfiguradas(true);
    } catch (error: any) {
      if (operacion === operacionChatRef.current) alert('No se pudo abrir el grupo: ' + error.message);
    } finally {
      if (configurandoRef.current === operacion) {
        configurandoRef.current = null;
        setConfigurando(false);
      }
    }
  };

  const cargarMensajesGrupo = async (grupoId: string, vig: string, aes: string, operacion: number) => {
    const { data, error } = await supabase
      .from('mensajes_grupo')
      .select('*, emisor:usuarios!mensajes_grupo_emisor_id_fkey(username)')
      .eq('grupo_id', grupoId)
      .order('created_at', { ascending: true });

    if (operacion !== operacionChatRef.current) return;
    if (error) throw error;
    if (data) {
      const descifrados = await Promise.all(data.map(async msg => {
        try {
          const texto = await descifrar(msg.contenido_cifrado, vig, aes);
          return { ...msg, texto, integro: esCifradoAutenticado(msg.contenido_cifrado) ? true : null };
        } catch {
          return { ...msg, texto: '[No se pudo verificar o descifrar: revisá las claves; el mensaje también podría estar alterado]', integro: false };
        }
      }));
      if (operacion !== operacionChatRef.current) return;
      setMensajes(descifrados);
    }
  };

  const suscribirMensajesGrupo = async (grupoId: string, vig: string, aes: string, operacion: number) => {
    await cerrarCanalChat();
    if (operacion !== operacionChatRef.current) return;
    // Supabase reutiliza los canales con el mismo topic; retirar restos antes de registrar eventos.
    for (const anterior of supabase.getChannels().filter(c => c.topic === 'realtime:grupo-' + grupoId)) {
      try {
        const estado = await supabase.removeChannel(anterior);
        if (estado !== 'ok') anterior.teardown();
      } catch {
        anterior.teardown();
      }
    }
    if (operacion !== operacionChatRef.current) return;
    const canal = supabase
      .channel('grupo-' + grupoId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes_grupo', filter: `grupo_id=eq.${grupoId}` },
        async (payload) => {
          if (operacion !== operacionChatRef.current || canalActivoRef.current !== canal) return;
          const msg = payload.new as any;
          try {
            const texto = await descifrar(msg.contenido_cifrado, vig, aes);
            if (operacion !== operacionChatRef.current || canalActivoRef.current !== canal) return;
            setMensajes(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, { ...msg, texto, integro: esCifradoAutenticado(msg.contenido_cifrado) ? true : null }]);
          } catch {
            if (operacion !== operacionChatRef.current || canalActivoRef.current !== canal) return;
            setMensajes(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, { ...msg, texto: '[No se pudo verificar o descifrar: revisá las claves; el mensaje también podría estar alterado]', integro: false }]);
          }
        })
      .on('broadcast', { event: 'escribiendo' }, (payload) => {
          if (operacion !== operacionChatRef.current || canalActivoRef.current !== canal) return;
        if (payload.payload?.usuario_id === usuario?.id) return;
        setOtroEscribiendo(payload.payload?.username || 'Alguien');
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setOtroEscribiendo(null), 3000);
      })
      .subscribe();
    canalActivoRef.current = canal;
  };

  const enviarArchivo = async (file: File) => {
    setErrorMensaje('');
    const mime = validarArchivo(file);
    const operation = operacionChatRef.current;
    const isGroup = !!grupoSeleccionado;
    if(isGroup && !plazoGrupo.listo) throw new Error('Esperá a que se cargue el plazo del grupo.');
    const plazoAdjunto=plazoGrupo.segundos;
    const target = isGroup ? grupoSeleccionado.id : conversacionId;
    if (!usuario || !target || !clavesConfiguradas) throw new Error('Abrí el chat y configurá las claves primero.');
    const { data: session, error: authError } = await supabase.auth.getUser();
    if (authError || session.user?.id !== usuario.id) throw new Error('La sesión cambió. Recargá la página e iniciá sesión en la cuenta correcta.');
    const path = (isGroup ? 'grupo/' : 'privado/') + target + '/' + usuario.id + '/' + crypto.randomUUID() + '.bin';
    const cipher = await cifrarArchivo(file, claveVig, claveAes, path);
    if (operation !== operacionChatRef.current) throw new Error('Cambiaste de chat. El adjunto no se envió.');
    const { error: uploadError } = await supabase.storage.from(MEDIA_BUCKET).upload(path, cipher, { contentType: 'application/octet-stream', upsert: false });
    if (uploadError) throw new Error('No se pudo subir el adjunto: ' + uploadError.message);
    try {
      if (operation !== operacionChatRef.current) throw new Error('Cambiaste de chat. El adjunto no se envió.');
      const description = describirArchivo({ version: 1, path, name: file.name.slice(0, 200), mime, size: file.size });
      const contenido_cifrado = await cifrar(description, claveVig, claveAes);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contenido_cifrado))))
        .map(value => value.toString(16).padStart(2, '0')).join('');
      if (operation !== operacionChatRef.current) throw new Error('Cambiaste de chat. El adjunto no se envió.');
      const { data, error } = await supabase.from(isGroup ? 'mensajes_grupo' : 'mensajes').insert({
        ...(isGroup ? { grupo_id: target, plazo_segundos: plazoAdjunto } : { conversacion_id: target }),
        emisor_id: usuario.id, contenido_cifrado, hash, archivo_path: path,
      }).select().single();
      if (error) throw new Error('No se pudo enviar el adjunto: ' + error.message);
      if (data && operation === operacionChatRef.current) setMensajes(prev => prev.some(m => m.id === data.id) ? prev : [...prev, { ...data, texto: description, integro: true }]);
    } catch (error) {
      // Storage permite borrar solo objetos sin mensaje: una respuesta perdida
      // despues de un INSERT exitoso nunca elimina el adjunto ya enviado.
      await supabase.storage.from(MEDIA_BUCKET).remove([path]).catch(() => {});
      throw error;
    }
  };

  const enviarMensajeGrupo = async () => {
    if (!clavesConfiguradas || !grupoSeleccionado || !usuario) return;
    if (!plazoGrupo.listo) { setErrorMensaje('Esperá a que se cargue el plazo del grupo.'); return; }
    if (!mensaje.trim()) { setErrorMensaje(''); return; }
    const resultado = mensajeSchema.safeParse(mensaje);
    if (!resultado.success) { setErrorMensaje(resultado.error.issues[0].message); return; }
    const operation = operacionChatRef.current;
    setErrorMensaje('');
    try {
      const mensajeLimpio = DOMPurify.sanitize(mensaje).trim();
      if (!mensajeLimpio) return;
      const contenidoCifrado = await cifrar(mensajeLimpio, claveVig, claveAes);
      const hash = await hashCifrado(contenidoCifrado);
      if (operation !== operacionChatRef.current) return;
      const { error } = await supabase.from('mensajes_grupo').insert({
        grupo_id: grupoSeleccionado.id,
        plazo_segundos: plazoGrupo.segundos,
        emisor_id: usuario.id,
        contenido_cifrado: contenidoCifrado,
        hash,
      });
      if (error) { setErrorMensaje('No se pudo enviar: ' + error.message); return; }
      if (operation === operacionChatRef.current) setMensaje(prev => prev === mensaje ? '' : prev);
    } catch (e: any) {
      alert('Error al cifrar: ' + e.message);
    }
  };

  const configurarClaves = async () => {
    if (configurandoRef.current !== null || clavesConfiguradas) return;
    const vigResult = claveSchema.safeParse(claveVig);
    const aesResult = claveSchema.safeParse(claveAes);
    if (!vigResult.success) { alert('Clave Vigenere invalida: ' + vigResult.error.issues[0].message); return; }
    if (!aesResult.success) { alert('Clave AES invalida: ' + aesResult.error.issues[0].message); return; }
    if (!usuario || !contactoSeleccionado) return;

    const operacion = ++operacionChatRef.current;
    configurandoRef.current = operacion;
    setConfigurando(true);
    try {
    const { data: existente, error: errorBusqueda } = await supabase
      .from('conversaciones')
      .select('*')
      .or(`and(usuario_a.eq.${usuario.id},usuario_b.eq.${contactoSeleccionado.id}),and(usuario_a.eq.${contactoSeleccionado.id},usuario_b.eq.${usuario.id})`)
      .maybeSingle();
    if (operacion !== operacionChatRef.current) return;
    if (errorBusqueda) throw new Error(errorBusqueda.code === 'PGRST116'
      ? 'Hay conversaciones duplicadas con este contacto. Debemos unificar sus historiales antes de continuar.'
      : errorBusqueda.message);

    let convId = existente?.id;
    if (!convId) {
      const { data, error } = await supabase
        .from('conversaciones')
        .insert({ usuario_a: usuario.id, usuario_b: contactoSeleccionado.id })
        .select()
        .single();
      if (operacion !== operacionChatRef.current) return;
      if (error) throw error;
      convId = data.id;
    }

    await cargarMensajes(convId, claveVig, claveAes, operacion);
    if (operacion !== operacionChatRef.current) return;
    await suscribirMensajes(convId, claveVig, claveAes, operacion);
    if (operacion !== operacionChatRef.current) return;
    setConversacionId(convId);
    setClavesConfiguradas(true);
    } catch (error: any) {
      if (operacion === operacionChatRef.current) alert('No se pudo abrir el chat: ' + error.message);
    } finally {
      if (configurandoRef.current === operacion) {
        configurandoRef.current = null;
        setConfigurando(false);
      }
    }
  };

  const cargarMensajes = async (convId: string, vig: string, aes: string, operacion: number) => {
    const { data, error } = await supabase
      .from('mensajes')
      .select('*')
      .eq('conversacion_id', convId)
      .order('created_at', { ascending: true });

    if (operacion !== operacionChatRef.current) return;
    if (error) throw error;
    if (data) {
      const descifrados = await Promise.all(data.map(async msg => {
        try {
          const texto = await descifrar(msg.contenido_cifrado, vig, aes);
          return { ...msg, texto, integro: esCifradoAutenticado(msg.contenido_cifrado) ? true : null };
        } catch {
          return { ...msg, texto: '[No se pudo verificar o descifrar: revisá las claves; el mensaje también podría estar alterado]', integro: false };
        }
      }));
      if (operacion !== operacionChatRef.current) return;
      setMensajes(descifrados);
    }
  };

  const suscribirMensajes = async (convId: string, vig: string, aes: string, operacion: number) => {
    await cerrarCanalChat();
    if (operacion !== operacionChatRef.current) return;
    // Supabase reutiliza los canales con el mismo topic; retirar restos antes de registrar eventos.
    for (const anterior of supabase.getChannels().filter(c => c.topic === 'realtime:mensajes-' + convId)) {
      try {
        const estado = await supabase.removeChannel(anterior);
        if (estado !== 'ok') anterior.teardown();
      } catch {
        anterior.teardown();
      }
    }
    if (operacion !== operacionChatRef.current) return;
    const canal = supabase
      .channel('mensajes-' + convId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes', filter: `conversacion_id=eq.${convId}` },
        async (payload) => {
          if (operacion !== operacionChatRef.current || canalActivoRef.current !== canal) return;
          const msg = payload.new as any;
          try {
            const texto = await descifrar(msg.contenido_cifrado, vig, aes);
            if (operacion !== operacionChatRef.current || canalActivoRef.current !== canal) return;
            setMensajes(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, { ...msg, texto, integro: esCifradoAutenticado(msg.contenido_cifrado) ? true : null }]);
          } catch {
            if (operacion !== operacionChatRef.current || canalActivoRef.current !== canal) return;
            setMensajes(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, { ...msg, texto: '[No se pudo verificar o descifrar: revisá las claves; el mensaje también podría estar alterado]', integro: false }]);
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mensajes', filter: `conversacion_id=eq.${convId}` },
        (payload) => {
          if (operacion !== operacionChatRef.current || canalActivoRef.current !== canal) return;
          const msgActualizado = payload.new as any;
          setMensajes(prev => prev.map(m => m.id === msgActualizado.id ? { ...m, leido: msgActualizado.leido } : m));
        })
      .on('broadcast', { event: 'escribiendo' }, (payload) => {
          if (operacion !== operacionChatRef.current || canalActivoRef.current !== canal) return;
        if (payload.payload?.usuario_id === usuario?.id) return;
        setOtroEscribiendo(payload.payload?.username || 'Alguien');
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setOtroEscribiendo(null), 3000);
      })
      .subscribe();
    canalActivoRef.current = canal;
  };

  const notificarEscribiendo = () => {
    if (!canalActivoRef.current || !usuario) return;
    const ahora = Date.now();
    if (ahora - ultimoBroadcastRef.current < 1500) return;
    ultimoBroadcastRef.current = ahora;
    canalActivoRef.current.send({
      type: 'broadcast',
      event: 'escribiendo',
      payload: { usuario_id: usuario.id, username: miUsername || 'Alguien' },
    });
  };

  const enviarMensaje = async () => {
    if (!clavesConfiguradas || !conversacionId || !usuario) return;
    if (!mensaje.trim()) { setErrorMensaje(''); return; }
    const resultado = mensajeSchema.safeParse(mensaje);
    if (!resultado.success) { setErrorMensaje(resultado.error.issues[0].message); return; }
    const operation = operacionChatRef.current;
    setErrorMensaje('');
    try {
      const mensajeLimpio = DOMPurify.sanitize(mensaje).trim();
      if (!mensajeLimpio) return;
      const contenidoCifrado = await cifrar(mensajeLimpio, claveVig, claveAes);
      const hash = await hashCifrado(contenidoCifrado);
      if (operation !== operacionChatRef.current) return;
      const { error } = await supabase.from('mensajes').insert({
        conversacion_id: conversacionId,
        emisor_id: usuario.id,
        contenido_cifrado: contenidoCifrado,
        hash,
        leido: false,
      });
      if (error) { setErrorMensaje('No se pudo enviar: ' + error.message); return; }
      if (operation === operacionChatRef.current) setMensaje(prev => prev === mensaje ? '' : prev);
    } catch (e: any) {
      alert('Error al cifrar: ' + e.message);
    }
  };

  function bloquearSesion() {
    sesionCerradaRef.current = true;
    invalidarChat();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setSesionBloqueada(true);
    setUsuario(null);
    setClaveVig(''); setClaveAes(''); setClavesConfiguradas(false);
    setMensajes([]); setMensaje(''); setMostrarClaves(false);
    setContactoSeleccionado(null); setGrupoSeleccionado(null); setConversacionId(null);
    setContactos([]); setGrupos([]); setSolicitudesPendientes([]); setInvitacionesGrupo([]);
    setResultadosBusqueda([]); setOtroEscribiendo(null); setMostrarMiembros(false);
  };

  async function cerrarSesion() {
    if (cerrandoSesionRef.current) return;
    cerrandoSesionRef.current = true;
    bloquearSesion();
    setErrorCierre('');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.location.replace('/login');
    } catch {
      setErrorCierre('El chat está bloqueado, pero no se pudo cerrar la sesión. Revisá tu conexión y reintentá.');
    } finally { cerrandoSesionRef.current = false; }
  };

  if (sesionBloqueada) return <main className="min-h-dvh bg-gray-950 text-gray-100 flex items-center justify-center p-6">
    <section className="max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6" aria-live="polite">
      <h1 className="text-xl font-semibold">Chat bloqueado</h1>
      <p className="mt-3">Los mensajes y las claves de esta conversación ya no se muestran.</p>
      {errorCierre ? <><p className="mt-3 text-red-300">{errorCierre}</p><button onClick={cerrarSesion} className="mt-4 rounded-lg bg-blue-600 px-4 py-3">Reintentar cierre de sesión</button></> : <p className="mt-3">Cerrando sesión…</p>}
    </section>
  </main>;

  if (!usuario) return null;

  return (
    <main ref={marcoChatRef} data-conversacion={!!(contactoSeleccionado || grupoSeleccionado)} className="chat-adaptable h-dvh min-h-0 overflow-hidden bg-gray-950 text-gray-100 flex flex-col">
      <header className="chat-cabecera shrink-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Sistema de Cifrado</h1>
          <p className="text-xs text-gray-500">{usuario.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/cuenta" className="text-sm text-blue-200 hover:text-white bg-blue-500/10 border border-blue-500/30 px-4 py-2 rounded-lg">Mi cuenta</a>
        <button onClick={cerrarSesion}
          className="text-sm text-gray-400 hover:text-white border border-gray-700 px-4 py-2 rounded-lg">
          Cerrar sesión
        </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="chat-lista w-80 lg:w-96 shrink-0 min-h-0 overflow-hidden bg-gray-900 border-r border-gray-800 flex flex-col">
          <div className="flex shrink-0 gap-1 px-2 pt-2 border-b border-gray-700">

            <button onClick={() => setVista('buscar')}
              className={`flex-1 min-h-14 px-1 py-4 text-sm font-semibold rounded-t-lg transition-colors focus-visible:outline-2 focus-visible:outline-blue-300 ${vista === 'buscar' ? 'bg-blue-500/15 text-blue-200 border-b-2 border-blue-400' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              Agregar
            </button>
            <button onClick={() => setVista('solicitudes')}
              className={`flex-1 min-h-14 px-1 py-4 text-sm font-semibold rounded-t-lg transition-colors focus-visible:outline-2 focus-visible:outline-blue-300 relative ${vista === 'solicitudes' ? 'bg-blue-500/15 text-blue-200 border-b-2 border-blue-400' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              Solicitudes
              {solicitudesPendientes.length + invitacionesGrupo.length > 0 && (
                <span className="absolute top-0 right-0 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {solicitudesPendientes.length + invitacionesGrupo.length}
                </span>
              )}
            </button>
            <button onClick={() => { if (grupoSeleccionado) { invalidarChat(); setGrupoSeleccionado(null); setClavesConfiguradas(false); setMensajes([]); } setVista('chats'); }}
              className={`flex-1 min-h-14 px-1 py-4 text-sm font-semibold rounded-t-lg transition-colors focus-visible:outline-2 focus-visible:outline-blue-300 ${vista === 'chats' ? 'bg-blue-500/15 text-blue-200 border-b-2 border-blue-400' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              Chats
            </button>
            <button onClick={() => { if (contactoSeleccionado) { invalidarChat(); setContactoSeleccionado(null); setConversacionId(null); setClavesConfiguradas(false); setMensajes([]); } setVista('grupos'); }}
              className={`flex-1 min-h-14 px-1 py-4 text-sm font-semibold rounded-t-lg transition-colors focus-visible:outline-2 focus-visible:outline-blue-300 ${vista === 'grupos' ? 'bg-blue-500/15 text-blue-200 border-b-2 border-blue-400' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              Grupos
            </button>
          </div>

          {resumen.error && <p role="status" className="p-3 text-xs text-amber-300">{resumen.error}</p>}
          {errorGrupos && <p role="alert" className="p-3 text-xs text-red-400">{errorGrupos}</p>}
          {avisoGrupos && <p role="status" className="p-3 text-xs text-green-400">{avisoGrupos}</p>}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {vista === 'chats' && (
              <div className="flex flex-col h-full">
                <div className="p-3 border-b border-gray-800">
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10.5A6.5 6.5 0 114 10.5a6.5 6.5 0 0113 0z" />
                    </svg>
                    <input type="search" name="buscar-conversaciones" aria-label="Buscar chat" autoComplete="off" autoCapitalize="none" spellCheck={false} data-lpignore="true" data-1p-ignore="true" value={busquedaChats} onChange={e => setBusquedaChats(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                      placeholder="Buscar chat" />
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                  {contactos.length === 0 && (
                    <p className="text-xs text-gray-600 p-4">Todavía no tenés contactos. Usá Agregar para buscar usuarios.</p>
                  )}

                  {[...contactos].sort((a,b) => resumen.actividad('privado',b.id) - resumen.actividad('privado',a.id))
                    .filter(c => c.username?.toLowerCase().includes(busquedaChats.toLowerCase()))
                    .map(c => (
                      <button key={c.id} onClick={() => seleccionarContacto(c)}
                        className={`w-full text-left px-4 py-3 hover:bg-gray-800 border-b border-gray-800 ${contactoSeleccionado?.id === c.id ? 'bg-gray-800' : ''}`}>
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${usuariosOnline.has(c.id) ? 'bg-green-500' : 'bg-gray-600'}`}></span>
                          <p className="text-sm font-medium">{c.username}</p>
                        </div>
                        <p className="text-xs text-gray-500 ml-4">
                          {usuariosOnline.has(c.id) ? 'En linea' : tiempoRelativo(c.ultima_conexion)}
                        </p>
                        {filaResumen('privado', c.id)}
                      </button>
                    ))}
                </div>
              </div>
            )}

            {vista === 'grupos' && (
              <div className="flex flex-col h-full">
                <div className="p-3 border-b border-gray-800">
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10.5A6.5 6.5 0 114 10.5a6.5 6.5 0 0113 0z" />
                    </svg>
                    <input type="search" name="buscar-grupos" aria-label="Buscar grupo" autoComplete="off" autoCapitalize="none" spellCheck={false} data-lpignore="true" data-1p-ignore="true" value={busquedaGrupos} onChange={e => setBusquedaGrupos(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                      placeholder="Buscar grupo" />
                  </div>
                  {!mostrarCrearGrupo ? (
                    <button onClick={() => setMostrarCrearGrupo(true)}
                      className="w-full mt-2 border border-gray-700 text-gray-300 hover:bg-gray-800 py-1.5 rounded-lg text-xs">
                      + Crear grupo
                    </button>
                  ) : (
                    <div className="bg-gray-800 rounded-lg p-3 mt-2">
                      <input value={nombreNuevoGrupo} onChange={e => setNombreNuevoGrupo(e.target.value)}
                        className="w-full mb-2 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500"
                        placeholder="Nombre del grupo" maxLength={80} />
                      <p className="text-xs text-gray-500 mb-1">Elegí contactos para invitar:</p>
                      <div className="max-h-40 overflow-y-auto space-y-1 mb-2">
                        {contactos.length === 0 && <p className="text-xs text-gray-600">No tenes contactos todavia.</p>}
                        {contactos.map(c => (
                          <label key={c.id} className="flex items-center gap-2 text-xs text-gray-300">
                            <input type="checkbox" checked={miembrosNuevoGrupo.includes(c.id)}
                              onChange={() => toggleMiembroNuevoGrupo(c.id)} />
                            {c.username}
                          </label>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={crearGrupo} disabled={creandoGrupo}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-1 rounded text-xs">
                          {creandoGrupo ? 'Creando...' : 'Crear e invitar'}
                        </button>
                        <button onClick={() => { setMostrarCrearGrupo(false); setNombreNuevoGrupo(''); setMiembrosNuevoGrupo([]); }}
                          className="flex-1 border border-gray-700 text-gray-400 py-1 rounded text-xs">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                  {grupos.length === 0 && (
                    <p className="text-xs text-gray-600 p-4">No tenes grupos aun.</p>
                  )}
                  {[...grupos].sort((a,b) => resumen.actividad('grupo',b.id) - resumen.actividad('grupo',a.id))
                    .filter(g => g.nombre?.toLowerCase().includes(busquedaGrupos.toLowerCase()))
                    .map(g => (
                      <div key={g.id}
                        className={`w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800 border-b border-gray-800 ${grupoSeleccionado?.id === g.id ? 'bg-gray-800' : ''}`}>
                        <button onClick={() => seleccionarGrupo(g)} className="text-left flex-1 min-w-0">
                          <p className="text-sm font-medium">{g.nombre}</p>
                          <p className="text-xs text-gray-500">Grupo</p>
                          {filaResumen('grupo',g.id)}
                        </button>
                        <button onClick={() => salirDeGrupo(g)}
                          className="text-xs text-red-400 hover:text-red-300 ml-2">
                          Salir
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {vista === 'buscar' && (
              <div className="p-3">
                <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && buscarUsuarios()}
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="Buscar por email..." />
                <button onClick={buscarUsuarios}
                  className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-xs">
                  {buscando ? 'Buscando...' : 'Buscar'}
                </button>
                <div className="mt-3 space-y-2">
                  {resultadosBusqueda.map(u => (
                    <div key={u.id} className="bg-gray-800 rounded-lg p-3">
                      <p className="text-sm font-medium">{u.username}</p>
                      <p className="text-xs text-gray-500 mb-2">{u.email}</p>
                      <button onClick={() => enviarSolicitud(u.id)}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-1 rounded text-xs">
                        Agregar contacto
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {vista === 'solicitudes' && (
              <div className="p-3 space-y-3">
                {solicitudesPendientes.length === 0 && invitacionesGrupo.length === 0 && (
                  <p className="text-xs text-gray-600">No tenes solicitudes pendientes.</p>
                )}
                {invitacionesGrupo.map(i => (
                  <div key={i.id} className="bg-gray-800 rounded-lg p-3 border border-blue-900">
                    <p className="text-xs text-blue-400 mb-1">Invitación a grupo</p>
                    <p className="text-sm font-medium">{i.grupo?.nombre || 'Grupo'}</p>
                    <p className="text-xs text-gray-400 mt-1 mb-3">{i.emisor?.username || 'Un contacto'} te invitó a unirte.</p>
                    <div className="flex gap-2">
                      <button disabled={respondiendoInvitacion !== null} onClick={() => responderInvitacionGrupo(i, true)}
                        className="flex-1 bg-green-600 text-white py-1 rounded text-xs disabled:opacity-50">Aceptar</button>
                      <button disabled={respondiendoInvitacion !== null} onClick={() => responderInvitacionGrupo(i, false)}
                        className="flex-1 border border-gray-600 text-gray-300 py-1 rounded text-xs disabled:opacity-50">Rechazar</button>
                    </div>
                  </div>
                ))}
                {solicitudesPendientes.map(s => (
                  <div key={s.id} className="bg-gray-800 rounded-lg p-3">
                    <p className="text-sm font-medium">{s.emisor.username}</p>
                    <p className="text-xs text-gray-500 mb-2">{s.emisor.email}</p>
                    <div className="flex gap-2">
                      <button onClick={() => responderSolicitud(s.id, 'aceptado')}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white py-1 rounded text-xs">
                        Aceptar
                      </button>
                      <button onClick={() => responderSolicitud(s.id, 'rechazado')}
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white py-1 rounded text-xs">
                        Rechazar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="chat-conversacion flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
          {(contactoSeleccionado || grupoSeleccionado) && <button onClick={volverALista} className="md:hidden shrink-0 min-h-11 border-b border-gray-700 bg-gray-900 px-4 py-2 text-left text-blue-300">← Volver a {grupoSeleccionado ? 'grupos' : 'chats'}</button>}
          {(() => {
            const destino = contactoSeleccionado || grupoSeleccionado;
            const esGrupo = !!grupoSeleccionado;
            const nombreDestino = esGrupo ? grupoSeleccionado.nombre : contactoSeleccionado?.username;
            const handleConfigurar = esGrupo ? configurarClavesGrupo : configurarClaves;
            const handleEnviar = esGrupo ? enviarMensajeGrupo : enviarMensaje;

            if (!destino) {
              return (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-gray-600">Selecciona un contacto o grupo para chatear</p>
                </div>
              );
            }
            if (!clavesConfiguradas) {
              return (
                <div className="flex-1 min-h-0 overflow-y-auto p-6">
                  <form autoComplete="off" onSubmit={e => { e.preventDefault(); if (!configurando) void handleConfigurar(); }} className="w-full max-w-md mx-auto my-4 bg-gray-900 rounded-xl border border-gray-800 p-6">
                    <h2 className="text-lg font-semibold mb-2">Abrir conversación con {nombreDestino}</h2>
                    {esGrupo && <button type="button" onClick={abrirMiembros} className="mb-4 rounded-lg border border-blue-700 px-4 py-2 text-sm text-blue-200">Información del grupo</button>}
                    <p className="text-sm text-gray-300 mb-3">Ya iniciaste sesión. Ahora ingresá las dos claves compartidas de esta conversación para leer y enviar mensajes cifrados.</p>
                    <p className="text-xs text-gray-400 mb-3">Estas claves no son la contraseña de tu cuenta. {esGrupo ? 'Todos los miembros deben usar las mismas.' : 'Vos y tu contacto deben usar las mismas.'} Acuérdenlas en persona o por otro medio de confianza.</p>
                    <p className="text-xs text-gray-400 mb-5">Si todavía no hay mensajes, no podemos comprobar si coinciden con las de la otra persona. Cambiar lo que ingresás aquí no cambia las claves de los mensajes anteriores ni las de los demás.</p>
                    <p className="text-xs text-blue-200 mb-4">Para una conversación nueva, acuerden dos frases distintas de al menos 12 caracteres. Eviten nombres, fechas y claves fáciles de adivinar.</p>
                    {((claveVig.length > 0 && claveVig.length < 12) || (claveAes.length > 0 && claveAes.length < 12) || (claveVig && claveVig === claveAes)) && <p role="status" className="mb-4 text-xs text-amber-200">Estas claves ofrecen poca protección. Si son de una conversación existente, usá las originales para leerla; para una nueva, acuerden frases largas y distintas.</p>}
                    <label htmlFor="clave-vig" className="text-xs text-gray-300">Clave compartida Vigenère</label>
                    <input id="clave-vig" name="secreto-conversacion-uno" readOnly onFocus={e => { e.currentTarget.readOnly = false; }} onBlur={e => { e.currentTarget.readOnly = true; }} data-lpignore="true" data-1p-ignore="true" autoCapitalize="none" type={mostrarClaves ? "text" : "password"} autoComplete="off" spellCheck={false} disabled={configurando} value={claveVig} onChange={e => setClaveVig(e.target.value)}
                      className="w-full mt-1 mb-4 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:border-blue-500"
                      placeholder="Ingresá la clave acordada" />
                    <label htmlFor="clave-aes" className="text-xs text-gray-300">Clave compartida AES</label>
                    <input id="clave-aes" name="secreto-conversacion-dos" readOnly onFocus={e => { e.currentTarget.readOnly = false; }} onBlur={e => { e.currentTarget.readOnly = true; }} data-lpignore="true" data-1p-ignore="true" autoCapitalize="none" type={mostrarClaves ? "text" : "password"} autoComplete="off" spellCheck={false} disabled={configurando} value={claveAes} onChange={e => setClaveAes(e.target.value)}
                      className="w-full mt-1 mb-6 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:border-blue-500"
                      placeholder="Ingresá la segunda clave acordada" />
                    <label className="flex items-center gap-2 text-xs text-gray-300 mb-4">
                      <input type="checkbox" checked={mostrarClaves} onChange={e => setMostrarClaves(e.target.checked)} /> Mostrar claves
                    </label>
                    <button type="submit" disabled={configurando}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg text-sm">
                      {configurando ? 'Descifrando mensajes…' : 'Abrir conversación'}
                    </button>
                  </form>
                </div>
              );
            }
            return (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="chat-destino shrink-0 px-6 py-3 border-b border-gray-800 bg-gray-900 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{nombreDestino}</p>
                    <p className="text-xs text-gray-500">
                      {otroEscribiendo
                        ? (esGrupo ? `${otroEscribiendo} esta escribiendo...` : 'escribiendo...')
                        : esGrupo
                          ? 'Grupo'
                          : usuariosOnline.has(contactoSeleccionado?.id)
                            ? 'En linea'
                            : tiempoRelativo(contactoSeleccionado?.ultima_conexion)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <button onClick={cambiarClaves} className="text-xs text-blue-300 border border-gray-700 px-3 py-1.5 rounded-lg">Volver a ingresar claves</button>
                  {esGrupo && (
                    <div className="flex items-center gap-2">
                      <button onClick={abrirMiembros}
                        className="text-xs text-gray-300 hover:text-white border border-gray-700 px-3 py-1.5 rounded-lg">
                        Información del grupo
                      </button>
                      <button onClick={() => salirDeGrupo(grupoSeleccionado)}
                        className="text-xs text-red-400 hover:text-red-300 border border-red-900 px-3 py-1.5 rounded-lg">
                        Salir del grupo
                      </button>
                    </div>
                  )}
                  </div>
                </div>
                <details key={esGrupo ? grupoSeleccionado.id : conversacionId} className="shrink-0 border-b border-slate-800 bg-slate-900/60 px-5 py-3 text-sm">
                  <summary className="cursor-pointer text-blue-200">Configuración del chat · Duración de los mensajes: {esGrupo ? (plazoGrupo.listo ? nombrePlazo(plazoGrupo.plazo === 'grupo' ? plazoGrupo.maximo : Number(plazoGrupo.plazo)) : 'consultando…') : nombrePlazo(duracionPrivada.valor)}</summary>
                  <div className="mt-4 max-w-lg space-y-3 pb-2">
                    <label className="block font-medium" htmlFor="duracion-chat">Duración de los mensajes</label>
                    <select id="duracion-chat" className="min-h-11 w-full rounded-xl border border-slate-600 bg-slate-950 p-3" value={esGrupo ? (plazoGrupo.plazo === 'grupo' ? String(plazoGrupo.maximo || 0) : plazoGrupo.plazo) : String(duracionPrivada.valor)} disabled={esGrupo ? !plazoGrupo.listo : !duracionPrivada.listo || duracionPrivada.busy} onChange={e=>{if(esGrupo)plazoGrupo.setPlazo(Number(e.target.value) === (plazoGrupo.maximo || 0) ? 'grupo' : e.target.value);else void duracionPrivada.guardar(Number(e.target.value));}}>
                      {PLAZOS.map(p=><option key={p.valor} value={p.valor} disabled={esGrupo && !!plazoGrupo.maximo && (p.valor === 0 || p.valor > plazoGrupo.maximo)}>{p.texto}</option>)}
                    </select>
                    <p className="text-slate-300">{esGrupo ? 'Se aplica a tus próximos envíos, dentro del máximo establecido por el administrador.' : 'Cualquiera de los dos puede cambiarla. Se aplica a los próximos mensajes de ambos.'} El tiempo empieza al enviar. Los mensajes anteriores conservan su duración.</p>
                    {esGrupo && !!plazoGrupo.maximo && <p className="text-sm text-blue-200">El administrador estableció un máximo de {nombrePlazo(plazoGrupo.maximo)}. Las opciones que superan ese límite no están disponibles.</p>}
                    {(esGrupo ? plazoGrupo.error : duracionPrivada.error) && <p role="status" className="text-amber-200">{esGrupo ? plazoGrupo.error : duracionPrivada.error}</p>}
                    {duracionPrivada.busy && !esGrupo && <p role="status">Guardando…</p>}
                  </div>
                </details>
                {mensajes.some(m => m.integro === false) && (
                  <div role="status" className="shrink-0 px-4 py-3 bg-amber-950 text-amber-100 text-xs">
                    Hay mensajes que no se pudieron leer o verificar. Revisá que ambas claves coincidan con las usadas al enviarlos. También puede tratarse de contenido alterado.
                    <button onClick={cambiarClaves} className="ml-2 underline font-medium">Volver a ingresar las claves</button>
                  </div>
                )}
                <div ref={mensajesRef} className="chat-mensajes flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 md:p-6 space-y-4">
                  {mensajes.filter(msg=>!vencido(msg.destruir_en)).map(msg => (
                    <div key={msg.id} className={`flex flex-col ${msg.emisor_id === usuario.id ? 'items-end' : 'items-start'}`}>
                      {esGrupo && msg.emisor_id !== usuario.id && (
                        <p className="text-xs text-gray-500 mb-0.5">{msg.emisor?.username || 'Usuario'}</p>
                      )}
                      <div className={`chat-burbuja max-w-md rounded-xl p-3 ${msg.emisor_id === usuario.id ? 'bg-blue-600 rounded-tr-none' : 'bg-gray-800 rounded-tl-none'}`}>
                        {msg.integro === false ? <p className="rounded-lg border border-red-300/30 bg-red-950/60 p-3 text-sm text-red-100">No se pudo abrir este mensaje. Las claves son incorrectas o el contenido fue alterado.</p> : <MensajeMedia texto={msg.texto} path={msg.archivo_path} vig={claveVig} aes={claveAes} expires={msg.destruir_en} />}
                      </div>
                      <div className="mt-1 flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-600">{new Date(msg.created_at).toLocaleTimeString()}</span>
                        {!esGrupo && msg.emisor_id === usuario.id && <CheckStatus enviado={true} leido={msg.leido} />}
                        {msg.integro === null && <span className="text-xs text-amber-300">Mensaje antiguo: no se puede comprobar su integridad.</span>}
                      </div>

                    </div>
                  ))}
                </div>
                <div className="chat-compositor shrink-0 max-h-[45dvh] overflow-y-auto bg-gray-900 border-t border-gray-800 p-4 flex flex-col gap-2">

                  <AdjuntarMedia key={(grupoSeleccionado?.id || conversacionId) + ":" + usuario.id} onSend={enviarArchivo}>
                  {errorMensaje && <p role="alert" className="text-red-400 text-xs">{errorMensaje}</p>}
                  <div className="flex gap-3">
                    <input value={mensaje} onChange={e => { setMensaje(e.target.value); notificarEscribiendo(); }}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && mensaje.trim()) { e.preventDefault(); void handleEnviar(); } }}
                      className="min-w-0 flex-1 bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
                      aria-label="Mensaje" placeholder="Escribe un mensaje..." />
                    <button type="button" disabled={!mensaje.trim()} onClick={handleEnviar}
                      className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-6 py-3 rounded-lg text-sm">
                      Enviar
                    </button>
                  </div>
                  </AdjuntarMedia>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {mostrarMiembros && grupoSeleccionado && usuario && (
        <InformacionGrupo key={grupoSeleccionado.id + ':' + usuario.id}
          grupo={grupoSeleccionado} userId={usuario.id} contactos={contactos} onPolicyChanged={plazoGrupo.actualizar}
          onClose={() => setMostrarMiembros(false)}
          onRename={(id, nombre) => {
            setGrupos(prev => prev.map(g => g.id === id ? { ...g, nombre } : g));
            setGrupoSeleccionado((prev: any) => prev?.id === id ? { ...prev, nombre } : prev);
          }}
          onLeft={id => {
            setMostrarMiembros(false);
            if (grupoActualRef.current === id) {
              invalidarChat(); setGrupoSeleccionado(null); setClavesConfiguradas(false); setMensajes([]);
              setClaveVig(''); setClaveAes('');
            }
            setGrupos(prev => prev.filter(g => g.id !== id));
            setAvisoGrupos('Saliste del grupo.');
          }} />
      )}
    </main>
  );
}
