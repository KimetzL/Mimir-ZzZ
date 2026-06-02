class AudioEngine {
    constructor() {
        this.ctx = null;
        this.noiseGen = null;
        this.masterGain = null;
        
        this.activeSourceNode = null;
        this.currentSoundType = null;
        this.isPlaying = false;
        
        this.fadeDuration = 0.5; // segundos para el fade in/out
        
        // Cache de buffers cargados/generados para no recalcular
        this.bufferCache = {};

        // Volúmenes relativos ajustados para que todos suenen al mismo nivel percibido
        this.soundVolumes = {
            white: 0.15,  // El ruido blanco es de muy alta frecuencia y energía percibida
            brown: 0.90,  // El ruido marrón es muy sordo/grave y requiere más amplitud
            green: 0.45,  // El ruido verde (bosque/naturaleza) tiene nivel medio
            rain: 0.55    // La lluvia tiene frecuencias mixtas y suena agradable a nivel medio
        };
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
     * Carga y decodifica un archivo de audio MP3 desde la carpeta local /audio/ de forma asíncrona.
     */
    async loadSoundBuffer(type) {
        if (this.bufferCache[type]) {
            return this.bufferCache[type];
        }

        let url = null;
        switch (type) {
            case 'white': url = 'audio/White-noise.mp3'; break;
            case 'brown': url = 'audio/Marron.mp3'; break;
            case 'green': url = 'audio/Green-noise.mp3'; break;
            case 'rain': url = 'audio/Lluvia.mp3'; break;
            default: return null;
        }

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
            this.bufferCache[type] = audioBuffer;
            return audioBuffer;
        } catch (error) {
            console.error(`Error al cargar o decodificar el audio para '${type}':`, error);
            return null;
        }
    }

    /**
     * Reproduce un sonido específico de forma asíncrona. Si ya hay uno sonando, hace crossfade.
     */
    async playSound(type, metadata) {
        if (!this.ctx) this.init();
        
        const buffer = await this.loadSoundBuffer(type);
        if (!buffer) {
            console.warn("Sonido no soportado o en desarrollo:", type);
            return false;
        }

        // Si ya está sonando el mismo, no hacemos nada
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
        
        // Obtener volumen relativo calibrado para este sonido
        const targetVolume = this.soundVolumes[type] || 1.0;
        
        // Fade-in exponencial hacia el volumen calibrado
        localGain.gain.exponentialRampToValueAtTime(targetVolume, this.ctx.currentTime + this.fadeDuration);

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
