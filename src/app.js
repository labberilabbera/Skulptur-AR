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

    // Run audio analysis every animation frame
    const tick = () => {
      analyser.getByteFrequencyData(freqData)

      // With fftSize=512 and 44100 Hz → each bin ≈ 86 Hz
      // Bass:   ~20–200 Hz  → bins 0–2
      // Mid:   ~200–2000 Hz → bins 2–23
      // Treble: ~2–8 kHz    → bins 23–93
      let bassSum = 0, midSum = 0, trebleSum = 0

      for (let i = 0; i < 3; i++) bassSum += freqData[i]
      for (let i = 3; i < 23; i++) midSum += freqData[i]
      for (let i = 23; i < 93; i++) trebleSum += freqData[i]

      window.audioData.bass   = bassSum   / (3   * 255)   // 0–1
      window.audioData.mid    = midSum    / (20  * 255)
      window.audioData.treble = trebleSum / (70  * 255)

      rafHandle = requestAnimationFrame(tick)
    }
    tick()
  } catch (e) {
    console.warn('[audio] Web Audio API-fel:', e)
  }
}

const onxrloaded = () => {
  XR8.XrController.configure({
    imageTargetData: [
      require('../image-targets/fram.json'),
    ],
  })

  const audio = new Audio('./assets/music.mp3')
  window._arAudio = audio
  audio.loop = true

  // AudioContext kräver user gesture på mobil — sätt upp vid första touch
  const onFirstTouch = () => {
    setupAnalyser(audio)
    document.removeEventListener('touchstart', onFirstTouch)
  }
  document.addEventListener('touchstart', onFirstTouch, {once: true})

  XR8.addCameraPipelineModule({
    name: 'sculpture-audio',
    listeners: [
      {
        event: 'reality.imagefound',
        process: ({detail}) => {
          if (detail.name !== 'fram') return
          audio.play().catch(() => {
            const resume = () => { setupAnalyser(audio); audio.play(); document.removeEventListener('touchstart', resume) }
            document.addEventListener('touchstart', resume, {once: true})
          })
        },
      },
    ],
  })
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
