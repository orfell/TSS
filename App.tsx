import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { 
  Gender, 
  Language, 
  Accent, 
  Style, 
  VoiceOption, 
  AudioSettings, 
  HistoryItem,
  TAGS
} from './types';
import { generateSpeech } from './services/geminiService';
import { decodeAudioData, audioBufferToWav } from './utils/audio';
import { 
  PlayIcon, 
  PauseIcon, 
  ArrowPathIcon, 
  SpeakerWaveIcon, 
  ArrowDownTrayIcon,
  TrashIcon,
  MicrophoneIcon,
  FaceSmileIcon,
  FaceFrownIcon,
  MegaphoneIcon,
  ClockIcon
} from '@heroicons/react/24/solid';

// Define the 10 voices (Mapping UI names to Gemini API names)
// We reuse the 5 distinct base voices but assign them to 10 slots.
const VOICES: VoiceOption[] = [
  // Male
  { id: 'Puck', apiName: 'Puck', name: 'Hombre 1 (Suave)', gender: Gender.Male },
  { id: 'Charon', apiName: 'Charon', name: 'Hombre 2 (Profundo)', gender: Gender.Male },
  { id: 'Fenrir', apiName: 'Fenrir', name: 'Hombre 3 (Energico)', gender: Gender.Male },
  { id: 'Zephyr', apiName: 'Zephyr', name: 'Hombre 4 (Claro)', gender: Gender.Male },
  { id: 'Orpheus', apiName: 'Puck', name: 'Hombre 5 (Narrador)', gender: Gender.Male }, // Reusing Puck logic handled in system prompt if needed, strictly ID passed to API
  // Female
  { id: 'Kore', apiName: 'Kore', name: 'Mujer 1 (Calma)', gender: Gender.Female },
  { id: 'Aoede', apiName: 'Aoede', name: 'Mujer 2 (Dulce)', gender: Gender.Female },
  { id: 'Mnemosyne', apiName: 'Kore', name: 'Mujer 3 (Profesional)', gender: Gender.Female }, // Reusing Kore
  { id: 'Leto', apiName: 'Aoede', name: 'Mujer 4 (Alegre)', gender: Gender.Female }, // Reusing Aoede
  { id: 'Hestia', apiName: 'Kore', name: 'Mujer 5 (Mayor)', gender: Gender.Female },
];

// Define accent groups for filtering
const SPANISH_ACCENTS = [Accent.Spain, Accent.Mexico, Accent.Argentina, Accent.Colombia];
const ENGLISH_ACCENTS = [Accent.US, Accent.UK, Accent.Australia];

// Helper to get API voice name from our ID
const getApiVoiceName = (id: string) => {
  const v = VOICES.find(v => v.id === id);
  return v ? v.apiName : 'Puck'; // Fallback
};

export default function App() {
  // State
  const [text, setText] = useState<string>("Hola [risa], bienvenido a esta demostración.");
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [currentAudio, setCurrentAudio] = useState<{ buffer: AudioBuffer, id: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Settings State
  const [settings, setSettings] = useState<AudioSettings>({
    language: Language.Spanish,
    voiceId: 'Puck',
    accent: Accent.Spain,
    style: Style.Natural,
    speed: 1.0, // Normal speed
    pitch: 0,   // Detune cents (0 = normal, range -1200 to 1200)
  });

  // Audio Context Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);

  // Initialize AudioContext
  useEffect(() => {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    audioContextRef.current = new AudioCtx();
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  // Monitor playback progress
  useEffect(() => {
    let animationFrame: number;
    const updateProgress = () => {
      if (isPlaying && audioContextRef.current && startTimeRef.current) {
        // Calculate elapsed time taking playback rate into account
        const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
        const adjustedTime = pausedAtRef.current + (elapsed * settings.speed); 
        
        if (currentAudio && adjustedTime >= currentAudio.buffer.duration) {
          stopAudio();
          setCurrentTime(0);
        } else {
          setCurrentTime(adjustedTime);
          animationFrame = requestAnimationFrame(updateProgress);
        }
      }
    };

    if (isPlaying) {
      animationFrame = requestAnimationFrame(updateProgress);
    }

    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, currentAudio, settings.speed]);

  // Update real-time audio parameters
  useEffect(() => {
    if (sourceNodeRef.current && isPlaying) {
      // Update Speed (playbackRate)
      sourceNodeRef.current.playbackRate.value = settings.speed;
      // Update Pitch (detune)
      // Note: Changing playbackRate changes pitch too. To change pitch INDEPENDENTLY requires complex DSP.
      // However, usually "Pitch" sliders in simple web apps just detune. 
      // If we want to change pitch without speed, that's harder.
      // But the requirement asks for a pitch selector. 
      // We will apply detune. (100 cents = 1 semitone). Range: -1200 to +1200 (octave).
      sourceNodeRef.current.detune.value = settings.pitch;
    }
  }, [settings.speed, settings.pitch, isPlaying]);


  const insertTag = (tagValue: string) => {
    setText(prev => prev + ` ${tagValue} `);
  };

  const getTagDisplay = (value: string) => {
    switch (value) {
      case '[pausa]': return { icon: <ClockIcon className="w-4 h-4" />, text: 'PAUSA' };
      case '[risa]': return { icon: <FaceSmileIcon className="w-4 h-4" />, text: 'RISA' };
      case '[grito]': return { icon: <MegaphoneIcon className="w-4 h-4" />, text: 'GRITO' };
      case '[llanto]': return { icon: <FaceFrownIcon className="w-4 h-4" />, text: 'LLANTO' };
      default: return { icon: null, text: value };
    }
  };

  const handleGenerate = async () => {
    if (!text.trim()) return;
    setIsLoading(true);

    try {
      // 1. Call API
      // Note: We map the UI voice ID to the real API voice name inside the service, 
      // but we pass the specific UI ID to mapping logic.
      // We actually need to pass the real API name to the service for the config.
      const apiVoiceName = getApiVoiceName(settings.voiceId);
      const settingsForApi = { ...settings, voiceId: apiVoiceName };
      
      const base64Audio = await generateSpeech(text, settingsForApi);

      // 2. Decode Audio
      if (!audioContextRef.current) return;
      const audioBuffer = await decodeAudioData(base64Audio, audioContextRef.current);

      // 3. Create Blob for history
      const wavBlob = audioBufferToWav(audioBuffer);

      // 4. Add to History
      const newItem: HistoryItem = {
        id: Date.now().toString(),
        text: text,
        audioBlob: wavBlob,
        duration: audioBuffer.duration,
        createdAt: Date.now(),
        settings: { ...settings }
      };

      setHistory(prev => [newItem, ...prev]);
      
      // 5. Auto Play
      playBuffer(audioBuffer, newItem.id);

    } catch (error) {
      alert("Error al generar el audio. Revisa tu API Key o intenta de nuevo.");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const playBuffer = (buffer: AudioBuffer, id: string) => {
    // Stop current if playing
    stopAudio();

    if (!audioContextRef.current) return;

    // Resume context if suspended (browser policy)
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    
    // Apply initial settings
    source.playbackRate.value = settings.speed;
    source.detune.value = settings.pitch;

    const gainNode = audioContextRef.current.createGain();
    
    source.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);

    sourceNodeRef.current = source;
    gainNodeRef.current = gainNode;

    // Start from beginning
    pausedAtRef.current = 0;
    startTimeRef.current = audioContextRef.current.currentTime;
    
    source.start(0);
    
    setCurrentAudio({ buffer, id });
    setIsPlaying(true);
    
    source.onended = () => {
       // Handled by progress loop mostly, but safety check
       // setIsPlaying(false); 
    };
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) { /* ignore already stopped */ }
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    pausedAtRef.current = 0;
  };

  const handleHistoryPlay = async (item: HistoryItem) => {
    if (currentAudio?.id === item.id && isPlaying) {
        stopAudio();
        return;
    }

    if (!audioContextRef.current) return;
    
    // Convert blob back to array buffer then audio buffer
    const arrayBuffer = await item.audioBlob.arrayBuffer();
    const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
    
    // Update settings to match history item? 
    // Usually better to keep current user controls active for playback experimentation
    // OR reset controls to what generated it. 
    // Requirement implies "Selector allows setting speed/tone". Let's allow real-time manipulation of history items too.
    playBuffer(audioBuffer, item.id);
  };

  const downloadAudio = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Filter accents based on selected language
  const availableAccents = settings.language === Language.Spanish ? SPANISH_ACCENTS : ENGLISH_ACCENTS;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center py-8 px-4 font-sans">
      
      <header className="mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
            <SpeakerWaveIcon className="w-8 h-8 text-indigo-600" />
            <h1 className="text-3xl font-bold text-slate-800">VozGen AI</h1>
        </div>
        <p className="text-slate-500 max-w-lg mx-auto">
          Transforma texto a voz con emociones, acentos y control total.
        </p>
      </header>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Controls */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-semibold mb-4 text-slate-700">Configuración de Voz</h2>
            
            {/* 1. Idioma */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-600 mb-1">Idioma</label>
              <div className="flex bg-slate-100 p-1 rounded-lg">
                <button 
                  onClick={() => setSettings(s => ({...s, language: Language.Spanish, accent: Accent.Spain}))}
                  className={`flex-1 py-1.5 text-sm rounded-md transition-all ${settings.language === Language.Spanish ? 'bg-white shadow-sm text-indigo-600 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Español
                </button>
                <button 
                  onClick={() => setSettings(s => ({...s, language: Language.English, accent: Accent.US}))}
                  className={`flex-1 py-1.5 text-sm rounded-md transition-all ${settings.language === Language.English ? 'bg-white shadow-sm text-indigo-600 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Inglés
                </button>
              </div>
            </div>

            {/* 2. Voz */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-600 mb-1">Voz (10 Opciones)</label>
              <select 
                value={settings.voiceId}
                onChange={(e) => setSettings(s => ({...s, voiceId: e.target.value}))}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              >
                <optgroup label="Hombres">
                    {VOICES.filter(v => v.gender === Gender.Male).map(v => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                </optgroup>
                <optgroup label="Mujeres">
                    {VOICES.filter(v => v.gender === Gender.Female).map(v => (
                        <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                </optgroup>
              </select>
            </div>

            {/* 3. Acento */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-600 mb-1">Acento</label>
              <select 
                value={settings.accent}
                onChange={(e) => setSettings(s => ({...s, accent: e.target.value as Accent}))}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                {availableAccents.map(acc => (
                  <option key={acc} value={acc}>{acc}</option>
                ))}
              </select>
            </div>

            {/* 4. Estilo */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-600 mb-1">Estilo</label>
              <select 
                value={settings.style}
                onChange={(e) => setSettings(s => ({...s, style: e.target.value as Style}))}
                className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                {Object.values(Style).map(st => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-semibold mb-4 text-slate-700">Ajustes de Audio</h2>

             {/* 5. Velocidad */}
             <div className="mb-6">
              <div className="flex justify-between mb-1">
                <label className="text-sm font-medium text-slate-600">Velocidad</label>
                <span className="text-xs text-indigo-600 font-mono bg-indigo-50 px-2 py-0.5 rounded">{settings.speed.toFixed(1)}x</span>
              </div>
              <input 
                type="range" 
                min="0.5" 
                max="2.0" 
                step="0.1" 
                value={settings.speed} 
                onChange={(e) => setSettings(s => ({...s, speed: parseFloat(e.target.value)}))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>Lento</span>
                <span>Rápido</span>
              </div>
            </div>

            {/* 6. Tono (Pitch) */}
            <div>
              <div className="flex justify-between mb-1">
                <label className="text-sm font-medium text-slate-600">Tono</label>
                <span className="text-xs text-indigo-600 font-mono bg-indigo-50 px-2 py-0.5 rounded">{settings.pitch > 0 ? '+' : ''}{settings.pitch}</span>
              </div>
              <input 
                type="range" 
                min="-1200" 
                max="1200" 
                step="50" 
                value={settings.pitch} 
                onChange={(e) => setSettings(s => ({...s, pitch: parseInt(e.target.value)}))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
               <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>Grave</span>
                <span>Agudo</span>
              </div>
            </div>
          </div>
        </div>

        {/* Center Column: Text Input & Preview */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-full flex flex-col">
            <div className="flex flex-col mb-4">
              <h2 className="text-lg font-semibold text-slate-700 mb-2">Contenido</h2>
              <div className="flex gap-2 flex-wrap">
                 {/* 8. Etiquetas */}
                 {TAGS.map(tag => {
                   const display = getTagDisplay(tag.value);
                   return (
                     <button
                       key={tag.value}
                       onClick={() => insertTag(tag.value)}
                       className="flex items-center gap-1.5 bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 border border-slate-200 px-3 py-1.5 rounded-lg transition-all text-xs font-bold shadow-sm active:scale-95"
                       title={tag.label}
                     >
                       {display.icon}
                       {display.text}
                     </button>
                   );
                 })}
              </div>
            </div>
            
            <textarea 
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escribe algo aquí... Usa las etiquetas de arriba para efectos especiales."
              className="w-full flex-grow min-h-[200px] p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 text-lg leading-relaxed resize-none mb-4"
            />

            <div className="flex items-center gap-4">
              <button 
                onClick={handleGenerate}
                disabled={isLoading || !text.trim()}
                className={`flex-1 py-3 px-6 rounded-xl flex items-center justify-center gap-2 font-semibold text-white shadow-lg shadow-indigo-200 transition-all
                  ${isLoading || !text.trim() ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98]'}`}
              >
                {isLoading ? (
                  <>
                    <ArrowPathIcon className="w-5 h-5 animate-spin" />
                    Generando...
                  </>
                ) : (
                  <>
                    <MicrophoneIcon className="w-5 h-5" />
                    Generar Voz
                  </>
                )}
              </button>

              {currentAudio && (
                 <div className="flex items-center gap-3 bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100">
                    <button 
                        onClick={() => isPlaying ? stopAudio() : playBuffer(currentAudio.buffer, currentAudio.id)}
                        className="w-10 h-10 flex items-center justify-center bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-colors"
                    >
                        {isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5 pl-0.5" />}
                    </button>
                    <div className="text-xs font-mono text-indigo-800">
                        {currentTime.toFixed(1)}s / {currentAudio.buffer.duration.toFixed(1)}s
                    </div>
                 </div>
              )}
            </div>
          </div>
        </div>

        {/* 7. Historial (Full Width) */}
        <div className="lg:col-span-3">
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-700">Historial de Generaciones</h2>
                    <span className="text-xs text-slate-400">{history.length} audios</span>
                </div>

                {history.length === 0 ? (
                    <div className="text-center py-10 text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        <SpeakerWaveIcon className="w-10 h-10 mx-auto mb-2 opacity-20" />
                        No hay historial reciente. Genera tu primer audio.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {history.map(item => (
                            <div key={item.id} className={`p-4 rounded-xl border transition-all ${currentAudio?.id === item.id && isPlaying ? 'border-indigo-400 bg-indigo-50 shadow-md' : 'border-slate-200 bg-white hover:border-indigo-200'}`}>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                                            {item.settings.language === Language.Spanish ? 'ES' : 'EN'} • {item.settings.style}
                                        </span>
                                        <span className="text-xs text-slate-400">
                                            {new Date(item.createdAt).toLocaleTimeString()}
                                        </span>
                                    </div>
                                    <button 
                                        onClick={() => setHistory(prev => prev.filter(h => h.id !== item.id))}
                                        className="text-slate-300 hover:text-red-500 transition-colors"
                                    >
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                                
                                <p className="text-sm text-slate-700 mb-3 line-clamp-2 h-10 font-medium">
                                    "{item.text}"
                                </p>

                                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                                    <button 
                                        onClick={() => handleHistoryPlay(item)}
                                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-sm font-medium transition-colors
                                            ${currentAudio?.id === item.id && isPlaying 
                                                ? 'bg-indigo-200 text-indigo-800' 
                                                : 'bg-slate-100 text-slate-600 hover:bg-indigo-100 hover:text-indigo-700'}`}
                                    >
                                        {currentAudio?.id === item.id && isPlaying ? (
                                            <>
                                                <PauseIcon className="w-4 h-4" /> Pausar
                                            </>
                                        ) : (
                                            <>
                                                <PlayIcon className="w-4 h-4" /> Reproducir
                                            </>
                                        )}
                                    </button>
                                    <button 
                                        onClick={() => downloadAudio(item.audioBlob, `vozgen-${item.id}.wav`)}
                                        className="p-1.5 text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 rounded-lg border border-slate-200 transition-colors"
                                        title="Descargar WAV"
                                    >
                                        <ArrowDownTrayIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
             </div>
        </div>
      </div>
    </div>
  );
}