import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import { GeneratedVisual, LyricSegment, AspectRatio, VisualType, AnimationType } from '../types';

interface CanvasPlayerProps {
  currentTime: number;
  lyrics: LyricSegment[];
  images: GeneratedVisual[];
  aspectRatio: AspectRatio;
  title: string;
  animationType: AnimationType;
}

export interface CanvasPlayerRef {
  getCanvas: () => HTMLCanvasElement | null;
}

const CanvasPlayer = forwardRef<CanvasPlayerRef, CanvasPlayerProps>(({ 
  currentTime, 
  lyrics, 
  images, 
  aspectRatio,
  title,
  animationType
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Caches
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const videoCache = useRef<Map<string, HTMLVideoElement>>(new Map());
  
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Expose canvas to parent
  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current
  }));

  // Wait for fonts
  useEffect(() => {
    document.fonts.ready.then(() => setFontsLoaded(true));
  }, []);

  // Preload Visuals
  useEffect(() => {
    images.forEach(vis => {
      if (vis.type === VisualType.Image) {
        if (!imageCache.current.has(vis.mediaUrl)) {
          const image = new Image();
          image.src = vis.mediaUrl;
          imageCache.current.set(vis.mediaUrl, image);
        }
      } else if (vis.type === VisualType.Video) {
        if (!videoCache.current.has(vis.mediaUrl)) {
           const vid = document.createElement('video');
           vid.src = vis.mediaUrl;
           vid.muted = true; // Must be muted to autoplay/play via script
           vid.loop = true;
           vid.playsInline = true;
           vid.preload = "auto";
           vid.load();
           videoCache.current.set(vis.mediaUrl, vid);
        }
      }
    });
  }, [images]);

  // Determine Resolution
  const isPortrait = aspectRatio === AspectRatio.Portrait;
  const canvasWidth = isPortrait ? 1080 : 1920;
  const canvasHeight = isPortrait ? 1920 : 1080;

  // Helper to wrap text
  const getWrappedLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
    const words = text.split(''); 
    const lines = [];
    let currentLine = words[0] || '';

    if (ctx.measureText(text).width <= maxWidth) return [text];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + word).width;
        if (width < maxWidth) {
            currentLine += word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
  };

  // Main Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fontsLoaded) return;

    const ctx = canvas.getContext('2d', { alpha: false }); 
    if (!ctx) return;

    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;

    // --- 1. Identify Active Visual ---
    let activeVisual = images[0];
    for (let i = 0; i < images.length; i++) {
      if (currentTime >= images[i].timeIndex) {
        activeVisual = images[i];
      } else {
        break;
      }
    }

    // --- 2. Draw Visual ---
    if (activeVisual) {
        if (activeVisual.type === VisualType.Image) {
             const img = imageCache.current.get(activeVisual.mediaUrl);
             // Pause all videos to save resources
             videoCache.current.forEach(v => v.pause());

             if (img && img.complete) {
                // Ken Burns
                const timeElapsed = currentTime - activeVisual.timeIndex;
                const progress = Math.min(timeElapsed / 10, 1);
                const scale = 1.0 + (progress * 0.1); 
                
                ctx.save();
                ctx.translate(cx, cy);
                ctx.scale(scale, scale);
                ctx.translate(-cx, -cy);
                
                // Cover fit logic
                const imgRatio = img.width / img.height;
                const canvasRatio = canvasWidth / canvasHeight;
                let renderW, renderH, offsetX, offsetY;
                if (imgRatio > canvasRatio) {
                    renderH = canvasHeight;
                    renderW = img.width * (canvasHeight / img.height);
                    offsetX = (canvasWidth - renderW) / 2;
                    offsetY = 0;
                } else {
                    renderW = canvasWidth;
                    renderH = img.height * (canvasWidth / img.width);
                    offsetX = 0;
                    offsetY = (canvasHeight - renderH) / 2;
                }
                ctx.drawImage(img, offsetX, offsetY, renderW, renderH);
                ctx.restore();
             } else {
                 ctx.fillStyle = '#000';
                 ctx.fillRect(0, 0, canvasWidth, canvasHeight);
             }
        } 
        else if (activeVisual.type === VisualType.Video) {
            const vid = videoCache.current.get(activeVisual.mediaUrl);
            
            videoCache.current.forEach((v, k) => {
                if (k === activeVisual.mediaUrl) {
                    if (v.paused) v.play().catch(e => console.warn(e));
                } else {
                    if (!v.paused) v.pause();
                }
            });

            if (vid && vid.readyState >= 2) {
                ctx.save();
                const vidRatio = vid.videoWidth / vid.videoHeight;
                const canvasRatio = canvasWidth / canvasHeight;
                let renderW, renderH, offsetX, offsetY;
                
                if (vidRatio > canvasRatio) {
                     renderH = canvasHeight;
                     renderW = vid.videoWidth * (canvasHeight / vid.videoHeight);
                     offsetX = (canvasWidth - renderW) / 2;
                     offsetY = 0;
                } else {
                     renderW = canvasWidth;
                     renderH = vid.videoHeight * (canvasWidth / vid.videoWidth);
                     offsetX = 0;
                     offsetY = (canvasHeight - renderH) / 2;
                }
                ctx.drawImage(vid, offsetX, offsetY, renderW, renderH);
                ctx.restore();
            } else {
                ctx.fillStyle = '#111';
                ctx.fillRect(0,0, canvasWidth, canvasHeight);
            }
        }
    } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    // --- 3. Overlay ---
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // --- 4. Render Text (Title or Lyrics) ---
    const firstLyricTime = lyrics.length > 0 ? lyrics[0].startTime : 0;
    const isIntro = lyrics.length > 0 && currentTime < (firstLyricTime - 0.5);

    if (isIntro) {
        ctx.save();
        const titleSize = isPortrait ? 100 : 160;
        ctx.font = `900 ${titleSize}px "Noto Sans SC", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let alpha = 1;
        if (currentTime < 1) alpha = currentTime; 
        else if (currentTime > (firstLyricTime - 1.5)) alpha = Math.max(0, (firstLyricTime - 0.5) - currentTime);
        ctx.globalAlpha = alpha;
        
        const maxWidth = canvasWidth * 0.85;
        const lines = getWrappedLines(ctx, title, maxWidth);
        const lineHeight = titleSize * 1.2;
        const startY = cy - (lines.length * lineHeight / 2) + (lineHeight / 2);

        const gradient = ctx.createLinearGradient(cx - maxWidth/2, cy, cx + maxWidth/2, cy);
        gradient.addColorStop(0, '#f472b6'); 
        gradient.addColorStop(1, '#c084fc'); 
        ctx.fillStyle = gradient;
        
        lines.forEach((line, i) => {
             ctx.fillText(line, cx, startY + i * lineHeight);
             ctx.lineWidth = 3;
             ctx.strokeStyle = 'white';
             ctx.strokeText(line, cx, startY + i * lineHeight);
        });
        ctx.restore();
    } else {
        // --- LYRICS RENDERING ---
        const activeLyric = lyrics.find(seg => currentTime >= seg.startTime && currentTime < seg.endTime);
        
        if (activeLyric) {
            const text = activeLyric.text;
            const fontSize = isPortrait ? 80 : 120;
            ctx.font = `900 ${fontSize}px "Noto Sans SC", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const maxWidth = canvasWidth * 0.85;
            const lines = getWrappedLines(ctx, text, maxWidth);
            const lineHeight = fontSize * 1.25;
            const totalHeight = lines.length * lineHeight;
            const startY = cy - (totalHeight / 2) + (lineHeight / 2);
            
            const lyricDuration = activeLyric.endTime - activeLyric.startTime;
            const elapsed = currentTime - activeLyric.startTime;
            const progress = Math.min(elapsed / lyricDuration, 1);

            ctx.save();
            
            // --- NEW RHYTHMIC ANIMATIONS ---

            if (animationType === AnimationType.Standard) {
                 // Standard Fade In
                 let alpha = Math.min(elapsed * 2, 1);
                 let yOff = (1 - alpha) * 20;
                 ctx.globalAlpha = alpha;
                 ctx.fillStyle = 'white';
                 ctx.shadowColor = 'rgba(0,0,0,0.8)';
                 ctx.shadowBlur = 10;
                 lines.forEach((l, i) => {
                     ctx.fillText(l, cx, startY + (i * lineHeight) + yOff);
                 });
            } 
            else if (animationType === AnimationType.Snap) {
                 // Snap: Hard Impact Scale (Good for Beat Drops)
                 // Drops from scale 4.0 to 1.0 very quickly (0.2s)
                 const entryDur = 0.25;
                 let scale = 1;
                 if (elapsed < entryDur) {
                    const t = elapsed / entryDur;
                    // Ease out quint
                    scale = 1 + (3 * Math.pow(1 - t, 3));
                 }
                 
                 ctx.translate(cx, cy);
                 ctx.scale(scale, scale);
                 ctx.translate(-cx, -cy);
                 
                 // Gradient Style
                 const gradient = ctx.createLinearGradient(cx - maxWidth/2, cy, cx + maxWidth/2, cy);
                 gradient.addColorStop(0, '#fff');
                 gradient.addColorStop(1, '#ffdd00');
                 ctx.fillStyle = gradient;
                 ctx.shadowColor = 'black';
                 ctx.shadowBlur = 20;
                 ctx.shadowOffsetX = 4;
                 ctx.shadowOffsetY = 4;

                 lines.forEach((l, i) => {
                     ctx.fillText(l, cx, startY + i * lineHeight);
                 });
            }
            else if (animationType === AnimationType.Karaoke) {
                 // Karaoke: Stroke first, then Fill based on progress
                 lines.forEach((l, i) => {
                    const yPos = startY + i * lineHeight;
                    
                    // 1. Draw Background (Stroke/Hollow)
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                    ctx.lineWidth = 4;
                    ctx.strokeText(l, cx, yPos);

                    // 2. Draw Fill (Clipped)
                    ctx.save();
                    // Clip rect moves from left to right based on progress
                    const textWidth = ctx.measureText(l).width;
                    const leftX = cx - (textWidth / 2);
                    
                    // Slightly inaccurate per-line sync (block sync), but feels good visually
                    const fillWidth = textWidth * Math.min(progress * 1.2, 1); // Speed up slightly to finish early
                    
                    ctx.beginPath();
                    ctx.rect(leftX, yPos - lineHeight/2, fillWidth, lineHeight);
                    ctx.clip();
                    
                    ctx.fillStyle = '#67e8f9'; // Cyan fill
                    ctx.shadowColor = '#67e8f9';
                    ctx.shadowBlur = 15;
                    ctx.fillText(l, cx, yPos);
                    ctx.restore();
                 });
            }
            else if (animationType === AnimationType.Signal) {
                 // Signal: Sine Wave Motion
                 ctx.fillStyle = 'white';
                 ctx.shadowColor = '#d8b4fe'; // Purple glow
                 ctx.shadowBlur = 10;
                 
                 lines.forEach((l, i) => {
                     const words = l.split('');
                     let totalW = ctx.measureText(l).width;
                     let currX = cx - totalW / 2;
                     
                     words.forEach((char, idx) => {
                         const charW = ctx.measureText(char).width;
                         // Wave calc
                         const waveSpeed = 8;
                         const waveFreq = 0.5;
                         const amp = 15;
                         const yOffset = Math.sin((currentTime * waveSpeed) + (idx * waveFreq)) * amp;
                         
                         ctx.fillText(char, currX + charW/2, startY + i * lineHeight + yOffset);
                         currX += charW;
                     });
                 });
            }
            else if (animationType === AnimationType.Glitch) {
                // Glitch: Random offsets and color separation
                const isGlitchFrame = Math.random() > 0.8; // Flicker
                const offsetX = isGlitchFrame ? (Math.random() - 0.5) * 10 : 0;
                const offsetY = isGlitchFrame ? (Math.random() - 0.5) * 5 : 0;
                
                // RGB Split
                // Red Channel
                ctx.save();
                ctx.fillStyle = 'rgba(255,0,0,0.7)';
                ctx.translate(offsetX + 4, offsetY);
                lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
                ctx.restore();
                
                // Blue Channel
                ctx.save();
                ctx.fillStyle = 'rgba(0,255,255,0.7)';
                ctx.translate(-offsetX - 4, -offsetY);
                lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
                ctx.restore();
                
                // Main White
                ctx.fillStyle = 'white';
                lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
            }

            ctx.restore();
        }
    }

  }, [currentTime, lyrics, images, canvasWidth, canvasHeight, fontsLoaded, title, animationType]);

  return (
    <canvas 
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        className="w-full h-full object-contain bg-black shadow-2xl"
    />
  );
});

export default CanvasPlayer;