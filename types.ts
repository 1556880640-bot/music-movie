export interface LyricSegment {
  startTime: number; // Seconds
  endTime: number;   // Seconds
  text: string;
  visualPrompt?: string; // Prompt for image generation for this segment
}

export enum AnimationType {
  Standard = 'standard',   // Soft Fade
  Snap = 'snap',           // Hard Impact Scale
  Karaoke = 'karaoke',     // Fill Color Progress
  Signal = 'signal',       // Sine Wave Motion
  Glitch = 'glitch',       // Cyberpunk jitter
}

export enum VisualType {
  Image = 'image',
  Video = 'video', // Uses Veo
}

export interface GeneratedVisual {
  timeIndex: number; 
  mediaUrl: string;
  prompt: string;
  type: VisualType;
}

export enum AspectRatio {
  Landscape = '16:9',
  Portrait = '9:16',
}

export enum AppStatus {
  Idle = 'idle',
  Uploading = 'uploading',
  AnalyzingAudio = 'analyzing_audio', 
  GeneratingVisuals = 'generating_visuals', 
  Ready = 'ready',
  Error = 'error',
}

export interface MVData {
  lyrics: LyricSegment[];
  images: GeneratedVisual[]; // Renamed in concept, but keeping var name consistent in App usually easier, but let's use the interface
  audioUrl: string;
  title: string;
}