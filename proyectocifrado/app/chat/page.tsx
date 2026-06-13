'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { cifrar, descifrar } from '../../lib/cifrado';

export default function ChatPage() {
  const [usuario, setUsuario] = useState<any>(null);
  const [mensaje, setMensaje] = useState('');
  const [claveVig, setClaveVig] = useState('');
  const [claveAes, setClaveAes] = useState('');
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [clavesConfiguradas, setClavesConfiguradas] = useState(false);
  const [conversacionId, setConversacionId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) window.location.href = '/login';
      else setUsuario(data.user);
    });
  }, []);

  const configurarClaves = async () => {
    if (!claveVig || !claveAes || !usuario) return;

    const { data, error } = await supabase
      .from('conversaciones')
      .insert({ usuario_a: usuario.id, usuario_b: usuario.id })
      .select()
      .single();

    if (error) { alert('Error al crear conversación: ' + error.message); return; }

    setConversacionId(data.id);
    setClavesConfiguradas(true);
    cargarMensajes(data.id);
  };

  const cargarMensajes = async (convId: string) => {
    const { data } = await supabase
      .from('mensajes')
      .select('*')
      .eq('conversacion_id', convId)
      .order('created_at', { ascending: true });

    if (data) {
      const descifrados = data.map(msg => {
        try {
          const texto = descifrar(msg.contenido_cifrado, claveVig, claveAes);
          return { ...msg, texto, integro: true };
        } catch {
          return { ...msg, texto: '[No se pudo descifrar]', integro: false };
        }
      });
      setMensajes(descifrados);
    }
  };

  const enviarMensaje = async () => {
    if (!mensaje || !clavesConfiguradas || !conversacionId || !usuario) return;
    try {
      const contenidoCifrado = cifrar(mensaje, claveVig, claveAes);
      const hash = btoa(encodeURIComponent(mensaje)).slice(0, 32);

      const { error } = await supabase.from('mensajes').insert({
        conversacion_id: conversacionId,
        emisor_id: usuario.id,
        contenido_cifrado: contenidoCifrado,
        hash,
      });

      if (error) { alert('Error al enviar: ' + error.message); return; }

      setMensajes(prev => [...prev, {
        id: Date.now(),
        texto: mensaje,
        contenido_cifrado: contenidoCifrado,
        emisor_id: usuario.id,
        integro: true,
        created_at: new Date().toISOString(),
      }]);
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
          Cerrar sesión
        </button>
      </header>

      {!clavesConfiguradas ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-gray-900 rounded-xl border border-gray-800 p-6">
            <h2 className="text-lg font-semibold mb-1">Configurar claves</h2>
            <p className="text-xs text-gray-500 mb-6">Acordá estas claves con tu contacto antes de chatear</p>
            <label className="text-xs text-gray-500">Clave Vigenère</label>
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
        <div className="flex-1 flex flex-col">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {mensajes.length === 0 && (
              <p className="text-center text-gray-600 text-sm mt-8">No hay mensajes aún. Escribí el primero.</p>
            )}
            {mensajes.map(msg => (
              <div key={msg.id} className={`flex flex-col ${msg.emisor_id === usuario.id ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-md rounded-xl p-3 ${msg.emisor_id === usuario.id ? 'bg-blue-600 rounded-tr-none' : 'bg-gray-800 rounded-tl-none'}`}>
                  <p className="text-sm">{msg.texto}</p>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xs text-gray-600">
                    {new Date(msg.created_at).toLocaleTimeString()}
                  </span>
                  <span className={`text-xs ${msg.integro ? 'text-green-500' : 'text-red-500'}`}>
                    {msg.integro ? '✓ Íntegro' : '✗ Alterado'}
                  </span>
                </div>
                <div className="mt-1 bg-gray-900 rounded-lg p-2 max-w-md">
                  <p className="text-xs text-gray-500">Cifrado: {msg.contenido_cifrado?.slice(0, 40)}...</p>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-gray-900 border-t border-gray-800 p-4 flex gap-3">
            <input value={mensaje} onChange={e => setMensaje(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && enviarMensaje()}
              className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Escribí un mensaje..." />
            <button onClick={enviarMensaje}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg text-sm">
              Enviar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}