export interface LyricSegment {
  startTime: number; // Seconds
  endTime: number;   // Seconds
  text: string;
  visualPrompt?: string; // Prompt for image generation for this segment
}

export interface GeneratedImage {
  timeIndex: number; // Maps to a specific time or segment index
  imageUrl: string;
  prompt: string;
}

export enum AspectRatio {
  Landscape = '16:9',
  Portrait = '9:16',
}

export enum AppStatus {
  Idle = 'idle',
  Uploading = 'uploading',
  AnalyzingAudio = 'analyzing_audio', // Transcription
  GeneratingVisuals = 'generating_visuals', // Image Gen
  Ready = 'ready',
  Error = 'error',
}

export interface MVData {
  lyrics: LyricSegment[];
  images: GeneratedImage[];
  audioUrl: string;
  title: string;
}
