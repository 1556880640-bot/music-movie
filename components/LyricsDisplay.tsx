import React, { useMemo } from 'react';
import { LyricSegment, AspectRatio } from '../types';

interface LyricsDisplayProps {
  currentTime: number;
  segments: LyricSegment[];
  aspectRatio: AspectRatio;
}

const LyricsDisplay: React.FC<LyricsDisplayProps> = ({ currentTime, segments, aspectRatio }) => {
  
  // Find the active segment
  const activeIndex = useMemo(() => {
    return segments.findIndex(seg => currentTime >= seg.startTime && currentTime < seg.endTime);
  }, [currentTime, segments]);

  const activeSegment = segments[activeIndex];
  // const nextSegment = segments[activeIndex + 1]; // Optional: Hide next segment to focus on center

  // If no lyrics found but song is playing
  if (!activeSegment && currentTime === 0) {
     return null;
  }

  // Adjust font size based on screen orientation
  const isPortrait = aspectRatio === AspectRatio.Portrait;
  const mainTextSize = isPortrait ? 'text-3xl' : 'text-6xl'; // Slightly larger for center impact

  return (
    <div className={`absolute inset-0 p-8 flex flex-col items-center justify-center text-center z-20 pointer-events-none transition-all duration-500`}>
      
      {/* Main Active Lyric - Centered */}
      <div className="relative flex items-center justify-center w-full max-w-4xl">
        {activeSegment ? (
            <div key={activeIndex} className="animate-lyric-entry">
                <h2 className={`${mainTextSize} font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-white to-purple-300 drop-shadow-[0_4px_4px_rgba(0,0,0,0.9)] neon-text leading-tight`}>
                  {activeSegment.text}
                </h2>
            </div>
        ) : (
             <span className="text-white/20 text-2xl tracking-[1em] uppercase animate-pulse">...</span>
        )}
      </div>
      
      <style>{`
        @keyframes lyricEntry {
          0% { opacity: 0; transform: scale(1.1) translateY(10px); filter: blur(8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
        }
        .animate-lyric-entry {
          animation: lyricEntry 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
      `}</style>
    </div>
  );
};

export default LyricsDisplay;