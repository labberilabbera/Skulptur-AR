// ── Audio analyser (shared globally so sculpture-ar.ts can read it each tick) ──
window.audioData = {bass: 0, mid: 0, treble: 0, active: false}

let audioCtx   = null
let analyser   = null
let freqData   = null
let rafHandle  = null

function setupAnalyser(audioEl) {
  if (audioCtx) return
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    analyser = audioCtx.createAnalyser()
    analyser.fftSize          = 512
    analyser.smoothingTimeConstant = 0.75

    const source = audioCtx.createMediaElementSource(audioEl)
    source.connect(analyser)
    analyser.connect(audioCtx.destination)

    freqData = new Uint8Array(analyser.frequencyBinCount)
    window.audioData.active = true

    const tick = () => {
      analyser.getByteFrequencyData(freqData)
      let bassSum = 0, midSum = 0, trebleSum = 0
      for (let i = 0; i < 3; i++) bassSum += freqData[i]
      for (let i = 3; i < 23; i++) midSum += freqData[i]
      for (let i = 23; i < 93; i++) trebleSum += freqData[i]
      window.audioData.bass   = bassSum   / (3   * 255)
      window.audioData.mid    = midSum    / (20  * 255)
      window.audioData.treble = trebleSum / (70  * 255)
      rafHandle = requestAnimationFrame(tick)
    }
    tick()
  } catch (e) {
    console.warn('[audio] Web Audio API-fel:', e)
  }
}

// ── Skapa audio direkt vid sidladdning, inte vänta på XR ─────────────────
const audio = new Audio('./assets/music.mp3')
audio.loop = true
audio.preload = 'auto'
window._arAudio = audio

// Exponera setupAnalyser så STARTA-knappen kan sätta upp audio-reaktiviteten
window._setupAudioAnalyser = () => setupAnalyser(audio)

// ── 8th Wall setup ─────────────────────────────────────────────────────────
const onxrloaded = () => {
  XR8.XrController.configure({
    imageTargetData: [
      require('../image-targets/fram.json'),
    ],
  })
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
