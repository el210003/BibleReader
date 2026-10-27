// Debug: why did wordBoundaryEnabled yield zero metadata events?
import pkg from 'msedge-tts';
const { MsEdgeTTS, OUTPUT_FORMAT } = pkg;

const tts = new MsEdgeTTS({ enableLogger: true });
await tts.setMetadata('zh-TW-HsiaoChenNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
  wordBoundaryEnabled: true,
  sentenceBoundaryEnabled: true,
  voiceLocale: 'zh-TW',
});

const { audioStream, metadataStream } = tts.toStream('神愛世人，甚至將他的獨生子賜給他們。');
console.log('metadataStream is null?', metadataStream === null);

let audioBytes = 0;
audioStream.on('data', (c) => { audioBytes += c.length; });
audioStream.on('end', () => {
  console.log('audio bytes:', audioBytes);
  tts.close();
  setTimeout(() => process.exit(0), 300);
});

if (metadataStream) {
  metadataStream.on('data', (c) => console.log('META CHUNK:', c.toString().slice(0, 400)));
  metadataStream.on('end', () => console.log('META END'));
}
