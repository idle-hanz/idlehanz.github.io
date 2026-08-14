/* Ride — live-insert EQ training on a running music source.
   One filter chain stays connected. Problems are gain changes, not restarts. */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'eqEarTrainerRideStats';
    var IDB_NAME = 'eq-ear-trainer-ride';
    var AUDIO_EXT = /\.(mp3|wav|wave|flac|m4a|aac|ogg|opus|webm|aiff|aif)$/i;
    var SKIP_DIRS = /^(node_modules|__pycache__|\.git|\.svn|desktop\.ini)$/i;
    var LISTEN_MS = 1400;
    var REVEAL_MS = 1600;
    var COMPARE_GUESS_MS = 2200;
    var COMPARE_TRUTH_MS = 2400;
    var NARROW_Q = 6;
    var RIDE_Q = 0.85;
    var MAX_LIBRARY = 4000;

    /* Detectability: boosts are easier than cuts (SoundGym; White; narrow-Q
       boosts more audible than equivalent cuts). Pedagogical pairing is ~2:1
       cut:boost — +3 ≈ −6, +6 ≈ −12, +1.5 ≈ −3. Broadband JND is ~1 dB;
       narrowband EQ needs more. TrainYourEars beginners often start at ±12. */
    var BAND_LADDER = [
        { step: 1, gain: 6, label: '+6' },
        { step: 2, gain: -12, label: '−12' },
        { step: 3, gain: 3, label: '+3' },
        { step: 4, gain: -6, label: '−6' },
        { step: 5, gain: 1.5, label: '+1.5' },
        { step: 6, gain: -3, label: '−3' }
    ];

    function dbToGain(db) {
        return Math.pow(10, db / 20);
    }

    function compensationDb(gainDb, q) {
        var qClamped = Math.min(Math.max(q || 1.2, 0.5), 10);
        var width = 1.2 / qClamped;
        var factor = 0.16 * Math.min(1, width + 0.18);
        return -gainDb * factor;
    }

    function fileBase(name) {
        return String(name || '').replace(/\.[^.]+$/, '');
    }

    function findLoopWindow(buffer, seconds) {
        var data = buffer.getChannelData(0);
        var sr = buffer.sampleRate;
        var dur = buffer.duration;
        var winSec = Math.min(seconds, Math.max(4, dur));
        if (dur <= winSec + 0.2) {
            return { start: 0, end: dur };
        }
        var hop = Math.floor(sr * 0.25);
        var win = Math.floor(sr * 0.5);
        var guard = Math.floor(sr * 0.5);
        var bestAt = guard;
        var best = -1;
        for (var i = guard; i < data.length - win - guard; i += hop) {
            var sum = 0;
            for (var j = 0; j < win; j += 8) {
                var s = data[i + j];
                sum += s * s;
            }
            if (sum > best) {
                best = sum;
                bestAt = i;
            }
        }
        var len = winSec * sr;
        var start = bestAt - len * 0.25;
        var maxStart = data.length - len;
        if (start < 0) start = 0;
        if (start > maxStart) start = Math.max(0, maxStart);
        return { start: start / sr, end: (start + len) / sr };
    }

    function createDemoBuffer(ctx) {
        var sr = ctx.sampleRate;
        var dur = 8;
        var len = Math.floor(sr * dur);
        var buf = ctx.createBuffer(2, len, sr);
        var freqs = [65.41, 98.00, 130.81, 155.56, 196.00, 311.13];
        for (var ch = 0; ch < 2; ch++) {
            var d = buf.getChannelData(ch);
            for (var i = 0; i < len; i++) {
                var t = i / sr;
                var env = 0.72 + 0.28 * Math.sin((2 * Math.PI * t) / dur);
                var s = 0;
                for (var k = 0; k < freqs.length; k++) {
                    var det = ch === 0 ? 1 : 1.0025;
                    s += Math.sin(2 * Math.PI * freqs[k] * det * t) * (0.16 - k * 0.015);
                }
                var n = 0;
                for (var r = 0; r < 6; r++) n += Math.random() * 2 - 1;
                s += (n / 6) * 0.07;
                d[i] = Math.tanh(s * env * 1.35) * 0.52;
            }
        }
        return buf;
    }

    function idbOpen() {
        return new Promise(function (resolve, reject) {
            if (!global.indexedDB) {
                reject(new Error('no idb'));
                return;
            }
            var req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = function () {
                if (!req.result.objectStoreNames.contains('kv')) {
                    req.result.createObjectStore('kv');
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function idbGet(key) {
        return idbOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('kv', 'readonly');
                var r = tx.objectStore('kv').get(key);
                r.onsuccess = function () { resolve(r.result); };
                r.onerror = function () { reject(r.error); };
            });
        });
    }

    function idbSet(key, val) {
        return idbOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('kv', 'readwrite');
                tx.objectStore('kv').put(val, key);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function RideEngine(ctx) {
        this.ctx = ctx;
        this.input = ctx.createGain();
        this.eq = ctx.createBiquadFilter();
        this.eq.type = 'peaking';
        this.eq.frequency.value = 1000;
        this.eq.Q.value = RIDE_Q;
        this.eq.gain.value = 0;
        this.comp = ctx.createGain();
        this.wet = ctx.createGain();
        this.dry = ctx.createGain();
        this.gate = ctx.createGain();
        this.filters = [];
        this.bandList = [];

        this.input.connect(this.dry);
        this.dry.connect(this.gate);
        this.input.connect(this.eq);
        this.eq.connect(this.comp);
        this.comp.connect(this.wet);
        this.wet.connect(this.gate);
        this.gate.connect(ctx.destination);
        this.dry.gain.value = 1;
        this.wet.gain.value = 0;
        this.gate.gain.value = 0.88;

        this.buffer = null;
        this.loopStart = 0;
        this.loopEnd = 0;
        this.offsetAtStart = 0;
        this.startedAt = 0;
        this.pausedAt = 0;
        this.playing = false;
        this.bufferSource = null;
        this.streamSource = null;
        this.stream = null;
        this.kind = null;
        this.problem = null;
        this.abClean = false;
        this.onStreamEnded = null;
        this.loopEnabled = true;
        this.onEnded = null;
    }

    RideEngine.prototype.setBands = function (bands) {
        this.bandList = bands || [];
        this._applyProblemGains();
    };

    RideEngine.prototype._stopBufferSource = function () {
        if (this.bufferSource) {
            try { this.bufferSource.onended = null; this.bufferSource.stop(); } catch (e) { /* stopped */ }
            try { this.bufferSource.disconnect(); } catch (e2) { /* disconnected */ }
            this.bufferSource = null;
        }
    };

    RideEngine.prototype._disconnectStream = function (stopTracks) {
        if (this.streamSource) {
            try { this.streamSource.disconnect(); } catch (e) { /* disconnected */ }
            this.streamSource = null;
        }
        if (stopTracks && this.stream) {
            this.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ended */ } });
            this.stream = null;
        }
    };

    RideEngine.prototype._nowOffset = function () {
        if (!this.playing || this.kind !== 'buffer' || !this.buffer) return this.pausedAt;
        var elapsed = this.ctx.currentTime - this.startedAt;
        var span = this.loopEnabled
            ? Math.max(0.05, this.loopEnd - this.loopStart)
            : this.buffer.duration;
        return (this.offsetAtStart + elapsed) % span;
    };

    RideEngine.prototype._startBuffer = function (offset) {
        if (!this.buffer) return;
        this._stopBufferSource();
        this._disconnectStream(true);
        this.kind = 'buffer';
        var src = this.ctx.createBufferSource();
        src.buffer = this.buffer;
        src.loop = !!this.loopEnabled;
        if (this.loopEnabled) {
            src.loopStart = this.loopStart;
            src.loopEnd = this.loopEnd;
        }
        src.connect(this.input);
        var span = this.loopEnabled
            ? Math.max(0.05, this.loopEnd - this.loopStart)
            : this.buffer.duration;
        var off = ((offset % span) + span) % span;
        var startAt = this.loopEnabled ? this.loopStart + off : off;
        if (startAt >= this.buffer.duration) startAt = 0;
        src.onended = this._onBufferEnded.bind(this);
        src.start(0, startAt);
        this.bufferSource = src;
        this.offsetAtStart = off;
        this.startedAt = this.ctx.currentTime;
        this.playing = true;
        if (this.ctx.state === 'suspended') this.ctx.resume();
    };

    RideEngine.prototype._onBufferEnded = function () {
        if (this.loopEnabled) return;
        this.playing = false;
        this.pausedAt = 0;
        if (this.onEnded) this.onEnded();
    };

    RideEngine.prototype.setLoop = function (on) {
        this.loopEnabled = !!on;
        if (this.playing && this.kind === 'buffer' && this.buffer) {
            this._startBuffer(this._nowOffset());
        }
    };

    RideEngine.prototype.setBuffer = function (buffer, slice) {
        this.buffer = buffer;
        this.kind = 'buffer';
        if (slice) {
            var win = findLoopWindow(buffer, 8);
            this.loopStart = win.start;
            this.loopEnd = win.end;
        } else {
            this.loopStart = 0;
            this.loopEnd = buffer.duration;
        }
        this.pausedAt = 0;
        if (this.playing) this._startBuffer(0);
    };

    RideEngine.prototype.setStream = function (stream) {
        this._stopBufferSource();
        this._disconnectStream(true);
        this.buffer = null;
        this.kind = 'stream';
        this.stream = stream;
        var src = this.ctx.createMediaStreamSource(stream);
        src.connect(this.input);
        this.streamSource = src;
        this.playing = true;
        var self = this;
        stream.getTracks().forEach(function (t) {
            t.addEventListener('ended', function () {
                if (self.onStreamEnded) self.onStreamEnded();
            });
        });
        if (this.ctx.state === 'suspended') this.ctx.resume();
    };

    RideEngine.prototype.play = function () {
        if (this.kind === 'stream') {
            this.playing = true;
            this.gate.gain.setTargetAtTime(0.88, this.ctx.currentTime, 0.02);
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return;
        }
        if (!this.buffer) return;
        this.gate.gain.setTargetAtTime(0.88, this.ctx.currentTime, 0.02);
        this._startBuffer(this.pausedAt);
    };

    RideEngine.prototype.pause = function () {
        if (this.kind === 'stream') {
            this.playing = false;
            this.gate.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
            return;
        }
        if (this.kind === 'buffer' && this.playing) {
            this.pausedAt = this._nowOffset();
            this._stopBufferSource();
        }
        this.playing = false;
    };

    RideEngine.prototype.stop = function (stopCapture) {
        if (this.kind === 'buffer' && this.playing) this.pausedAt = this._nowOffset();
        this._stopBufferSource();
        this._disconnectStream(!!stopCapture);
        this.playing = false;
        this.clearProblem();
    };

    RideEngine.prototype.setProblem = function (problem) {
        this.problem = problem ? {
            index: problem.index,
            freq: problem.freq,
            gain: problem.gain,
            q: problem.q || RIDE_Q
        } : null;
        this.abClean = false;
        this._applyProblemGains();
    };

    RideEngine.prototype.clearProblem = function () {
        this.problem = null;
        this.abClean = false;
        this._applyProblemGains();
    };

    RideEngine.prototype.toggleAB = function () {
        if (!this.problem) return false;
        this.abClean = !this.abClean;
        this._applyProblemGains();
        return true;
    };

    RideEngine.prototype.setABClean = function (clean) {
        if (!this.problem) return;
        this.abClean = !!clean;
        this._applyProblemGains();
    };

    RideEngine.prototype._snap = function (param, value, t) {
        param.cancelScheduledValues(t);
        param.setValueAtTime(param.value, t);
        param.linearRampToValueAtTime(value, t + 0.02);
    };

    RideEngine.prototype._applyProblemGains = function () {
        if (!this.eq) return;
        var t = this.ctx.currentTime;
        var active = !!(this.problem && !this.abClean);
        if (this.problem && typeof this.problem.freq === 'number') {
            this.eq.frequency.setValueAtTime(this.problem.freq, t);
            this.eq.Q.setValueAtTime(this.problem.q || RIDE_Q, t);
            this.eq.gain.setValueAtTime(this.problem.gain, t);
            this.comp.gain.setValueAtTime(dbToGain(compensationDb(this.problem.gain, this.problem.q)), t);
        } else {
            this.eq.gain.setValueAtTime(0, t);
            this.comp.gain.setValueAtTime(1, t);
        }
        this._snap(this.dry.gain, active ? 0 : 1, t);
        this._snap(this.wet.gain, active ? 1 : 0, t);
    };

    function defaultStats() {
        return {
            skill: 'band',
            bandStep: 1,
            amountLevel: 'easy',
            bandMode: 'few',
            loop: true,
            loopSlice: false,
            streak: 0,
            correct: 0,
            total: 0,
            perBand: {}
        };
    }

    function loadStats() {
        try {
            var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            var s = defaultStats();
            if (raw.skill === 'amount' || raw.skill === 'band') s.skill = raw.skill;
            if (raw.skill === 'direction') s.skill = 'band';
            if (typeof raw.bandStep === 'number' && raw.bandStep >= 1 && raw.bandStep <= 6) {
                s.bandStep = raw.bandStep;
            } else if (raw.bandLevel === 'medium') {
                s.bandStep = 3;
            } else if (raw.bandLevel === 'hard') {
                s.bandStep = 5;
            }
            if (raw.amountLevel === 'easy' || raw.amountLevel === 'hard') s.amountLevel = raw.amountLevel;
            if (raw.bandMode === 'many' || raw.bandMode === 'few') s.bandMode = raw.bandMode;
            if (typeof raw.loop === 'boolean') s.loop = raw.loop;
            if (typeof raw.loopSlice === 'boolean') s.loopSlice = raw.loopSlice;
            if (typeof raw.streak === 'number') s.streak = raw.streak;
            if (typeof raw.correct === 'number') s.correct = raw.correct;
            if (typeof raw.total === 'number') s.total = raw.total;
            if (raw.perBand && typeof raw.perBand === 'object') s.perBand = raw.perBand;
            return s;
        } catch (e) {
            return defaultStats();
        }
    }

    function saveStats(stats) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
        } catch (e) { /* quota */ }
    }

    function Ride() {
        this.hooks = null;
        this.engine = null;
        this.stats = loadStats();
        this.bands = [];
        this.library = [];
        this.order = [];
        this.orderPos = 0;
        this.source = 'demo';
        this.gameOn = false;
        this.phase = 'idle';
        this.currentProblem = null;
        this.lockedBand = null;
        this.lockedDir = null;
        this.timers = [];
        this.loadGen = 0;
        this.els = {};
        this.captureVideo = null;
        this.demoBuffer = null;
        this.decodeFails = 0;
        this.deck = [];
        this.lastBandIndex = -1;
        this.watch = false;
    }

    Ride.prototype.init = function (hooks) {
        this.hooks = hooks;
        this.els = {
            panel: document.getElementById('ride-panel'),
            nowPlaying: document.getElementById('ride-now-playing'),
            trackCount: document.getElementById('ride-track-count'),
            status: document.getElementById('ride-status'),
            ab: document.getElementById('ride-ab-badge'),
            guess: document.getElementById('ride-guess-buttons'),
            dirRow: document.getElementById('ride-dir-row'),
            amtRow: document.getElementById('ride-amt-row'),
            streak: document.getElementById('ride-streak'),
            accuracy: document.getElementById('ride-accuracy'),
            weak: document.getElementById('ride-weak'),
            playBtn: document.getElementById('ride-play-btn'),
            gameBtn: document.getElementById('ride-game-btn'),
            folderInput: document.getElementById('ride-folder-input'),
            filesInput: document.getElementById('ride-files-input'),
            captureVideo: document.getElementById('ride-capture-video'),
            result: document.getElementById('ride-result'),
            resultMark: document.getElementById('ride-result-mark'),
            resultDetail: document.getElementById('ride-result-detail'),
            skillHint: document.getElementById('ride-skill-hint')
        };
        this.captureVideo = this.els.captureVideo;
        this._bind();
        this._setSource('library', true);
        this._setSkill(this.stats.skill, true);
        this._setBandMode(this.stats.bandMode, true);
        this._syncLoopUi();
        this._renderGuess();
        this._renderStats();
        this.setStatus('Choose a folder, then Start ride.');
        this._tryRestoreFolder();
    };

    Ride.prototype._ctx = function () {
        return this.hooks.getContext();
    };

    Ride.prototype._ensureEngine = function () {
        var ctx = this._ctx();
        if (!this.engine || this.engine.ctx !== ctx) {
            this.engine = new RideEngine(ctx);
            var self = this;
            this.engine.onStreamEnded = function () {
                self._onCaptureEnded();
            };
            this.engine.setBands(this.bands);
            this.engine.loopEnabled = this.stats.loop !== false;
            this.engine.onEnded = function () {
                self._onTrackEnded();
            };
        }
        return this.engine;
    };

    Ride.prototype._bind = function () {
        var self = this;
        var byId = function (id) { return document.getElementById(id); };

        byId('ride-source-library').addEventListener('click', function () { self._setSource('library'); });
        var tapSrc = byId('ride-source-tap');
        if (tapSrc) tapSrc.addEventListener('click', function () { self._setSource('tap'); });
        byId('ride-source-demo').addEventListener('click', function () { self._setSource('demo'); });
        var tapBtn = byId('ride-tap-btn');
        if (tapBtn) tapBtn.addEventListener('click', function () { self.tapLive(); });

        byId('ride-choose-folder').addEventListener('click', function () { self.chooseFolder(); });
        byId('ride-add-files').addEventListener('click', function () { self.els.filesInput.click(); });
        var onFiles = function (e) {
            self._fromFileList(e.target.files);
            e.target.value = '';
        };
        this.els.folderInput.addEventListener('change', onFiles);
        if (this.els.filesInput) this.els.filesInput.addEventListener('change', onFiles);

        this.els.playBtn.addEventListener('click', function () { self.togglePlay(); });
        var prevBtn = byId('ride-prev-btn');
        if (prevBtn) prevBtn.addEventListener('click', function () { self.prevTrack(); });
        byId('ride-next-btn').addEventListener('click', function () { self.nextTrack(); });
        var randomBtn = byId('ride-random-btn');
        if (randomBtn) randomBtn.addEventListener('click', function () { self.randomTrack(); });
        byId('ride-loop-btn').addEventListener('click', function () { self.toggleLoopSlice(); });
        var loopToggle = byId('ride-loop-toggle');
        if (loopToggle) loopToggle.addEventListener('click', function () { self.toggleLoop(); });
        var levelChips = byId('ride-level-chips');
        if (levelChips) {
            levelChips.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-level]');
                if (!btn) return;
                self._setBandLevel(btn.getAttribute('data-level'));
            });
        }
        this.els.gameBtn.addEventListener('click', function () { self.toggleGame(); });
        if (this.els.result) {
            this.els.result.style.cursor = 'pointer';
            this.els.result.title = 'Click to skip';
            this.els.result.addEventListener('click', function () { self._skipCompare(); });
        }
        if (this.els.ab) {
            this.els.ab.addEventListener('mousedown', function (e) {
                e.preventDefault();
                self._holdClean(true);
            });
            this.els.ab.addEventListener('mouseup', function () { self._holdClean(false); });
            this.els.ab.addEventListener('mouseleave', function () { self._holdClean(false); });
            this.els.ab.addEventListener('touchstart', function (e) {
                e.preventDefault();
                self._holdClean(true);
            }, { passive: false });
            this.els.ab.addEventListener('touchend', function () { self._holdClean(false); });
        }

        byId('ride-skill-band').addEventListener('click', function () { self._setSkill('band'); });
        byId('ride-skill-amount').addEventListener('click', function () { self._setSkill('amount'); });
        var watchBtn = byId('ride-watch-btn');
        if (watchBtn) watchBtn.addEventListener('click', function () { self.toggleWatch(); });
        byId('ride-bands-few').addEventListener('click', function () { self._setBandMode('few'); });
        byId('ride-bands-many').addEventListener('click', function () { self._setBandMode('many'); });

        this.els.panel.addEventListener('dragover', function (e) {
            e.preventDefault();
            self.els.panel.classList.add('is-drop');
        });
        this.els.panel.addEventListener('dragleave', function () {
            self.els.panel.classList.remove('is-drop');
        });
        this.els.panel.addEventListener('drop', function (e) {
            e.preventDefault();
            self.els.panel.classList.remove('is-drop');
            var files = [];
            if (e.dataTransfer && e.dataTransfer.files) {
                for (var i = 0; i < e.dataTransfer.files.length; i++) {
                    var f = e.dataTransfer.files[i];
                    if (AUDIO_EXT.test(f.name)) files.push(f);
                }
            }
            if (files.length) {
                self._setSource('library');
                self._fromFileList(files);
            }
        });
    };

    Ride.prototype._setSource = function (source, silent) {
        this.source = source;
        ['library', 'tap', 'demo'].forEach(function (s) {
            var btn = document.getElementById('ride-source-' + s);
            if (!btn) return;
            btn.classList.toggle('is-active', s === source);
        });
        var lib = document.getElementById('ride-library-controls');
        var tap = document.getElementById('ride-tap-controls');
        if (lib) lib.classList.toggle('hidden', source !== 'library');
        if (tap) tap.classList.toggle('hidden', source !== 'tap');
        if (source !== 'tap' && this.engine && this.engine.kind === 'stream') {
            this.engine.stop(true);
            if (this.captureVideo) this.captureVideo.srcObject = null;
            this._syncPlayBtn();
        }
        if (silent) return;
        if (source === 'demo') this._loadDemo();
        if (source === 'tap') {
            this.setStatus('Choose the tab that is playing music, and turn on “Also share tab audio”.');
        }
        if (source === 'library' && !this.library.length) {
            this.setStatus('Choose a folder of albums, then Start ride.');
        }
    };

    Ride.prototype._setSkill = function (skill, silent) {
        if (skill !== 'amount') skill = 'band';
        this.stats.skill = skill;
        ['band', 'amount'].forEach(function (s) {
            var btn = document.getElementById('ride-skill-' + s);
            if (btn) btn.classList.toggle('is-active', s === skill);
        });
        this._syncSkillUi();
        this._renderGuess();
        if (!silent) {
            saveStats(this.stats);
            if (this.gameOn) this._beginListen();
        }
    };

    Ride.prototype._syncSkillUi = function () {
        var amount = this.stats.skill === 'amount';
        var host = document.getElementById('ride-level-chips');
        if (host) {
            host.innerHTML = '';
            host.appendChild(amount ? this._amountDiffBoard() : this._bandDiffBoard());
        }
        var watchBtn = document.getElementById('ride-watch-btn');
        if (watchBtn) watchBtn.classList.toggle('is-active', !!this.watch);
        if (!this.els.skillHint) return;
        if (this.watch) {
            this.els.skillHint.textContent = 'Watch mode — the answer lights up. Just listen.';
        } else if (amount) {
            this.els.skillHint.textContent = this.stats.amountLevel === 'hard'
                ? 'Now: Hard — boost +3 / +1.5, cut −3 / −6'
                : 'Now: Easy — boost +6 / +3, cut −6 / −12';
        } else {
            var rung = BAND_LADDER[(this.stats.bandStep || 1) - 1] || BAND_LADDER[0];
            var group = rung.step <= 2 ? 'Easy' : rung.step <= 4 ? 'Medium' : 'Hard';
            this.els.skillHint.textContent = 'Now: ' + group + ' · ' + (rung.gain > 0 ? 'boost' : 'cut') + ' ' + rung.label + ' dB';
        }
    };

    Ride.prototype._bandDiffBoard = function () {
        var step = this.stats.bandStep || 1;
        var board = document.createElement('div');
        board.className = 'ride-diff-board';
        var groups = [
            { name: 'Easy', steps: [BAND_LADDER[0], BAND_LADDER[1]] },
            { name: 'Medium', steps: [BAND_LADDER[2], BAND_LADDER[3]] },
            { name: 'Hard', steps: [BAND_LADDER[4], BAND_LADDER[5]] }
        ];
        groups.forEach(function (g) {
            var col = document.createElement('div');
            col.className = 'ride-diff-col';
            var lab = document.createElement('div');
            lab.className = 'ride-diff-col-label';
            lab.textContent = g.name;
            col.appendChild(lab);
            g.steps.forEach(function (rung) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'ride-diff-cell ' + (rung.gain > 0 ? 'is-boost' : 'is-cut');
                if (rung.step === step) btn.classList.add('is-active');
                btn.dataset.level = String(rung.step);
                btn.innerHTML = '<strong>' + rung.label + ' dB</strong><span>' + (rung.gain > 0 ? 'boost' : 'cut') + '</span>';
                col.appendChild(btn);
            });
            board.appendChild(col);
        });
        return board;
    };

    Ride.prototype._amountDiffBoard = function () {
        var cur = this.stats.amountLevel || 'easy';
        var board = document.createElement('div');
        board.className = 'ride-diff-board is-amount';
        [
            { id: 'easy', name: 'Easy', boost: 'Boost +6 and +3', cut: 'Cut −6 and −12' },
            { id: 'hard', name: 'Hard', boost: 'Boost +3 and +1.5', cut: 'Cut −3 and −6' }
        ].forEach(function (item) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ride-diff-card' + (cur === item.id ? ' is-active' : '');
            btn.dataset.level = item.id;
            btn.innerHTML = '<b>' + item.name + '</b><span>' + item.boost + '</span><span>' + item.cut + '</span>';
            board.appendChild(btn);
        });
        return board;
    };

    Ride.prototype._setBandLevel = function (level, silent) {
        if (this.stats.skill === 'amount') {
            this.stats.amountLevel = level === 'hard' ? 'hard' : 'easy';
        } else {
            var step = parseInt(level, 10);
            if (!(step >= 1 && step <= 6)) step = 1;
            this.stats.bandStep = step;
        }
        this._syncSkillUi();
        this._renderGuess();
        if (!silent) {
            saveStats(this.stats);
            if (this.gameOn) this._beginListen();
        }
    };

    Ride.prototype.toggleWatch = function () {
        this.watch = !this.watch;
        this._syncSkillUi();
        if (this.gameOn) this._beginListen();
        else this.setStatus(this.watch
            ? 'Watch is on. Start ride and the answer will light as the filter hits.'
            : 'Watch off. Start ride to play.');
    };

    Ride.prototype._setBandMode = function (mode, silent) {
        this.stats.bandMode = mode;
        var fewBtn = document.getElementById('ride-bands-few');
        var manyBtn = document.getElementById('ride-bands-many');
        if (fewBtn) fewBtn.classList.toggle('is-active', mode === 'few');
        if (manyBtn) manyBtn.classList.toggle('is-active', mode === 'many');
        this.bands = mode === 'many' ? this.hooks.getManyBands().slice() : this.hooks.getFewBands().slice();
        this.deck = [];
        this.lastBandIndex = -1;
        if (this.engine) this.engine.setBands(this.bands);
        this._renderGuess();
        if (!silent) {
            saveStats(this.stats);
            if (this.gameOn) this._beginListen();
        }
    };

    Ride.prototype._syncLoopUi = function () {
        var loopOn = this.stats.loop !== false;
        var toggle = document.getElementById('ride-loop-toggle');
        if (toggle) {
            toggle.classList.toggle('is-active', loopOn);
            toggle.textContent = loopOn ? 'Loop on' : 'Loop off';
        }
        var slice = document.getElementById('ride-loop-btn');
        if (slice) {
            slice.classList.toggle('is-active', !!this.stats.loopSlice);
            slice.classList.toggle('is-disabled', !loopOn);
            slice.textContent = 'Slice 8s';
        }
    };

    Ride.prototype.toggleLoop = function () {
        this.stats.loop = this.stats.loop === false;
        saveStats(this.stats);
        this._syncLoopUi();
        this._ensureEngine();
        this.engine.setLoop(this.stats.loop !== false);
        this._syncPlayBtn();
        this.setStatus(this.stats.loop !== false
            ? 'Loop on — the current track (or 8s slice) repeats.'
            : 'Loop off — the track plays once, then the next one.');
    };

    Ride.prototype.toggleLoopSlice = function () {
        this.stats.loopSlice = !this.stats.loopSlice;
        saveStats(this.stats);
        this._syncLoopUi();
        if (this.engine && this.engine.buffer) {
            this.engine.setBuffer(this.engine.buffer, this.stats.loopSlice);
            if (this.stats.loop !== false) this.engine.setLoop(true);
            this.engine.play();
            this._syncPlayBtn();
        }
        this.setStatus(this.stats.loopSlice
            ? 'Looping an 8-second slice.'
            : 'Using the full track.');
    };

    Ride.prototype._onTrackEnded = function () {
        this._syncPlayBtn();
        if (this.source === 'library' && this.library.length) {
            this.setStatus('Track ended — next.');
            this.nextTrack();
            return;
        }
        this.setStatus('Track ended.');
    };

    Ride.prototype.setStatus = function (text) {
        if (this.els.status) this.els.status.textContent = text;
    };

    Ride.prototype._setNowPlaying = function (text) {
        if (this.els.nowPlaying) this.els.nowPlaying.textContent = text;
    };

    Ride.prototype._displayTitle = function (entry) {
        if (!entry) return 'Nothing playing';
        var path = String(entry.path || entry.name || '');
        var parts = path.split(/[/\\]/).filter(Boolean);
        var file = fileBase(parts.length ? parts[parts.length - 1] : entry.name);
        var album = parts.length > 1 ? parts[parts.length - 2] : '';
        return album ? (album + ' — ' + file) : file;
    };

    Ride.prototype._syncPlayBtn = function () {
        var playing = this.engine && this.engine.playing;
        if (this.els.playBtn) {
            this.els.playBtn.innerHTML = playing
                ? '<i class="fa-solid fa-pause"></i>'
                : '<i class="fa-solid fa-play"></i>';
            this.els.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        }
    };

    Ride.prototype._syncGameBtn = function () {
        if (!this.els.gameBtn) return;
        this.els.gameBtn.textContent = this.gameOn ? 'Stop ride' : 'Start ride';
        this.els.gameBtn.classList.toggle('is-active', this.gameOn);
    };

    Ride.prototype._renderStats = function () {
        if (this.els.streak) this.els.streak.textContent = String(this.stats.streak);
        if (this.els.accuracy) {
            this.els.accuracy.textContent = this.stats.total
                ? Math.round((this.stats.correct / this.stats.total) * 100) + '%'
                : '—';
        }
        if (this.els.weak) {
            var worst = this._weakestLabel();
            this.els.weak.textContent = worst ? ('weak: ' + worst) : 'weak: —';
        }
        this._updateABBadge();
    };

    Ride.prototype._updateABBadge = function () {
        if (!this.els.ab) return;
        if (!this.engine || !this.engine.problem) {
            this.els.ab.textContent = 'Hold Space = clean';
            this.els.ab.classList.remove('is-clean', 'is-problem');
            return;
        }
        if (this.engine.abClean) {
            this.els.ab.textContent = 'Hearing clean';
            this.els.ab.classList.add('is-clean');
            this.els.ab.classList.remove('is-problem');
        } else {
            this.els.ab.textContent = 'Hearing problem';
            this.els.ab.classList.add('is-problem');
            this.els.ab.classList.remove('is-clean');
        }
    };

    Ride.prototype._weakestLabel = function () {
        var worstKey = null;
        var worstRate = 0;
        var per = this.stats.perBand;
        Object.keys(per).forEach(function (k) {
            var row = per[k];
            var n = (row.hit || 0) + (row.miss || 0);
            if (n < 3) return;
            var rate = (row.miss || 0) / n;
            if (rate > worstRate) {
                worstRate = rate;
                worstKey = k;
            }
        });
        if (!worstKey || worstRate < 0.35) return '';
        var band = this.bands.find(function (b) { return String(b.freq) === worstKey; });
        return band ? band.name : worstKey + ' Hz';
    };

    Ride.prototype._fmtGain = function (g) {
        var sign = g > 0 ? '+' : '';
        return sign + (Math.abs(g % 1) > 0.01 ? g.toFixed(1) : String(g));
    };

    Ride.prototype._amountPads = function () {
        if (this.stats.amountLevel === 'hard') {
            return { up: [3, 1.5], down: [-3, -6] };
        }
        return { up: [6, 3], down: [-6, -12] };
    };

    Ride.prototype._amountGains = function () {
        var pads = this._amountPads();
        return pads.up.concat(pads.down);
    };

    Ride.prototype._renderGuess = function () {
        var wrap = this.els.guess;
        if (!wrap) return;
        wrap.innerHTML = '';
        if (this.stats.skill === 'amount') this._renderAmountCols(wrap);
        else this._renderBandButtons(wrap);
    };

    Ride.prototype._renderBandButtons = function (wrap) {
        wrap.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3 mb-4';
        var self = this;
        this.bands.forEach(function (band, i) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.index = String(i);
            btn.innerHTML =
                '<div class="flex items-center gap-x-3">' +
                    '<div class="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-mono" style="background:' + band.color + '22;color:' + band.color + '">' +
                        (band.freq < 1000 ? band.freq : (band.freq / 1000) + 'k') +
                    '</div>' +
                    '<div>' +
                        '<div class="font-semibold">' + band.name + '</div>' +
                        (band.range ? '<div class="text-[10px] text-zinc-500">' + band.range + '</div>' : '') +
                    '</div>' +
                '</div>';
            btn.addEventListener('click', function () { self.guessBand(i); });
            wrap.appendChild(btn);
        });
    };

    Ride.prototype._renderAmountCols = function (wrap) {
        wrap.className = 'ride-amount-grid mb-4';
        var self = this;
        var pads = this._amountPads();
        this.bands.forEach(function (band, i) {
            var col = document.createElement('div');
            col.className = 'ride-band-col';
            col.dataset.index = String(i);
            pads.up.forEach(function (g) {
                var pad = document.createElement('button');
                pad.type = 'button';
                pad.className = 'ride-pad ride-pad-up';
                pad.dataset.index = String(i);
                pad.dataset.gain = String(g);
                pad.textContent = self._fmtGain(g);
                pad.addEventListener('click', function () { self.guessPad(i, g); });
                col.appendChild(pad);
            });
            var mid = document.createElement('div');
            mid.className = 'ride-band-mid';
            mid.dataset.index = String(i);
            mid.innerHTML =
                '<div class="text-[11px] font-semibold leading-tight" style="color:' + band.color + '">' + band.name + '</div>' +
                '<div class="text-[10px] text-zinc-500">' + (band.freq < 1000 ? band.freq + ' Hz' : (band.freq / 1000) + ' kHz') + '</div>';
            col.appendChild(mid);
            pads.down.forEach(function (g) {
                var pad = document.createElement('button');
                pad.type = 'button';
                pad.className = 'ride-pad ride-pad-down';
                pad.dataset.index = String(i);
                pad.dataset.gain = String(g);
                pad.textContent = self._fmtGain(g);
                pad.addEventListener('click', function () { self.guessPad(i, g); });
                col.appendChild(pad);
            });
            wrap.appendChild(col);
        });
    };

    Ride.prototype._showChoices = function () { /* amount is on the band columns now */ };

    Ride.prototype._clearHighlights = function () {
        if (this.els.guess) {
            this.els.guess.querySelectorAll('button, .ride-band-mid').forEach(function (b) {
                b.classList.remove('is-correct', 'is-wrong', 'is-target', 'is-lit');
                if (b.blur) b.blur();
            });
        }
        if (document.activeElement && document.activeElement.blur) {
            var ae = document.activeElement;
            if (ae.closest && ae.closest('#ride-guess-buttons')) ae.blur();
        }
    };

    Ride.prototype._lightAnswer = function () {
        var p = this.currentProblem;
        var wrap = this.els.guess;
        if (!p || !wrap) return;
        this._clearHighlights();
        if (this.stats.skill === 'amount') {
            var pads = wrap.querySelectorAll('.ride-pad[data-index="' + p.index + '"]');
            pads.forEach(function (pad) {
                if (Math.abs(parseFloat(pad.dataset.gain) - p.gain) < 0.05) {
                    pad.classList.add('is-lit');
                }
            });
        } else {
            var btn = wrap.querySelector('button[data-index="' + p.index + '"]');
            if (btn) btn.classList.add('is-lit');
        }
    };

    Ride.prototype._hideResult = function () {
        if (!this.els.result) return;
        this.els.result.classList.add('hidden');
        this.els.result.classList.remove('is-ok', 'is-bad');
    };

    Ride.prototype._showResult = function (ok, title, detail) {
        if (!this.els.result) return;
        this.els.result.classList.remove('hidden');
        this.els.result.classList.toggle('is-ok', !!ok);
        this.els.result.classList.toggle('is-bad', !ok);
        if (this.els.resultMark) this.els.resultMark.textContent = title;
        if (this.els.resultDetail) this.els.resultDetail.textContent = detail || '';
    };

    Ride.prototype.clearTimers = function () {
        this.timers.forEach(function (id) { clearTimeout(id); });
        this.timers = [];
    };

    Ride.prototype.after = function (ms, fn) {
        var self = this;
        var id = setTimeout(function () {
            self.timers = self.timers.filter(function (t) { return t !== id; });
            fn();
        }, ms);
        this.timers.push(id);
    };

    Ride.prototype.isActive = function () {
        return !!(this.engine && (this.engine.playing || this.gameOn));
    };

    Ride.prototype.suspendForOtherGame = function () {
        if (!this.engine) return;
        if (!this.engine.playing && !this.gameOn) return;
        this.clearTimers();
        this.engine.pause();
        this._syncPlayBtn();
        this.setStatus('Paused — the other trainer is using the audio. Press Play to come back.');
    };

    Ride.prototype.togglePlay = function () {
        this._ensureEngine();
        if (this.hooks && this.hooks.stopOtherAudio) this.hooks.stopOtherAudio();
        if (this.engine.playing) {
            this.engine.pause();
        } else {
            if (this.engine.kind === 'stream' || this.engine.buffer) {
                this.engine.play();
            } else if (this.source === 'library' && this.library.length) {
                this._playCurrent();
                return;
            } else {
                this._setSource('demo');
                return;
            }
        }
        this._syncPlayBtn();
    };

    Ride.prototype.toggleGame = function () {
        if (this.gameOn) this.stopGame();
        else this.startGame();
    };

    Ride.prototype.startGame = function () {
        this._ensureEngine();
        if (this.hooks && this.hooks.stopOtherAudio) this.hooks.stopOtherAudio();
        if (!this.engine.buffer && this.engine.kind !== 'stream') {
            if (this.source === 'library' && this.library.length) {
                this.gameOn = true;
                this._syncGameBtn();
                this._playCurrent();
                return;
            }
            this._setSource('demo');
        } else if (!this.engine.playing) {
            this.engine.play();
            this._syncPlayBtn();
        }
        this.gameOn = true;
        this._syncGameBtn();
        this._beginListen();
    };

    Ride.prototype.stopGame = function () {
        this.gameOn = false;
        this.phase = 'idle';
        this.clearTimers();
        this.currentProblem = null;
        this.lockedBand = null;
        this.lockedDir = null;
        if (this.engine) this.engine.clearProblem();
        this._clearHighlights();
        this._showChoices();
        this._updateABBadge();
        this._syncGameBtn();
        this._hideResult();
        this.setStatus('Ride stopped. Music can keep playing.');
    };

    Ride.prototype._beginListen = function () {
        if (!this.gameOn) return;
        this.clearTimers();
        this.phase = 'listen';
        this.currentProblem = null;
        this.lockedBand = null;
        this.lockedDir = null;
        if (this.engine) this.engine.clearProblem();
        this._clearHighlights();
        this._hideResult();
        this._showChoices();
        this._updateABBadge();
        this.setStatus('Listen…');
        var self = this;
        this.after(LISTEN_MS, function () { self._applyNewProblem(); });
    };

    Ride.prototype._weakestIndex = function () {
        var worstI = -1;
        var worstRate = 0.45;
        for (var i = 0; i < this.bands.length; i++) {
            var row = this.stats.perBand[String(this.bands[i].freq)] || { hit: 0, miss: 0 };
            var n = (row.hit || 0) + (row.miss || 0);
            if (n < 3) continue;
            var rate = (row.miss || 0) / n;
            if (rate > worstRate) {
                worstRate = rate;
                worstI = i;
            }
        }
        return worstI;
    };

    Ride.prototype._rebuildDeck = function () {
        var n = this.bands.length;
        var deck = [];
        for (var i = 0; i < n; i++) deck.push(i);
        for (var a = n - 1; a > 0; a--) {
            var b = Math.floor(Math.random() * (a + 1));
            var tmp = deck[a];
            deck[a] = deck[b];
            deck[b] = tmp;
        }
        if (n > 1 && deck[0] === this.lastBandIndex) {
            var sw = 1 + Math.floor(Math.random() * (n - 1));
            var t2 = deck[0];
            deck[0] = deck[sw];
            deck[sw] = t2;
        }
        var weak = this._weakestIndex();
        if (weak >= 0 && n > 1) {
            deck.splice(1 + Math.floor(Math.random() * n), 0, weak);
        }
        this.deck = deck;
    };

    Ride.prototype._pickBandIndex = function () {
        if (!this.deck || !this.deck.length) this._rebuildDeck();
        var idx = this.deck.shift();
        if (this.bands.length > 1 && idx === this.lastBandIndex && this.deck.length) {
            this.deck.push(idx);
            idx = this.deck.shift();
        }
        this.lastBandIndex = idx;
        return idx;
    };

    Ride.prototype._shapeForFreq = function (freq, skill) {
        var q = 1.4;
        var mag = 8;
        if (freq <= 80) { q = 1.0; mag = 10; }
        else if (freq <= 160) { q = 1.1; mag = 9; }
        else if (freq <= 400) { q = 1.25; mag = 8; }
        else if (freq <= 1200) { q = 1.4; mag = 8; }
        else if (freq <= 3000) { q = 1.7; mag = 7; }
        else if (freq <= 7000) { q = 2.2; mag = 7; }
        else { q = 2.5; mag = 6; }
        if (skill === 'direction') mag = Math.max(6, mag - 1);
        return { q: q, mag: mag };
    };

    Ride.prototype._bandLevelGain = function () {
        var rung = BAND_LADDER[(this.stats.bandStep || 1) - 1] || BAND_LADDER[0];
        return rung.gain;
    };

    Ride.prototype._applyNewProblem = function () {
        if (!this.gameOn) return;
        this._ensureEngine();
        var idx = this._pickBandIndex();
        var band = this.bands[idx];
        if (!band) return;
        var skill = this.stats.skill;
        var shape = this._shapeForFreq(band.freq, skill);
        var q = shape.q;
        var gain;
        if (skill === 'amount') {
            var choices = this._amountGains();
            gain = choices[Math.floor(Math.random() * choices.length)];
        } else {
            gain = this._bandLevelGain();
        }
        this._clearHighlights();
        this._hideResult();
        this.currentProblem = {
            index: idx,
            freq: band.freq,
            gain: gain,
            q: q,
            mag: Math.abs(gain),
            dir: gain >= 0 ? 'boost' : 'cut'
        };
        this.engine.setProblem(this.currentProblem);
        this.phase = 'problem';
        this._updateABBadge();
        if (this.watch) {
            this._lightAnswer();
            this.setStatus('Watch: ' + this._fmtGain(gain) + ' at ' + band.name + '. Hold Space for clean.');
            var self = this;
            this.after(3200, function () {
                if (self.gameOn && self.watch) self._beginListen();
            });
        } else {
            this.setStatus('What changed?  Hold Space to hear clean.');
        }
    };

    Ride.prototype.guessBand = function (index) {
        if (this.watch) {
            this._beginListen();
            return;
        }
        if (!this.gameOn || this.phase !== 'problem' || !this.currentProblem) return;
        this._clearHighlights();
        var buttons = this.els.guess.querySelectorAll('button[data-index]');
        var correct = index === this.currentProblem.index;
        var clicked = this.els.guess.querySelector('button[data-index="' + index + '"]');
        if (clicked) clicked.classList.add(correct ? 'is-correct' : 'is-wrong');
        if (!correct) {
            var right = this.els.guess.querySelector('button[data-index="' + this.currentProblem.index + '"]');
            if (right) right.classList.add('is-target');
        }
        this._finishRound(correct, 'band', {
            index: index,
            gain: this.currentProblem.gain,
            q: this._shapeForFreq(this.bands[index].freq, 'band').q
        });
    };

    Ride.prototype.guessPad = function (index, gain) {
        if (this.watch) {
            this._beginListen();
            return;
        }
        if (!this.gameOn || this.phase !== 'problem' || !this.currentProblem) return;
        this._clearHighlights();
        var ok = index === this.currentProblem.index && Math.abs(gain - this.currentProblem.gain) < 0.05;
        var wrap = this.els.guess;
        var clicked = wrap && wrap.querySelector('.ride-pad[data-index="' + index + '"][data-gain="' + gain + '"]');
        if (clicked) clicked.classList.add(ok ? 'is-correct' : 'is-wrong');
        if (!ok && wrap) {
            wrap.querySelectorAll('.ride-pad[data-index="' + this.currentProblem.index + '"]').forEach(function (pad) {
                if (Math.abs(parseFloat(pad.dataset.gain) - this.currentProblem.gain) < 0.05) {
                    pad.classList.add('is-target');
                }
            }.bind(this));
        }
        var gBand = this.bands[index];
        this._finishRound(ok, 'amount', {
            index: index,
            gain: gain,
            q: gBand ? this._shapeForFreq(gBand.freq, 'amount').q : this.currentProblem.q
        });
    };

    Ride.prototype._record = function (ok) {
        this.stats.total += 1;
        if (ok) {
            this.stats.correct += 1;
            this.stats.streak += 1;
        } else {
            this.stats.streak = 0;
        }
        if (this.currentProblem) {
            var key = String(this.bands[this.currentProblem.index].freq);
            if (!this.stats.perBand[key]) this.stats.perBand[key] = { hit: 0, miss: 0 };
            if (ok) this.stats.perBand[key].hit += 1;
            else this.stats.perBand[key].miss += 1;
        }
        saveStats(this.stats);
        this._renderStats();
    };

    Ride.prototype._labelEq = function (spec) {
        if (!spec || spec.index == null || !this.bands[spec.index]) return '';
        var band = this.bands[spec.index];
        return this._fmtGain(spec.gain) + ' dB at ' + band.name;
    };

    Ride.prototype._applyLiveEq = function (spec) {
        if (!this.engine || !spec || !this.bands[spec.index]) return;
        var band = this.bands[spec.index];
        this.engine.setProblem({
            index: spec.index,
            freq: band.freq,
            gain: spec.gain,
            q: spec.q || this._shapeForFreq(band.freq, this.stats.skill).q
        });
        this._updateABBadge();
    };

    Ride.prototype._skipCompare = function () {
        if (!this.gameOn) return;
        if (this.phase === 'reveal' || this.phase === 'compare-guess' || this.phase === 'compare-truth') {
            this._beginListen();
        }
    };

    Ride.prototype._finishRound = function (ok, stage, guess) {
        this._record(ok);
        this._showChoices();
        var p = this.currentProblem;
        var truthLabel = this._labelEq(p);
        var title = ok ? 'Yes' : 'No';
        if (!ok && stage === 'band') title = 'Wrong band';
        if (!ok && stage === 'amount') title = 'Wrong amount';
        this.clearTimers();

        if (ok || this.watch || !guess || !p) {
            this.phase = 'reveal';
            if (this.engine) this.engine.setABClean(false);
            this._updateABBadge();
            this._showResult(ok, title, truthLabel);
            this.setStatus(ok ? 'Yes — ' + truthLabel : truthLabel);
            var selfOk = this;
            this.after(REVEAL_MS, function () {
                if (selfOk.gameOn) selfOk._beginListen();
            });
            return;
        }

        this.lastGuess = guess;
        this.phase = 'compare-guess';
        this._applyLiveEq(guess);
        this._showResult(false, title, 'Your guess: ' + this._labelEq(guess));
        this.setStatus('Hearing your guess — ' + this._labelEq(guess) + '. Then the truth. Click to skip.');
        var self = this;
        this.after(COMPARE_GUESS_MS, function () {
            if (!self.gameOn || self.phase !== 'compare-guess') return;
            self.phase = 'compare-truth';
            self._applyLiveEq(p);
            self._showResult(false, title, 'Truth: ' + truthLabel);
            self.setStatus('Hearing the truth — ' + truthLabel + '. Hold Space for clean.');
        });
        this.after(COMPARE_GUESS_MS + COMPARE_TRUTH_MS, function () {
            if (self.gameOn && (self.phase === 'compare-truth' || self.phase === 'compare-guess')) {
                self._beginListen();
            }
        });
    };

    Ride.prototype._holdClean = function (on) {
        if (!this.engine || !this.engine.problem) {
            if (on) this._ensurePlayingAndProblem();
            return;
        }
        this.engine.setABClean(!!on);
        this._updateABBadge();
    };

    Ride.prototype._ensurePlayingAndProblem = function () {
        this._ensureEngine();
        if (this.hooks && this.hooks.stopOtherAudio) this.hooks.stopOtherAudio();
        this.gameOn = true;
        this._syncGameBtn();
        if (this.engine.playing && (this.engine.buffer || this.engine.kind === 'stream')) {
            this.clearTimers();
            this._applyNewProblem();
            return;
        }
        if (this.source === 'library' && this.library.length) {
            this._playCurrent();
            return;
        }
        if (this.engine.buffer) {
            this.engine.play();
            this._syncPlayBtn();
            this.clearTimers();
            this._applyNewProblem();
            return;
        }
        this._setSource('demo');
        this.clearTimers();
        this._applyNewProblem();
    };

    Ride.prototype.handleKeyUp = function (e) {
        if (e.key !== ' ' && e.key !== 'Spacebar') return false;
        e.preventDefault();
        if (this.engine && this.engine.problem) {
            this.engine.setABClean(false);
            this._updateABBadge();
        }
        return true;
    };

    Ride.prototype.handleKey = function (e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        var tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;

        var rideHot = this.gameOn || (this.engine && this.engine.playing);
        if (!rideHot && e.key !== ' ' && e.key !== 'Spacebar') return false;

        if (e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            if (e.repeat) return true;
            if (this.engine && this.engine.problem) {
                this._holdClean(true);
            } else {
                this._ensurePlayingAndProblem();
            }
            return true;
        }
        if (e.key === 'n' || e.key === 'N') {
            e.preventDefault();
            this.nextTrack();
            return true;
        }
        var num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= this.bands.length && this.phase === 'problem' && this.stats.skill === 'band') {
            e.preventDefault();
            this.guessBand(num - 1);
            return true;
        }
        return false;
    };

    Ride.prototype.chooseFolder = function () {
        var self = this;
        if (typeof window.showDirectoryPicker === 'function') {
            window.showDirectoryPicker({ mode: 'read' }).then(function (dir) {
                return idbSet('dir', dir).catch(function () { /* persist optional */ }).then(function () {
                    return self._fromDirectory(dir);
                });
            }).catch(function (err) {
                if (err && err.name === 'AbortError') return;
                self.setStatus('Could not open that folder. Try Add files instead.');
            });
            return;
        }
        this.els.folderInput.click();
    };

    Ride.prototype._tryRestoreFolder = function () {
        var self = this;
        idbGet('dir').then(function (dir) {
            if (!dir || !dir.queryPermission) return;
            return dir.queryPermission({ mode: 'read' }).then(function (state) {
                if (state === 'granted') return self._fromDirectory(dir);
                if (state === 'prompt') {
                    self.setStatus('Library remembered — click Choose folder to reopen it.');
                }
            });
        }).catch(function () { /* first visit */ });
    };

    Ride.prototype._fromDirectory = function (dirHandle) {
        var self = this;
        this.setStatus('Scanning library…');
        return collectAudio(dirHandle).then(function (list) {
            self.library = list;
            self._setAlbumOrder();
            if (self.els.trackCount) self.els.trackCount.textContent = list.length + ' tracks';
            if (!list.length) {
                self.setStatus('No audio files in that folder (mp3, wav, flac, m4a, ogg…).');
                return;
            }
            self._setSource('library', true);
            self.setStatus('Library ready in album order. Start ride when you want problems.');
            if (self.gameOn || (self.engine && self.engine.playing)) self._playCurrent();
        });
    };

    Ride.prototype._fromFileList = function (fileList) {
        var list = [];
        for (var i = 0; i < fileList.length; i++) {
            var f = fileList[i];
            if (!AUDIO_EXT.test(f.name)) continue;
            list.push({
                name: f.name,
                path: f.webkitRelativePath || f.name,
                file: f
            });
        }
        if (!list.length) {
            this.setStatus('Those files were not audio we can use.');
            return;
        }
        this.library = list;
        this._setAlbumOrder();
        if (this.els.trackCount) this.els.trackCount.textContent = list.length + ' tracks';
        this._setSource('library', true);
        this.setStatus(list.length + ' tracks loaded in album order.');
        this._playCurrent();
    };

    Ride.prototype._sortKey = function (entry) {
        var raw = String((entry && (entry.path || entry.name)) || '').toLowerCase();
        return raw.replace(/(\d+)/g, function (n) {
            return ('00000000' + n).slice(-8);
        });
    };

    Ride.prototype._setAlbumOrder = function () {
        var self = this;
        this.order = this.library.map(function (_, i) { return i; });
        this.order.sort(function (a, b) {
            var ka = self._sortKey(self.library[a]);
            var kb = self._sortKey(self.library[b]);
            if (ka < kb) return -1;
            if (ka > kb) return 1;
            return 0;
        });
        this.orderPos = 0;
    };

    Ride.prototype._currentEntry = function () {
        if (!this.library.length || !this.order.length) return null;
        return this.library[this.order[this.orderPos]];
    };

    Ride.prototype.nextTrack = function () {
        if (this.source === 'tap') {
            this.setStatus('Skip tracks in the player tab. This page cannot change a live stream.');
            return;
        }
        if (this.source === 'demo') {
            this._loadDemo();
            return;
        }
        if (!this.library.length || !this.order.length) return;
        this.orderPos = (this.orderPos + 1) % this.order.length;
        this._playCurrent();
    };

    Ride.prototype.prevTrack = function () {
        if (this.source === 'tap') {
            this.setStatus('Skip tracks in the player tab. This page cannot change a live stream.');
            return;
        }
        if (this.source === 'demo' || !this.library.length || !this.order.length) return;
        this.orderPos = (this.orderPos - 1 + this.order.length) % this.order.length;
        this._playCurrent();
    };

    Ride.prototype.randomTrack = function () {
        if (this.source === 'tap') {
            this.setStatus('Skip tracks in the player tab. This page cannot change a live stream.');
            return;
        }
        if (this.source === 'demo') {
            this._loadDemo();
            return;
        }
        if (!this.library.length || this.order.length < 2) return;
        var next = this.orderPos;
        var guard = 0;
        while (next === this.orderPos && guard < 20) {
            next = Math.floor(Math.random() * this.order.length);
            guard += 1;
        }
        this.orderPos = next;
        this._playCurrent();
    };

    Ride.prototype._playCurrent = function () {
        var entry = this._currentEntry();
        if (!entry) return;
        var self = this;
        var gen = ++this.loadGen;
        this._setNowPlaying('Loading ' + fileBase(entry.name) + '…');
        this._ensureEngine();
        if (this.hooks && this.hooks.stopOtherAudio) this.hooks.stopOtherAudio();
        entryFile(entry).then(function (file) {
            return file.arrayBuffer();
        }).then(function (ab) {
            if (gen !== self.loadGen) return null;
            return self._ctx().decodeAudioData(ab.slice ? ab.slice(0) : ab);
        }).then(function (buf) {
            if (gen !== self.loadGen || !buf) return;
            self.decodeFails = 0;
            self.engine.setBuffer(buf, self.stats.loopSlice);
            self.engine.play();
            self._setNowPlaying(self._displayTitle(entry));
            self._syncPlayBtn();
            self.setStatus(self.stats.loopSlice ? 'Looping an 8s slice.' : 'Playing. Start ride when you want problems.');
            if (self.gameOn) self._beginListen();
        }).catch(function () {
            if (gen !== self.loadGen) return;
            self.decodeFails += 1;
            if (!self.library.length || self.decodeFails >= Math.min(8, self.library.length)) {
                self.setStatus('Could not decode tracks in this library. Try MP3 or WAV.');
                return;
            }
            self.setStatus('Could not decode ' + entry.name + ' — skipping.');
            self.nextTrack();
        });
    };

    Ride.prototype._loadDemo = function () {
        this._ensureEngine();
        if (this.hooks && this.hooks.stopOtherAudio) this.hooks.stopOtherAudio();
        if (!this.demoBuffer) this.demoBuffer = createDemoBuffer(this._ctx());
        this.source = 'demo';
        this.engine.setBuffer(this.demoBuffer, false);
        this.engine.play();
        this._setNowPlaying('Demo bed — C minor pad');
        this._syncPlayBtn();
        this.setStatus('Demo is a stand-in so you can try Ride without a library.');
        if (this.gameOn) this._beginListen();
    };

    Ride.prototype.tapLive = function () {
        var self = this;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            this.setStatus('Tab audio needs Chrome or Edge on a computer.');
            return;
        }
        this._setSource('tap', true);
        navigator.mediaDevices.getDisplayMedia({
            video: { width: 320, height: 180, frameRate: 8 },
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 2,
                suppressLocalAudioPlayback: true
            },
            preferCurrentTab: false,
            systemAudio: 'exclude',
            monitorTypeSurfaces: 'exclude'
        }).then(function (stream) {
            if (!stream.getAudioTracks().length) {
                stream.getTracks().forEach(function (t) { t.stop(); });
                self.setStatus('No audio. Pick the player tab and turn on “Also share tab audio”.');
                return;
            }
            self._ensureEngine();
            if (self.hooks && self.hooks.stopOtherAudio) self.hooks.stopOtherAudio();
            if (self.captureVideo) {
                self.captureVideo.srcObject = stream;
                self.captureVideo.muted = true;
                var playP = self.captureVideo.play();
                if (playP && playP.catch) playP.catch(function () { /* autoplay */ });
            }
            self.engine.setStream(stream);
            self.source = 'tap';
            self._setNowPlaying('Browser tab — live');
            self._syncPlayBtn();
            self.setStatus('Hearing that tab. Start ride to train. Hold Space for clean.');
            if (self.gameOn) self._beginListen();
        }).catch(function (err) {
            if (err && err.name === 'AbortError') return;
            self.setStatus('Could not capture the tab.');
        });
    };

    Ride.prototype._onCaptureEnded = function () {
        if (this.captureVideo) this.captureVideo.srcObject = null;
        if (this.source !== 'tap') return;
        this.setStatus('Tab share ended.');
        this._setNowPlaying('Nothing playing');
        if (this.engine) this.engine.stop(true);
        this._syncPlayBtn();
        if (this.gameOn) this.stopGame();
    };

    function entryFile(entry) {
        if (entry.file) return Promise.resolve(entry.file);
        return entry.handle.getFile();
    }

    async function collectAudio(dirHandle) {
        var out = [];
        async function walk(handle, prefix, depth) {
            if (depth > 8 || out.length >= MAX_LIBRARY) return;
            try {
                for await (var entry of handle.entries()) {
                    var name = entry[0];
                    var child = entry[1];
                    if (!name || name.startsWith('.')) continue;
                    if (child.kind === 'directory' && !SKIP_DIRS.test(name)) {
                        await walk(child, prefix + name + '/', depth + 1);
                    } else if (child.kind === 'file' && AUDIO_EXT.test(name)) {
                        out.push({ name: name, path: prefix + name, handle: child });
                    }
                    if (out.length >= MAX_LIBRARY) return;
                }
            } catch (e) { /* unreadable folder */ }
        }
        await walk(dirHandle, '', 0);
        return out;
    }

    var ride = new Ride();

    global.EQRide = {
        init: function (hooks) { ride.init(hooks); },
        handleKey: function (e) { return ride.handleKey(e); },
        handleKeyUp: function (e) { return ride.handleKeyUp(e); },
        suspendForOtherGame: function () { ride.suspendForOtherGame(); },
        isActive: function () { return ride.isActive(); }
    };
})(window);
