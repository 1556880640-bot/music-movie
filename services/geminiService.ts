import { GoogleGenAI, Type } from "@google/genai";
import { LyricSegment, GeneratedImage, AspectRatio } from "../types";

// Helper to encode file to Base64
export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data url prefix (e.g., "data:audio/mp3;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
};

const getAIClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing. Please ensure the environment is configured correctly.");
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Step 1: Analyze Audio to get Lyrics and Visual Prompts
 * Uses a long-context model to handle up to 5 minutes of audio.
 */
export const analyzeAudio = async (base64Audio: string, mimeType: string, providedLyrics?: string): Promise<LyricSegment[]> => {
  const ai = getAIClient();
  
  // Use gemini-2.5-flash which supports multimodal input (audio)
  const modelId = "gemini-2.5-flash";

  let systemInstruction = `
    你是一个专业的音乐MV导演。请分析这段音频。
    你需要输出JSON格式的时间轴数据。
    对于每一段歌词或音乐章节，请提供一个简短的、极具画面感的“视觉提示词”(visualPrompt)，用于生成背景图片。
    视觉提示词必须是英文的，风格统一，适合作为AI绘画的Prompt。
  `;

  let promptText = "";

  if (providedLyrics && providedLyrics.trim().length > 0) {
     // Alignment Mode
     promptText = `
       请根据我提供的以下官方歌词，将其与音频进行精确的时间轴对齐(Alignment)。
       请不要重新识别歌词，而是直接使用我提供的文本，将它们切分为合适的片段，并标记准确的 startTime 和 endTime。
       如果歌词有空缺（如间奏），请添加纯音乐片段标记。

       官方歌词如下：
       """
       ${providedLyrics}
       """
       
       请严格按照以下JSON格式返回：
       [
         {
           "startTime": 0.0,
           "endTime": 5.5,
           "text": "歌词内容...",
           "visualPrompt": "Cinematic shot..."
         }
       ]
     `;
  } else {
    // Transcription Mode
    promptText = `
      请提取歌词并提供精确的时间戳。
      如果是纯音乐，请根据旋律情感划分章节。
      
      请严格按照以下JSON格式返回：
      [
        {
          "startTime": 0.0,
          "endTime": 5.5,
          "text": "歌词内容...",
          "visualPrompt": "Cinematic shot of a lonely street at night, neon lights, cyberpunk style, high detail"
        }
      ]
    `;
  }

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Audio
            }
          },
          { text: promptText }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              startTime: { type: Type.NUMBER },
              endTime: { type: Type.NUMBER },
              text: { type: Type.STRING },
              visualPrompt: { type: Type.STRING }
            },
            required: ["startTime", "endTime", "text", "visualPrompt"]
          }
        }
      }
    });

    const jsonText = response.text;
    if (!jsonText) throw new Error("No response text from Gemini");
    
    return JSON.parse(jsonText) as LyricSegment[];
  } catch (error) {
    console.error("Analysis failed:", error);
    throw error;
  }
};

/**
 * Step 2: Generate Images based on Visual Prompts
 * We select a subset of segments to generate images for (e.g., every 4th segment or based on major scene changes)
 * to save time and API quota, effectively creating a slideshow MV.
 */
export const generateMVImages = async (
  segments: LyricSegment[], 
  aspectRatio: AspectRatio,
  updateProgress: (msg: string) => void
): Promise<GeneratedImage[]> => {
  const ai = getAIClient();
  const modelId = "gemini-3-pro-image-preview"; // High quality image generation
  
  // Strategy: Identify key scenes. 
  // For a 5 minute song, we might want ~10-15 images to rotate through.
  // We'll filter segments that are spaced out by at least 15 seconds.
  
  const keySegments: { segment: LyricSegment, index: number }[] = [];
  let lastTime = -999;
  
  segments.forEach((seg, index) => {
    if (seg.startTime - lastTime > 15) { // Minimum 15 seconds per image
      keySegments.push({ segment: seg, index });
      lastTime = seg.startTime;
    }
  });

  // Limit to max 8 images for the demo speed, ensuring we cover the song
  const selectedKeySegments = keySegments.slice(0, 8);

  const images: GeneratedImage[] = [];
  
  const arValue = aspectRatio === AspectRatio.Landscape ? "16:9" : "9:16";

  // Process in parallel with concurrency limit or sequential to track progress
  // Sequential for better progress feedback in UI
  for (let i = 0; i < selectedKeySegments.length; i++) {
    const { segment } = selectedKeySegments[i];
    updateProgress(`正在生成第 ${i + 1} / ${selectedKeySegments.length} 张场景图...`);
    
    try {
      // Enhance prompt for style
      const enhancedPrompt = `${segment.visualPrompt}, highly detailed, 8k resolution, cinematic lighting, masterpiece, aesthetic music video background`;

      const response = await ai.models.generateContent({
        model: modelId,
        contents: {
          parts: [{ text: enhancedPrompt }]
        },
        config: {
          imageConfig: {
            aspectRatio: arValue as any,
            imageSize: "1K" 
          }
        }
      });

      // Extract image
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const base64Str = part.inlineData.data;
          const mimeType = part.inlineData.mimeType || 'image/png';
          
          images.push({
            timeIndex: segment.startTime, // Use startTime as key to switch image
            imageUrl: `data:${mimeType};base64,${base64Str}`,
            prompt: enhancedPrompt
          });
          break; // Only take one image per request
        }
      }
    } catch (e) {
      console.warn(`Failed to generate image for segment ${i}`, e);
      // Continue even if one fails
    }
  }

  return images;
};