'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../../lib/supabase';
import { MEDIA_BUCKET, MAX_MEDIA_BYTES, descifrarArchivo, leerArchivo, validarArchivo } from '../../lib/media';


function ImagenAmpliable({ url, nombre }: { url: string; nombre: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const abrir = () => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); };
  return <>
    <button type="button" onClick={abrir} aria-label={'Ampliar imagen: ' + nombre} className="block max-w-full rounded-xl focus-visible:outline-2 focus-visible:outline-blue-200">
      <img src={url} alt={nombre} className="max-h-80 max-w-full rounded-xl object-contain" />
      <span className="mt-2 block text-xs underline">Tocá para ampliar</span>
    </button>
    <dialog ref={dialog} aria-label="Imagen ampliada" className="fixed inset-0 m-auto w-[95vw] max-w-5xl max-h-[94dvh] overflow-auto rounded-2xl border border-slate-600 bg-slate-950 p-4 text-white shadow-2xl backdrop:bg-black/80" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 break-all text-sm text-slate-300">{nombre}</p>
        <button type="button" autoFocus onClick={() => dialog.current?.close()} className="min-h-11 rounded-xl border border-slate-500 px-4 py-2">Cerrar ✕</button>
      </div>
      <img src={url} alt={nombre} className="mx-auto max-h-[70dvh] max-w-full object-contain" />
      <a href={url} download={nombre} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-5 py-2 text-sm">Descargar imagen</a>
    </dialog>
  </>;
}

export function MensajeMedia({ texto, path, vig, aes, expires }: { texto: string; path?: string; vig: string; aes: string; expires?: string }) {
  const info = leerArchivo(texto, path);
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(() => !!expires && Date.parse(expires) <= Date.now());
  const [contenido, setContenido] = useState({ texto, path, vig, aes, expires });
  if (contenido.texto !== texto || contenido.path !== path || contenido.vig !== vig || contenido.aes !== aes || contenido.expires !== expires) {
    setContenido({ texto, path, vig, aes, expires }); setUrl(''); setError(''); setBusy(false);
    setExpired(!!expires && Date.parse(expires) <= new Date().getTime());
  }
  const generation = useRef(0), objectUrl = useRef('');
  useEffect(() => {
    generation.current++;
    const clear = () => { generation.current++; URL.revokeObjectURL(objectUrl.current); objectUrl.current = ''; };
    const remaining = expires ? new Date(expires).getTime() - Date.now() : Infinity;
    const timer = Number.isFinite(remaining) ? setTimeout(() => { clear(); setUrl(''); setExpired(true); }, Math.max(0, Math.min(remaining, 2147483647))) : undefined;
    return () => { clear(); clearTimeout(timer); };
  }, [texto, path, vig, aes, expires]);
  if (!info) return <p className="text-sm">{path ? '[No se pudo leer el adjunto con estas claves]' : texto}</p>;
  const load = async () => {
    if (busy || expired) return;
    const operation = generation.current;
    setBusy(true); setError('');
    try {
      const { data, error: failure } = await supabase.storage.from(MEDIA_BUCKET).download(info.path);
      if (failure || !data) throw new Error('No se pudo descargar. Revisá tu conexión y el acceso al chat.');
      const plain = await descifrarArchivo(data, info, vig, aes);
      if (operation !== generation.current) return;
      objectUrl.current = URL.createObjectURL(plain); setUrl(objectUrl.current);
    } catch (e) { if (operation === generation.current) setError((e as Error).message); }
    finally { if (operation === generation.current) setBusy(false); }
  };
  return <div className="space-y-2 max-w-full">
    <p className="text-sm break-all">{info.mime.startsWith('image/') ? 'Imagen' : info.mime.startsWith('audio/') ? 'Audio' : 'Video'} · {info.name}</p>
    <p className="text-xs opacity-70">{(info.size / 1024 / 1024).toFixed(1)} MB</p>
    {expired ? <p className="text-xs">Adjunto vencido.</p> : url ? <>
      {info.mime.startsWith('audio/') ? <audio controls preload="metadata" src={url} className="max-w-full" />
        : info.mime.startsWith('image/') ? <ImagenAmpliable key={url} url={url} nombre={info.name} /> : <video controls playsInline preload="metadata" src={url} className="max-w-full max-h-80 rounded" />}
      <a href={url} download={info.name} className="text-xs underline">Descargar archivo</a>
    </> : <button type="button" onClick={load} disabled={busy} className="border rounded px-3 py-2 text-xs disabled:opacity-50">{busy ? 'Descifrando…' : (info.mime.startsWith('image/') ? 'Ver imagen' : 'Reproducir archivo')}</button>}
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </div>;
}

export function AdjuntarMedia({ onSend, children }: { onSend: (file: File) => Promise<void>; children?: ReactNode }) {
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false), [requesting, setRequesting] = useState(false), [seconds, setSeconds] = useState(0);
  const input = useRef<HTMLInputElement>(null), recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null);
  const previewUrl = useRef('');
  const mounted = useRef(true), sending = useRef(false), request = useRef(0), cancelled = useRef(false);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; request.current++; cancelled.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    URL.revokeObjectURL(previewUrl.current); previewUrl.current = '';
  }; }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds(value => value + 1), 1000);
    const limit = setTimeout(() => recorder.current?.state === 'recording' && recorder.current.stop(), 300000);
    return () => { clearInterval(timer); clearTimeout(limit); };
  }, [recording]);
  const choose = (candidate: File) => {
    try {
      validarArchivo(candidate);
      const url = URL.createObjectURL(candidate);
      URL.revokeObjectURL(previewUrl.current); previewUrl.current = url;
      setPreview(url); setFile(candidate); setError('');
    }
    catch (e) { setError((e as Error).message); }
  };
  const descartar = () => {
    URL.revokeObjectURL(previewUrl.current); previewUrl.current = '';
    setPreview(''); setFile(null);
  };
  const record = async () => {
    if (requesting || recording || sending.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Este navegador no permite grabar aquí. Usá localhost o HTTPS, o adjuntá un archivo.'); return;
    }
    const current = ++request.current; setRequesting(true); setError(''); cancelled.current = false;
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || current !== request.current) { microphone.getTracks().forEach(t => t.stop()); return; }
      stream.current = microphone;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error('No hay un formato de grabación compatible. Adjuntá un audio.');
      const rec = new MediaRecorder(microphone, { mimeType: mime }); recorder.current = rec;
      const chunks: Blob[] = []; let size = 0;
      rec.ondataavailable = event => { if (event.data.size) { chunks.push(event.data); size += event.data.size; }
        if (size > MAX_MEDIA_BYTES && rec.state === 'recording') rec.stop(); };
      rec.onerror = () => { cancelled.current = true; microphone.getTracks().forEach(t => t.stop()); if (mounted.current) { setError('No se pudo completar la grabación.'); setRecording(false); } };
      rec.onstop = () => {
        microphone.getTracks().forEach(t => t.stop());
        if (!mounted.current) return;
        setRecording(false);
        if (cancelled.current) return;
        const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
        choose(new File(chunks, `audio-${Date.now()}.${extension}`, { type: mime }));
      };
      rec.start(1000); setSeconds(0); setRecording(true);
    } catch (e) { stream.current?.getTracks().forEach(t => t.stop()); if (mounted.current) setError((e as Error).name === 'NotAllowedError' ? 'El micrófono está bloqueado. Permití su uso en el navegador o adjuntá un audio.' : (e as Error).message); }
    finally { if (mounted.current) setRequesting(false); }
  };
  const send = async () => {
    if (!file || sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try { await onSend(file); if (mounted.current) descartar(); }
    catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { sending.current = false; if (mounted.current) setBusy(false); }
  };
  const accion = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/10 px-4 py-2.5 text-sm font-medium text-blue-100 hover:bg-blue-500/20 disabled:opacity-40';
  const seleccionar = (accept: string) => { if (input.current) { input.current.accept = accept; input.current.click(); } };
  const icono = (tipo: string) => <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{tipo === 'foto' ? <><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 7"/></> : tipo === 'video' ? <><rect x="3" y="6" width="12" height="12" rx="3"/><path d="m15 10 6-3v10l-6-3"/></> : tipo === 'archivo-audio' ? <><path d="M9 18V5l11-2v13M9 8l11-2"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></> : <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>}</svg>;
  return <div className="space-y-3">
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm,video/mp4,video/webm,.m4a" className="hidden"
      onChange={e => { const candidate = e.target.files?.[0]; if (candidate) choose(candidate); e.target.value = ''; }} />
    <div className="flex flex-wrap gap-2 items-center text-xs">
      {[['foto', 'Fotos y videos', 'image/jpeg,image/png,image/webp,video/mp4,video/webm'], ['archivo-audio', 'Subir audio', 'audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm,.m4a']].map(([tipo, texto, formatos]) => <button type="button" key={tipo} disabled={busy || recording || requesting} onClick={() => seleccionar(formatos)} className={accion}>{icono(tipo)}{texto}</button>)}
      {!recording ? <button type="button" disabled={busy || requesting || !!file} onClick={record} className={accion}>{icono('audio')}{requesting ? 'Esperando micrófono…' : 'Grabar voz'}</button>
        : <><span role="status" className="text-red-400">Grabando {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} / 5:00</span>
          <button type="button" onClick={() => recorder.current?.stop()} className={accion}>Finalizar audio</button>
          <button type="button" onClick={() => { cancelled.current = true; recorder.current?.stop(); }}>Cancelar</button></>}
      <span className="text-gray-400">Hasta 20 MB por archivo · Grabación de hasta 5 min</span>
    </div>
    {file && <div className="rounded-2xl border border-slate-600 bg-slate-800/70 p-4 space-y-3">
      <p className="text-xs break-all">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>
      {preview && (validarArchivo(file).startsWith('audio/') ? <audio controls src={preview} className="max-w-full" /> : validarArchivo(file).startsWith('image/') ? <img src={preview} alt="Vista previa del adjunto" className="max-h-40 max-w-full rounded-xl object-contain" /> : <video controls playsInline src={preview} className="max-h-40 max-w-full" />)}
      <div className="flex gap-3 text-xs"><button type="button" onClick={send} disabled={busy} className="min-h-11 rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium disabled:opacity-50">{busy ? 'Cifrando y enviando…' : (validarArchivo(file).startsWith('image/') ? 'Enviar foto' : validarArchivo(file).startsWith('audio/') ? 'Enviar audio' : 'Enviar video')}</button>
        <button type="button" className={accion} onClick={descartar} disabled={busy}>Descartar</button></div>
    </div>}
    {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
    {!file && !recording && !requesting && !busy && children}
  </div>;
}
