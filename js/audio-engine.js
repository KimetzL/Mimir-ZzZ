class AudioEngine {
    constructor() {
        this.ctx = null;
        this.noiseGen = null;
        this.masterGain = null;
        
        this.activeSourceNode = null;
        this.currentSoundType = null;
        this.isPlaying = false;
        
        this.fadeDuration = 0.5; // segundos para el fade in/out
        
        // Cache de buffers generados para no recalcular
        this.bufferCache = {};
    }

    /**
     * Inicializa el AudioContext. Debe llamarse como respuesta a un evento de usuario (clic).
     */
    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
            this.noiseGen = new NoiseGenerator(this.ctx);
            
            this.masterGain = this.ctx.createGain();
            this.masterGain.connect(this.ctx.destination);
            // Volumen inicial (puede ser sobrescrito por localStorage)
            this.masterGain.gain.value = 0.5;
            
            console.log("AudioContext inicializado:", this.ctx.state);
        } else if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    /**
     * Devuelve el buffer correspondiente al tipo de ruido. Lo genera y cachea si es necesario.
     */
    getBufferForSound(type) {
        if (this.bufferCache[type]) {
            return this.bufferCache[type];
        }

        let buffer = null;
        switch (type) {
            case 'white': buffer = this.noiseGen.generateWhiteNoise(); break;
            case 'pink': buffer = this.noiseGen.generatePinkNoise(); break;
            case 'brown': buffer = this.noiseGen.generateBrownNoise(); break;
            case 'green': buffer = this.noiseGen.generateGreenNoise(); break;
            default: return null;
        }

        if (buffer) {
            this.bufferCache[type] = buffer;
        }
        return buffer;
    }

    /**
     * Reproduce un sonido específico. Si ya hay uno sonando, hace crossfade.
     */
    playSound(type, metadata) {
        if (!this.ctx) this.init();
        
        const buffer = this.getBufferForSound(type);
        if (!buffer) {
            console.warn("Sonido no soportado o en desarrollo:", type);
            return false;
        }

        // Si ya está sonando el mismo, no hacemos nada (o podríamos pausarlo, pero app.js gestiona eso)
        if (this.isPlaying && this.currentSoundType === type) return true;

        this.stopCurrentSound(); // Detiene con fade-out rápido

        // Crear nuevo nodo fuente
        this.activeSourceNode = this.ctx.createBufferSource();
        this.activeSourceNode.buffer = buffer;
        this.activeSourceNode.loop = true;

        // Crear ganancia local para fade-in
        const localGain = this.ctx.createGain();
        localGain.gain.setValueAtTime(0.001, this.ctx.currentTime); // Empezar en silencio (evitar click)
        
        this.activeSourceNode.connect(localGain);
        localGain.connect(this.masterGain);

        this.activeSourceNode.start();
        
        // Fade-in lineal
        localGain.gain.exponentialRampToValueAtTime(1.0, this.ctx.currentTime + this.fadeDuration);

        // Guardamos referencia a la ganancia en el nodo para poder hacer fade-out
        this.activeSourceNode.fadeGain = localGain;

        this.currentSoundType = type;
        this.isPlaying = true;
        
        this.updateMediaSession(metadata);

        return true;
    }

    /**
     * Detiene el sonido actual con un fade-out suave.
     */
    stopCurrentSound(customFadeTime = null) {
        if (!this.activeSourceNode || !this.isPlaying) return;

        const nodeToStop = this.activeSourceNode;
        const gainNode = nodeToStop.fadeGain;
        const fadeTime = customFadeTime !== null ? customFadeTime : this.fadeDuration;

        // Limpiar el estado actual inmediatamente para que la app sepa que se detuvo,
        // aunque el audio tarde un poco más en apagarse.
        this.activeSourceNode = null;
        this.currentSoundType = null;
        this.isPlaying = false;

        // Fade-out
        const currentTime = this.ctx.currentTime;
        gainNode.gain.cancelScheduledValues(currentTime);
        gainNode.gain.setValueAtTime(gainNode.gain.value, currentTime);
        
        // Evitamos bajar a 0 exacto con exponentialRamp, usamos un valor muy bajo
        gainNode.gain.exponentialRampToValueAtTime(0.001, currentTime + fadeTime);
        
        // Detener el nodo después del fade
        nodeToStop.stop(currentTime + fadeTime);
        
        // Limpiar Media Session
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = "paused";
        }
    }

    setMasterVolume(value) {
        if (this.masterGain) {
            // value debe estar entre 0 y 1
            const clamped = Math.max(0, Math.min(1, value));
            // Evitar clicks al cambiar volumen
            this.masterGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.1);
        }
    }
    
    fadeOutForTimer(durationSeconds) {
         if (!this.isPlaying || !this.masterGain) return;
         
         const currentTime = this.ctx.currentTime;
         const currentVol = this.masterGain.gain.value;
         
         this.masterGain.gain.cancelScheduledValues(currentTime);
         this.masterGain.gain.setValueAtTime(currentVol, currentTime);
         
         // Fade progresivo a 0
         this.masterGain.gain.linearRampToValueAtTime(0.001, currentTime + durationSeconds);
         
         // Programar el stop completo
         setTimeout(() => {
             this.stopCurrentSound(0.1);
             // Restaurar volumen base para la próxima vez
             this.masterGain.gain.value = currentVol;
         }, durationSeconds * 1000);
    }

    /**
     * Actualiza la API Media Session del navegador (controles del SO)
     */
    updateMediaSession(metadata) {
        if ('mediaSession' in navigator && metadata) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: metadata.title || 'Mimir App',
                artist: 'Sonido Ambiental',
                album: 'Focus & Sleep',
                artwork: [
                    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
                ]
            });

            navigator.mediaSession.playbackState = "playing";

            // Controladores de SO
            navigator.mediaSession.setActionHandler('play', () => {
                // El SO pide Play, pero nosotros no tenemos "resume" simple porque la app
                // detiene el buffer. Podríamos reconstruirlo, pero en PWA iOS a veces
                // esto ni se ejecuta bien con Web Audio API. Lo dejamos como hook listo.
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                this.stopCurrentSound();
                // Deberíamos despachar un evento para que la UI se entere
                document.dispatchEvent(new CustomEvent('mimir:pause'));
            });
        }
    }
}
