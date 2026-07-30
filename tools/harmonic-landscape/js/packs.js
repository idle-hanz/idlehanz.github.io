/**
 * Dark / harmonic packs + bidirectional recognition
 * Templates: degree (semitones from tonic) + quality + duration
 */
(function (global) {
  'use strict';

  const PACKS = [
    {
      id: 'home-grit',
      name: 'Home grit',
      feel: 'foundation',
      colour: 'dark minor',
      why: 'Solid i–♭VI–♭VII–i. Gravity without fancy theory.',
      chords: [
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 8, q: 'maj', dur: 4, roman: 'bVI' },
        { d: 10, q: 'maj', dur: 4, roman: 'bVII' },
        { d: 0, q: 'min', dur: 4, roman: 'i' },
      ],
    },
    {
      id: 'bvi-lift',
      name: '♭VI lift',
      feel: 'lift',
      colour: 'cinematic',
      why: '♭VI hangs longer — the lift moment.',
      chords: [
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 8, q: 'maj', dur: 6, roman: 'bVI' },
        { d: 10, q: 'maj', dur: 2, roman: 'bVII' },
        { d: 0, q: 'min', dur: 4, roman: 'i' },
      ],
    },
    {
      id: 'modal-bvii',
      name: 'Modal ♭VII walk',
      feel: 'drive',
      colour: 'epic / rock',
      why: 'Stepwise roots under minor colour. Verse engine.',
      chords: [
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 10, q: 'maj', dur: 4, roman: 'bVII' },
        { d: 5, q: 'min', dur: 4, roman: 'iv' },
        { d: 10, q: 'maj', dur: 4, roman: 'bVII' },
      ],
    },
    {
      id: 'v7-hang',
      name: 'V7 hang',
      feel: 'tension',
      colour: 'tension',
      why: 'Hold the dominant — then land.',
      chords: [
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 5, q: 'min', dur: 4, roman: 'iv' },
        { d: 7, q: 'dom7', dur: 6, roman: 'V7' },
        { d: 0, q: 'min', dur: 2, roman: 'i' },
      ],
    },
    {
      id: 'noir-tritone',
      name: 'Noir tritone',
      feel: 'noir',
      colour: 'noir',
      why: '♭II7 into i — noir / jazz-dark turn.',
      chords: [
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 8, q: 'maj', dur: 4, roman: 'bVI' },
        { d: 1, q: 'dom7', dur: 4, roman: 'bII7' },
        { d: 0, q: 'min', dur: 4, roman: 'i' },
      ],
    },
    {
      id: 'cinematic-cm',
      name: 'Cinematic mediant',
      feel: 'cinematic',
      colour: 'cinematic',
      why: 'Chromatic mediant colour without abandoning minor home.',
      chords: [
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 4, q: 'maj', dur: 4, roman: 'CM' },
        { d: 8, q: 'maj', dur: 4, roman: 'bVI' },
        { d: 0, q: 'min', dur: 4, roman: 'i' },
      ],
    },
    {
      id: 'andalusian',
      name: 'Andalusian minor',
      feel: 'classic dark',
      colour: 'phrygian tint',
      why: 'i–♭VII–♭VI–V. Endless useful loop.',
      chords: [
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 10, q: 'maj', dur: 4, roman: 'bVII' },
        { d: 8, q: 'maj', dur: 4, roman: 'bVI' },
        { d: 7, q: 'maj', dur: 4, roman: 'V' },
      ],
    },
    {
      id: 'aeolian-descent',
      name: 'Aeolian descent',
      feel: 'descent',
      colour: 'dark minor',
      why: 'Falling bass story: i–♭VII–♭VI–V.',
      chords: [
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 10, q: 'maj', dur: 4, roman: 'bVII' },
        { d: 8, q: 'maj', dur: 4, roman: 'bVI' },
        { d: 7, q: 'maj', dur: 4, roman: 'V' },
      ],
    },
    {
      id: 'iv-colour',
      name: 'iv colour pad',
      feel: 'soft',
      colour: 'soft dark',
      why: 'Gentle motion. Good under vocals.',
      chords: [
        { d: 0, q: 'min7', dur: 4, roman: 'i' },
        { d: 5, q: 'min7', dur: 4, roman: 'iv' },
        { d: 8, q: 'maj7', dur: 4, roman: 'bVI' },
        { d: 5, q: 'min7', dur: 4, roman: 'iv' },
      ],
    },
    {
      id: 'secondary-sting',
      name: 'Secondary sting',
      feel: 'sting',
      colour: 'push',
      why: 'V/♭VI sting before the lift.',
      chords: [
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 3, q: 'dom7', dur: 2, roman: 'V/bVI' },
        { d: 8, q: 'maj', dur: 4, roman: 'bVI' },
        { d: 10, q: 'maj', dur: 2, roman: 'bVII' },
        { d: 0, q: 'min', dur: 4, roman: 'i' },
      ],
    },
    {
      id: 'dorian-hope',
      name: 'Dorian hope',
      feel: 'bittersweet',
      colour: 'bittersweet',
      why: 'Natural 6 (IV major). Dark but not hopeless.',
      chords: [
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 5, q: 'maj', dur: 4, roman: 'IV' },
        { d: 10, q: 'maj', dur: 4, roman: 'bVII' },
        { d: 0, q: 'min', dur: 4, roman: 'i' },
      ],
    },
    {
      id: 'phrygian-gate',
      name: 'Phrygian gate',
      feel: 'exotic dark',
      colour: 'phrygian',
      why: '♭II is the door to another place.',
      chords: [
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 1, q: 'maj', dur: 4, roman: 'bII' },
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 8, q: 'maj', dur: 4, roman: 'bVI' },
      ],
    },
    {
      id: 'jazz-dark-turn',
      name: 'Jazz-dark turn',
      feel: 'jazzy dark',
      colour: 'jazz dark',
      why: 'iiø–V7–i with minor colour.',
      chords: [
        { d: 0, q: 'min7', dur: 4, roman: 'i' },
        { d: 2, q: 'halfdim', dur: 2, roman: 'iiø' },
        { d: 7, q: 'dom7', dur: 2, roman: 'V7' },
        { d: 0, q: 'min7', dur: 4, roman: 'i' },
      ],
    },
    {
      id: 'half-time-doom',
      name: 'Half-time doom',
      feel: 'heavy',
      colour: 'doom',
      why: 'Long chords. Weight is the story.',
      chords: [
        { d: 0, q: 'min', dur: 8, roman: 'i' },
        { d: 8, q: 'maj', dur: 8, roman: 'bVI' },
        { d: 10, q: 'maj', dur: 8, roman: 'bVII' },
        { d: 0, q: 'min', dur: 8, roman: 'i' },
      ],
    },
    {
      id: 'syncopated-push',
      name: 'Syncopated push',
      feel: 'groove',
      colour: 'groove',
      why: 'Simple harmony; durations make it move.',
      chords: [
        { d: 0, q: 'min', dur: 3, roman: 'i' },
        { d: 10, q: 'maj', dur: 3, roman: 'bVII' },
        { d: 8, q: 'maj', dur: 2, roman: 'bVI' },
        { d: 0, q: 'min', dur: 4, roman: 'i' },
      ],
    },
    {
      id: 'relative-escape',
      name: 'Relative escape',
      feel: 'bridge',
      colour: 'modulation seed',
      why: 'Touches relative major — seed for leaving home.',
      chords: [
        { d: 0, q: 'min', dur: 4, roman: 'i' },
        { d: 8, q: 'maj', dur: 4, roman: 'bVI' },
        { d: 3, q: 'maj', dur: 4, roman: 'III' },
        { d: 10, q: 'maj', dur: 4, roman: 'bVII' },
      ],
    },
  ];

  const FEELS = [...new Set(PACKS.map((p) => p.feel))];
  const COLOURS = [...new Set(PACKS.map((p) => p.colour))];

  function roughQ(q) {
    if (!q) return 'maj';
    if (q === 'maj7' || q === 'maj9' || q === 'add9' || q === 'maj') return 'maj';
    if (q === 'min7' || q === 'min9' || q === 'minmaj7' || q === 'min') return 'min';
    if (q === 'dom7') return 'dom7';
    if (q === 'halfdim' || q === 'dim7' || q === 'dim') return 'dim';
    if (q === 'aug') return 'aug';
    return q;
  }

  function materialize(pack, tonic, modeKey) {
    const music = global.HLMusic;
    if (!music || !pack) return [];
    const t = music.pc(tonic);
    return pack.chords.map((spec, i) => {
      const root = (t + spec.d) % 12;
      let ch = music.makeChord(root, spec.q, {
        duration: spec.dur != null ? spec.dur : 4,
        roman: spec.roman || '',
        tag: pack.colour,
        region: regionFor(spec),
      });
      if (spec.bass != null && global.HLCompose && global.HLCompose.withBass) {
        ch = global.HLCompose.withBass(ch, (t + spec.bass) % 12);
        ch.duration = spec.dur != null ? spec.dur : 4;
        ch.roman = spec.roman || '';
        ch.tag = pack.colour;
      }
      ch.packId = pack.id;
      ch.slotIndex = i;
      ch.localTonic = t;
      ch.localMode = modeKey || 'minor';
      return ch;
    });
  }

  function regionFor(spec) {
    if (spec.roman && /V\//.test(spec.roman)) return 'secondary';
    if (spec.roman === 'bII7' || (spec.q === 'dom7' && spec.d === 1)) return 'tritone';
    if (spec.roman === 'CM') return 'chromatic';
    if (spec.roman === 'bII') return 'interchange';
    return 'diatonic';
  }

  /** Signature of a sequence relative to tonic: "0:min|8:maj|..." */
  function signature(chords, tonic, loose) {
    const music = global.HLMusic;
    const t = music.pc(tonic);
    return chords
      .map((c) => {
        const deg = (c.root - t + 12) % 12;
        const q = loose ? roughQ(c.quality) : c.quality;
        return deg + ':' + q;
      })
      .join('|');
  }

  function packSignature(pack, loose) {
    return pack.chords
      .map((s) => {
        const q = loose ? roughQ(s.q) : s.q;
        return s.d + ':' + q;
      })
      .join('|');
  }

  /**
   * Match working sequence to a canonical pack (same relative moves).
   * Returns { pack, exact, confidence } or null.
   */
  function recognize(chords, tonic) {
    if (!chords || chords.length < 2) return null;
    const exactSig = signature(chords, tonic, false);
    const looseSig = signature(chords, tonic, true);

    for (const pack of PACKS) {
      if (packSignature(pack, false) === exactSig) {
        return { pack, exact: true, confidence: 1, match: 'exact' };
      }
    }
    for (const pack of PACKS) {
      if (packSignature(pack, true) === looseSig) {
        return { pack, exact: false, confidence: 0.85, match: 'quality-family' };
      }
    }
    // Prefix / subsequence: first N chords match a pack of length N
    const n = chords.length;
    for (const pack of PACKS) {
      if (pack.chords.length !== n) continue;
      // already checked
    }
    // Partial: working is prefix of pack or pack is prefix of working
    let best = null;
    for (const pack of PACKS) {
      const pLoose = packSignature(pack, true).split('|');
      const wLoose = looseSig.split('|');
      let matchLen = 0;
      const max = Math.min(pLoose.length, wLoose.length);
      for (let i = 0; i < max; i++) {
        if (pLoose[i] === wLoose[i]) matchLen++;
        else break;
      }
      if (matchLen >= 3 && matchLen >= Math.min(pLoose.length, wLoose.length) * 0.75) {
        const conf = matchLen / Math.max(pLoose.length, wLoose.length);
        if (!best || conf > best.confidence) {
          best = {
            pack,
            exact: false,
            confidence: conf,
            match: matchLen === pLoose.length && matchLen === wLoose.length ? 'family' : 'related',
          };
        }
      }
    }
    return best;
  }

  function getPack(id) {
    return PACKS.find((p) => p.id === id) || null;
  }

  function byFeel(feel) {
    if (!feel || feel === 'all') return PACKS.slice();
    return PACKS.filter((p) => p.feel === feel);
  }

  function byColour(colour) {
    if (!colour || colour === 'all') return PACKS.slice();
    return PACKS.filter((p) => p.colour === colour);
  }

  global.HLPacks = {
    PACKS,
    FEELS,
    COLOURS,
    materialize,
    recognize,
    signature,
    getPack,
    byFeel,
    byColour,
    roughQ,
  };
})(typeof window !== 'undefined' ? window : globalThis);
