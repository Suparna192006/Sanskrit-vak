/* ═══════════════════════════════════════════════════════════
   SANSKRIT VOICE DETECTOR — CROSS-BROWSER FIXED
   Works on: Chrome ✓  Edge ✓  Safari (iOS/Mac) ✓
   Brave: shows setup guide  Firefox: shows manual fallback
═══════════════════════════════════════════════════════════ */

(function () {

  document.addEventListener('DOMContentLoaded', init);

  let mediaRecorder  = null;
  let isRecording    = false;
  let recognition    = null;
  let stream         = null;
  let silenceTimer   = null;
  let anim           = null;
  let analyser       = null;
  let timerInterval  = null;
  let timerSecs      = 0;
  let audioCtx       = null;

  /* ══════════════════════════════════════
     BROWSER / SUPPORT DETECTION
  ══════════════════════════════════════ */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  /* Brave exposes navigator.brave — use it to warn user */
  function isBrave() {
    return !!(navigator.brave && navigator.brave.isBrave);
  }

  /* Safari on iOS/Mac uses webkitSpeechRecognition */
  function isSafari() {
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  }

  /* ══════════════════════════════════════
     INIT
  ══════════════════════════════════════ */
  function init() {
    buildBars();
    injectStyles();
    checkBrowserSupport();
    document.getElementById('svd-record-btn')?.addEventListener('click', toggleRecording);
    document.getElementById('svd-clear-btn')?.addEventListener('click',  clearTranscript);
    document.getElementById('svd-analyse-btn')?.addEventListener('click', analyseFromVoice);
    /* Manual fallback textarea submit */
    document.getElementById('svd-manual-submit')?.addEventListener('click', submitManualText);
  }

  /* ══════════════════════════════════════
     BROWSER SUPPORT CHECK
     Shows appropriate UI for each browser
  ══════════════════════════════════════ */
  function checkBrowserSupport() {
    const recordBtn   = document.getElementById('svd-record-btn');
    const browserNote = document.getElementById('svd-browser-note');
    const manualBlock = document.getElementById('svd-manual-block');

    /* ── BRAVE: SR API exists but is blocked by shields ── */
    if (isBrave()) {
      if (browserNote) {
        browserNote.style.display = 'block';
        browserNote.innerHTML = `
          <span style="color:#F0C040;font-family:'Cinzel',serif;font-size:0.8rem;letter-spacing:0.1em;">⚠ Brave Browser Detected</span><br>
          <span style="font-size:0.82rem;color:rgba(250,240,220,0.6);line-height:1.7;">
            Brave Shields blocks the microphone API by default.<br>
            To enable: click the <strong style="color:#D4A017;">Lion icon</strong> in the address bar →
            turn off <strong style="color:#D4A017;">"Block fingerprinting"</strong> or lower Shields to Standard for this site.
            Or use the text input below.
          </span>`;
      }
      if (manualBlock) manualBlock.style.display = 'block';
      return;
    }

    /* ── NO SpeechRecognition at all (Firefox, old browsers) ── */
    if (!SR) {
      if (recordBtn) {
        recordBtn.disabled = true;
        recordBtn.title = 'Not supported in this browser';
        recordBtn.style.opacity = '0.4';
        recordBtn.style.cursor = 'not-allowed';
      }
      if (browserNote) {
        browserNote.style.display = 'block';
        browserNote.innerHTML = `
          <span style="color:#F0C040;font-family:'Cinzel',serif;font-size:0.8rem;letter-spacing:0.1em;">⚠ Voice not supported in this browser</span><br>
          <span style="font-size:0.82rem;color:rgba(250,240,220,0.6);line-height:1.7;">
            Voice detection requires Chrome, Edge, or Safari.<br>
            Use the text input below to type or paste your Sanskrit verse instead.
          </span>`;
      }
      if (manualBlock) manualBlock.style.display = 'block';
      return;
    }

    /* ── SAFARI specific note ── */
    if (isSafari()) {
      if (browserNote) {
        browserNote.style.display = 'block';
        browserNote.innerHTML = `
          <span style="color:rgba(250,240,220,0.5);font-size:0.78rem;font-style:italic;">
            Safari note: Allow microphone access when prompted. If voice stops unexpectedly, tap Record again.
          </span>`;
      }
    }
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
    if (!SR) {
      setStatus('Voice not supported — use text input below.', 'error');
      return;
    }
    if (isRecording) stopRecording();
    else await startRecording();
  }

  /* ══════════════════════════════════════
     START RECORDING
  ══════════════════════════════════════ */
  async function startRecording() {
    /* Must resume AudioContext from a user gesture on iOS Safari */
    if (audioCtx && audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch(e) {}
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        if (isBrave()) {
          setStatus('Blocked by Brave Shields — lower shields or use text input.', 'error');
        } else {
          setStatus('Microphone permission denied — please allow mic access.', 'error');
        }
      } else if (err.name === 'NotFoundError') {
        setStatus('No microphone found on this device.', 'error');
      } else {
        setStatus('Microphone error: ' + err.message, 'error');
      }
      return;
    }

    isRecording = true;

    /* MediaRecorder — use supported MIME type */
    const mimeType = getSupportedMimeType();
    try {
      mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorder.start();
    } catch(e) {
      /* MediaRecorder not critical — speech recognition still works */
    }

    startVisualizer(stream);
    startTimer();
    startSpeechRecognition();
    setRecordingUI(true);
    setStatus('🎙 Listening for Sanskrit…', 'recording');
  }

  /* Pick a MIME type supported by this browser */
  function getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) return t;
    }
    return null;
  }

  /* ══════════════════════════════════════
     STOP RECORDING
  ══════════════════════════════════════ */
  function stopRecording() {
    isRecording = false;
    clearTimeout(silenceTimer);

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch(e) {}
    }
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
     hi-IN = best Devanagari coverage.
     sa-IN not supported by any browser.
  ══════════════════════════════════════ */
  function startSpeechRecognition() {
    if (!SR) return;

    recognition = new SR();
    recognition.lang            = 'hi-IN';
    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.maxAlternatives = 5;

    let finalText = '';
    let restartCount = 0;
    const MAX_RESTARTS = 10;

    recognition.onstart = () => {
      setStatus('🎙 Listening…', 'recording');
    };

    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const best = pickBestResult(e.results[i]);
        if (e.results[i].isFinal) {
          finalText += best + ' ';
          resetSilenceTimer();
          restartCount = 0; /* Reset on successful speech */
        } else {
          interim = best;
        }
      }
      const display = (finalText + interim).trim();
      if (display) updateTranscript(display, finalText.trim());
    };

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') return; /* Ignore silence */
      if (e.error === 'aborted') return;   /* Ignore intentional stops */

      if (e.error === 'not-allowed') {
        setStatus('Microphone blocked — check browser permissions.', 'error');
        stopRecording();
        return;
      }

      if (e.error === 'network') {
        /* Network error — recognition needs internet connection */
        setStatus('Network error — check connection. Trying again…', 'error');
      }

      /* Attempt restart for recoverable errors */
      if (isRecording && restartCount < MAX_RESTARTS) {
        restartCount++;
        setTimeout(() => {
          if (isRecording) try { recognition.start(); } catch(err) {}
        }, 600);
      }
    };

    recognition.onend = () => {
      if (isRecording && restartCount < MAX_RESTARTS) {
        setTimeout(() => {
          if (isRecording) {
            try { recognition.start(); } catch(err) {}
          }
        }, 250);
      }
    };

    try { recognition.start(); } catch(e) {
      setStatus('Could not start voice recognition. Try refreshing.', 'error');
    }
  }

  /* ══════════════════════════════════════
     PICK BEST RESULT
     Prefers Devanagari, falls back to highest confidence.
  ══════════════════════════════════════ */
  function pickBestResult(result) {
    const DEVA = /[\u0900-\u097F]/;
    for (let j = 0; j < result.length; j++) {
      if (DEVA.test(result[j].transcript)) return result[j].transcript;
    }
    let best = result[0].transcript, bestConf = result[0].confidence || 0;
    for (let j = 1; j < result.length; j++) {
      if ((result[j].confidence || 0) > bestConf) {
        best = result[j].transcript;
        bestConf = result[j].confidence;
      }
    }
    return best;
  }

  /* ══════════════════════════════════════
     SILENCE TIMER
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
  ══════════════════════════════════════ */
  function updateTranscript(display, confirmed) {
    const wrap       = document.getElementById('svd-transcript-wrap');
    const transcEl   = document.getElementById('svd-transcript');
    const confEl     = document.getElementById('svd-confidence');
    const analyseBtn = document.getElementById('svd-analyse-btn');
    const clearBtn   = document.getElementById('svd-clear-btn');

    if (wrap)     wrap.style.display = 'block';
    if (transcEl) transcEl.textContent = display;
    if (confEl)   confEl.textContent   = getConfidenceLabel(display);

    if (confirmed) {
      if (analyseBtn) analyseBtn.style.display = '';
      if (clearBtn)   clearBtn.style.display   = '';
    }
  }

  /* ══════════════════════════════════════
     MANUAL TEXT FALLBACK
  ══════════════════════════════════════ */
  function submitManualText() {
    const manualInput = document.getElementById('svd-manual-input');
    if (!manualInput) return;
    const text = manualInput.value.trim();
    if (!text) {
      setStatus('Please type or paste a Sanskrit verse first.', 'error');
      return;
    }
    updateTranscript(text, text);
    setStatus('✦ Text entered — click Analyse', 'done');
  }

  /* ══════════════════════════════════════
     CONFIDENCE LABEL
  ══════════════════════════════════════ */
  function getConfidenceLabel(text) {
    const devaCount = (text.match(/[\u0900-\u097F]/g) || []).length;
    const total     = text.replace(/\s/g, '').length || 1;
    const pct       = Math.min(Math.round((devaCount / total) * 100 + 20), 99);
    const el        = document.getElementById('svd-confidence');
    if (el) {
      el.className = 'svd-confidence ' + (pct > 60 ? 'high' : pct > 30 ? 'mid' : 'low');
    }
    return pct + '% Sanskrit match';
  }

  /* ══════════════════════════════════════
     CLEAR
  ══════════════════════════════════════ */
  function clearTranscript() {
    const transcEl   = document.getElementById('svd-transcript');
    const wrap       = document.getElementById('svd-transcript-wrap');
    const clearBtn   = document.getElementById('svd-clear-btn');
    const analyseBtn = document.getElementById('svd-analyse-btn');
    const confEl     = document.getElementById('svd-confidence');
    const manualInput = document.getElementById('svd-manual-input');

    if (transcEl)   transcEl.textContent       = '';
    if (wrap)       wrap.style.display         = 'none';
    if (clearBtn)   clearBtn.style.display     = 'none';
    if (analyseBtn) analyseBtn.style.display   = 'none';
    if (confEl)     confEl.textContent         = '';
    if (manualInput) manualInput.value         = '';

    setStatus('Ready — click Start Recording', 'idle');
  }

  /* ══════════════════════════════════════
     ANALYSE — pushes transcript into main textarea
  ══════════════════════════════════════ */
  function analyseFromVoice() {
    const transcript = document.getElementById('svd-transcript')?.textContent.trim();
    if (!transcript) {
      setStatus('No Sanskrit text detected to analyse.', 'error');
      return;
    }

    const inp = document.getElementById('sktInput');
    if (inp) inp.value = transcript;

    setStatus('Analysing…', 'recording');

    if (typeof analyzeVerse === 'function') {
      analyzeVerse();
      setTimeout(() => {
        setStatus('Analysis complete — see results below', 'done');
        const results = document.getElementById('summaryResults');
        if (results && results.style.display !== 'none') {
          results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 600);
    } else {
      setStatus('Analysis engine not ready — please refresh the page.', 'error');
    }
  }

  /* ══════════════════════════════════════
     VISUALIZER
  ══════════════════════════════════════ */
  function startVisualizer(micStream) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      /* iOS Safari requires resume() after user gesture — already done in startRecording */
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const src = audioCtx.createMediaStreamSource(micStream);
      analyser  = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);

      const idle     = document.getElementById('svd-idle');
      const barsWrap = document.getElementById('svd-bars');
      if (idle)     idle.style.display     = 'none';
      if (barsWrap) barsWrap.style.display = 'flex';

      const bars = document.querySelectorAll('.svd-bar');
      const data = new Uint8Array(analyser.frequencyBinCount);

      anim = 1;
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
    } catch(e) {
      /* Visualizer is non-critical — silently skip */
    }
  }

  function stopVisualizer() {
    if (anim) cancelAnimationFrame(anim);
    anim = null;

    document.querySelectorAll('.svd-bar').forEach(b => b.style.height = '5px');

    const idle     = document.getElementById('svd-idle');
    const barsWrap = document.getElementById('svd-bars');
    if (idle)     idle.style.display     = 'flex';
    if (barsWrap) barsWrap.style.display = 'none';

    if (audioCtx) {
      try { audioCtx.close(); } catch(e) {}
      audioCtx = null;
    }
  }

  /* ══════════════════════════════════════
     TIMER
  ══════════════════════════════════════ */
  function startTimer() {
    timerSecs = 0;
    timerInterval = setInterval(() => {
      timerSecs++;
      const m  = Math.floor(timerSecs / 60);
      const s  = timerSecs % 60;
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

    if (!btn) return;

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
     INJECT STYLES
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

      /* Browser note */
      .svd-browser-note {
        display: none;
        background: rgba(212,160,23,0.06);
        border: 1px solid rgba(212,160,23,0.25);
        border-radius: 3px;
        padding: 0.85rem 1rem;
        margin-bottom: 1rem;
        line-height: 1.65;
      }

      /* Manual fallback */
      .svd-manual-block {
        display: none;
        margin-top: 1rem;
        border-top: 1px solid rgba(212,160,23,0.15);
        padding-top: 1rem;
      }
      .svd-manual-label {
        font-family: 'Cinzel', serif; font-size: 0.68rem;
        letter-spacing: 0.18em; color: #E07B39;
        text-transform: uppercase; margin-bottom: 0.5rem;
        display: block;
      }
      .svd-manual-input {
        width: 100%;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(212,160,23,0.3);
        border-radius: 3px;
        color: #FAF0DC;
        font-family: 'Tiro Devanagari Sanskrit', 'EB Garamond', serif;
        font-size: 1.1rem;
        line-height: 1.8;
        padding: 0.75rem 1rem;
        outline: none;
        resize: vertical;
        min-height: 70px;
        margin-bottom: 0.6rem;
        transition: border-color 0.25s;
      }
      .svd-manual-input:focus { border-color: #D4A017; }
      .svd-manual-input::placeholder { color: rgba(250,240,220,0.3); font-style: italic; }
      .svd-manual-submit {
        padding: 0.6rem 1.4rem;
        background: linear-gradient(135deg, rgba(212,160,23,0.15), rgba(224,123,57,0.1));
        border: 1px solid rgba(212,160,23,0.5);
        border-radius: 3px;
        color: #F0C040;
        font-family: 'Cinzel', serif; font-size: 0.75rem;
        letter-spacing: 0.15em; text-transform: uppercase;
        cursor: pointer; transition: all 0.25s;
      }
      .svd-manual-submit:hover {
        background: linear-gradient(135deg, rgba(212,160,23,0.25), rgba(224,123,57,0.2));
        transform: translateY(-1px);
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
      .svd-dot-done  { background: #D4A017; box-shadow: 0 0 8px rgba(212,160,23,0.6); }
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