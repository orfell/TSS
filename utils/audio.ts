/**
 * Decodes a base64 string into an AudioBuffer using the AudioContext.
 */
export async function decodeAudioData(
  base64Data: string,
  audioContext: AudioContext
): Promise<AudioBuffer> {
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  // Gemini returns raw PCM at 24000Hz usually, but sometimes headers are missing.
  // We try standard decode first.
  try {
    // We need to copy the buffer because decodeAudioData detaches it
    const bufferCopy = bytes.buffer.slice(0);
    return await audioContext.decodeAudioData(bufferCopy);
  } catch (e) {
    // Fallback: If raw PCM (no header), we assume 24kHz mono (typical for Gemini)
    // This part constructs a crude buffer from raw floats if the above fails
    // However, Gemini API usually sends raw PCM requiring manual float conversion.
    // Let's implement manual PCM decoding for safety.
    return manualPCMDecode(bytes, audioContext);
  }
}

function manualPCMDecode(bytes: Uint8Array, ctx: AudioContext): AudioBuffer {
    // Assuming 16-bit PCM, 24kHz, Mono (standard Gemini output for now)
    const sampleRate = 24000;
    const numChannels = 1;
    const int16Data = new Int16Array(bytes.buffer);
    const float32Data = new Float32Array(int16Data.length);
    
    for (let i = 0; i < int16Data.length; i++) {
        // Convert Int16 to Float32 (-1.0 to 1.0)
        float32Data[i] = int16Data[i] / 32768.0;
    }

    const buffer = ctx.createBuffer(numChannels, float32Data.length, sampleRate);
    buffer.getChannelData(0).set(float32Data);
    return buffer;
}

/**
 * Converts an AudioBuffer to a WAV Blob for downloading.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // write WAVE header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this example)

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // write interleaved data
  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
      view.setInt16(44 + offset, sample, true); // write 16-bit sample
      offset += 2;
    }
    pos++;
  }

  return new Blob([bufferArr], { type: 'audio/wav' });

  function setUint16(data: any) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: any) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}
