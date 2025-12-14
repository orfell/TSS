import { GoogleGenAI, Modality } from "@google/genai";
import { Accent, AudioSettings, Language, Style } from "../types";

export const generateSpeech = async (text: string, settings: AudioSettings): Promise<string> => {
  const API_KEY = process.env.API_KEY || '';
  
  if (!API_KEY) {
    throw new Error("Falta la API Key en las variables de entorno");
  }

  // Initialize inside the function to ensure we catch the latest environment variable
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  // For the TTS model, it is often more effective to include the acting instructions
  // directly in the prompt text rather than a separate systemInstruction config,
  // ensuring the model "reads" the context before generating the audio.
  const promptText = `
    [Instructions for the Voice Actor]
    Target Language: ${settings.language === Language.Spanish ? 'Spanish' : 'English'}
    Accent/Region: ${settings.accent}
    Emotion/Style: ${settings.style}

    Behaviors for tags:
    - [pausa]: Pause for ~2 seconds.
    - [risa]: Laugh naturally.
    - [grito]: Shout/Exclaim energetically.
    - [llanto]: Sob briefly.

    Please read the following text with the specified emotion and accent, performing the tags as actions, not reading them aloud:
    
    "${text}"
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: {
        parts: [{ text: promptText }]
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: settings.voiceId
            }
          }
        }
      }
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!base64Audio) {
      throw new Error("No se generó audio en la respuesta. Es posible que el texto haya sido filtrado por seguridad.");
    }

    return base64Audio;

  } catch (error) {
    console.error("Error generating speech:", error);
    throw error;
  }
};