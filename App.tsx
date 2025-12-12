import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, AspectRatio, MVData, VisualType, AnimationType } from './types';
import { analyzeAudio, generateMVVisuals, fileToBase64 } from './services/geminiService';
import CanvasPlayer, { CanvasPlayerRef } from './components/CanvasPlayer';

const App: React.FC = () => {
  // State
  const [status, setStatus] = useState<AppStatus>(AppStatus.Idle);
  const [statusMsg, setStatusMsg] = useState<string>('');
  
  // Settings
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(AspectRatio.Landscape);
  const [visualType, setVisualType] = useState<VisualType>(VisualType.Image);
  const [animationType, setAnimationType] = useState<AnimationType>(AnimationType.Karaoke); // Default to Karaoke as it feels most synced
  
  const [mvData, setMvData] = useState<MVData | null>(null);
  const [customLyrics, setCustomLyrics] = useState<string>('');
  const [lyricsFileName, setLyricsFileName] = useState<string>('');
  
  // Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  
  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<CanvasPlayerRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lyricsInputRef = useRef<HTMLInputElement>(null);
  
  // Web Audio Context for Recording
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Audio Loop
  useEffect(() => {
    let rafId: number;
    const updateLoop = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
        if (!audioRef.current.paused) {
           rafId = requestAnimationFrame(updateLoop);
        }
      }
    };
    if (isPlaying) {
      rafId = requestAnimationFrame(updateLoop);
    }
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying]);

  const handleLyricsUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCustomLyrics(text);
    setLyricsFileName(file.name);
  };

  // Handle File Upload & Generation Process
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) { 
      alert("文件过大，请上传20MB以内的音频文件");
      return;
    }

    try {
      setStatus(AppStatus.Uploading);
      setStatusMsg("正在读取音频文件...");
      
      const audioUrl = URL.createObjectURL(file);
      const base64Audio = await fileToBase64(file);
      
      // Step 1: Analyze
      setStatus(AppStatus.AnalyzingAudio);
      setStatusMsg(customLyrics ? "Gemini 正在对齐歌词..." : "Gemini 正在聆听并分析歌词情感...");
      
      const lyrics = await analyzeAudio(base64Audio, file.type || 'audio/mp3', customLyrics);
      
      // Step 2: Visuals
      setStatus(AppStatus.GeneratingVisuals);
      setStatusMsg(visualType === VisualType.Video ? "正在启动 AI 视频生成模型 (这需要一些时间)..." : "AI 正在构思画面...");
      
      // Use generic visuals generator
      const images = await generateMVVisuals(lyrics, aspectRatio, visualType, (msg) => setStatusMsg(msg));

      setMvData({
        lyrics,
        images,
        audioUrl,
        title: file.name.replace(/\.[^/.]+$/, "")
      });
      
      setStatus(AppStatus.Ready);
      
    } catch (e: any) {
      console.error(e);
      setStatus(AppStatus.Error);
      setStatusMsg(`生成失败: ${e.message || "未知错误"}`);
    }
  };

  const handleRestart = () => {
    if (audioRef.current) audioRef.current.pause();
    
    // Reset Web Audio
    if (sourceNodeRef.current) {
        try { sourceNodeRef.current.disconnect(); } catch (e) { console.warn(e); }
        sourceNodeRef.current = null;
    }
    if (mediaStreamDestRef.current) mediaStreamDestRef.current = null;

    setMvData(null);
    setStatus(AppStatus.Idle);
    setIsPlaying(false);
    setCurrentTime(0);
    setCustomLyrics('');
    setLyricsFileName('');
    setIsRecording(false);
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    if (audioRef.current.paused) {
      audioRef.current.play();
      setIsPlaying(true);
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleTimeSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleDirectDownload = async () => {
    if (!mvData || !audioRef.current || !canvasRef.current) return;
    const canvasEl = canvasRef.current.getCanvas();
    if (!canvasEl) return;

    try {
        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        const ctx = audioCtxRef.current;
        
        if (!sourceNodeRef.current) {
             sourceNodeRef.current = ctx.createMediaElementSource(audioRef.current);
             mediaStreamDestRef.current = ctx.createMediaStreamDestination();
             sourceNodeRef.current.connect(mediaStreamDestRef.current);
             sourceNodeRef.current.connect(ctx.destination);
        }

        const canvasStream = canvasEl.captureStream(30);
        const audioStream = mediaStreamDestRef.current!.stream;
        const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioStream.getAudioTracks()]);

        let options = { mimeType: 'video/webm;codecs=vp9' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) options = { mimeType: 'video/webm' };

        const mediaRecorder = new MediaRecorder(combinedStream, options);
        const chunks: Blob[] = [];

        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${mvData.title}_AI_MV.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setIsRecording(false);
            if (audioRef.current) audioRef.current.controls = false;
        };

        setIsRecording(true);
        setIsPlaying(true);
        audioRef.current.currentTime = 0;
        setCurrentTime(0);
        
        setTimeout(async () => {
            if (ctx.state === 'suspended') await ctx.resume();
            mediaRecorder.start();
            audioRef.current?.play();
        }, 100);

        const handleEnded = () => {
            if (mediaRecorder.state === 'recording') mediaRecorder.stop();
            setIsPlaying(false);
            audioRef.current?.removeEventListener('ended', handleEnded);
        };
        audioRef.current.addEventListener('ended', handleEnded);

    } catch (err: any) {
        setIsRecording(false);
        alert("录制启动失败: " + err.message);
    }
  };

  // UI Sections
  const renderConfigPanel = () => (
    <div className="flex flex-col space-y-4 w-full max-w-md bg-gray-900/80 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm">
         
         {/* Aspect Ratio */}
         <div className="flex flex-col space-y-2">
            <label className="text-xs text-gray-500 uppercase font-bold tracking-wider text-left">画面比例</label>
            <div className="flex space-x-2">
                {[
                  { l: '16:9 横屏', v: AspectRatio.Landscape }, 
                  { l: '9:16 竖屏', v: AspectRatio.Portrait }
                ].map(opt => (
                  <button 
                    key={opt.v}
                    onClick={() => setAspectRatio(opt.v)}
                    className={`flex-1 py-2 rounded transition-all font-medium text-sm ${aspectRatio === opt.v ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                  >
                    {opt.l}
                  </button>
                ))}
            </div>
         </div>

         {/* Visual Type (Image vs Video) */}
         <div className="flex flex-col space-y-2">
            <label className="text-xs text-gray-500 uppercase font-bold tracking-wider text-left flex justify-between">
                <span>画面风格</span>
            </label>
            <div className="flex space-x-2">
                 <button 
                    onClick={() => setVisualType(VisualType.Image)}
                    className={`flex-1 py-2 rounded transition-all font-medium text-sm ${visualType === VisualType.Image ? 'bg-pink-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                  >
                    静态绘图 (快)
                  </button>
                  <button 
                    onClick={() => setVisualType(VisualType.Video)}
                    className={`flex-1 py-2 rounded transition-all font-medium text-sm ${visualType === VisualType.Video ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                  >
                    AI 视频 (Google Veo)
                  </button>
            </div>
            {visualType === VisualType.Video && (
                <p className="text-[10px] text-indigo-400 text-left">* 视频生成时间较长，系统将为关键节点生成短视频循环背景。</p>
            )}
         </div>

         {/* Animation Type */}
         <div className="flex flex-col space-y-2">
            <label className="text-xs text-gray-500 uppercase font-bold tracking-wider text-left">字幕动效 (同步感升级)</label>
            <select 
                value={animationType}
                onChange={(e) => setAnimationType(e.target.value as AnimationType)}
                className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg block p-2.5 focus:border-purple-500 focus:ring-purple-500"
            >
                <option value={AnimationType.Karaoke}>卡拉OK (逐字填色)</option>
                <option value={AnimationType.Snap}>冲击 (卡点缩放)</option>
                <option value={AnimationType.Signal}>信号 (声波律动)</option>
                <option value={AnimationType.Glitch}>故障 (赛博抖动)</option>
                <option value={AnimationType.Standard}>标准 (淡入)</option>
            </select>
         </div>

         {/* Lyrics Upload */}
         <div className="flex flex-col space-y-2 border-t border-gray-700 pt-4">
            <label className="text-xs text-gray-500 uppercase font-bold tracking-wider text-left flex justify-between">
                <span>歌词 (可选)</span>
                {customLyrics && <span className="text-green-400">已加载</span>}
            </label>
            <div className="flex space-x-2">
                <button 
                    onClick={() => lyricsInputRef.current?.click()}
                    className={`flex-1 py-2 rounded border border-dashed border-gray-600 text-xs ${customLyrics ? 'text-green-400 border-green-800' : 'text-gray-400'}`}
                >
                    {customLyrics ? lyricsFileName : '上传 .txt/.lrc'}
                </button>
                <input type="file" ref={lyricsInputRef} onChange={handleLyricsUpload} accept=".txt,.lrc" className="hidden" />
            </div>
         </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white selection:bg-purple-500 selection:text-white font-sans h-screen overflow-y-auto">
      {status === AppStatus.Idle && (
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center space-y-8 animate-float">
          <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 tracking-tighter">
            AI 灵感 MV
          </h1>
          <p className="text-gray-400 max-w-md">上传音乐，选择风格，生成专属 MV。</p>
          
          {renderConfigPanel()}

          <div className="relative group w-full max-w-md pb-12">
            <div className="absolute -inset-1 bg-gradient-to-r from-pink-600 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-100 transition duration-500"></div>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="relative w-full py-4 bg-black rounded-xl border border-gray-800 text-white font-bold text-lg hover:bg-gray-900 transition-all flex items-center justify-center space-x-3"
            >
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              <span>上传音乐并开始生成</span>
            </button>
          </div>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="audio/*" className="hidden" />
        </div>
      )}

      {(status === AppStatus.Uploading || status === AppStatus.AnalyzingAudio || status === AppStatus.GeneratingVisuals) && (
        <div className="flex flex-col items-center justify-center h-screen space-y-6">
           <div className="relative w-24 h-24">
             <div className="absolute inset-0 border-4 border-gray-800 rounded-full"></div>
             <div className="absolute inset-0 border-4 border-purple-500 rounded-full border-t-transparent animate-spin"></div>
           </div>
           <div className="text-center space-y-2">
             <h3 className="text-2xl font-bold text-white">正在创作中...</h3>
             <p className="text-gray-400 animate-pulse">{statusMsg}</p>
           </div>
        </div>
      )}

      {status === AppStatus.Ready && mvData && (
          <div className={`flex flex-col items-center justify-center ${isRecording ? 'min-h-screen bg-black pointer-events-none cursor-wait' : 'min-h-screen w-full py-4 px-4'}`}>
            {isRecording && (
                <div className="fixed top-10 z-50 bg-red-600 px-6 py-2 rounded-full animate-pulse font-bold">● 录制中...</div>
            )}
            
            <div className={aspectRatio === AspectRatio.Landscape 
                ? "aspect-video w-full max-w-6xl mx-auto shadow-2xl border border-gray-800 rounded-lg overflow-hidden relative bg-black"
                : "aspect-[9/16] h-[85vh] mx-auto shadow-2xl border border-gray-800 rounded-lg overflow-hidden relative bg-black"}>
                
                <CanvasPlayer 
                  ref={canvasRef}
                  currentTime={currentTime} 
                  lyrics={mvData.lyrics} 
                  images={mvData.images}
                  aspectRatio={aspectRatio}
                  title={mvData.title}
                  animationType={animationType}
                />

                <div className={`absolute bottom-0 left-0 w-full bg-gradient-to-t from-black via-black/60 to-transparent p-6 transition-all duration-300 z-50 flex flex-col space-y-4 ${isRecording ? 'opacity-0' : 'opacity-0 hover:opacity-100'}`}>
                   <input 
                     type="range" min={0} max={duration || 100} value={currentTime} onChange={handleTimeSeek}
                     className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
                   />
                   <div className="flex items-center justify-between">
                      <button onClick={togglePlay} className="text-white hover:text-purple-400">
                        {isPlaying ? "暂停" : "播放"}
                      </button>
                   </div>
                </div>
            </div>

            {!isRecording && (
            <div className="mt-6 flex space-x-6 items-center pb-12">
               <button onClick={handleRestart} className="px-4 py-2 text-gray-400 hover:text-white rounded">重新制作</button>
               <button onClick={handleDirectDownload} className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded shadow-lg">下载视频</button>
            </div>
            )}
            
            <audio 
              ref={audioRef} 
              src={mvData.audioUrl} 
              crossOrigin="anonymous"
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              onEnded={() => { if(!isRecording) setIsPlaying(false); }}
            />
          </div>
      )}

      {status === AppStatus.Error && (
        <div className="flex flex-col items-center justify-center h-screen space-y-6">
          <div className="text-red-500 text-6xl">⚠</div>
          <p className="text-2xl text-red-400 max-w-lg text-center">{statusMsg}</p>
          <button onClick={handleRestart} className="px-8 py-3 bg-gray-800 rounded-lg hover:bg-gray-700 font-bold">重试</button>
        </div>
      )}
    </div>
  );
};

export default App;