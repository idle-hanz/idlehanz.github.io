/* Ride — live-insert EQ training on a running music source.
   One filter chain stays connected. Problems are gain changes, not restarts. */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'eqEarTrainerRideStats';
    var SET_KEY = 'eqEarTrainerRideSet';
    var STATS_VERSION = 2;
    var LAYOUTS = ['starter', 'seven', 'octaves', 'thirds'];
    /* Staircase for Auto difficulty: 2 right in a row -> smaller change,
       1 wrong -> bigger (2-down/1-up converges on ~71% correct). m is the
       boost size in dB; cuts are played twice as deep (cuts are harder). */
    var STAIR_START = 6;
    var STAIR_MIN = 0.5;
    var STAIR_MAX = 12;
    var STAIR_STEP = 1.26;
    var IDB_NAME = 'eq-ear-trainer-ride';
    var AUDIO_EXT = /\.(mp3|wav|wave|flac|m4a|aac|ogg|opus|webm|aiff|aif)$/i;
    var SKIP_DIRS = /^(node_modules|__pycache__|\.git|\.svn|desktop\.ini)$/i;
    var LISTEN_MS = 1400;
    var REVEAL_MS = 1600;
    var COMPARE_GUESS_MS = 2200;
    var COMPARE_TRUTH_MS = 2400;
    var COMPARE_GAP_MS = 1200;
    var SET_TARGET = 24;
    var NARROW_Q = 6;
    var RIDE_Q = 0.85;
    var MAX_LIBRARY = 4000;
    /* Frequency ID solos one band of the music: two cascaded bandpasses at
       the layout's Q, then a gain that puts every band at the same
       K-weighted loudness (half the full mix, i.e. -6 dB). */
    var SKILLS = ['freq', 'band', 'amount'];
    var SOLO_TARGET = 0.5;
    var SOLO_MIN_GAIN = 0.25;   // -12 dB
    var SOLO_MAX_GAIN = 40;     // +32 dB, for bands the song barely uses
    var FREQ_LISTEN_MS = 900;

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

    function kWeightMag(freq) {
        var f = Math.max(20, freq || 1000);
        var hp = (f * f) / (f * f + 38 * 38);
        var s = f / 1682;
        var shelf = (1 + 1.58 * s) / (1 + s);
        return hp * shelf;
    }

    function detectabilityScale(freq) {
        if (freq < 70) return 1.5;
        if (freq < 140) return 1.28;
        if (freq < 350) return 1.12;
        if (freq < 1800) return 1.0;
        if (freq < 4500) return 0.82;
        if (freq < 7500) return 0.92;
        return 1.38;
    }

    function scaleDetectability(gain, freq) {
        var signed = gain < 0 ? -1 : 1;
        var g = Math.abs(gain) * detectabilityScale(freq);
        g = Math.max(1, Math.min(14, g));
        return signed * g;
    }

    function compensationDb(gainDb, q, freq) {
        var qClamped = Math.min(Math.max(q || 1.2, 0.5), 10);
        var width = 1.2 / qClamped;
        var k = kWeightMag(freq);
        var factor = 0.34 * Math.min(1, width + 0.14) * Math.min(1.35, 0.5 + k);
        return -gainDb * factor;
    }

    function rmsBuffer(buf) {
        var d = buf.getChannelData(0);
        var s = 0;
        for (var i = 0; i < d.length; i++) s += d[i] * d[i];
        return Math.sqrt(s / Math.max(1, d.length));
    }

    function renderKWeighted(buffer, startSec, dur, eq) {
        var sr = buffer.sampleRate;
        var frames = Math.max(256, Math.floor(sr * dur));
        var maxStart = Math.max(0, buffer.length - frames);
        var off = Math.min(Math.max(0, Math.floor(startSec * sr)), maxStart);
        var ctx = new OfflineAudioContext(1, frames, sr);
        var src = ctx.createBufferSource();
        src.buffer = buffer;
        var node = src;
        if (eq && eq.kind === 'solo') {
            [0, 1].forEach(function () {
                var bp = ctx.createBiquadFilter();
                bp.type = 'bandpass';
                bp.frequency.value = eq.freq;
                bp.Q.value = eq.q;
                node.connect(bp);
                node = bp;
            });
        } else if (eq && Math.abs(eq.gain) > 0.01) {
            var p = ctx.createBiquadFilter();
            p.type = 'peaking';
            p.frequency.value = eq.freq;
            p.Q.value = eq.q || 1.2;
            p.gain.value = eq.gain;
            node.connect(p);
            node = p;
        }
        var hs = ctx.createBiquadFilter();
        hs.type = 'highshelf';
        hs.frequency.value = 1682;
        hs.gain.value = 4;
        var hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 38;
        hp.Q.value = 0.5;
        node.connect(hs);
        hs.connect(hp);
        hp.connect(ctx.destination);
        src.start(0, off / sr, dur);
        return ctx.startRendering().then(rmsBuffer);
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

    function RideEngine(ctx, output) {
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
        this.gate.connect(output || ctx.destination);
        // Solo path for Frequency ID: input -> bandpass -> bandpass -> solo.
        this.bp1 = ctx.createBiquadFilter();
        this.bp2 = ctx.createBiquadFilter();
        this.bp1.type = 'bandpass';
        this.bp2.type = 'bandpass';
        this.solo = ctx.createGain();
        this.solo.gain.value = 0;
        this.input.connect(this.bp1);
        this.bp1.connect(this.bp2);
        this.bp2.connect(this.solo);
        this.solo.connect(this.gate);
        this._probe = ctx.createBiquadFilter();
        this._probe.type = 'bandpass';
        // Long window, no smoothing, sampled every 200 ms (windows overlap),
        // so short hits (kick, hats) count as much as sustained notes.
        this.ltAn = ctx.createAnalyser();
        this.ltAn.fftSize = 16384;
        this.ltAn.smoothingTimeConstant = 0;
        this.input.connect(this.ltAn);
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.35;
        this.input.connect(this.analyser);
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
        this.lt = null;
        this.ltFrames = 0;
        var self = this;
        this._ltTimer = setInterval(function () { self._sampleSpectrum(); }, 200);
    }

    /* Long-term average power spectrum of what is playing (about a 4 s
       window). Used to level-match soloed bands on any source, including
       a captured tab where there is no buffer to render offline. */
    RideEngine.prototype._resetSpectrum = function () {
        this.lt = null;
        this.ltFrames = 0;
    };

    RideEngine.prototype._sampleSpectrum = function () {
        if (!this.playing || !this.ltAn) return;
        var n = this.ltAn.frequencyBinCount;
        if (!this._ltBuf || this._ltBuf.length !== n) this._ltBuf = new Float32Array(n);
        this.ltAn.getFloatFrequencyData(this._ltBuf);
        var peak = -200;
        for (var j = 0; j < n; j++) if (this._ltBuf[j] > peak) peak = this._ltBuf[j];
        if (!(peak > -110)) return; // silence teaches nothing about the spectrum
        if (!this.lt || this.lt.length !== n) {
            this.lt = new Float32Array(n);
            this.ltFrames = 0;
        }
        var a = this.ltFrames < 25 ? 1 / (this.ltFrames + 1) : 0.04;
        for (var i = 0; i < n; i++) {
            var p = Math.pow(10, this._ltBuf[i] / 10);
            if (!isFinite(p)) p = 0;
            this.lt[i] += (p - this.lt[i]) * a;
        }
        this.ltFrames += 1;
    };

    /* Gain that brings a soloed band (cascaded bandpass at freq/q) to
       SOLO_TARGET x the K-weighted loudness of the full mix. */
    RideEngine.prototype.soloGainFor = function (freq, q) {
        if (!this.lt || this.ltFrames < 2) this._sampleSpectrum();
        var spec = this.lt;
        if (!spec) return 4;
        var n = spec.length;
        var binHz = this.ctx.sampleRate / this.ltAn.fftSize;
        if (!this._binF || this._binF.length !== n) {
            this._binF = new Float32Array(n);
            this._kw = new Float32Array(n);
            for (var i = 0; i < n; i++) {
                var f = Math.max(1, i * binHz);
                this._binF[i] = f;
                var k = kWeightMag(f);
                this._kw[i] = f < 20 ? 0 : k * k;
            }
            this._mag = new Float32Array(n);
            this._ph = new Float32Array(n);
        }
        this._probe.frequency.value = freq;
        this._probe.Q.value = q;
        this._probe.getFrequencyResponse(this._binF, this._mag, this._ph);
        var tot = 0;
        var band = 0;
        for (var b = 1; b < n; b++) {
            var pk = spec[b] * this._kw[b];
            var m = this._mag[b];
            tot += pk;
            band += pk * m * m * m * m; // two stages -> |H|^4 in power
        }
        if (!(tot > 1e-14) || !(band > 1e-18)) return SOLO_MAX_GAIN / 4;
        var g = SOLO_TARGET * Math.sqrt(tot / band);
        return Math.max(SOLO_MIN_GAIN, Math.min(SOLO_MAX_GAIN, g));
    };

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

    /* Files and the demo: refine the spectral estimate by rendering the
       next 3 s offline, full mix vs soloed band, both K-weighted. */
    RideEngine.prototype.calibrateSolo = function (spec) {
        if (!spec || spec.kind !== 'solo' || this.kind !== 'buffer' || !this.buffer) return;
        if (typeof OfflineAudioContext === 'undefined') return;
        var buf = this.buffer;
        var start = this.loopEnabled ? this.loopStart + this._nowOffset() : this._nowOffset();
        var dur = Math.min(3, buf.duration);
        var self = this;
        Promise.all([
            renderKWeighted(buf, start, dur, null),
            renderKWeighted(buf, start, dur, spec)
        ]).then(function (r) {
            if (self.buffer !== buf || !(r[0] > 1e-6) || !(r[1] > 1e-9)) return;
            var g = Math.max(SOLO_MIN_GAIN, Math.min(SOLO_MAX_GAIN, SOLO_TARGET * r[0] / r[1]));
            spec.soloGain = g;
            var p = self.problem;
            if (p && p.kind === 'solo' && p.freq === spec.freq && Math.abs(p.q - spec.q) < 1e-6) {
                p.soloGain = g;
                if (!self.abClean) {
                    var t = self.ctx.currentTime;
                    self.solo.gain.cancelScheduledValues(t);
                    self.solo.gain.setValueAtTime(self.solo.gain.value, t);
                    self.solo.gain.setTargetAtTime(g, t, 0.03);
                }
            }
        }).catch(function () { /* keep the spectral estimate */ });
    };

    RideEngine.prototype.setBuffer = function (buffer, slice) {
        if (buffer !== this.buffer) this._resetSpectrum();
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
        this._resetSpectrum();
        this.clearProblem();
        var t = this.ctx.currentTime;
        this.dry.gain.cancelScheduledValues(t);
        this.wet.gain.cancelScheduledValues(t);
        this.dry.gain.setValueAtTime(1, t);
        this.wet.gain.setValueAtTime(0, t);
        var src = this.ctx.createMediaStreamSource(stream);
        src.connect(this.input);
        this.streamSource = src;
        this.playing = true;
        var self = this;
        stream.getTracks().forEach(function (track) {
            track.addEventListener('ended', function () {
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
            kind: problem.kind === 'solo' ? 'solo' : 'eq',
            index: problem.index,
            freq: problem.freq,
            gain: problem.gain || 0,
            soloGain: problem.soloGain || 1,
            compGain: problem.compGain,
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

    RideEngine.prototype.setGate = function (value, seconds) {
        var t = this.ctx.currentTime;
        this.gate.gain.cancelScheduledValues(t);
        this.gate.gain.setValueAtTime(this.gate.gain.value, t);
        this.gate.gain.linearRampToValueAtTime(value, t + (seconds || 0.04));
    };

    RideEngine.prototype.bandHasEnergy = function (freq) {
        if (!this.analyser || !freq) return true;
        var n = this.analyser.frequencyBinCount;
        if (!this._spec || this._spec.length !== n) this._spec = new Float32Array(n);
        this.analyser.getFloatFrequencyData(this._spec);
        var sr = this.ctx.sampleRate;
        var binHz = sr / this.analyser.fftSize;
        var lo = freq / 1.7;
        var hi = freq * 1.7;
        var peak = -140;
        var sum = 0;
        var count = 0;
        for (var i = 1; i < n; i++) {
            var f = i * binHz;
            var v = this._spec[i];
            if (f >= 30 && f <= 16000) {
                sum += v;
                count++;
            }
            if (f >= lo && f <= hi && v > peak) peak = v;
        }
        // Silence (or a gap between tracks) is not a place to hide a problem.
        if (!isFinite(peak) || peak < -120) return false;
        var avg = count ? sum / count : -80;
        return peak > -62 && peak > avg - 3;
    };

    RideEngine.prototype.isSilent = function () {
        if (!this.analyser || !this.playing) return true;
        var n = this.analyser.fftSize;
        if (!this._td || this._td.length !== n) this._td = new Float32Array(n);
        this.analyser.getFloatTimeDomainData(this._td);
        var peak = 0;
        for (var i = 0; i < n; i++) {
            var a = Math.abs(this._td[i]);
            if (a > peak) peak = a;
        }
        return peak < 0.0015; // about -56 dBFS
    };

    RideEngine.prototype.calibrateCompensation = function (problem) {
        if (!problem) return;
        var fallback = dbToGain(compensationDb(problem.gain, problem.q, problem.freq));
        problem.compGain = fallback;
        this.comp.gain.setValueAtTime(fallback, this.ctx.currentTime);
        if (this.kind !== 'buffer' || !this.buffer || typeof OfflineAudioContext === 'undefined') return;
        var start = this.loopEnabled ? this.loopStart + this._nowOffset() : this._nowOffset();
        var self = this;
        Promise.all([
            renderKWeighted(this.buffer, start, 0.45, null),
            renderKWeighted(this.buffer, start, 0.45, problem)
        ]).then(function (pair) {
            if (!self.problem || self.problem.freq !== problem.freq) return;
            var clean = pair[0];
            var wet = pair[1];
            if (!(wet > 1e-8) || !(clean > 1e-8)) return;
            var g = Math.max(0.32, Math.min(2.6, clean / wet));
            problem.compGain = g;
            self.comp.gain.setTargetAtTime(g, self.ctx.currentTime, 0.03);
        }).catch(function () { /* keep formula */ });
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
        var solo = !!(this.problem && this.problem.kind === 'solo');
        var soloT = 0;
        if (solo) {
            this.bp1.frequency.setValueAtTime(this.problem.freq, t);
            this.bp2.frequency.setValueAtTime(this.problem.freq, t);
            this.bp1.Q.setValueAtTime(this.problem.q, t);
            this.bp2.Q.setValueAtTime(this.problem.q, t);
            this.eq.gain.setValueAtTime(0, t);
            this.comp.gain.setValueAtTime(1, t);
            soloT = active ? this.problem.soloGain : 0;
        } else if (this.problem && typeof this.problem.freq === 'number') {
            this.eq.frequency.setValueAtTime(this.problem.freq, t);
            this.eq.Q.setValueAtTime(this.problem.q || RIDE_Q, t);
            this.eq.gain.setValueAtTime(this.problem.gain, t);
            this.comp.gain.setValueAtTime(
                this.problem.compGain != null
                    ? this.problem.compGain
                    : dbToGain(compensationDb(this.problem.gain, this.problem.q, this.problem.freq)),
                t
            );
        } else {
            this.eq.gain.setValueAtTime(0, t);
            this.comp.gain.setValueAtTime(1, t);
        }
        if (this.kind === 'stream') {
            this.dry.gain.cancelScheduledValues(t);
            this.wet.gain.cancelScheduledValues(t);
            this.solo.gain.cancelScheduledValues(t);
            this.dry.gain.setValueAtTime(active ? 0 : 1, t);
            this.wet.gain.setValueAtTime(active && !solo ? 1 : 0, t);
            this.solo.gain.setValueAtTime(soloT, t);
        } else {
            this._snap(this.dry.gain, active ? 0 : 1, t);
            this._snap(this.wet.gain, active && !solo ? 1 : 0, t);
            this._snap(this.solo.gain, soloT, t);
        }
    };

    function defaultStats() {
        return {
            version: STATS_VERSION,
            skill: 'freq',
            bandStep: 1,
            bandAuto: false,
            amountLevel: 'easy',
            bandMode: 'seven',
            loop: true,
            loopSlice: false,
            gapAB: false,
            streak: 0,
            correct: 0,
            total: 0,
            perBand: {},
            stair: {},
            // Frequency ID keeps its own streak/accuracy (per-band rows are
            // already separate: their key contains "freq:solo").
            freq: { streak: 0, correct: 0, total: 0 }
        };
    }

    function loadStats() {
        try {
            var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            var s = defaultStats();
            if (SKILLS.indexOf(raw.skill) >= 0) s.skill = raw.skill;
            if (raw.skill === 'direction') s.skill = 'band';
            if (typeof raw.bandStep === 'number' && raw.bandStep >= 1 && raw.bandStep <= 6) {
                s.bandStep = raw.bandStep;
            } else if (raw.bandLevel === 'medium') {
                s.bandStep = 3;
            } else if (raw.bandLevel === 'hard') {
                s.bandStep = 5;
            }
            if (raw.amountLevel === 'easy' || raw.amountLevel === 'hard') s.amountLevel = raw.amountLevel;
            if (LAYOUTS.indexOf(raw.bandMode) >= 0) s.bandMode = raw.bandMode;
            else if (raw.bandMode === 'few') s.bandMode = 'seven';
            else if (raw.bandMode === 'many') s.bandMode = 'octaves';
            if (typeof raw.bandAuto === 'boolean') s.bandAuto = raw.bandAuto;
            if (typeof raw.loop === 'boolean') s.loop = raw.loop;
            if (typeof raw.loopSlice === 'boolean') s.loopSlice = raw.loopSlice;
            if (typeof raw.gapAB === 'boolean') s.gapAB = raw.gapAB;
            if (typeof raw.streak === 'number') s.streak = raw.streak;
            if (typeof raw.correct === 'number') s.correct = raw.correct;
            if (typeof raw.total === 'number') s.total = raw.total;
            if (raw.freq && typeof raw.freq === 'object') {
                ['streak', 'correct', 'total'].forEach(function (k) {
                    if (typeof raw.freq[k] === 'number' && isFinite(raw.freq[k])) s.freq[k] = raw.freq[k];
                });
            }
            /* v1 per-band history mixed every layout and difficulty together,
               so it is dropped; overall streak/accuracy carry over. */
            if (raw.version === STATS_VERSION) {
                if (raw.perBand && typeof raw.perBand === 'object') s.perBand = raw.perBand;
                if (raw.stair && typeof raw.stair === 'object') s.stair = raw.stair;
            }
            if (s.skill === 'amount' && s.bandMode === 'thirds') s.bandMode = 'octaves';
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

    /* One daily set per game kind: Frequency ID and the EQ games. */
    function setKey(kind) {
        return kind === 'freq' ? SET_KEY + ':freq' : SET_KEY;
    }

    function loadSet(kind) {
        try {
            var s = JSON.parse(localStorage.getItem(setKey(kind)) || 'null');
            if (!s || typeof s.date !== 'string' || typeof s.done !== 'number') return null;
            return {
                kind: kind === 'freq' ? 'freq' : 'music',
                date: s.date,
                done: s.done,
                hits: typeof s.hits === 'number' ? s.hits : 0,
                activeMs: typeof s.activeMs === 'number' ? s.activeMs : 0,
                finished: !!s.finished,
                log: Array.isArray(s.log) ? s.log.slice(-200) : []
            };
        } catch (e) {
            return null;
        }
    }

    function saveSet(session) {
        if (!session) return;
        try {
            localStorage.setItem(setKey(session.kind), JSON.stringify(session));
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
        this.free = false;      // Free play: band buttons audition, nothing is scored
        this.freeSel = null;
        this.tourOn = false;
        this.tourIndex = 0;
        this.session = null;
        this.setTimer = null;
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
        this._syncGapUi();
        this._ensureSession(false);
        this._renderGuess();
        this._renderStats();
        this._renderWeakMap();
        this._renderSetBar();
        this.setStatus(this._isFreq()
            ? 'Frequency ID: press Start ride (demo, folder or tab) and name the soloed band.'
            : 'Choose a folder, then Start ride.');
        this._tryRestoreFolder();
    };

    Ride.prototype._ctx = function () {
        return this.hooks.getContext();
    };

    Ride.prototype._ensureEngine = function () {
        var ctx = this._ctx();
        if (!this.engine || this.engine.ctx !== ctx) {
            this.engine = new RideEngine(ctx, this.hooks.getOutput ? this.hooks.getOutput() : null);
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
        var helpBtn = byId('ride-help-btn');
        if (helpBtn) helpBtn.addEventListener('click', function () { self.openHelp(); });
        var tourNext = byId('ride-tour-next');
        if (tourNext) tourNext.addEventListener('click', function () { self._tourNext(); });
        var tourBack = byId('ride-tour-back');
        if (tourBack) tourBack.addEventListener('click', function () { self._tourBack(); });
        var tourSkip = byId('ride-tour-skip');
        if (tourSkip) tourSkip.addEventListener('click', function () { self.closeHelp(); });
        document.addEventListener('keydown', function (e) {
            if (!self.tourOn) return;
            if (e.key === 'Escape') self.closeHelp();
            if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); self._tourNext(); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); self._tourBack(); }
        });
        window.addEventListener('resize', function () { if (self.tourOn) self._placeTour(); });
        window.addEventListener('scroll', function () { if (self.tourOn) self._placeTour(); }, true);
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
        var gapBtn = byId('ride-gap-btn');
        if (gapBtn) gapBtn.addEventListener('click', function () { self.toggleGapAB(); });
        var setNew = byId('ride-set-new');
        if (setNew) setNew.addEventListener('click', function () { self._ensureSession(true); });
        var setKeep = byId('ride-set-keep');
        if (setKeep) setKeep.addEventListener('click', function () { self._dismissSetReport(true); });
        var setDone = byId('ride-set-done');
        if (setDone) setDone.addEventListener('click', function () { self._dismissSetReport(false); });
        var levelChips = byId('ride-level-chips');
        if (levelChips) {
            levelChips.addEventListener('click', function (e) {
                var lay = e.target.closest('[data-layout]');
                if (lay) {
                    self._setBandMode(lay.getAttribute('data-layout'));
                    return;
                }
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

        SKILLS.forEach(function (skill) {
            var b = byId('ride-skill-' + skill);
            if (b) b.addEventListener('click', function () { self._setSkill(skill); });
        });
        var freeBtn = byId('ride-free-btn');
        if (freeBtn) freeBtn.addEventListener('click', function () { self.toggleFree(); });
        document.querySelectorAll('#ride-layout-row [data-layout]').forEach(function (btn) {
            btn.addEventListener('click', function () { self._setBandMode(btn.getAttribute('data-layout')); });
        });

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
        ['library', 'tap'].forEach(function (s) {
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

    Ride.prototype._isFreq = function () {
        return this.stats.skill === 'freq';
    };

    Ride.prototype._setSkill = function (skill, silent) {
        if (SKILLS.indexOf(skill) < 0) skill = 'band';
        var changed = skill !== this.stats.skill;
        this.stats.skill = skill;
        if (skill === 'amount' && this.stats.bandMode === 'thirds') {
            this._setBandMode('octaves', true);
        }
        this._syncLayoutUi();
        SKILLS.forEach(function (s) {
            var btn = document.getElementById('ride-skill-' + s);
            if (btn) {
                btn.classList.toggle('is-active', s === skill);
                btn.setAttribute('aria-pressed', s === skill ? 'true' : 'false');
            }
        });
        if (this.els.panel) this.els.panel.classList.toggle('is-freq', skill === 'freq');
        this.deck = [];
        if (this.free) this._clearFreeSel();
        this._syncSkillUi();
        this._renderGuess();
        if (this.els.streak) {
            this._ensureSession(false);
            this._renderStats();
        }
        if (!silent) {
            saveStats(this.stats);
            if (this.gameOn) this._beginListen();
            else if (this.free) this.setStatus(this._freeHint());
            if (changed && this.hooks && this.hooks.onSkillChange) this.hooks.onSkillChange(skill);
        }
    };

    Ride.prototype._syncSkillUi = function () {
        var amount = this.stats.skill === 'amount';
        var freq = this._isFreq();
        var host = document.getElementById('ride-level-chips');
        if (host) {
            host.innerHTML = '';
            host.appendChild(freq ? this._freqDiffBoard() : amount ? this._amountDiffBoard() : this._bandDiffBoard());
        }
        if (!this.els.skillHint) return;
        if (freq) {
            var set = this._bandSet(this.stats.bandMode);
            this.els.skillHint.textContent = 'Now: ' + set.label + ' · one band of the song soloed (bandpass Q ' + set.q +
                '), every band at the same loudness';
        } else if (amount) {
            this.els.skillHint.textContent = this.stats.amountLevel === 'hard'
                ? 'Now: Hard — boost +3 / +1.5, cut −3 / −6'
                : 'Now: Easy — boost +6 / +3, cut −6 / −12';
        } else if (this.stats.bandAuto) {
            this.els.skillHint.textContent = 'Now: Auto — each band adapts on its own (2 right = smaller, 1 wrong = bigger). Boosts and cuts mixed; cuts are twice as deep.';
        } else {
            var rung = BAND_LADDER[(this.stats.bandStep || 1) - 1] || BAND_LADDER[0];
            var group = rung.step <= 2 ? 'Easy' : rung.step <= 4 ? 'Medium' : 'Hard';
            var lo = Infinity, hi = -Infinity;
            (this.bands || []).forEach(function (b) {
                var g = Math.abs(scaleDetectability(rung.gain, b.freq));
                if (g < lo) lo = g;
                if (g > hi) hi = g;
            });
            var sign = rung.gain > 0 ? '+' : '−';
            var range = isFinite(lo) && hi - lo > 0.05
                ? ' — actually plays ' + sign + (Math.round(lo * 10) / 10) + ' to ' + sign + (Math.round(hi * 10) / 10) + ' dB, scaled per band for audibility'
                : '';
            this.els.skillHint.textContent = 'Now: ' + group + ' · ' + (rung.gain > 0 ? 'boost' : 'cut') + ' ' + rung.label + ' dB' + range;
        }
    };

    Ride.prototype._bandDiffBoard = function () {
        var step = this.stats.bandAuto ? 0 : (this.stats.bandStep || 1);
        var board = document.createElement('div');
        board.className = 'ride-diff-board has-auto';
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
        var autoCol = document.createElement('div');
        autoCol.className = 'ride-diff-col';
        var autoLab = document.createElement('div');
        autoLab.className = 'ride-diff-col-label';
        autoLab.textContent = 'Auto';
        autoCol.appendChild(autoLab);
        var autoBtn = document.createElement('button');
        autoBtn.type = 'button';
        autoBtn.className = 'ride-diff-cell is-auto' + (this.stats.bandAuto ? ' is-active' : '');
        autoBtn.dataset.level = 'auto';
        autoBtn.title = 'Adaptive: each band finds your threshold';
        autoBtn.innerHTML = '<strong>Adaptive</strong><span>per band</span>';
        autoCol.appendChild(autoBtn);
        board.appendChild(autoCol);
        return board;
    };

    /* Frequency ID has no gain to shrink: it gets harder by naming finer
       bands, so the "difficulty" is the band layout. */
    Ride.prototype._freqDiffBoard = function () {
        var cur = this.stats.bandMode;
        var board = document.createElement('div');
        board.className = 'ride-diff-board is-amount is-freq';
        var sets = this.hooks.getBandSets();
        [
            { id: 'starter', name: 'Easy', line: '4 bands, two octaves apart' },
            { id: 'seven', name: 'Medium', line: '7 named ranges' },
            { id: 'octaves', name: 'Hard', line: '9 octave bands' },
            { id: 'thirds', name: 'Expert', line: '24 third-octave bands' }
        ].forEach(function (item) {
            if (!sets[item.id]) return;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ride-diff-card' + (cur === item.id ? ' is-active' : '');
            btn.dataset.layout = item.id;
            btn.innerHTML = '<b>' + item.name + '</b><span>' + item.line + '</span>';
            board.appendChild(btn);
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
        } else if (level === 'auto') {
            this.stats.bandAuto = true;
        } else {
            var step = parseInt(level, 10);
            if (!(step >= 1 && step <= 6)) step = 1;
            this.stats.bandStep = step;
            this.stats.bandAuto = false;
        }
        this.deck = [];
        if (this.free) this._clearFreeSel();
        this._renderWeakMap();
        this._renderStats();
        this._syncSkillUi();
        this._renderGuess();
        if (!silent) {
            saveStats(this.stats);
            if (this.gameOn) this._beginListen();
        }
    };

    /* One idea per card. A first-time visitor should be able to set up
       music and play after this, without a manual. */
    Ride.prototype.TOUR = [
        {
            target: '.ride-top',
            source: 'library',
            skill: 'band',
            title: 'What this is',
            html: 'Ride trains your ear on <strong>your own music</strong>. The song keeps playing. Either one band of it is soloed, or one part is made louder or quieter. You name it.'
        },
        {
            target: '#ride-source-tap',
            source: 'library',
            title: 'Streaming',
            html: 'Already playing Amazon Music, Spotify, or YouTube in another tab? Start here. Click <strong>Browser tab</strong>. Use Chrome or Edge on a computer.'
        },
        {
            target: '#ride-tap-controls',
            source: 'tap',
            title: 'Hook that tab',
            html: 'Click <strong>Choose tab</strong>. Pick the music tab — not this page, not a window, not the whole screen. Turn on <strong>Also share tab audio</strong>. That mutes the player so you only hear it here.'
        },
        {
            target: '#ride-library-controls',
            source: 'library',
            title: 'Or use files',
            html: 'No stream? Stay on <strong>My albums</strong> and click <strong>Choose folder</strong>. Songs play in album order. <strong>Add files</strong> if you only want a few tracks.'
        },
        {
            target: '#ride-transport-nav',
            source: 'library',
            title: 'Move around the music',
            html: '<strong>Play</strong>, previous, next. <strong>Random</strong> jumps, then the album continues. <strong>Loop</strong> repeats the track. <strong>Slice 8s</strong> loops a short section so comparing is easier. On a live tab, change songs in the player.'
        },
        {
            target: '.ride-prompt-row',
            title: 'Your cue',
            html: 'This line tells you what to do next. Press <strong>Space</strong> to start a ride. Once a change is on, hold <strong>Space</strong> to hear the song clean; let go to hear the change again. Tap and hold the gold badge for the same thing.'
        },
        {
            target: '.ride-setup-row',
            skill: 'freq',
            title: 'Three games',
            html: '<strong>Frequency ID</strong> (start here): one band of the song plays on its own, level-matched — name it. <strong>Which band?</strong> The full song with one band boosted or cut — name the band. <strong>Band + amount</strong>: band and how much in one tap. Start with <strong>4</strong> or <strong>7 bands</strong>, then <strong>Octaves</strong>, then <strong>Thirds</strong>. Filters get narrower as the bands get closer.'
        },
        {
            target: '#ride-level-row',
            skill: 'band',
            title: 'How hard',
            html: 'Easy is a big boost (<strong>+6 dB</strong> — clearly louder). Next is a bigger cut (<strong>−12</strong>), because cuts are harder to hear. Then it gets smaller. The exact amount is scaled a little per band so each is equally audible; the line above shows the real range. <strong>Auto</strong> adapts each band to you and tracks your threshold in dB.'
        },
        {
            target: '#ride-guess-buttons',
            skill: 'amount',
            title: 'Band + amount',
            html: 'Each column is a band. Pads <strong>above</strong> the name turn it up. Pads <strong>below</strong> turn it down. One tap is your whole answer.'
        },
        {
            target: '#ride-free-btn',
            skill: 'band',
            title: 'Learn first',
            html: 'Turn on <strong>Free play</strong> and every band button plays at once on the music — in Frequency ID it solos that band, in the EQ games it applies that boost or cut. Tap it again to go back. Nothing is scored. Turn it off, then Start ride to be quizzed.'
        },
        {
            target: '#ride-progress',
            title: 'Daily set',
            html: 'A session is <strong>24 problems</strong> and survives a page refresh. <strong>New set</strong> starts a fresh 24. The chips under the score are your weakness map for this layout and difficulty — red bands come back more often. In Auto they also show your threshold.'
        },
        {
            target: '#ride-game-btn',
            title: 'Start ride',
            html: 'Music playing? Press <strong>Start ride</strong>. After a short listen, a change appears. Tap what you heard. Silent spots are skipped, and loudness is matched, so you hear the EQ — not a volume trick.'
        },
        {
            target: '#ride-gap-btn',
            title: 'If you miss',
            html: 'Green is right. Red is wrong. A miss plays <strong>your guess</strong> on this song, then the <strong>truth</strong>. Click the result to skip. Turn on <strong>Gap A/B</strong> if you want a short silence between them.'
        },
        {
            target: '#ride-help-btn',
            title: 'You are ready',
            html: '<strong>Help</strong> is always here. <strong>Corrective EQ</strong> lives in the tab above. Pick music, Start ride, hold Space, tap what you heard.'
        }
    ];

    Ride.prototype.openHelp = function () {
        var el = document.getElementById('ride-tour');
        if (!el) return;
        this.tourOn = true;
        this.tourIndex = 0;
        this._tourPrevSource = this.source || 'library';
        this._tourPrevSkill = (this.stats && this.stats.skill) || 'freq';
        if (el.parentNode !== document.body) document.body.appendChild(el);
        el.classList.remove('hidden');
        this._showTourStep();
    };

    Ride.prototype.closeHelp = function () {
        this.tourOn = false;
        var el = document.getElementById('ride-tour');
        if (el) el.classList.add('hidden');
        if (this._tourPrevSource && this._tourPrevSource !== this.source) {
            this._setSource(this._tourPrevSource, true);
        }
        if (this._tourPrevSkill && this.stats && this._tourPrevSkill !== this.stats.skill) {
            this._setSkill(this._tourPrevSkill, true);
        }
    };

    Ride.prototype._tourNext = function () {
        if (!this.tourOn) return;
        if (this.tourIndex >= this.TOUR.length - 1) {
            this.closeHelp();
            return;
        }
        this.tourIndex += 1;
        this._showTourStep();
    };

    Ride.prototype._tourBack = function () {
        if (!this.tourOn || this.tourIndex <= 0) return;
        this.tourIndex -= 1;
        this._showTourStep();
    };

    Ride.prototype._showTourStep = function () {
        var step = this.TOUR[this.tourIndex];
        if (!step) return;
        if (step.source) this._setSource(step.source, true);
        if (step.skill) this._setSkill(step.skill, true);
        var title = document.getElementById('ride-tour-title');
        var body = document.getElementById('ride-tour-body');
        var num = document.getElementById('ride-tour-step');
        var next = document.getElementById('ride-tour-next');
        var back = document.getElementById('ride-tour-back');
        if (title) title.textContent = step.title;
        if (body) {
            if (step.html) body.innerHTML = step.html;
            else body.textContent = step.body || '';
        }
        if (num) num.textContent = (this.tourIndex + 1) + ' / ' + this.TOUR.length;
        if (next) next.textContent = this.tourIndex >= this.TOUR.length - 1 ? 'Got it' : 'Next';
        if (back) back.disabled = this.tourIndex <= 0;
        var self = this;
        var target = document.querySelector(step.target);
        if (target && target.scrollIntoView) {
            target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }
        window.setTimeout(function () { self._placeTour(); }, (step.source || step.skill) ? 360 : 220);
    };

    Ride.prototype._placeTour = function () {
        if (!this.tourOn) return;
        var step = this.TOUR[this.tourIndex];
        var spot = document.getElementById('ride-tour-spot');
        var card = document.getElementById('ride-tour-card');
        var arrow = document.getElementById('ride-tour-arrow');
        if (!step || !spot || !card) return;
        var target = document.querySelector(step.target);
        if (!target) {
            spot.style.display = 'none';
            card.style.left = '50%';
            card.style.top = '38%';
            card.style.transform = 'translate(-50%, -50%)';
            if (arrow) arrow.style.display = 'none';
            return;
        }
        var r = target.getBoundingClientRect();
        var pad = 8;
        var hlW = Math.max(r.width + pad * 2, 52);
        var hlH = Math.max(r.height + pad * 2, 36);
        var hlL = r.left + r.width / 2 - hlW / 2;
        var hlT = r.top + r.height / 2 - hlH / 2;
        spot.style.display = 'block';
        spot.style.top = Math.max(6, hlT) + 'px';
        spot.style.left = Math.max(6, hlL) + 'px';
        spot.style.width = Math.min(window.innerWidth - 12, hlW) + 'px';
        spot.style.height = Math.min(window.innerHeight - 12, hlH) + 'px';
        var cardW = card.offsetWidth || 320;
        var cardH = card.offsetHeight || 180;
        var huge = r.height > window.innerHeight * 0.42;
        var below = !huge && (r.bottom + 22 + cardH < window.innerHeight - 10 || r.top < cardH + 28);
        var top = huge
            ? window.innerHeight - cardH - 16
            : (below ? r.bottom + 18 : r.top - 18 - cardH);
        top = Math.max(10, Math.min(top, window.innerHeight - cardH - 10));
        var left = huge
            ? (window.innerWidth - cardW) / 2
            : (r.left + r.width / 2 - cardW / 2);
        left = Math.max(10, Math.min(left, window.innerWidth - cardW - 10));
        card.style.transform = 'none';
        card.style.top = top + 'px';
        card.style.left = left + 'px';
        if (arrow) {
            if (huge) {
                arrow.style.display = 'none';
            } else {
                arrow.style.display = 'block';
                arrow.className = 'ride-tour-arrow ' + (below ? 'up' : 'down');
                arrow.style.left = Math.max(18, Math.min(cardW - 28, r.left + r.width / 2 - left - 8)) + 'px';
            }
        }
    };

    /* ---- Free play: tap a band, hear it now. Replaces the old Watch mode
       (which made you wait for each answer to come round). ---- */
    Ride.prototype.toggleFree = function () {
        this._setFree(!this.free);
    };

    Ride.prototype._freeHint = function () {
        if (this._isFreq()) return 'Free play: tap any band to solo it on the music. Tap it again for the full mix.';
        if (this.stats.skill === 'amount') return 'Free play: tap any pad to hear that boost or cut on the music. Tap it again for clean.';
        return 'Free play: tap any band to hear this level\u2019s change on it. Tap it again for clean.';
    };

    Ride.prototype._setFree = function (on, quiet) {
        this.free = !!on;
        if (this.free && this.gameOn) this.stopGame();
        this._clearFreeSel();
        this._hideResult();
        var btn = document.getElementById('ride-free-btn');
        if (btn) {
            btn.classList.toggle('is-active', this.free);
            btn.setAttribute('aria-pressed', this.free ? 'true' : 'false');
        }
        if (this.els.panel) this.els.panel.classList.toggle('is-free', this.free);
        if (quiet) return;
        if (this.free) {
            this._ensureMusic();
            this.setStatus(this._freeHint());
        } else {
            this.setStatus('Free play off. Press Start ride to be quizzed.');
        }
    };

    Ride.prototype._clearFreeSel = function () {
        this.freeSel = null;
        if (this.engine && !this.gameOn) this.engine.clearProblem();
        this._clearHighlights();
        this._updateABBadge();
    };

    /* Make sure something is playing: current source, else the library,
       else the demo. */
    Ride.prototype._ensureMusic = function () {
        this._ensureEngine();
        if (this.hooks && this.hooks.stopOtherAudio) this.hooks.stopOtherAudio();
        if (this.engine.playing) return;
        if (this.engine.kind === 'stream' || this.engine.buffer) {
            this.engine.play();
            this._syncPlayBtn();
            return;
        }
        if (this.source === 'library' && this.library.length) {
            this._playCurrent();
            return;
        }
        this._setSource('demo');
    };

    Ride.prototype._freeBand = function (index, gain) {
        var band = this.bands[index];
        if (!band) return;
        var key = index + '|' + (gain == null ? '' : gain);
        if (this.freeSel === key) {
            this._clearFreeSel();
            this.setStatus(this._isFreq() ? 'Full mix. Tap a band to solo it.' : 'Clean. Tap a band to hear it.');
            return;
        }
        this._ensureMusic();
        this.freeSel = key;
        var spec;
        if (this._isFreq()) {
            spec = this._specFor(index);
        } else {
            spec = this._specFor(index, gain != null ? gain : this._gainForBand(index, 1));
        }
        this.engine.setProblem(spec);
        if (spec.kind !== 'solo') this.engine.calibrateCompensation(spec);
        this._clearHighlights();
        var wrap = this.els.guess;
        var el = gain != null
            ? wrap && wrap.querySelector('.ride-pad[data-index="' + index + '"][data-gain="' + gain + '"]')
            : wrap && wrap.querySelector('button[data-index="' + index + '"]');
        if (el) el.classList.add('is-lit');
        this._updateABBadge();
        this.setStatus(this._isFreq()
            ? 'Free play: ' + this._labelEq(spec) + ' soloed. Tap again for the full mix · hold Space to compare.'
            : 'Free play: ' + this._labelEq(spec) + '. Tap again for clean · hold Space to compare.');
    };

    Ride.prototype._bandSet = function (mode) {
        var sets = this.hooks.getBandSets();
        return sets[mode] || sets.seven;
    };

    Ride.prototype._syncLayoutUi = function () {
        var mode = this.stats.bandMode;
        var amount = this.stats.skill === 'amount';
        document.querySelectorAll('#ride-layout-row [data-layout]').forEach(function (btn) {
            var id = btn.getAttribute('data-layout');
            btn.classList.toggle('is-active', id === mode);
            btn.classList.toggle('is-disabled', amount && id === 'thirds');
        });
    };

    Ride.prototype._setBandMode = function (mode, silent) {
        if (LAYOUTS.indexOf(mode) < 0) mode = 'seven';
        if (mode === 'thirds' && this.stats.skill === 'amount') mode = 'octaves';
        this.stats.bandMode = mode;
        this._syncLayoutUi();
        this.bands = this._bandSet(mode).bands.slice();
        this._syncSkillUi();
        this.deck = [];
        this.lastBandIndex = -1;
        if (this.engine) this.engine.setBands(this.bands);
        if (this.free) this._clearFreeSel();
        this._renderGuess();
        this._renderWeakMap();
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

    Ride.prototype._syncGapUi = function () {
        var btn = document.getElementById('ride-gap-btn');
        if (!btn) return;
        btn.classList.toggle('is-active', !!this.stats.gapAB);
    };

    Ride.prototype.toggleGapAB = function () {
        this.stats.gapAB = !this.stats.gapAB;
        saveStats(this.stats);
        this._syncGapUi();
        this.setStatus(this.stats.gapAB
            ? 'Gap A/B on — a short silence between your guess and the truth.'
            : 'Gap A/B off — guess then truth with no gap.');
    };

    Ride.prototype._todayKey = function () {
        var d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    };

    /* The daily set lives in localStorage, keyed by date, so a refresh does
       not lose progress. The clock only counts time while a ride is on. */
    Ride.prototype._setKind = function () {
        return this._isFreq() ? 'freq' : 'music';
    };

    Ride.prototype._ensureSession = function (forceNew) {
        var today = this._todayKey();
        var kind = this._setKind();
        if (this.session && this.session.kind !== kind) {
            saveSet(this.session);
            this.session = null;
            this._hideSetReport();
        }
        if (!forceNew && this.session && this.session.date === today) {
            this._renderSetBar();
            this._startSetClock();
            return;
        }
        if (!forceNew) {
            var saved = loadSet(kind);
            if (saved && saved.date === today) {
                this.session = saved;
                this._startSetClock();
                this._renderSetBar();
                return;
            }
        }
        this.session = {
            kind: kind,
            date: today,
            done: 0,
            hits: 0,
            activeMs: 0,
            finished: false,
            log: []
        };
        saveSet(this.session);
        this._hideSetReport();
        this._startSetClock();
        this._renderSetBar();
    };

    Ride.prototype._startSetClock = function () {
        var self = this;
        if (this.setTimer) clearInterval(this.setTimer);
        this._lastTick = Date.now();
        var ticks = 0;
        this.setTimer = setInterval(function () {
            var now = Date.now();
            var ses = self.session;
            if (ses && !ses.finished && self.gameOn) {
                ses.activeMs = (ses.activeMs || 0) + Math.min(5000, now - self._lastTick);
                ticks += 1;
                if (ticks % 10 === 0) saveSet(ses);
            }
            self._lastTick = now;
            self._renderSetBar();
        }, 1000);
    };

    Ride.prototype._fmtClock = function (ms) {
        var s = Math.max(0, Math.floor(ms / 1000));
        var m = Math.floor(s / 60);
        s = s % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    };

    Ride.prototype._renderSetBar = function () {
        var ses = this.session;
        var prog = document.getElementById('ride-set-progress');
        var clock = document.getElementById('ride-set-clock');
        if (!ses) return;
        if (prog) prog.textContent = (ses.kind === 'freq' ? 'Daily ID set ' : 'Daily set ') + ses.done + ' / ' + SET_TARGET;
        if (clock) {
            clock.textContent = this._fmtClock(ses.activeMs || 0);
            clock.title = 'Time spent riding today';
            clock.classList.toggle('is-long', (ses.activeMs || 0) > 10 * 60 * 1000);
        }
    };

    Ride.prototype._hideSetReport = function () {
        var el = document.getElementById('ride-set-report');
        if (el) el.classList.add('hidden');
    };

    Ride.prototype._endDailySet = function () {
        if (!this.session || this.session.finished) return;
        this.session.finished = true;
        saveSet(this.session);
        if (this.setTimer) {
            clearInterval(this.setTimer);
            this.setTimer = null;
        }
        this._renderSetBar();
        this._renderSetReport();
        this.stopGame();
        this.setStatus('Daily set complete.');
    };

    Ride.prototype._renderSetReport = function () {
        var el = document.getElementById('ride-set-report');
        var body = document.getElementById('ride-set-report-body');
        if (!el || !body || !this.session) return;
        var ses = this.session;
        var pct = ses.done ? Math.round((ses.hits / ses.done) * 100) : 0;
        var elapsed = this._fmtClock(ses.activeMs || 0);
        var self = this;
        var auto = this.stats.skill === 'band' && this.stats.bandAuto;
        var lines = ['<div class="ride-set-hero">' + ses.hits + ' / ' + ses.done + ' · ' + pct + '% · ' + elapsed + '</div>'];
        var by = {};
        ses.log.forEach(function (row) {
            var k = String(row.freq);
            if (!by[k]) by[k] = { hit: 0, miss: 0, name: row.name };
            if (row.ok) by[k].hit += 1;
            else by[k].miss += 1;
        });
        lines.push('<div class="ride-set-rows">');
        this.bands.forEach(function (band) {
            var row = by[String(band.freq)];
            var n = row ? row.hit + row.miss : 0;
            var ok = row ? row.hit : 0;
            var rate = n ? row.miss / n : 0;
            var col = n ? (rate > 0.45 ? '#c45c5c' : rate > 0.25 ? '#c9a36e' : '#8fad6e') : '#5a5144';
            var thr = auto ? self._stairLabel(band.freq) : '';
            lines.push(
                '<div class="ride-set-row"><span>' + band.name + '</span>' +
                '<span class="ride-set-bar"><i style="width:' + Math.max(8, (n ? ok / n : 0) * 100) + '%;background:' + col + '"></i></span>' +
                '<span>' + (n ? ok + '/' + n : '—') + (thr ? ' · ' + thr : '') + '</span></div>'
            );
        });
        lines.push('</div>');
        body.innerHTML = lines.join('');
        el.classList.remove('hidden');
    };

    Ride.prototype._dismissSetReport = function (keep) {
        this._hideSetReport();
        if (keep) {
            this.session.finished = true;
            saveSet(this.session);
            this.startGame();
            return;
        }
        this._ensureSession(true);
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

    /* Streak/accuracy: Frequency ID and the EQ games are counted apart. */
    Ride.prototype._totals = function () {
        if (this._isFreq()) {
            if (!this.stats.freq) this.stats.freq = { streak: 0, correct: 0, total: 0 };
            return this.stats.freq;
        }
        return this.stats;
    };

    Ride.prototype._renderStats = function () {
        var tot = this._totals();
        if (this.els.streak) this.els.streak.textContent = String(tot.streak);
        if (this.els.accuracy) {
            this.els.accuracy.textContent = tot.total
                ? Math.round((tot.correct / tot.total) * 100) + '%'
                : '—';
        }
        if (this.els.weak) {
            var worst = this._weakestLabel();
            this.els.weak.textContent = worst ? ('weak: ' + worst) : 'weak: —';
        }
        this._updateABBadge();
        this._renderWeakMap();
    };

    /* Per-band stats are kept separately for each layout + game + difficulty,
       e.g. "octaves|band:3|1000", so a -3 dB miss never mixes with +6 dB hits. */
    Ride.prototype._levelKey = function () {
        if (this._isFreq()) return 'freq:solo';
        if (this.stats.skill === 'amount') return 'amount:' + (this.stats.amountLevel || 'easy');
        return this.stats.bandAuto ? 'band:auto' : 'band:' + (this.stats.bandStep || 1);
    };

    Ride.prototype._statKey = function (freq) {
        return this.stats.bandMode + '|' + this._levelKey() + '|' + freq;
    };

    Ride.prototype._bandRow = function (freq) {
        return this.stats.perBand[this._statKey(freq)] || { hit: 0, miss: 0 };
    };

    /* ---- Auto difficulty: one staircase per layout + band ---- */
    Ride.prototype._stair = function (freq) {
        var layout = this.stats.bandMode;
        if (!this.stats.stair[layout]) this.stats.stair[layout] = {};
        var key = String(freq);
        var st = this.stats.stair[layout][key];
        if (!st || typeof st.m !== 'number' || !isFinite(st.m)) {
            st = this.stats.stair[layout][key] = { m: STAIR_START, run: 0, dir: 0, rev: [], n: 0 };
        }
        if (!Array.isArray(st.rev)) st.rev = [];
        return st;
    };

    Ride.prototype._stairThreshold = function (freq) {
        var st = this._stair(freq);
        if (st.rev.length >= 2) {
            var last = st.rev.slice(-6);
            return last.reduce(function (a, b) { return a + b; }, 0) / last.length;
        }
        return null;
    };

    Ride.prototype._stairLabel = function (freq) {
        var t = this._stairThreshold(freq);
        return t == null ? '' : '≈' + (Math.round(t * 10) / 10) + ' dB';
    };

    Ride.prototype._stairUpdate = function (freq, ok) {
        var st = this._stair(freq);
        st.n = (st.n || 0) + 1;
        if (ok) {
            st.run = (st.run || 0) + 1;
            if (st.run >= 2) {
                st.run = 0;
                if (st.dir === 1) st.rev.push(st.m);
                st.dir = -1;
                st.m = Math.max(STAIR_MIN, st.m / STAIR_STEP);
            }
        } else {
            st.run = 0;
            if (st.dir === -1) st.rev.push(st.m);
            st.dir = 1;
            st.m = Math.min(STAIR_MAX, st.m * STAIR_STEP);
        }
        if (st.rev.length > 12) st.rev = st.rev.slice(-12);
    };

    Ride.prototype._autoGain = function (freq, sign) {
        var m = this._stair(freq).m;
        var g = sign > 0 ? m : -Math.min(14, m * 2);
        return Math.round(g * 10) / 10;
    };

    Ride.prototype._renderWeakMap = function () {
        var host = document.getElementById('ride-weak-map');
        if (!host) return;
        host.innerHTML = '';
        var self = this;
        var auto = this.stats.skill === 'band' && this.stats.bandAuto;
        this.bands.forEach(function (band) {
            var row = self._bandRow(band.freq);
            var n = (row.hit || 0) + (row.miss || 0);
            var rate = n ? (row.miss || 0) / n : 0;
            var cell = document.createElement('span');
            cell.className = 'ride-weak-cell';
            var thr = auto ? self._stairThreshold(band.freq) : null;
            cell.title = band.name + (n ? (' · ' + Math.round((1 - rate) * 100) + '% of ' + n) : ' · no data yet') +
                (auto ? (thr != null ? ' · threshold ≈ ' + (Math.round(thr * 10) / 10) + ' dB boost / ' + (Math.round(thr * 20) / 10) + ' dB cut' : ' · threshold: not enough data yet') : '');
            if (n < 3) cell.style.background = 'rgba(90,81,68,0.45)';
            else if (rate > 0.45) cell.style.background = 'rgba(196,92,92,' + (0.35 + rate * 0.45) + ')';
            else cell.style.background = 'rgba(143,173,110,' + (0.28 + (1 - rate) * 0.4) + ')';
            cell.textContent = band.freq < 1000 ? String(band.freq) : ((band.freq / 1000) + 'k');
            if (thr != null) {
                var sm = document.createElement('small');
                sm.textContent = (Math.round(thr * 10) / 10) + ' dB';
                cell.appendChild(sm);
            }
            host.appendChild(cell);
        });
    };

    Ride.prototype._updateABBadge = function () {
        if (!this.els.ab) return;
        var freq = this._isFreq();
        if (!this.engine || !this.engine.problem) {
            this.els.ab.textContent = this.free
                ? 'Free play · tap a band'
                : (freq ? 'Space = start · hold = full mix' : 'Space = start · hold = clean');
            this.els.ab.classList.remove('is-clean', 'is-problem');
            return;
        }
        if (this.engine.abClean) {
            this.els.ab.textContent = freq ? 'Hearing full mix' : 'Hearing clean';
            this.els.ab.classList.add('is-clean');
            this.els.ab.classList.remove('is-problem');
        } else {
            this.els.ab.textContent = freq ? 'Hearing one band' : 'Hearing problem';
            this.els.ab.classList.add('is-problem');
            this.els.ab.classList.remove('is-clean');
        }
    };

    Ride.prototype._weakestLabel = function () {
        var worst = null;
        var worstRate = 0;
        var self = this;
        this.bands.forEach(function (band) {
            var row = self._bandRow(band.freq);
            var n = (row.hit || 0) + (row.miss || 0);
            if (n < 3) return;
            var rate = (row.miss || 0) / n;
            if (rate > worstRate) {
                worstRate = rate;
                worst = band;
            }
        });
        if (!worst || worstRate < 0.35) return '';
        return worst.name;
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

    /* Another drill took over (tab switch): stop the game and the music. */
    Ride.prototype.deactivate = function () {
        if (this.gameOn) this.stopGame();
        if (this.free) this._clearFreeSel();
        if (this.engine && this.engine.playing) {
            this.engine.pause();
            this._syncPlayBtn();
            this.setStatus('Paused while you use another drill. Press Play to come back.');
        }
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
        if (this.free) this._setFree(false, true);
        this._ensureEngine();
        if (this.hooks && this.hooks.stopOtherAudio) this.hooks.stopOtherAudio();
        if (!this.engine.buffer && this.engine.kind !== 'stream') {
            if (this.source === 'library' && this.library.length) {
                this.gameOn = true;
                this._syncGameBtn();
                this._ensureSession(false);
                this._startSetClock();
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
        this._ensureSession(false);
        this._startSetClock();
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
        this.setStatus(this._isFreq()
            ? 'Stopped. Music keeps playing — try Free play to hear each band.'
            : 'Ride stopped. Music can keep playing.');
    };

    Ride.prototype._beginListen = function () {
        if (!this.gameOn) return;
        if (this.session && !this.session.finished && this.session.done >= SET_TARGET) {
            this._endDailySet();
            return;
        }
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
        this.setStatus(this._isFreq() ? 'Full mix…' : 'Listen…');
        var self = this;
        this.after(this._isFreq() ? FREQ_LISTEN_MS : LISTEN_MS, function () { self._applyNewProblem(); });
    };

    Ride.prototype._weakestIndex = function () {
        var worstI = -1;
        var worstRate = 0.45;
        for (var i = 0; i < this.bands.length; i++) {
            var row = this._bandRow(this.bands[i].freq);
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
        for (var w = 0; w < n; w++) {
            if (w === weak) continue;
            var row = this._bandRow(this.bands[w].freq);
            var nn = (row.hit || 0) + (row.miss || 0);
            if (nn >= 3 && (row.miss || 0) / nn >= 0.4) {
                deck.splice(1 + Math.floor(Math.random() * deck.length), 0, w);
            }
        }
        this.deck = deck;
    };

    Ride.prototype._pickBandIndex = function () {
        var tries = Math.max(this.bands.length * 2, 8);
        var fallback = 0;
        for (var t = 0; t < tries; t++) {
            if (!this.deck || !this.deck.length) this._rebuildDeck();
            var idx = this.deck.shift();
            if (this.bands.length > 1 && idx === this.lastBandIndex && this.deck.length) {
                this.deck.push(idx);
                idx = this.deck.shift();
            }
            fallback = idx;
            var freq = this.bands[idx] && this.bands[idx].freq;
            if (!this.engine || this.engine.bandHasEnergy(freq)) {
                this.lastBandIndex = idx;
                return idx;
            }
            this.deck.push(idx);
        }
        this.lastBandIndex = fallback;
        return fallback;
    };

    /* Bell width comes from the layout, matched to the spacing between
       neighbouring bands (4 bands Q 1.0, 7 bands Q 1.2, octaves Q 1.41,
       thirds Q 4.32), so adjacent answers stay distinguishable. */
    Ride.prototype._shapeForFreq = function () {
        var set = this._bandSet(this.stats.bandMode);
        return { q: set.q || RIDE_Q };
    };

    /* Gain actually played for a band in the current game/difficulty. */
    Ride.prototype._gainForBand = function (index, sign) {
        var band = this.bands[index];
        if (!band) return 0;
        if (this.stats.bandAuto) return this._autoGain(band.freq, sign);
        return scaleDetectability(this._bandLevelGain(), band.freq);
    };

    /* What a band sounds like in the current game: a level-matched solo
       (Frequency ID) or a bell at the given gain (EQ games). */
    Ride.prototype._specFor = function (index, gain) {
        var band = this.bands[index];
        if (!band) return null;
        var q = this._shapeForFreq().q;
        if (this._isFreq()) {
            this._ensureEngine();
            var spec = {
                kind: 'solo',
                index: index,
                freq: band.freq,
                gain: 0,
                q: q,
                soloGain: this.engine.soloGainFor(band.freq, q)
            };
            this.engine.calibrateSolo(spec); // async; updates spec + live gain
            return spec;
        }
        return { kind: 'eq', index: index, freq: band.freq, gain: gain, q: q };
    };

    Ride.prototype._bandLevelGain = function () {
        var rung = BAND_LADDER[(this.stats.bandStep || 1) - 1] || BAND_LADDER[0];
        return rung.gain;
    };

    Ride.prototype._applyNewProblem = function () {
        if (!this.gameOn) return;
        this._ensureEngine();
        if (this.engine.isSilent()) {
            // Nothing audible (paused, silent intro, gap between tracks): wait.
            var selfWait = this;
            this.setStatus('Waiting for sound…');
            this.after(700, function () { selfWait._applyNewProblem(); });
            return;
        }
        var idx = this._pickBandIndex();
        var band = this.bands[idx];
        if (!band) return;
        var skill = this.stats.skill;
        var q = this._shapeForFreq().q;
        var gain;
        if (skill === 'freq') {
            this._clearHighlights();
            this._hideResult();
            this.currentProblem = this._specFor(idx);
            this.engine.setProblem(this.currentProblem);
            this.phase = 'problem';
            this._updateABBadge();
            this.setStatus('Which band is playing on its own? Hold Space for the full mix.');
            return;
        }
        if (skill === 'amount') {
            var choices = this._amountGains();
            gain = choices[Math.floor(Math.random() * choices.length)];
        } else {
            gain = this._gainForBand(idx, Math.random() < 0.5 ? 1 : -1);
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
        this.engine.calibrateCompensation(this.currentProblem);
        this.phase = 'problem';
        this._updateABBadge();
        this.setStatus('What changed?  Hold Space to hear clean.');
    };

    Ride.prototype.guessBand = function (index) {
        if (this.free) {
            this._freeBand(index);
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
        var p = this.currentProblem;
        if (this._isFreq()) {
            this._finishRound(correct, 'freq', this._specFor(index));
            return;
        }
        // Demo the guess the way it would really have been played on that band.
        var guessGain = this.stats.bandAuto ? p.gain : this._gainForBand(index, p.gain >= 0 ? 1 : -1);
        this._finishRound(correct, 'band', {
            index: index,
            gain: guessGain,
            q: this._shapeForFreq().q
        });
    };

    Ride.prototype.guessPad = function (index, gain) {
        if (this.free) {
            this._freeBand(index, gain);
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
            q: gBand ? this._shapeForFreq().q : this.currentProblem.q
        });
    };

    Ride.prototype._record = function (ok) {
        var tot = this._totals();
        tot.total += 1;
        if (ok) {
            tot.correct += 1;
            tot.streak += 1;
        } else {
            tot.streak = 0;
        }
        if (this.currentProblem) {
            var freq = this.bands[this.currentProblem.index].freq;
            var key = this._statKey(freq);
            if (!this.stats.perBand[key]) this.stats.perBand[key] = { hit: 0, miss: 0 };
            if (ok) this.stats.perBand[key].hit += 1;
            else this.stats.perBand[key].miss += 1;
            if (this.stats.skill === 'band' && this.stats.bandAuto) this._stairUpdate(freq, ok);
        }
        saveStats(this.stats);
        this._renderStats();
        this._renderWeakMap();
        if (this.session && !this.session.finished) {
            this.session.done += 1;
            if (ok) this.session.hits += 1;
            this.session.log.push({
                freq: this.currentProblem ? this.currentProblem.freq : 0,
                name: this.currentProblem && this.bands[this.currentProblem.index]
                    ? this.bands[this.currentProblem.index].name : '',
                ok: ok
            });
            if (this.session.log.length > 200) this.session.log = this.session.log.slice(-200);
            saveSet(this.session);
            this._renderSetBar();
        }
    };

    Ride.prototype._labelEq = function (spec) {
        if (!spec || spec.index == null || !this.bands[spec.index]) return '';
        var band = this.bands[spec.index];
        if (spec.kind === 'solo') return band.name + (band.range && band.range !== band.name ? ' (' + band.range + ')' : '');
        return this._fmtGain(spec.gain) + ' dB at ' + band.name;
    };

    Ride.prototype._applyLiveEq = function (spec) {
        if (!this.engine || !spec || !this.bands[spec.index]) return;
        var band = this.bands[spec.index];
        if (spec.kind === 'solo') {
            this.engine.setProblem(spec);
            this._updateABBadge();
            return;
        }
        this.engine.setProblem({
            index: spec.index,
            freq: band.freq,
            gain: spec.gain,
            q: spec.q || this._shapeForFreq().q
        });
        this._updateABBadge();
    };

    Ride.prototype._skipCompare = function () {
        if (!this.gameOn) return;
        if (this.phase === 'reveal' || this.phase === 'compare-guess' || this.phase === 'compare-truth' || this.phase === 'compare-gap') {
            if (this.engine) this.engine.setGate(0.88);
            this._beginListen();
        }
    };

    Ride.prototype._finishRound = function (ok, stage, guess) {
        this._record(ok);
        this._showChoices();
        var p = this.currentProblem;
        var truthLabel = this._labelEq(p);
        var title = ok ? 'Yes' : 'No';
        if (!ok && (stage === 'band' || stage === 'freq')) title = 'Wrong band';
        if (!ok && stage === 'amount') title = 'Wrong amount';
        this.clearTimers();

        if (ok || !guess || !p) {
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
        var gap = this.stats.gapAB ? COMPARE_GAP_MS : 0;
        this.after(COMPARE_GUESS_MS, function () {
            if (!self.gameOn || self.phase !== 'compare-guess') return;
            if (gap && self.engine) {
                self.phase = 'compare-gap';
                self.engine.setGate(0);
                self.setStatus('…');
                return;
            }
            self.phase = 'compare-truth';
            self._applyLiveEq(p);
            self._showResult(false, title, 'Truth: ' + truthLabel);
            self.setStatus('Hearing the truth — ' + truthLabel + '. Hold Space for ' + (self._isFreq() ? 'the full mix.' : 'clean.'));
        });
        if (gap) {
            this.after(COMPARE_GUESS_MS + gap, function () {
                if (!self.gameOn || self.phase !== 'compare-gap') return;
                self.phase = 'compare-truth';
                if (self.engine) self.engine.setGate(0.88);
                self._applyLiveEq(p);
                self._showResult(false, title, 'Truth: ' + truthLabel);
                self.setStatus('Hearing the truth — ' + truthLabel + '. Hold Space for clean.');
            });
        }
        this.after(COMPARE_GUESS_MS + gap + COMPARE_TRUTH_MS, function () {
            if (self.gameOn && (self.phase === 'compare-truth' || self.phase === 'compare-guess' || self.phase === 'compare-gap')) {
                if (self.engine) self.engine.setGate(0.88);
                self._beginListen();
            }
        });
    };

    Ride.prototype._holdClean = function (on) {
        if (!this.engine || !this.engine.problem) {
            if (this.free) return; // free play: nothing to compare yet
            // No problem yet: start a ride (with its clean listening period);
            // never skip straight to a problem.
            if (on && !this.gameOn) this.startGame();
            return;
        }
        this.engine.setABClean(!!on);
        this._updateABBadge();
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

    /* Called by the page only while the Ride tab is showing. */
    Ride.prototype.handleKey = function (e) {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        var tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;

        if (e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            if (e.repeat) return true;
            if (this.engine && this.engine.problem) {
                this._holdClean(true);       // hold = hear clean
            } else if (this.free) {
                this.setStatus('Free play: tap a band (or 1–9). Turn Free play off, then Start ride to be quizzed.');
            } else if (!this.gameOn) {
                this.startGame();            // starts with the clean listen
            }
            // Ride on but between problems: ignore, keep the clean period.
            return true;
        }
        if (e.key === 'n' || e.key === 'N') {
            e.preventDefault();
            this.nextTrack();
            return true;
        }
        var num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= 9) {
            e.preventDefault();
            var bandKeys = this.stats.skill !== 'amount';
            if (num <= this.bands.length && bandKeys) {
                if (this.free) this._freeBand(num - 1);
                else if (this.gameOn && this.phase === 'problem') this.guessBand(num - 1);
            }
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
            self.setStatus(self.free ? self._freeHint() : (self.stats.loopSlice ? 'Looping an 8s slice.' : 'Playing. Start ride when you want problems.'));
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
        this.setStatus(this.free ? this._freeHint() : 'Demo is a stand-in so you can try Ride without a library.');
        if (this.gameOn) this._beginListen();
    };

    Ride.prototype._silenceCapturedTab = function (stream) {
        var tracks = stream.getAudioTracks();
        var jobs = tracks.map(function (track) {
            if (!track.applyConstraints) return Promise.resolve();
            return track.applyConstraints({
                suppressLocalAudioPlayback: true,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }).catch(function () { /* not supported */ });
        });
        return Promise.all(jobs).then(function () {
            var silenced = tracks.some(function (track) {
                var s = track.getSettings ? track.getSettings() : {};
                return s.suppressLocalAudioPlayback === true;
            });
            var video = stream.getVideoTracks()[0];
            var surface = video && video.getSettings ? video.getSettings().displaySurface : '';
            return { silenced: silenced, surface: surface || '' };
        });
    };

    Ride.prototype.tapLive = function () {
        var self = this;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            this.setStatus('Tab audio needs Chrome or Edge on a computer.');
            return;
        }
        this._setSource('tap', true);
        var opts = {
            video: {
                displaySurface: 'browser',
                width: 16,
                height: 16,
                frameRate: 1
            },
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                suppressLocalAudioPlayback: true
            },
            preferCurrentTab: false,
            selfBrowserSurface: 'exclude',
            systemAudio: 'exclude',
            monitorTypeSurfaces: 'exclude',
            surfaceSwitching: 'exclude'
        };
        navigator.mediaDevices.getDisplayMedia(opts).then(function (stream) {
            if (!stream.getAudioTracks().length) {
                stream.getTracks().forEach(function (t) { t.stop(); });
                self.setStatus('No audio. Pick the player tab and turn on “Also share tab audio”.');
                return;
            }
            return self._silenceCapturedTab(stream).then(function (info) {
                if (info.surface === 'monitor' || info.surface === 'window') {
                    stream.getTracks().forEach(function (t) { t.stop(); });
                    self.setStatus('Pick a Chrome tab, not a window or the whole screen — otherwise the music plays twice.');
                    return;
                }
                self._ensureEngine();
                if (self.hooks && self.hooks.stopOtherAudio) self.hooks.stopOtherAudio();
                if (self.captureVideo) {
                    self.captureVideo.pause();
                    self.captureVideo.srcObject = null;
                    self.captureVideo.muted = true;
                    self.captureVideo.volume = 0;
                }
                self.engine.setStream(stream);
                self.source = 'tap';
                self._setNowPlaying('Browser tab — live');
                self._syncPlayBtn();
                self.setStatus(info.silenced
                    ? 'Hearing that tab only through the trainer. Start ride when you want problems.'
                    : 'Tab connected. If it sounds doubled, pick the player tab again and turn on “Also share tab audio”.');
                if (self.gameOn) self._beginListen();
            });
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
        deactivate: function () { ride.deactivate(); },
        isActive: function () { return ride.isActive(); },
        setSkill: function (skill) { ride._setSkill(skill); },
        getSkill: function () { return ride.stats.skill; },
        setFree: function (on) { ride._setFree(on); },
        _ride: ride // read-only handle for automated checks
    };
})(window);
