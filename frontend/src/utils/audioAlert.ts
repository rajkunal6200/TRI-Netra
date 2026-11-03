/**
 * Web Audio API synthesizer and Speech Synthesis engine for real-time security surveillance alerts
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private volume: number = 0.8;
  private isUnlocked: boolean = false;
  private lastSpokenText: string = '';
  private lastSpokenTime: number = 0;

  constructor() {
    // Automatically unlock audio context on any initial user gesture
    if (typeof window !== 'undefined') {
      const unlockAudio = () => {
        this.initCtx();
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
        if ('speechSynthesis' in window && window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        this.isUnlocked = true;
      };

      window.addEventListener('pointerdown', unlockAudio, { once: true });
      window.addEventListener('click', unlockAudio, { once: true });
      window.addEventListener('keydown', unlockAudio, { once: true });
      window.addEventListener('touchstart', unlockAudio, { once: true });
    }
  }

  public initCtx() {
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    } catch (e) {
      console.warn('AudioContext init error:', e);
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  public getVolume(): number {
    return this.volume;
  }

  /**
   * High-urgency tactical siren for Unauthorized Intruder / Security Breaches
   */
  public playIntruderAlarm() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      // Siren sweep: 880Hz -> 440Hz -> 880Hz
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.15);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.45);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.6);

      gain.gain.setValueAtTime(this.volume * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.7);
    } catch (e) {
      console.warn('Audio alert playback failed:', e);
    }
  }

  /**
   * Warning double-beep for Unknown or Suspicious individual detected
   */
  public playWarningBeep() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      
      // Beep 1
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(640, now);
      gain1.gain.setValueAtTime(this.volume * 0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.12);

      // Beep 2
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(640, now + 0.16);
      gain2.gain.setValueAtTime(this.volume * 0.3, now + 0.16);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now + 0.16);
      osc2.stop(now + 0.28);
    } catch (e) {
      console.warn('Audio alert playback failed:', e);
    }
  }

  /**
   * Soft affirmative two-tone chime for Authorized Personnel match
   */
  public playAuthorizedChime() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(523.25, now); // C5
      gain1.gain.setValueAtTime(this.volume * 0.2, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.2);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(783.99, now + 0.1); // G5
      gain2.gain.setValueAtTime(this.volume * 0.2, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.35);
    } catch (e) {
      console.warn('Audio alert playback failed:', e);
    }
  }

  /**
   * Continuous emergency lockdown siren
   */
  public playLockdownSiren() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(400, now);
      osc.frequency.linearRampToValueAtTime(950, now + 0.5);
      osc.frequency.linearRampToValueAtTime(400, now + 1.0);

      gain.gain.setValueAtTime(this.volume * 0.35, now);
      gain.gain.linearRampToValueAtTime(this.volume * 0.35, now + 0.9);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.05);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 1.05);
    } catch (e) {
      console.warn('Audio alert playback failed:', e);
    }
  }

  /**
   * Stop all ongoing speech and audio
   */
  public stopAllSpeech() {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch (e) {
      console.warn('Failed to stop speech:', e);
    }
  }

  /**
   * Vocal tactical security announcements via SpeechSynthesis
   */
  public speakAnnouncement(text: string, force = false) {
    if (this.isMuted) return;

    // Prevent excessive repetition of identical speech within 4 seconds
    const now = Date.now();
    if (!force && text === this.lastSpokenText && now - this.lastSpokenTime < 4000) {
      return;
    }
    this.lastSpokenText = text;
    this.lastSpokenTime = now;

    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.cancel(); // Stop prior overlapping speech

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = Math.max(0.4, this.volume);
        
        // Pick an English voice if available
        const voices = window.speechSynthesis.getVoices();
        const enVoice = voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('David') || v.name.includes('Samantha')));
        if (enVoice) {
          utterance.voice = enVoice;
        }

        window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
      console.warn('Speech synthesis alert error:', e);
    }
  }

  /**
   * Test audio synthesis and voice announcements
   */
  public testAudioSystem() {
    this.initCtx();
    this.playIntruderAlarm();
    setTimeout(() => {
      this.speakAnnouncement('Security voice alert system operational. Unregistered threat detection active.', true);
    }, 400);
  }
}

export const soundEngine = new SoundEngine();
