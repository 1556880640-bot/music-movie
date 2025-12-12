import React, { useState, useEffect } from 'react';
import { GeneratedImage, AspectRatio } from '../types';

interface VisualsDisplayProps {
  currentTime: number;
  images: GeneratedImage[];
  aspectRatio: AspectRatio;
}

const VisualsDisplay: React.FC<VisualsDisplayProps> = ({ currentTime, images, aspectRatio }) => {
  const [activeImage, setActiveImage] = useState<GeneratedImage | null>(null);

  useEffect(() => {
    if (images.length === 0) return;

    // Find the image that has the largest timeIndex <= currentTime
    // Essentially "find last valid image"
    let current = images[0];
    for (let i = 0; i < images.length; i++) {
      if (currentTime >= images[i].timeIndex) {
        current = images[i];
      } else {
        break; 
      }
    }
    setActiveImage(current);
  }, [currentTime, images]);

  // Ken Burns effect or simple fade
  return (
    <div className={`absolute inset-0 bg-black z-0 overflow-hidden`}>
      {/* Dark overlay for text readability */}
      <div className="absolute inset-0 bg-black/40 z-10" />
      
      {images.map((img) => (
        <div
          key={img.timeIndex}
          className={`absolute inset-0 transition-opacity duration-[2000ms] ease-in-out ${
            activeImage?.timeIndex === img.timeIndex ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <img
            src={img.imageUrl}
            alt={img.prompt}
            className={`w-full h-full object-cover transform transition-transform duration-[20000ms] ease-linear ${
                activeImage?.timeIndex === img.timeIndex ? 'scale-110' : 'scale-100'
            }`}
          />
        </div>
      ))}

      {/* Fallback if generating */}
      {images.length === 0 && (
         <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-white/20 animate-pulse text-6xl">♫</div>
         </div>
      )}
    </div>
  );
};

export default VisualsDisplay;
