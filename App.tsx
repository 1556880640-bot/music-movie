import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, AspectRatio, MVData } from './types';
import { analyzeAudio, generateMVImages, fileToBase64 } from './services/geminiService';
import CanvasPlayer, { CanvasPlayerRef } from './components/CanvasPlayer';

const App: React.FC = () => {
  // State
  const [status, setStatus] = useState<AppStatus>(AppStatus.Idle);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(AspectRatio.Landscape);
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
      if (customLyrics) {
        setStatusMsg("正在使用 Gemini 将你的歌词与音频对齐...");
      } else {
        setStatusMsg("正在使用 Gemini 聆听并分析歌词情感...");
      }
      
      const lyrics = await analyzeAudio(base64Audio, file.type || 'audio/mp3', customLyrics);
      
      // Step 2: Visuals
      setStatus(AppStatus.GeneratingVisuals);
      setStatusMsg("正在构思画面..."); 
      
      const images = await generateMVImages(lyrics, aspectRatio, (msg) => setStatusMsg(msg));

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
    if (audioRef.current) {
      audioRef.current.pause();
    }
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
    
    // Resume AudioContext if suspended (browser policy)
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
    if (!canvasEl) {
        alert("Canvas not found");
        return;
    }

    try {
        // 1. Prepare Audio Context & Source for Recording
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        const ctx = audioCtxRef.current;
        
        if (!sourceNodeRef.current) {
             sourceNodeRef.current = ctx.createMediaElementSource(audioRef.current);
             mediaStreamDestRef.current = ctx.createMediaStreamDestination();
             
             // Connect: Source -> Destination (for recorder)
             sourceNodeRef.current.connect(mediaStreamDestRef.current);
             // Connect: Source -> Output (so user can still hear it)
             sourceNodeRef.current.connect(ctx.destination);
        }

        // 2. Get Streams
        // Capture Canvas Video Stream (30fps)
        const canvasStream = canvasEl.captureStream(30);
        // Get Audio Stream
        const audioStream = mediaStreamDestRef.current!.stream;
        
        // 3. Combine Tracks
        const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioStream.getAudioTracks()
        ]);

        // 4. Setup Recorder
        // Prefer VP9 for better quality, fallback to defaults
        let options = { mimeType: 'video/webm;codecs=vp9' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = { mimeType: 'video/webm' };
        }

        const mediaRecorder = new MediaRecorder(combinedStream, options);
        const chunks: Blob[] = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

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
            
            // Allow user controls again
            if (audioRef.current) audioRef.current.controls = false;
        };

        // 5. Start Process
        setIsRecording(true);
        setIsPlaying(true);
        
        // Reset to beginning
        audioRef.current.currentTime = 0;
        setCurrentTime(0);
        
        // Wait a tiny bit for seek to complete
        setTimeout(async () => {
            if (ctx.state === 'suspended') await ctx.resume();
            mediaRecorder.start();
            audioRef.current?.play();
        }, 100);

        // 6. Stop when audio ends
        const handleEnded = () => {
            if (mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
            setIsPlaying(false);
            audioRef.current?.removeEventListener('ended', handleEnded);
        };
        audioRef.current.addEventListener('ended', handleEnded);

    } catch (err: any) {
        console.error("Recording failed", err);
        setIsRecording(false);
        alert("录制启动失败: " + err.message);
    }
  };

  // UI Components
  const renderIdle = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center space-y-8 animate-float">
      <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 tracking-tighter">
        AI 灵感 MV
      </h1>
      <p className="text-gray-400 max-w-md">
        上传你的音乐 (MP3/WAV)，Gemini 将自动为你生成匹配意境的动态歌词 MV。
        <br/><span className="text-xs text-gray-500 mt-2 block">支持长达 5 分钟的完整歌曲</span>
      </p>

      {/* Config Panel */}
      <div className="flex flex-col space-y-4 w-full max-w-md bg-gray-900/80 p-6 rounded-2xl border border-gray-800 backdrop-blur-sm">
         
         {/* Aspect Ratio */}
         <div className="flex flex-col space-y-2">
            <label className="text-xs text-gray-500 uppercase font-bold tracking-wider text-left">画面比例</label>
            <div className="flex space-x-2">
                <button 
                onClick={() => setAspectRatio(AspectRatio.Landscape)}
                className={`flex-1 py-2 rounded transition-all font-medium ${aspectRatio === AspectRatio.Landscape ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}
                >
                16:9 横屏
                </button>
                <button 
                onClick={() => setAspectRatio(AspectRatio.Portrait)}
                className={`flex-1 py-2 rounded transition-all font-medium ${aspectRatio === AspectRatio.Portrait ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/50' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}`}
                >
                9:16 竖屏
                </button>
            </div>
         </div>

         {/* Lyrics Upload */}
         <div className="flex flex-col space-y-2">
            <label className="text-xs text-gray-500 uppercase font-bold tracking-wider text-left flex justify-between">
                <span>歌词 (可选)</span>
                {customLyrics && <span className="text-green-400">已加载: {lyricsFileName || '粘贴的文本'}</span>}
            </label>
            
            <div className="flex space-x-2">
                <button 
                    onClick={() => lyricsInputRef.current?.click()}
                    className={`flex-1 py-2 rounded border border-dashed border-gray-600 text-sm transition-colors hover:border-purple-500 hover:text-purple-400 ${customLyrics ? 'bg-gray-800 text-green-400 border-green-800' : 'text-gray-400'}`}
                >
                    {customLyrics ? '重新上传歌词文件' : '上传歌词文件 (.txt/.lrc)'}
                </button>
                <input 
                    type="file" 
                    ref={lyricsInputRef} 
                    onChange={handleLyricsUpload} 
                    accept=".txt,.lrc" 
                    className="hidden" 
                />
            </div>
            
            <textarea 
                placeholder="或者直接在这里粘贴歌词..." 
                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500 h-20 resize-none"
                value={customLyrics}
                onChange={(e) => setCustomLyrics(e.target.value)}
            />
            <p className="text-[10px] text-gray-500 text-left">
                * 上传歌词可大幅提高字幕准确度，AI 将自动对齐时间轴。
            </p>
         </div>

      </div>

      {/* Main Action */}
      <div className="relative group w-full max-w-md">
        <div className="absolute -inset-1 bg-gradient-to-r from-pink-600 to-purple-600 rounded-xl blur opacity-30 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="relative w-full py-5 bg-black rounded-xl border border-gray-800 text-white font-bold text-lg hover:bg-gray-900 transition-all flex items-center justify-center space-x-3 shadow-2xl"
        >
          <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
          <span>上传音乐开始生成</span>
        </button>
      </div>
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        accept="audio/*" 
        className="hidden" 
      />
    </div>
  );

  const renderProcessing = () => (
    <div className="flex flex-col items-center justify-center h-screen space-y-6">
       <div className="relative w-24 h-24">
         <div className="absolute inset-0 border-4 border-gray-800 rounded-full"></div>
         <div className="absolute inset-0 border-4 border-purple-500 rounded-full border-t-transparent animate-spin"></div>
       </div>
       <div className="text-center space-y-2">
         <h3 className="text-2xl font-bold text-white">
            {status === AppStatus.AnalyzingAudio ? (customLyrics ? "正在对齐歌词..." : "AI 正在听歌...") : "AI 正在构思画面..."}
         </h3>
         <p className="text-gray-400 animate-pulse">{statusMsg}</p>
       </div>
    </div>
  );

  const renderPlayer = () => {
    if (!mvData) return null;
    
    // UI Classes
    const containerClass = aspectRatio === AspectRatio.Landscape 
         ? "aspect-video w-full max-w-6xl mx-auto shadow-2xl border border-gray-800 rounded-lg overflow-hidden relative bg-black"
         : "aspect-[9/16] h-[85vh] mx-auto shadow-2xl border border-gray-800 rounded-lg overflow-hidden relative bg-black";

    return (
      <div className={`flex flex-col items-center justify-center ${isRecording ? 'min-h-screen bg-black pointer-events-none cursor-wait' : 'min-h-screen w-full py-4 px-4'}`}>
        
        {isRecording && (
            <div className="fixed top-10 left-1/2 transform -translate-x-1/2 z-50 bg-red-600 px-6 py-2 rounded-full animate-pulse font-bold flex items-center space-x-2">
                <div className="w-3 h-3 bg-white rounded-full"></div>
                <span>正在录制并导出视频，请勿关闭窗口...</span>
            </div>
        )}

        <div className={containerClass}>
            {/* Unified Canvas Player */}
            <CanvasPlayer 
              ref={canvasRef}
              currentTime={currentTime} 
              lyrics={mvData.lyrics} 
              images={mvData.images}
              aspectRatio={aspectRatio}
              title={mvData.title}
            />

            {/* Controls Overlay (Hidden when recording) */}
            <div className={`absolute bottom-0 left-0 w-full bg-gradient-to-t from-black via-black/60 to-transparent p-6 transition-all duration-300 z-50 flex flex-col space-y-4 ${isRecording ? 'opacity-0' : 'opacity-0 hover:opacity-100'}`}>
               <input 
                 type="range" 
                 min={0} 
                 max={duration || 100} 
                 value={currentTime} 
                 onChange={handleTimeSeek}
                 className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-purple-500"
               />
               <div className="flex items-center justify-between">
                  <button onClick={togglePlay} className="text-white hover:text-purple-400 transition-colors">
                    {isPlaying ? (
                      <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                    ) : (
                      <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    )}
                  </button>
                  <span className="text-sm font-mono text-gray-300">
                    {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')} / 
                    {Math.floor(duration / 60)}:{Math.floor(duration % 60).toString().padStart(2, '0')}
                  </span>
               </div>
            </div>
        </div>

        {/* Outer Actions - Hidden during recording */}
        {!isRecording && (
        <div className="mt-6 flex space-x-6 items-center">
           <button onClick={handleRestart} className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-900 rounded transition-colors text-sm flex items-center space-x-2">
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
             <span>制作新的 MV</span>
           </button>
           
           <button 
             onClick={handleDirectDownload}
             className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded shadow-lg shadow-purple-900/50 transition-all text-sm font-bold flex items-center space-x-2"
           >
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
             <span>下载视频 (无水印)</span>
           </button>
        </div>
        )}

        {/* Hidden Audio Element with CORS safety for capture */}
        <audio 
          ref={audioRef} 
          src={mvData.audioUrl} 
          crossOrigin="anonymous"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onEnded={() => { if(!isRecording) setIsPlaying(false); }}
        />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-purple-500 selection:text-white font-sans">
      {status === AppStatus.Idle && renderIdle()}
      {(status === AppStatus.Uploading || status === AppStatus.AnalyzingAudio || status === AppStatus.GeneratingVisuals) && renderProcessing()}
      {status === AppStatus.Ready && renderPlayer()}
      {status === AppStatus.Error && (
        <div className="flex flex-col items-center justify-center h-screen space-y-6">
          <div className="text-red-500 text-6xl">⚠</div>
          <p className="text-2xl text-red-400 max-w-lg text-center">{statusMsg}</p>
          <button onClick={handleRestart} className="px-8 py-3 bg-gray-800 rounded-lg hover:bg-gray-700 font-bold transition-all">重试</button>
        </div>
      )}
    </div>
  );
};

export default App;