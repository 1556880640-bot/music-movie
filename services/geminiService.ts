import { GoogleGenAI, Type } from "@google/genai";
import { LyricSegment, GeneratedVisual, AspectRatio, VisualType } from "../types";

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
 * Step 1: Analyze Audio
 */
export const analyzeAudio = async (base64Audio: string, mimeType: string, providedLyrics?: string): Promise<LyricSegment[]> => {
  const ai = getAIClient();
  const modelId = "gemini-2.5-flash";

  let systemInstruction = `
    你是一个专业的音乐MV导演。请分析这段音频。
    你需要输出JSON格式的时间轴数据。
    对于每一段歌词或音乐章节，请提供一个简短的、极具画面感的“视觉提示词”(visualPrompt)。
    视觉提示词必须是英文的，描述具体的场景、光影、氛围，适合作为AI绘画或AI视频生成的Prompt。
  `;

  let promptText = "";

  if (providedLyrics && providedLyrics.trim().length > 0) {
     promptText = `
       请根据我提供的以下官方歌词，将其与音频进行精确的时间轴对齐(Alignment)。
       官方歌词如下：
       """
       ${providedLyrics}
       """
       请严格按照JSON格式返回，包含startTime, endTime, text, visualPrompt。
     `;
  } else {
    promptText = `
      请提取歌词并提供精确的时间戳。如果是纯音乐，请根据旋律情感划分章节。
      请严格按照JSON格式返回。
    `;
  }

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType, data: base64Audio } },
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
 * Step 2: Generate Visuals (Images or Videos)
 */
export const generateMVVisuals = async (
  segments: LyricSegment[], 
  aspectRatio: AspectRatio,
  visualType: VisualType,
  updateProgress: (msg: string) => void
): Promise<GeneratedVisual[]> => {
  const ai = getAIClient();
  
  // Strategy: Select key segments. 
  // If Video: fewer segments because it's slower.
  const interval = visualType === VisualType.Video ? 20 : 15; 
  
  const keySegments: { segment: LyricSegment, index: number }[] = [];
  let lastTime = -999;
  
  segments.forEach((seg, index) => {
    if (seg.startTime - lastTime > interval) {
      keySegments.push({ segment: seg, index });
      lastTime = seg.startTime;
    }
  });

  // Limit max visuals to avoid extremely long wait times
  const maxItems = visualType === VisualType.Video ? 4 : 8;
  const selectedKeySegments = keySegments.slice(0, maxItems);

  const visuals: GeneratedVisual[] = [];
  const arValue = aspectRatio === AspectRatio.Landscape ? "16:9" : "9:16";

  for (let i = 0; i < selectedKeySegments.length; i++) {
    const { segment } = selectedKeySegments[i];
    const itemNum = i + 1;
    const total = selectedKeySegments.length;
    
    // Enhance prompt
    const enhancedPrompt = `${segment.visualPrompt}, highly detailed, cinematic lighting, masterpiece, aesthetic music video background`;

    if (visualType === VisualType.Image) {
        updateProgress(`正在生成第 ${itemNum} / ${total} 张场景图...`);
        try {
            const response = await ai.models.generateContent({
                model: "gemini-3-pro-image-preview",
                contents: { parts: [{ text: enhancedPrompt }] },
                config: {
                    imageConfig: { aspectRatio: arValue as any, imageSize: "1K" }
                }
            });
            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) {
                    visuals.push({
                        timeIndex: segment.startTime,
                        mediaUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                        prompt: enhancedPrompt,
                        type: VisualType.Image
                    });
                    break;
                }
            }
        } catch (e) {
            console.warn(`Failed to generate image ${i}`, e);
        }
    } else {
        // VIDEO GENERATION (Veo)
        updateProgress(`正在生成第 ${itemNum} / ${total} 段视频 (Veo)...这可能需要一点时间`);
        try {
             // Veo models: 'veo-3.1-fast-generate-preview'
             // Note: Resolution affects speed. 
             let operation = await ai.models.generateVideos({
                model: 'veo-3.1-fast-generate-preview',
                prompt: enhancedPrompt,
                config: {
                    numberOfVideos: 1,
                    resolution: '720p', 
                    aspectRatio: arValue as any
                }
             });

             // Polling loop
             let pollCount = 0;
             while (!operation.done && pollCount < 60) { // Max 10 minutes (10s * 60)
                await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s
                operation = await ai.operations.getVideosOperation({operation: operation});
                pollCount++;
                updateProgress(`正在生成第 ${itemNum} / ${total} 段视频... 已等待 ${pollCount * 10}秒`);
             }

             if (operation.done && operation.response?.generatedVideos?.[0]?.video?.uri) {
                 const videoUri = operation.response.generatedVideos[0].video.uri;
                 
                 // Fetch the actual video bytes using the API Key
                 const apiKey = process.env.API_KEY;
                 const videoRes = await fetch(`${videoUri}&key=${apiKey}`);
                 const videoBlob = await videoRes.blob();
                 const videoUrl = URL.createObjectURL(videoBlob);

                 visuals.push({
                    timeIndex: segment.startTime,
                    mediaUrl: videoUrl,
                    prompt: enhancedPrompt,
                    type: VisualType.Video
                 });
             }
        } catch (e) {
            console.warn(`Failed to generate video ${i}`, e);
            updateProgress(`视频生成失败，跳过...`);
        }
    }
  }

  return visuals;
};