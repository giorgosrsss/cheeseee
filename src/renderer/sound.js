// Small synthesized board sounds, so no audio files are needed.
let ctx = null;

function audio() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function knock(freq, duration, volume, noiseMix = 0.6) {
  const a = audio();
  const now = a.currentTime;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  gain.connect(a.destination);

  const osc = a.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, now + duration);
  const og = a.createGain();
  og.gain.value = 1 - noiseMix;
  osc.connect(og).connect(gain);
  osc.start(now);
  osc.stop(now + duration);

  const len = Math.floor(a.sampleRate * duration);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const noise = a.createBufferSource();
  noise.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq * 3;
  const ng = a.createGain();
  ng.gain.value = noiseMix;
  noise.connect(filter).connect(ng).connect(gain);
  noise.start(now);
}

export function playSound(kind, volume) {
  if (!volume) return;
  try {
    if (kind === 'capture') {
      knock(260, 0.12, volume * 0.9, 0.7);
      setTimeout(() => knock(180, 0.1, volume * 0.6, 0.7), 35);
    } else if (kind === 'check') {
      knock(520, 0.14, volume * 0.7, 0.3);
    } else if (kind === 'end') {
      knock(392, 0.25, volume * 0.6, 0.2);
      setTimeout(() => knock(294, 0.35, volume * 0.6, 0.2), 140);
    } else {
      knock(320, 0.09, volume, 0.65);
    }
  } catch (_) { /* audio not available */ }
}
