/* Reference — compare your mix with a reference track, band by band.
   Everything happens in this browser: files are decoded and analysed
   locally, nothing is uploaded. Both tracks play in sync and are
   loudness-matched; A/B is a gain switch, so playback never restarts. */
(function (global) {
    'use strict';

    var FFT_N = 8192;
    var MAX_SECONDS = 420;
    var SETS = ['seven', 'octaves', 'thirds'];

    function kWeightMag(freq) {
        var f = Math.max(20, freq || 1000);
        var hp = (f * f) / (f * f + 38 * 38);
        var s = f / 1682;
        return hp * ((1 + 1.58 * s) / (1 + s));
    }

    function fft(re, im) {
        var n = re.length;
        for (var i = 1, j = 0; i < n; i++) {
            var bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                var t = re[i]; re[i] = re[j]; re[j] = t;
                t = im[i]; im[i] = im[j]; im[j] = t;
            }
        }
        for (var len = 2; len <= n; len <<= 1) {
            var ang = -2 * Math.PI / len;
            var wr = Math.cos(ang), wi = Math.sin(ang);
            for (var k = 0; k < n; k += len) {
                var cr = 1, ci = 0;
                for (var m = 0; m < len / 2; m++) {
                    var a = k + m, b = a + len / 2;
                    var xr = re[b] * cr - im[b] * ci;
                    var xi = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - xr; im[b] = im[a] - xi;
                    re[a] += xr; im[a] += xi;
                    var nr = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = nr;
                }
            }
        }
    }

    /* Long-term average power spectrum of a decoded buffer (mono sum,
       Hann window, quiet frames skipped). Yields to the UI as it goes. */
    function analyse(buffer, onProgress) {
        return new Promise(function (resolve) {
            var sr = buffer.sampleRate;
            var len = Math.min(buffer.length, Math.floor(MAX_SECONDS * sr));
            var chans = [];
            for (var c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
            var win = new Float64Array(FFT_N);
            for (var w = 0; w < FFT_N; w++) win[w] = 0.5 - 0.5 * Math.cos(2 * Math.PI * w / (FFT_N - 1));
            var half = FFT_N / 2;
            var acc = new Float64Array(half);
            var re = new Float64Array(FFT_N), im = new Float64Array(FFT_N);
            var frames = Math.floor(len / FFT_N);
            var used = 0, f = 0;
            var step = function () {
                var stop = Math.min(frames, f + 40);
                for (; f < stop; f++) {
                    var off = f * FFT_N, e = 0;
                    for (var i = 0; i < FFT_N; i++) {
                        var v = 0;
                        for (var ch = 0; ch < chans.length; ch++) v += chans[ch][off + i];
                        v /= chans.length;
                        e += v * v;
                        re[i] = v * win[i];
                        im[i] = 0;
                    }
                    if (e / FFT_N < 1e-7) continue; // below about -70 dBFS: silence
                    fft(re, im);
                    for (var b = 0; b < half; b++) acc[b] += re[b] * re[b] + im[b] * im[b];
                    used += 1;
                }
                if (onProgress) onProgress(frames ? f / frames : 1);
                if (f < frames) { setTimeout(step, 0); return; }
                if (used) for (var k = 0; k < half; k++) acc[k] /= used;
                var binHz = sr / FFT_N, kw = 0;
                for (var q = 1; q < half; q++) {
                    var km = kWeightMag(q * binHz);
                    kw += acc[q] * (q * binHz < 20 ? 0 : km * km);
                }
                resolve({ spec: acc, binHz: binHz, kPower: kw, frames: used });
            };
            step();
        });
    }

    function bandEdges(bands) {
        return bands.map(function (b, i) {
            var lo = i > 0 ? Math.sqrt(bands[i - 1].freq * b.freq) : b.freq / Math.sqrt(bands[1].freq / b.freq);
            var hi = i < bands.length - 1 ? Math.sqrt(b.freq * bands[i + 1].freq) : Math.min(20000, b.freq * Math.sqrt(b.freq / bands[i - 1].freq));
            return [Math.max(20, lo), hi];
        });
    }

    function bandPowers(an, bands) {
        return bandEdges(bands).map(function (e) {
            var s = 0;
            var a = Math.max(1, Math.floor(e[0] / an.binHz)), z = Math.min(an.spec.length - 1, Math.ceil(e[1] / an.binHz));
            for (var i = a; i <= z; i++) s += an.spec[i];
            return s;
        });
    }

    function fmtHz(f) { return f < 1000 ? f + ' Hz' : (f / 1000) + ' kHz'; }

    var ref = {
        shared: null,
        setId: 'octaves',
        mode: 'compare',      // compare | quiz
        slots: { a: null, b: null },  // {name, buffer, an}
        listen: 'a',
        g: null,
        diffs: null,
        quiz: null,           // {band, dir, answered}
        solo: -1,
        totals: { correct: 0, total: 0 }
    };

    function $(id) { return document.getElementById(id); }

    function status(t) { var el = $('ref-status'); if (el) el.textContent = t; }

    function bands() { return ref.shared.bandSets[ref.setId].bands; }

    function loadFile(slot, file) {
        if (!file) return;
        var ctx = ref.shared.initAudio();
        status('Decoding ' + file.name + '…');
        file.arrayBuffer().then(function (ab) {
            return ctx.decodeAudioData(ab);
        }).then(function (buf) {
            setSlot(slot, file.name, buf);
        }).catch(function () {
            status('Could not decode ' + file.name + '. Try WAV, MP3 or FLAC.');
        });
    }

    function setSlot(slot, name, buf) {
        stop();
        ref.slots[slot] = { name: name, buffer: buf, an: null };
        var label = $('ref-name-' + slot);
        if (label) label.textContent = name;
        status('Analysing ' + name + '…');
        analyse(buf, function (p) {
            var el = $('ref-name-' + slot);
            if (el) el.textContent = name + ' · analysing ' + Math.round(p * 100) + '%';
        }).then(function (an) {
            if (!ref.slots[slot] || ref.slots[slot].buffer !== buf) return;
            ref.slots[slot].an = an;
            var el = $('ref-name-' + slot);
            if (el) el.textContent = name;
            onReady();
        });
    }

    function ready() { return !!(ref.slots.a && ref.slots.a.an && ref.slots.b && ref.slots.b.an); }

    function matchGains() {
        var ka = ref.slots.a.an.kPower, kb = ref.slots.b.an.kPower;
        if (!(ka > 0) || !(kb > 0)) return { a: 1, b: 1, db: 0 };
        // Turn the louder one down to the quieter one.
        var r = Math.sqrt(kb / ka);
        return r < 1 ? { a: 1, b: r, db: 20 * Math.log10(ka / kb) / 2 } : { a: 1 / r, b: 1, db: 20 * Math.log10(ka / kb) / 2 };
    }

    function computeDiffs() {
        var bs = bands();
        var pa = bandPowers(ref.slots.a.an, bs), pb = bandPowers(ref.slots.b.an, bs);
        var ka = ref.slots.a.an.kPower, kb = ref.slots.b.an.kPower;
        ref.diffs = bs.map(function (b, i) {
            var da = 10 * Math.log10(Math.max(1e-20, pa[i]) / ka);
            var db = 10 * Math.log10(Math.max(1e-20, pb[i]) / kb);
            return Math.round((da - db) * 10) / 10;
        });
    }

    function onReady() {
        if (!ready()) {
            status(ref.slots.a ? 'Now load a reference track.' : 'Load your mix (or use Ride’s track), then a reference.');
            render();
            return;
        }
        computeDiffs();
        var m = matchGains();
        $('ref-match').textContent = Math.abs(m.db) < 0.1 ? 'Already at the same loudness.'
            : (m.db > 0 ? 'Your mix is ' + Math.abs(m.db).toFixed(1) + ' dB louder' : 'The reference is ' + Math.abs(m.db).toFixed(1) + ' dB louder') + ' (K-weighted); it is turned down so you compare tone, not level.';
        newQuiz();
        render();
        status('Ready. Play, then switch A / B (or press Space) — both keep playing in sync.');
    }

    function build() {
        stop();
        if (!ready()) return;
        var sh = ref.shared;
        var ctx = sh.initAudio();
        if (ctx.state === 'suspended') ctx.resume();
        sh.stopOthers();
        var out = sh.getOutput();
        var m = matchGains();
        var loopEnd = Math.min(ref.slots.a.buffer.duration, ref.slots.b.buffer.duration);
        var t0 = ctx.currentTime + 0.05;
        var g = { srcs: [], gains: {}, bps: [], match: m, t0: t0 };
        ['a', 'b'].forEach(function (k) {
            var src = ctx.createBufferSource();
            src.buffer = ref.slots[k].buffer;
            src.loop = true;
            src.loopStart = 0;
            src.loopEnd = loopEnd;
            var bp1 = ctx.createBiquadFilter(), bp2 = ctx.createBiquadFilter();
            bp1.type = bp2.type = 'allpass'; // neutral until a band is soloed
            var solo = ctx.createGain();
            var gain = ctx.createGain();
            gain.gain.value = 0;
            src.connect(bp1); bp1.connect(bp2); bp2.connect(solo); solo.connect(gain); gain.connect(out);
            src.start(t0, 0);
            g.srcs.push(src);
            g.gains[k] = gain;
            g.bps.push({ bp1: bp1, bp2: bp2, solo: solo, key: k });
        });
        ref.g = g;
        applySolo();
        applyListen(true);
        render();
    }

    function stop() {
        if (ref.g) {
            ref.g.srcs.forEach(function (s) { try { s.stop(); } catch (e) { /* done */ } try { s.disconnect(); } catch (e2) { /* gone */ } });
            Object.keys(ref.g.gains).forEach(function (k) { try { ref.g.gains[k].disconnect(); } catch (e) { /* gone */ } });
            ref.g = null;
        }
        render();
    }

    function applyListen(now) {
        if (!ref.g) { render(); return; }
        var ctx = ref.shared.initAudio();
        var t = ctx.currentTime;
        ['a', 'b'].forEach(function (k) {
            var target = ref.listen === k ? ref.g.match[k] : 0;
            var p = ref.g.gains[k].gain;
            p.cancelScheduledValues(t);
            p.setValueAtTime(p.value, t);
            p.linearRampToValueAtTime(target, t + (now ? 0.005 : 0.012));
        });
        render();
    }

    function applySolo() {
        if (!ref.g) return;
        var bs = bands();
        var q = ref.shared.bandSets[ref.setId].q || 1.4;
        ref.g.bps.forEach(function (o) {
            var on = ref.solo >= 0 && ref.solo < bs.length;
            o.bp1.type = o.bp2.type = on ? 'bandpass' : 'allpass';
            if (on) {
                o.bp1.frequency.value = o.bp2.frequency.value = bs[ref.solo].freq;
                o.bp1.Q.value = o.bp2.Q.value = q;
            }
            o.solo.gain.value = on ? 4 : 1; // soloed band is quieter; same lift for both, so the A/B stays fair
        });
    }

    function setListen(k) {
        ref.listen = k;
        if (!ref.g && ready()) build();
        else applyListen(false);
    }

    function newQuiz() {
        ref.quiz = null;
        if (!ref.diffs) return;
        var best = 0;
        ref.diffs.forEach(function (d, i) { if (Math.abs(d) > Math.abs(ref.diffs[best])) best = i; });
        ref.quiz = { band: best, dir: ref.diffs[best] >= 0 ? 1 : -1, pickBand: -1, pickDir: 0, answered: false };
    }

    function quizPick(band, dir) {
        var qz = ref.quiz;
        if (!qz || qz.answered) return;
        if (band != null) qz.pickBand = band;
        if (dir) qz.pickDir = dir;
        if (qz.pickBand < 0 || !qz.pickDir) { render(); return; }
        qz.answered = true;
        var top = Math.abs(ref.diffs[qz.band]);
        var bandOk = qz.pickBand === qz.band || Math.abs(Math.abs(ref.diffs[qz.pickBand]) - top) <= 0.5;
        var dirOk = (ref.diffs[qz.pickBand] >= 0 ? 1 : -1) === qz.pickDir;
        qz.ok = bandOk && dirOk;
        ref.totals.total += 1;
        if (qz.ok) ref.totals.correct += 1;
        render();
    }

    function render() {
        var playing = !!ref.g;
        var pb = $('ref-play');
        if (pb) pb.textContent = playing ? 'Stop' : 'Play';
        ['a', 'b'].forEach(function (k) {
            var b = $('ref-listen-' + k);
            if (b) {
                b.classList.toggle('is-active', ref.listen === k);
                b.setAttribute('aria-pressed', ref.listen === k ? 'true' : 'false');
            }
        });
        document.querySelectorAll('#ref-set-row [data-set]').forEach(function (b) {
            b.classList.toggle('is-active', b.getAttribute('data-set') === ref.setId);
        });
        document.querySelectorAll('#ref-mode-row [data-mode]').forEach(function (b) {
            b.classList.toggle('is-active', b.getAttribute('data-mode') === ref.mode);
        });
        var quizEl = $('ref-quiz');
        var chartWrap = $('ref-chart-wrap');
        var ok = ready();
        var showChart = ok && (ref.mode === 'compare' || (ref.quiz && ref.quiz.answered));
        if (chartWrap) chartWrap.classList.toggle('hidden', !showChart);
        if (quizEl) quizEl.classList.toggle('hidden', !(ok && ref.mode === 'quiz'));
        renderBands();
        if (showChart) drawChart();
        var res = $('ref-quiz-result');
        if (res) {
            var qz = ref.quiz;
            if (ok && ref.mode === 'quiz' && qz && qz.answered) {
                var bs = bands();
                var d = ref.diffs[qz.band];
                res.innerHTML = '<b class="' + (qz.ok ? 'ref-ok' : 'ref-bad') + '">' + (qz.ok ? 'Yes' : 'Not quite') + '</b> — the biggest difference is <b>' +
                    fmtHz(bs[qz.band].freq) + '</b>: your mix has <b>' + Math.abs(d).toFixed(1) + ' dB ' + (d >= 0 ? 'more' : 'less') + '</b> there than the reference. ' +
                    (Math.abs(d) < 1 ? 'Under 1 dB: these two are very close. ' : '') + ref.totals.correct + ' / ' + ref.totals.total + ' this session.';
            } else if (res) {
                res.textContent = ok && ref.mode === 'quiz' ? 'Listen to both. Which band differs most, and does your mix have more or less of it?' : '';
            }
        }
        document.querySelectorAll('#ref-dir-row [data-dir]').forEach(function (b) {
            var qz = ref.quiz;
            b.classList.toggle('is-active', !!(qz && qz.pickDir === parseInt(b.getAttribute('data-dir'), 10)));
        });
        var nb = $('ref-next');
        if (nb) nb.classList.toggle('hidden', !(ref.quiz && ref.quiz.answered));
    }

    function renderBands() {
        var host = $('ref-bands');
        if (!host) return;
        host.innerHTML = '';
        if (!ready()) return;
        var qz = ref.mode === 'quiz' ? ref.quiz : null;
        bands().forEach(function (b, i) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ride-chip ref-band';
            btn.textContent = b.freq < 1000 ? String(b.freq) : (b.freq / 1000) + 'k';
            btn.title = b.name + (ref.mode === 'compare' ? ' — tap to solo this band on both tracks' : '');
            if (qz) {
                if (qz.pickBand === i) btn.classList.add(qz.answered ? (qz.ok || i === qz.band ? 'is-ok' : 'is-bad') : 'is-active');
                if (qz.answered && i === qz.band) btn.classList.add('is-ok');
            } else if (ref.solo === i) {
                btn.classList.add('is-active');
            }
            btn.addEventListener('click', function () {
                if (ref.mode === 'quiz') { quizPick(i, 0); return; }
                ref.solo = ref.solo === i ? -1 : i;
                if (!ref.g) build(); else applySolo();
                render();
                status(ref.solo >= 0 ? 'Soloing ' + fmtHz(b.freq) + ' on both tracks. Tap again for the full mix.' : 'Full mix.');
            });
            host.appendChild(btn);
        });
    }

    function drawChart() {
        var cv = $('ref-chart');
        if (!cv || !ref.diffs) return;
        var dpr = window.devicePixelRatio || 1;
        var w = cv.clientWidth || 600, h = cv.clientHeight || 180;
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        var c = cv.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, w, h);
        var bs = bands();
        var n = bs.length;
        var top = 16, bottom = h - 18;
        var mid = (top + bottom) / 2;
        var range = 12;
        var y = function (d) { return mid - Math.max(-range, Math.min(range, d)) / range * (bottom - top) / 2; };
        c.strokeStyle = 'rgba(90,81,68,0.35)';
        [-6, 6].forEach(function (d) { c.beginPath(); c.moveTo(0, y(d)); c.lineTo(w, y(d)); c.stroke(); });
        c.strokeStyle = 'rgba(201,163,110,0.6)';
        c.beginPath(); c.moveTo(0, mid); c.lineTo(w, mid); c.stroke();
        var bw = w / n;
        c.font = '10px sans-serif';
        c.textAlign = 'center';
        ref.diffs.forEach(function (d, i) {
            var x = i * bw;
            c.fillStyle = d >= 0 ? 'rgba(201,163,110,0.85)' : 'rgba(110,150,190,0.85)';
            c.fillRect(x + bw * 0.15, Math.min(mid, y(d)), bw * 0.7, Math.abs(y(d) - mid));
            if (n <= 12 || i % 2 === 0) {
                c.fillStyle = '#8a7d6a';
                var f = bs[i].freq;
                c.fillText(f < 1000 ? String(f) : (f / 1000) + 'k', x + bw / 2, h - 5);
            }
            if (n <= 12) {
                c.fillStyle = '#d8ccb4';
                c.fillText((d > 0 ? '+' : '') + d.toFixed(1), x + bw / 2, d >= 0 ? y(d) - 3 : y(d) + 11);
            }
        });
        c.textAlign = 'left';
        c.fillStyle = '#8a7d6a';
        c.fillText('your mix has more ▲', 4, 11);
        c.fillText('▼ less than the reference', 4, bottom + 0);
    }

    function handleKey(e) {
        if (e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            if (e.repeat) return true;
            if (!ready()) return true;
            setListen(ref.listen === 'a' ? 'b' : 'a');
            return true;
        }
        if (e.key === 'a' || e.key === 'A') { setListen('a'); return true; }
        if (e.key === 'b' || e.key === 'B') { setListen('b'); return true; }
        return false;
    }

    function init(shared) {
        ref.shared = shared;
        var fa = $('ref-file-a'), fb = $('ref-file-b');
        $('ref-load-a').addEventListener('click', function () { fa.click(); });
        $('ref-load-b').addEventListener('click', function () { fb.click(); });
        fa.addEventListener('change', function () { loadFile('a', fa.files[0]); fa.value = ''; });
        fb.addEventListener('change', function () { loadFile('b', fb.files[0]); fb.value = ''; });
        $('ref-use-ride').addEventListener('click', function () {
            var src = shared.getRideBuffer();
            if (!src) {
                status(shared.rideIsStream() ? 'A live tab can’t be measured ahead of time. Load your mix as a file instead.' : 'Nothing loaded in Ride yet. Play a track in Ride first, or load a file.');
                return;
            }
            setSlot('a', src.name, src.buffer);
        });
        $('ref-play').addEventListener('click', function () { if (ref.g) stop(); else if (ready()) build(); else status('Load both tracks first.'); });
        $('ref-listen-a').addEventListener('click', function () { setListen('a'); });
        $('ref-listen-b').addEventListener('click', function () { setListen('b'); });
        document.querySelectorAll('#ref-set-row [data-set]').forEach(function (b) {
            b.addEventListener('click', function () {
                ref.setId = b.getAttribute('data-set');
                ref.solo = -1;
                applySolo();
                if (ready()) { computeDiffs(); newQuiz(); }
                render();
            });
        });
        document.querySelectorAll('#ref-mode-row [data-mode]').forEach(function (b) {
            b.addEventListener('click', function () {
                ref.mode = b.getAttribute('data-mode');
                ref.solo = -1;
                applySolo();
                if (ref.mode === 'quiz' && ready()) newQuiz();
                render();
            });
        });
        document.querySelectorAll('#ref-dir-row [data-dir]').forEach(function (b) {
            b.addEventListener('click', function () { quizPick(null, parseInt(b.getAttribute('data-dir'), 10)); });
        });
        $('ref-next').addEventListener('click', function () {
            // Same pair, next question: the next-biggest difference.
            var qz = ref.quiz;
            if (!qz || !ref.diffs) return;
            var used = (qz.used || []).concat([qz.band]);
            var best = -1;
            ref.diffs.forEach(function (d, i) {
                if (used.indexOf(i) >= 0) return;
                if (best < 0 || Math.abs(d) > Math.abs(ref.diffs[best])) best = i;
            });
            if (best < 0) { used = []; newQuiz(); render(); return; }
            ref.quiz = { band: best, dir: ref.diffs[best] >= 0 ? 1 : -1, pickBand: -1, pickDir: 0, answered: false, used: used, excludeFromTop: used };
            render();
        });
        window.addEventListener('resize', function () { if (ready()) drawChart(); });
        render();
        status('Load your mix (or use Ride’s track), then a reference. Files stay on this computer.');
    }

    global.EQReference = {
        init: init,
        stop: stop,
        handleKey: handleKey,
        isPlaying: function () { return !!ref.g; },
        _ref: ref,
        _setSlot: setSlot
    };
})(window);
