'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { cifrar, descifrar } from '../../lib/cifrado';
import DOMPurify from 'dompurify';
import { z } from 'zod';

const mensajeSchema = z.string().min(1, 'El mensaje no puede estar vacio').max(2000, 'El mensaje es demasiado largo');
const claveSchema = z.string().min(3, 'La clave debe tener al menos 3 caracteres');

function CheckStatus({ enviado, leido }: { enviado: boolean, leido: boolean }) {
  if (leido) return <span className="text-blue-400 text-xs">✓✓</span>;
  if (enviado) return <span className="text-gray-500 text-xs">✓✓</span>;
  return <span className="text-gray-600 text-xs">✓</span>;
}

type Vista = 'chats' | 'buscar' | 'solicitudes';

export default function ChatPage() {
  const [usuario, setUsuario] = useState<any>(null);
  const [contactos, setContactos] = useState<any[]>([]);
  const [solicitudesPendientes, setSolicitudesPendientes] = useState<any[]>([]);
  const [contactoSeleccionado, setContactoSeleccionado] = useState<any>(null);
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [claveVig, setClaveVig] = useState('');
  const [claveAes, setClaveAes] = useState('');
  const [clavesConfiguradas, setClavesConfiguradas] = useState(false);
  const [conversacionId, setConversacionId] = useState<string | null>(null);
  const [errorMensaje, setErrorMensaje] = useState('');
  const [vista, setVista] = useState<Vista>('chats');
  const [busqueda, setBusqueda] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);
  const mensajesRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimeout = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      alert('Sesion cerrada por inactividad.');
      supabase.auth.signOut();
      window.location.href = '/login';
    }, 15 * 60 * 1000);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) window.location.href = '/login';
      else {
        setUsuario(data.user);
        cargarContactos(data.user.id);
        cargarSolicitudes(data.user.id);
      }
    });
  }, []);

  useEffect(() => {
    resetTimeout();
    window.addEventListener('mousemove', resetTimeout);
    window.addEventListener('keydown', resetTimeout);
    return () => {
      window.removeEventListener('mousemove', resetTimeout);
      window.removeEventListener('keydown', resetTimeout);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (mensajesRef.current) {
      mensajesRef.current.scrollTop = mensajesRef.current.scrollHeight;
    }
  }, [mensajes]);

  const cargarContactos = async (miId: string) => {
    const { data } = await supabase
      .from('solicitudes_contacto')
      .select(`
        id,
        emisor_id,
        receptor_id,
        emisor:usuarios!solicitudes_contacto_emisor_id_fkey(id, username, email),
        receptor:usuarios!solicitudes_contacto_receptor_id_fkey(id, username, email)
      `)
      .eq('estado', 'aceptado')
      .or(`emisor_id.eq.${miId},receptor_id.eq.${miId}`);

    if (data) {
      const lista = data.map(s => s.emisor_id === miId ? s.receptor : s.emisor);
      setContactos(lista);
    }
  };

  const cargarSolicitudes = async (miId: string) => {
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
    setContactoSeleccionado(contacto);
    setClavesConfiguradas(false);
    setMensajes([]);
    setConversacionId(null);
    setClaveVig('');
    setClaveAes('');
    setErrorMensaje('');
    setVista('chats');
  };

  const configurarClaves = async () => {
    const vigResult = claveSchema.safeParse(claveVig);
    const aesResult = claveSchema.safeParse(claveAes);
    if (!vigResult.success) { alert('Clave Vigenere invalida: ' + vigResult.error.errors[0].message); return; }
    if (!aesResult.success) { alert('Clave AES invalida: ' + aesResult.error.errors[0].message); return; }
    if (!usuario || !contactoSeleccionado) return;

    const { data: existente } = await supabase
      .from('conversaciones')
      .select('*')
      .or(`and(usuario_a.eq.${usuario.id},usuario_b.eq.${contactoSeleccionado.id}),and(usuario_a.eq.${contactoSeleccionado.id},usuario_b.eq.${usuario.id})`)
      .single();

    let convId = existente?.id;
    if (!convId) {
      const { data, error } = await supabase
        .from('conversaciones')
        .insert({ usuario_a: usuario.id, usuario_b: contactoSeleccionado.id })
        .select()
        .single();
      if (error) { alert('Error: ' + error.message); return; }
      convId = data.id;
    }

    setConversacionId(convId);
    setClavesConfiguradas(true);
    await cargarMensajes(convId, claveVig, claveAes);
    await marcarComoLeidos(convId);
    suscribirMensajes(convId, claveVig, claveAes);
  };

  const marcarComoLeidos = async (convId: string) => {
    if (!usuario) return;
    await supabase
      .from('mensajes')
      .update({ leido: true })
      .eq('conversacion_id', convId)
      .neq('emisor_id', usuario.id)
      .eq('leido', false);
  };

  const cargarMensajes = async (convId: string, vig: string, aes: string) => {
    const { data } = await supabase
      .from('mensajes')
      .select('*')
      .eq('conversacion_id', convId)
      .order('created_at', { ascending: true });

    if (data) {
      const descifrados = data.map(msg => {
        try {
          const texto = descifrar(msg.contenido_cifrado, vig, aes);
          return { ...msg, texto, integro: true };
        } catch {
          return { ...msg, texto: '[No se pudo descifrar]', integro: false };
        }
      });
      setMensajes(descifrados);
    }
  };

  const suscribirMensajes = (convId: string, vig: string, aes: string) => {
    supabase
      .channel('mensajes-' + convId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes', filter: `conversacion_id=eq.${convId}` },
        async (payload) => {
          const msg = payload.new as any;
          try {
            const texto = descifrar(msg.contenido_cifrado, vig, aes);
            setMensajes(prev => [...prev, { ...msg, texto, integro: true }]);
            if (msg.emisor_id !== usuario?.id) {
              await supabase.from('mensajes').update({ leido: true }).eq('id', msg.id);
            }
          } catch {
            setMensajes(prev => [...prev, { ...msg, texto: '[No se pudo descifrar]', integro: false }]);
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mensajes', filter: `conversacion_id=eq.${convId}` },
        (payload) => {
          const msgActualizado = payload.new as any;
          setMensajes(prev => prev.map(m => m.id === msgActualizado.id ? { ...m, leido: msgActualizado.leido } : m));
        })
      .subscribe();
  };

  const enviarMensaje = async () => {
    if (!clavesConfiguradas || !conversacionId || !usuario) return;
    const resultado = mensajeSchema.safeParse(mensaje);
    if (!resultado.success) { setErrorMensaje(resultado.error.errors[0].message); return; }
    setErrorMensaje('');
    try {
      const mensajeLimpio = DOMPurify.sanitize(mensaje).trim();
      if (!mensajeLimpio) return;
      const contenidoCifrado = cifrar(mensajeLimpio, claveVig, claveAes);
      const hash = btoa(encodeURIComponent(mensajeLimpio)).slice(0, 32);
      await supabase.from('mensajes').insert({
        conversacion_id: conversacionId,
        emisor_id: usuario.id,
        contenido_cifrado: contenidoCifrado,
        hash,
        leido: false,
      });
      setMensaje('');
    } catch (e: any) {
      alert('Error al cifrar: ' + e.message);
    }
  };

  const cerrarSesion = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  if (!usuario) return null;

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Sistema de Cifrado</h1>
          <p className="text-xs text-gray-500">{usuario.email}</p>
        </div>
        <button onClick={cerrarSesion}
          className="text-sm text-gray-400 hover:text-white border border-gray-700 px-4 py-2 rounded-lg">
          Cerrar sesion
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
          <div className="flex border-b border-gray-800">
            <button onClick={() => setVista('chats')}
              className={`flex-1 py-3 text-xs ${vista === 'chats' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500'}`}>
              Chats
            </button>
            <button onClick={() => setVista('buscar')}
              className={`flex-1 py-3 text-xs ${vista === 'buscar' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500'}`}>
              Buscar
            </button>
            <button onClick={() => setVista('solicitudes')}
              className={`flex-1 py-3 text-xs relative ${vista === 'solicitudes' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500'}`}>
              Solicitudes
              {solicitudesPendientes.length > 0 && (
                <span className="absolute top-2 right-2 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {solicitudesPendientes.length}
                </span>
              )}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {vista === 'chats' && (
              <>
                {contactos.length === 0 && (
                  <p className="text-xs text-gray-600 p-4">No tenes contactos aun. Busca usuarios para agregar.</p>
                )}
                {contactos.map(c => (
                  <button key={c.id} onClick={() => seleccionarContacto(c)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-800 border-b border-gray-800 ${contactoSeleccionado?.id === c.id ? 'bg-gray-800' : ''}`}>
                    <p className="text-sm font-medium">{c.username}</p>
                    <p className="text-xs text-gray-500">{c.email}</p>
                  </button>
                ))}
              </>
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
                {solicitudesPendientes.length === 0 && (
                  <p className="text-xs text-gray-600">No tenes solicitudes pendientes.</p>
                )}
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

        <div className="flex-1 flex flex-col">
          {!contactoSeleccionado ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-600">Selecciona un contacto para chatear</p>
            </div>
          ) : !clavesConfiguradas ? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="w-full max-w-sm bg-gray-900 rounded-xl border border-gray-800 p-6">
                <h2 className="text-lg font-semibold mb-1">Chat con {contactoSeleccionado.username}</h2>
                <p className="text-xs text-gray-500 mb-6">Acorda estas claves con {contactoSeleccionado.username} antes de chatear</p>
                <label className="text-xs text-gray-500">Clave Vigenere</label>
                <input value={claveVig} onChange={e => setClaveVig(e.target.value)}
                  className="w-full mt-1 mb-4 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="ej: salta2025" />
                <label className="text-xs text-gray-500">Clave AES</label>
                <input value={claveAes} onChange={e => setClaveAes(e.target.value)}
                  className="w-full mt-1 mb-6 bg-gray-950 border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="ej: mi-clave-secreta" />
                <button onClick={configurarClaves}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg text-sm">
                  Iniciar chat
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-6 py-3 border-b border-gray-800 bg-gray-900">
                <p className="text-sm font-medium">{contactoSeleccionado.username}</p>
                <p className="text-xs text-gray-500">{contactoSeleccionado.email}</p>
              </div>
              <div ref={mensajesRef} className="flex-1 overflow-y-auto p-6 space-y-4">
                {mensajes.length === 0 && (
                  <p className="text-center text-gray-600 text-sm mt-8">No hay mensajes aun.</p>
                )}
                {mensajes.map(msg => (
                  <div key={msg.id} className={`flex flex-col ${msg.emisor_id === usuario.id ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-md rounded-xl p-3 ${msg.emisor_id === usuario.id ? 'bg-blue-600 rounded-tr-none' : 'bg-gray-800 rounded-tl-none'}`}>
                      <p className="text-sm">{msg.texto}</p>
                    </div>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-600">{new Date(msg.created_at).toLocaleTimeString()}</span>
                      {msg.emisor_id === usuario.id && <CheckStatus enviado={true} leido={msg.leido} />}
                      <span className={`text-xs ${msg.integro ? 'text-green-500' : 'text-red-500'}`}>
                        {msg.integro ? 'Integro' : 'Alterado'}
                      </span>
                    </div>
                    <details className="mt-1 max-w-md">
                      <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400">
                        Ver cifrado
                      </summary>
                      <div className="bg-gray-900 rounded-lg p-2 mt-1">
                        <p className="text-xs text-gray-500 break-all">{msg.contenido_cifrado}</p>
                      </div>
                    </details>
                  </div>
                ))}
              </div>
              <div className="bg-gray-900 border-t border-gray-800 p-4 flex flex-col gap-2">
                {errorMensaje && <p className="text-red-400 text-xs">{errorMensaje}</p>}
                <div className="flex gap-3">
                  <input value={mensaje} onChange={e => setMensaje(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && enviarMensaje()}
                    className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
                    placeholder="Escribe un mensaje..." />
                  <button onClick={enviarMensaje}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg text-sm">
                    Enviar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}