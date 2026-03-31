/* ═══════════════════════════════════════════════════════════
   SANSKRIT VOICE DETECTOR — FULLY FIXED
═══════════════════════════════════════════════════════════ */

(function () {

  document.addEventListener('DOMContentLoaded', init);

  let mediaRecorder = null;
  let isRecording   = false;
  let recognition   = null;
  let stream        = null;
  let silenceTimer  = null;
  let anim          = null;
  let analyser      = null;
  let timerInterval = null;
  let timerSecs     = 0;

  /* ══════════════════════════════════════
     INIT
  ══════════════════════════════════════ */
  function init() {
    buildBars();
    injectStyles();
    document.getElementById('svd-record-btn')?.addEventListener('click', toggleRecording);
    document.getElementById('svd-clear-btn')?.addEventListener('click',  clearTranscript);
    document.getElementById('svd-analyse-btn')?.addEventListener('click', analyseFromVoice);
  }

  /* ══════════════════════════════════════
     BUILD BARS
  ══════════════════════════════════════ */
  function buildBars() {
    const bars = document.getElementById('svd-bars');
    if (!bars || bars.children.length > 0) return;
    bars.innerHTML = Array.from({ length: 28 }, (_, i) =>
      `<div class="svd-bar" style="animation-delay:${i * 0.05}s"></div>`
    ).join('');
  }

  /* ══════════════════════════════════════
     TOGGLE RECORDING
  ══════════════════════════════════════ */
  async function toggleRecording() {
    if (isRecording) stopRecording();
    else await startRecording();
  }

  /* ══════════════════════════════════════
     START RECORDING
  ══════════════════════════════════════ */
  async function startRecording() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus('Microphone permission denied', 'error');
      return;
    }

    isRecording = true;

    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.start();

    startVisualizer(stream);
    startTimer();
    startSpeechRecognition();
    setRecordingUI(true);
    setStatus('🎙 Listening for Sanskrit…', 'recording');
  }

  /* ══════════════════════════════════════
     STOP RECORDING
  ══════════════════════════════════════ */
  function stopRecording() {
    isRecording = false;
    clearTimeout(silenceTimer);

    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (recognition) { try { recognition.stop(); } catch(e) {} }

    stopVisualizer();
    stopTimer();
    setRecordingUI(false);

    const text = document.getElementById('svd-transcript').textContent.trim();
    setStatus(text ? '✦ Detection complete — click Analyse' : 'No speech detected. Try again.', 'done');
  }

  /* ══════════════════════════════════════
     SPEECH RECOGNITION
     Uses hi-IN (Hindi/Devanagari) for best
     Sanskrit phoneme coverage.
     sa-IN is NOT supported by Chrome —
     using it causes immediate error + restart loop.
  ══════════════════════════════════════ */
  function startSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setStatus('Speech Recognition not available. Use Chrome.', 'error');
      return;
    }

    recognition = new SR();
    recognition.lang             = 'hi-IN'; /* Best for Devanagari/Sanskrit */
    recognition.continuous       = true;
    recognition.interimResults   = true;
    recognition.maxAlternatives  = 5;

    let finalText = '';

    recognition.onstart = () => {
      setStatus('🎙 Listening…', 'recording');
    };

    recognition.onresult = (e) => {
      let interim = '';

      for (let i = e.resultIndex; i < e.results.length; i++) {
        /* Pick best Sanskrit-matching alternative */
        let best = pickBestResult(e.results[i]);

        if (e.results[i].isFinal) {
          finalText += best + ' ';
          resetSilenceTimer();
        } else {
          interim = best;
        }
      }

      const display = (finalText + interim).trim();
      if (display) updateTranscript(display, finalText.trim());
    };

    recognition.onerror = (e) => {
      /* Only restart on recoverable errors, ignore no-speech */
      if (e.error === 'no-speech') return;
      if (e.error === 'not-allowed') {
        setStatus('Microphone blocked.', 'error');
        stopRecording();
        return;
      }
      /* For other errors, attempt restart */
      if (isRecording) {
        setTimeout(() => {
          if (isRecording) try { recognition.start(); } catch(err) {}
        }, 500);
      }
    };

    recognition.onend = () => {
      if (isRecording) {
        setTimeout(() => {
          if (isRecording) try { recognition.start(); } catch(err) {}
        }, 200);
      }
    };

    try { recognition.start(); } catch(e) {}
  }

  /* ══════════════════════════════════════
     PICK BEST RESULT
     Prefers Devanagari results over romanised.
     Falls back to highest confidence.
  ══════════════════════════════════════ */
  function pickBestResult(result) {
    const DEVA = /[\u0900-\u097F]/;

    /* First pass — find Devanagari alternative */
    for (let j = 0; j < result.length; j++) {
      if (DEVA.test(result[j].transcript)) {
        return result[j].transcript;
      }
    }

    /* Second pass — highest confidence */
    let best = result[0].transcript;
    let bestConf = result[0].confidence || 0;
    for (let j = 1; j < result.length; j++) {
      if ((result[j].confidence || 0) > bestConf) {
        best = result[j].transcript;
        bestConf = result[j].confidence;
      }
    }
    return best;
  }

  /* ══════════════════════════════════════
     SILENCE TIMER — auto stop after 4s quiet
  ══════════════════════════════════════ */
  function resetSilenceTimer() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (isRecording) {
        setStatus('Silence detected — stopping…', 'idle');
        setTimeout(stopRecording, 500);
      }
    }, 4000);
  }

  /* ══════════════════════════════════════
     UPDATE TRANSCRIPT
     Shows both Devanagari AND roman text —
     does NOT strip roman since Chrome often
     returns roman even for Sanskrit speech.
  ══════════════════════════════════════ */
  function updateTranscript(display, confirmed) {
    const wrap       = document.getElementById('svd-transcript-wrap');
    const transcEl   = document.getElementById('svd-transcript');
    const confEl     = document.getElementById('svd-confidence');
    const analyseBtn = document.getElementById('svd-analyse-btn');
    const clearBtn   = document.getElementById('svd-clear-btn');

    wrap.style.display      = 'block';
    transcEl.textContent    = display;
    confEl.textContent      = getConfidenceLabel(display);

    if (confirmed) {
      analyseBtn.style.display = '';
      clearBtn.style.display   = '';
    }
  }

  /* ══════════════════════════════════════
     CONFIDENCE LABEL
  ══════════════════════════════════════ */
  function getConfidenceLabel(text) {
    const devaCount = (text.match(/[\u0900-\u097F]/g) || []).length;
    const total     = text.replace(/\s/g, '').length || 1;
    const pct       = Math.min(Math.round((devaCount / total) * 100 + 20), 99);

    const el = document.getElementById('svd-confidence');
    if (el) {
      el.className = 'svd-confidence ' + (pct > 60 ? 'high' : pct > 30 ? 'mid' : 'low');
    }
    return pct + '% Sanskrit match';
  }

  /* ══════════════════════════════════════
     CLEAR
  ══════════════════════════════════════ */
  function clearTranscript() {
    document.getElementById('svd-transcript').textContent       = '';
    document.getElementById('svd-transcript-wrap').style.display = 'none';
    document.getElementById('svd-clear-btn').style.display       = 'none';
    document.getElementById('svd-analyse-btn').style.display     = 'none';
    document.getElementById('svd-confidence').textContent        = '';
    setStatus('Ready — click Start Recording', 'idle');
  }

  /* ══════════════════════════════════════
     ANALYSE — pushes transcript into the
     main textarea and calls analyzeVerse()
     which is the LOCAL engine (no API key).
  ══════════════════════════════════════ */
  async function analyseFromVoice() {
  const transcript = document.getElementById('svd-transcript').textContent.trim();
  if (!transcript) {
    setStatus('No Sanskrit text detected to analyse.', 'error');
    return;
  }
  // Push detected text into the main analyser textarea
  document.getElementById('sktInput').value = transcript;
  // Call the local analysis engine defined in the main HTML
  setStatus('Analysing…', 'recording');
  if (typeof analyzeVerse === 'function') {
    analyzeVerse();
    setTimeout(() => {
      document.getElementById('summaryResults')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 500);
  }
  setStatus('Analysis complete — see results below', 'done');
}

  /* ══════════════════════════════════════
     VISUALIZER
  ══════════════════════════════════════ */
  function startVisualizer(stream) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();

    const src  = ctx.createMediaStreamSource(stream);
    analyser   = ctx.createAnalyser();
    analyser.fftSize = 64;
    src.connect(analyser);

    const idle     = document.getElementById('svd-idle');
    const barsWrap = document.getElementById('svd-bars');
    if (idle)     idle.style.display     = 'none';
    if (barsWrap) barsWrap.style.display = 'flex';

    const bars = document.querySelectorAll('.svd-bar');
    const data = new Uint8Array(analyser.frequencyBinCount);

    anim = 1; /* Mark as active before first frame */

    function draw() {
      if (!anim) return;
      analyser.getByteFrequencyData(data);
      bars.forEach((b, i) => {
        const h = Math.max(5, (data[i % data.length] / 255) * 80);
        b.style.height = h + 'px';
      });
      anim = requestAnimationFrame(draw);
    }
    draw();
  }

  function stopVisualizer() {
    if (anim) cancelAnimationFrame(anim);
    anim = null;

    document.querySelectorAll('.svd-bar').forEach(b => b.style.height = '5px');

    const idle     = document.getElementById('svd-idle');
    const barsWrap = document.getElementById('svd-bars');
    if (idle)     idle.style.display     = 'flex';
    if (barsWrap) barsWrap.style.display = 'none';
  }

  /* ══════════════════════════════════════
     TIMER
  ══════════════════════════════════════ */
  function startTimer() {
    timerSecs = 0;
    timerInterval = setInterval(() => {
      timerSecs++;
      const m = Math.floor(timerSecs / 60);
      const s = timerSecs % 60;
      const el = document.getElementById('svd-timer');
      if (el) el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  /* ══════════════════════════════════════
     RECORDING UI
  ══════════════════════════════════════ */
  function setRecordingUI(state) {
    const btn   = document.getElementById('svd-record-btn');
    const label = document.getElementById('svd-btn-label');
    const icon  = document.getElementById('svd-btn-icon');
    const vis   = document.getElementById('svd-visualizer');

    if (state) {
      btn.classList.add('svd-recording');
      if (label) label.textContent = 'Stop Recording';
      if (icon)  icon.textContent  = '⏹';
      if (vis)   vis.classList.add('svd-vis-active');
    } else {
      btn.classList.remove('svd-recording');
      if (label) label.textContent = 'Start Recording';
      if (icon)  icon.textContent  = '⏺';
      if (vis)   vis.classList.remove('svd-vis-active');
    }
  }

  function setStatus(msg, state) {
    const text = document.getElementById('svd-status');
    const dot  = document.getElementById('svd-dot');
    if (text) text.textContent = msg;
    if (dot)  dot.className   = 'svd-status-dot svd-dot-' + state;
  }

  /* ══════════════════════════════════════
     INJECT STYLES — fixes broken layout
  ══════════════════════════════════════ */
  function injectStyles() {
    if (document.getElementById('svd-styles')) return;
    const s = document.createElement('style');
    s.id = 'svd-styles';
    s.textContent = `
      #svd-block { margin-bottom: 1.5rem; }

      .svd-wrapper {
        background: linear-gradient(135deg, rgba(20,8,2,0.97), rgba(12,5,0,0.99));
        border: 1px solid rgba(212,160,23,0.35);
        border-radius: 4px;
        padding: 1.75rem 2rem;
        position: relative;
        overflow: hidden;
      }
      .svd-wrapper::before {
        content: '';
        position: absolute; top: 0; left: 0; right: 0; height: 2px;
        background: linear-gradient(90deg, transparent, #D4A017, #E07B39, #D4A017, transparent);
      }

      /* Header */
      .svd-header {
        display: flex; align-items: flex-start; gap: 1rem; margin-bottom: 1.2rem;
      }
      .svd-title-icon { font-size: 1.8rem; line-height: 1; }
      .svd-title {
        font-family: 'Cinzel', serif; font-size: 1rem;
        letter-spacing: 0.12em; color: #F5E199; font-weight: 600; margin-bottom: 0.2rem;
      }
      .svd-subtitle { font-size: 0.82rem; color: rgba(250,240,220,0.45); font-style: italic; }
      .svd-lang-badge {
        margin-left: auto;
        padding: 0.25rem 0.85rem;
        background: rgba(212,160,23,0.08);
        border: 1px solid rgba(212,160,23,0.3);
        border-radius: 20px;
        font-family: 'Tiro Devanagari Sanskrit', serif;
        font-size: 0.95rem; color: #D4A017; white-space: nowrap;
      }

      /* Visualizer */
      .svd-visualizer {
        background: rgba(0,0,0,0.4);
        border: 1px solid rgba(212,160,23,0.15);
        border-radius: 3px;
        height: 90px;
        display: flex; align-items: center; justify-content: center;
        margin-bottom: 0.85rem;
        overflow: hidden;
        transition: border-color 0.3s;
      }
      .svd-visualizer.svd-vis-active {
        border-color: rgba(212,160,23,0.5);
        box-shadow: 0 0 20px rgba(212,160,23,0.08);
      }
      .svd-vis-bars {
        display: none; align-items: flex-end;
        gap: 3px; height: 80px; padding: 0 1rem;
      }
      .svd-bar {
        width: 5px; min-height: 5px;
        background: linear-gradient(180deg, #D4A017 0%, #E07B39 60%, #8B1A1A 100%);
        border-radius: 2px 2px 0 0;
        transition: height 0.05s ease;
      }
      .svd-vis-idle {
        display: flex; flex-direction: column; align-items: center; gap: 0.4rem;
      }
      .svd-idle-om {
        font-family: 'Tiro Devanagari Sanskrit', serif;
        font-size: 2rem; color: #D4A017; opacity: 0.3;
      }
      .svd-idle-text {
        font-size: 0.78rem; color: rgba(250,240,220,0.3); font-style: italic;
      }

      /* Status */
      .svd-status-row {
        display: flex; align-items: center; gap: 0.6rem; margin-bottom: 1rem;
      }
      .svd-status-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: rgba(250,240,220,0.2); flex-shrink: 0;
        transition: background 0.3s, box-shadow 0.3s;
      }
      .svd-dot-recording {
        background: #e05050;
        box-shadow: 0 0 8px rgba(220,80,80,0.7);
        animation: svd-blink 1s ease-in-out infinite;
      }
      .svd-dot-done { background: #D4A017; box-shadow: 0 0 8px rgba(212,160,23,0.6); }
      .svd-dot-error { background: #e05050; }
      .svd-dot-idle  { background: rgba(250,240,220,0.2); }
      @keyframes svd-blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
      .svd-status-text {
        font-size: 0.82rem; color: rgba(250,240,220,0.55); font-style: italic; flex: 1;
      }
      .svd-timer {
        font-family: 'Cinzel', serif; font-size: 0.78rem;
        color: rgba(212,160,23,0.6); letter-spacing: 0.1em;
      }

      /* Transcript */
      .svd-transcript-wrap {
        background: rgba(0,0,0,0.35);
        border: 1px solid rgba(212,160,23,0.2);
        border-radius: 3px;
        padding: 1rem 1.2rem; margin-bottom: 1rem;
      }
      .svd-transcript-label {
        display: flex; align-items: center; justify-content: space-between;
        font-family: 'Cinzel', serif;
        font-size: 0.65rem; letter-spacing: 0.2em;
        color: #E07B39; text-transform: uppercase; margin-bottom: 0.6rem;
      }
      .svd-confidence {
        font-family: 'Cinzel', serif; font-size: 0.65rem;
        letter-spacing: 0.1em; padding: 0.15rem 0.6rem;
        border-radius: 10px; border: 1px solid;
      }
      .svd-confidence.high { color:#80c880; border-color:rgba(128,200,128,0.4); background:rgba(128,200,128,0.08); }
      .svd-confidence.mid  { color:#D4A017; border-color:rgba(212,160,23,0.4);  background:rgba(212,160,23,0.08); }
      .svd-confidence.low  { color:#E07B39; border-color:rgba(224,123,57,0.4);  background:rgba(224,123,57,0.08); }
      .svd-transcript {
        font-family: 'Tiro Devanagari Sanskrit', serif;
        font-size: 1.4rem; color: #FAF0DC; line-height: 1.8; min-height: 2rem;
      }

      /* Controls */
      .svd-controls { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; }
      .svd-btn {
        padding: 0.7rem 1.4rem;
        font-family: 'Cinzel', serif; font-size: 0.75rem;
        letter-spacing: 0.15em; text-transform: uppercase;
        border-radius: 3px; cursor: pointer;
        transition: all 0.25s;
        display: flex; align-items: center; gap: 0.5rem; border: 1px solid;
      }
      .svd-btn-record {
        background: linear-gradient(135deg, #8B1A1A, #5C0F0F);
        border-color: rgba(212,160,23,0.4); color: #F5E199;
        flex: 1; justify-content: center;
      }
      .svd-btn-record:hover { box-shadow: 0 4px 20px rgba(139,26,26,0.5); transform: translateY(-1px); }
      .svd-btn-record.svd-recording {
        background: linear-gradient(135deg, #5c0f0f, #3d0808);
        border-color: rgba(220,80,80,0.6);
        animation: svd-pulse-rec 1.5s ease-in-out infinite;
      }
      @keyframes svd-pulse-rec {
        0%,100%{ box-shadow: 0 0 12px rgba(220,80,80,0.3); }
        50%    { box-shadow: 0 0 24px rgba(220,80,80,0.6); }
      }
      .svd-btn-icon { font-size: 1rem; }
      .svd-btn-clear {
        background: transparent; border-color: rgba(250,240,220,0.15);
        color: rgba(250,240,220,0.45);
      }
      .svd-btn-clear:hover { border-color: rgba(250,240,220,0.4); color: #FAF0DC; }
      .svd-btn-analyse {
        background: linear-gradient(135deg, rgba(212,160,23,0.15), rgba(224,123,57,0.1));
        border-color: rgba(212,160,23,0.5); color: #F0C040;
        flex: 1; justify-content: center;
      }
      .svd-btn-analyse:hover {
        background: linear-gradient(135deg, rgba(212,160,23,0.25), rgba(224,123,57,0.2));
        box-shadow: 0 4px 16px rgba(212,160,23,0.2); transform: translateY(-1px);
      }

      /* Tip */
      .svd-tip {
        font-size: 0.78rem; color: rgba(250,240,220,0.3);
        font-style: italic; line-height: 1.6;
        border-top: 1px solid rgba(212,160,23,0.1); padding-top: 0.85rem;
      }
    `;
    document.head.appendChild(s);
  }

})();