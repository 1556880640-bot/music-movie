import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import { GeneratedImage, LyricSegment, AspectRatio } from '../types';

interface CanvasPlayerProps {
  currentTime: number;
  lyrics: LyricSegment[];
  images: GeneratedImage[];
  aspectRatio: AspectRatio;
  title: string; // Add title prop
  width?: number;
  height?: number;
}

export interface CanvasPlayerRef {
  getCanvas: () => HTMLCanvasElement | null;
}

const CanvasPlayer = forwardRef<CanvasPlayerRef, CanvasPlayerProps>(({ 
  currentTime, 
  lyrics, 
  images, 
  aspectRatio,
  title
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Expose canvas to parent for recording
  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current
  }));

  // Wait for fonts
  useEffect(() => {
    document.fonts.ready.then(() => setFontsLoaded(true));
  }, []);

  // Preload Images
  useEffect(() => {
    images.forEach(img => {
      if (!imageCache.current.has(img.imageUrl)) {
        const image = new Image();
        image.src = img.imageUrl;
        imageCache.current.set(img.imageUrl, image);
      }
    });
  }, [images]);

  // Determine Resolution
  const isPortrait = aspectRatio === AspectRatio.Portrait;
  const canvasWidth = isPortrait ? 1080 : 1920;
  const canvasHeight = isPortrait ? 1920 : 1080;

  // Helper to wrap text
  const getWrappedLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
    const words = text.split(''); // Split by char for CJK mixed support
    const lines = [];
    let currentLine = words[0] || '';

    // Quick check if whole text fits
    if (ctx.measureText(text).width <= maxWidth) {
        return [text];
    }

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

    const ctx = canvas.getContext('2d', { alpha: false }); // Optimization
    if (!ctx) return;

    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;

    // --- 1. Draw Background (Visuals) ---
    // Find active image
    let activeImgData = images[0];
    
    // Simple logic: Find the last image that started before currentTime
    for (let i = 0; i < images.length; i++) {
      if (currentTime >= images[i].timeIndex) {
        activeImgData = images[i];
      } else {
        break;
      }
    }

    if (activeImgData) {
        const img = imageCache.current.get(activeImgData.imageUrl);
        if (img && img.complete) {
            // Ken Burns Effect Calculation
            // Calculate time elapsed for this image
            const timeElapsed = currentTime - activeImgData.timeIndex;
            const duration = 10; // Assume 10s effect duration or until next image
            const progress = Math.min(timeElapsed / duration, 1);
            
            // Scale goes from 1.0 to 1.1
            const scale = 1.0 + (progress * 0.1); 
            
            // Draw
            ctx.save();
            // Center pivot
            ctx.translate(cx, cy);
            ctx.scale(scale, scale);
            ctx.translate(-cx, -cy);
            
            // Cover fit
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

            ctx.globalAlpha = 1;
            ctx.drawImage(img, offsetX, offsetY, renderW, renderH);
            ctx.restore();
        }
    } else {
        // Black BG fallback
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    // --- 2. Overlay (Dim) ---
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // --- 3. Logic: Intro Title vs Lyrics ---
    const firstLyricTime = lyrics.length > 0 ? lyrics[0].startTime : 0;
    
    // Check if we are in the intro phase (before first lyric)
    // We add a 0.5s buffer so the title fades out just as lyrics start
    const isIntro = lyrics.length > 0 && currentTime < (firstLyricTime - 0.5);

    if (isIntro) {
        // --- Draw Title (Intro Mode) ---
        ctx.save();
        
        // Font Settings for Title
        const titleSize = isPortrait ? 100 : 160;
        ctx.font = `900 ${titleSize}px "Noto Sans SC", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Fade in/out logic
        // Fade in first 1s, Fade out last 1s of intro
        let alpha = 1;
        if (currentTime < 1) alpha = currentTime; 
        else if (currentTime > (firstLyricTime - 1.5)) {
            alpha = Math.max(0, (firstLyricTime - 0.5) - currentTime);
        }

        ctx.globalAlpha = alpha;

        // Subtle Pulse Scale
        const pulse = 1 + Math.sin(currentTime * 2) * 0.02;
        ctx.translate(cx, cy);
        ctx.scale(pulse, pulse);
        ctx.translate(-cx, -cy);

        // Glow
        ctx.shadowColor = '#a855f7'; // Purple glow
        
        // Wrapping Title
        const maxWidth = canvasWidth * 0.85;
        const lines = getWrappedLines(ctx, title, maxWidth);
        
        const lineHeight = titleSize * 1.2;
        const totalHeight = lines.length * lineHeight;
        const startY = cy - (totalHeight / 2) + (lineHeight / 2);

        // Gradient Fill
        const gradient = ctx.createLinearGradient(cx - maxWidth/2, cy, cx + maxWidth/2, cy);
        gradient.addColorStop(0, '#f472b6'); // Pink
        gradient.addColorStop(1, '#c084fc'); // Purple
        ctx.fillStyle = gradient;
        
        lines.forEach((line, i) => {
            const y = startY + (i * lineHeight);
            ctx.shadowBlur = 40;
            ctx.fillText(line, cx, y);
            
            ctx.shadowBlur = 0; // Stroke usually doesn't need shadow here or it gets too muddy
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'white';
            ctx.strokeText(line, cx, y);
        });

        // Optional "Music Video" subtitle
        const subtitleY = startY + (lines.length * lineHeight) - (lineHeight/2) + titleSize/2 + 20;

        ctx.shadowBlur = 0;
        ctx.font = `700 ${isPortrait ? 40 : 60}px "Noto Sans SC", sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText("MUSIC VIDEO", cx, subtitleY);

        ctx.restore();

    } else {
        // --- Draw Lyrics (Standard Mode) ---
        const activeLyric = lyrics.find(seg => currentTime >= seg.startTime && currentTime < seg.endTime);
        
        if (activeLyric) {
            const text = activeLyric.text;
            
            // Font Settings
            const fontSize = isPortrait ? 80 : 120;
            ctx.font = `900 ${fontSize}px "Noto Sans SC", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Wrapping Logic
            const maxWidth = canvasWidth * 0.85; // Leave 15% margin
            const lines = getWrappedLines(ctx, text, maxWidth);

            const lineHeight = fontSize * 1.25;
            const totalHeight = lines.length * lineHeight;
            const startY = cy - (totalHeight / 2) + (lineHeight / 2);

            // Entry Animation (Fade in + slight slide up)
            const lyricElapsed = currentTime - activeLyric.startTime;
            const entryDuration = 0.5;
            let alpha = 1;
            let yOffset = 0;

            if (lyricElapsed < entryDuration) {
                const ease = 1 - Math.pow(1 - (lyricElapsed / entryDuration), 3); // Cubic ease out
                alpha = ease;
                yOffset = 20 * (1 - ease);
            }

            ctx.save();
            ctx.globalAlpha = alpha;

            // --- Glow Effect (Neon) ---
            ctx.shadowColor = '#e60073'; // Pinkish glow

            // --- Gradient Text ---
            // Gradient across the probable width
            const gradient = ctx.createLinearGradient(cx - (maxWidth/2), cy, cx + (maxWidth/2), cy);
            gradient.addColorStop(0, '#67e8f9'); // Cyan
            gradient.addColorStop(0.5, '#ffffff'); // White
            gradient.addColorStop(1, '#d8b4fe'); // Purple

            ctx.fillStyle = gradient;
            
            // Draw Text Lines
            lines.forEach((l, i) => {
                const yPos = startY + (i * lineHeight) + yOffset;
                
                // Fill
                ctx.shadowBlur = 30;
                ctx.fillText(l, cx, yPos);
                
                // Redraw specifically to boost glow (canvas text shadow can be weak)
                ctx.shadowBlur = 50;
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeText(l, cx, yPos); 
            });

            ctx.restore();
        }
    }

  }, [currentTime, lyrics, images, canvasWidth, canvasHeight, fontsLoaded, title]);

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