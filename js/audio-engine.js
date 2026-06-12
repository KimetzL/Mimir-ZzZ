class AudioEngine {
    constructor() {
        // Usamos dos reproductores HTML5 Audio para lograr un crossfade fluido
        this.players = [new Audio(), new Audio()];
        this.players.forEach(p => {
            p.loop = true;
            p.preload = "auto";
        });
        
        this.activePlayerIdx = 0;
        this.currentSoundType = null;
        this.isPlaying = false;
        
        this.fadeDuration = 600; // milisegundos para el crossfade
        this.fadeIntervals = [];
        
        // Volúmenes relativos ajustados para que todos suenen al mismo nivel percibido
        this.soundVolumes = {
            white: 0.15,
            brown: 0.90,
            green: 0.45,
            rain: 0.55,
            pink: 0.35,
            waves: 0.50,
            fire: 0.45,
            lofi: 0.30,
            cafe: 0.40,
            fan: 0.40
        };

        // Mapeo de archivos de audio
        this.soundUrls = {
            white: 'audio/White-noise.mp3',
            brown: 'audio/Marron.mp3',
            green: 'audio/Green-noise.mp3',
            rain: 'audio/Lluvia.mp3',
            pink: 'audio/Pink-noise.mp3',
            waves: 'audio/Waves.mp3',
            fire: 'audio/Fire-crackling.mp3',
            lofi: 'audio/Lofi.mp3',
            cafe: 'audio/Coffee-shop.mp3',
            fan: 'audio/Fan.mp3'
        };
        
        // Cargar volumen de localStorage
        const savedVol = localStorage.getItem('mimir_vol');
        this.masterVolumeValue = savedVol !== null ? parseFloat(savedVol) : 0.5;
    }

    /**
     * Desbloquea proactivamente los elementos de audio para evitar bloqueos en iOS/Safari.
     */
    unlock() {
        const silentSrc = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
        this.players.forEach(player => {
            const originalSrc = player.src;
            player.src = silentSrc;
            player.play()
                .then(() => {
                    player.pause();
                    player.src = originalSrc;
                })
                .catch(err => {
                    // Ignorar errores del reproductor vacío
                    console.log("Audio player unlocked");
                });
        });
    }

    /**
     * Mantenido por compatibilidad
     */
    init() {
        console.log("AudioEngine inicializado.");
    }

    /**
     * Pre-carga todos los archivos de audio en segundo plano.
     */
    preloadSounds() {
        Object.keys(this.soundUrls).forEach(sound => {
            const url = this.soundUrls[sound];
            if (url) {
                const tempAudio = new Audio();
                tempAudio.preload = "auto";
                tempAudio.src = url;
            }
        });
    }

    /**
     * Método dummy para compatibilidad
     */
    async loadSoundBuffer(type) {
        return true;
    }

    /**
     * Reproduce un sonido específico. Si ya hay uno sonando, hace crossfade.
     */
    async playSound(type, metadata) {
        if (this.isPlaying && this.currentSoundType === type) return true;
        
        const nextPlayerIdx = 1 - this.activePlayerIdx;
        const nextPlayer = this.players[nextPlayerIdx];
        const prevPlayer = this.players[this.activePlayerIdx];
        
        const url = this.soundUrls[type];
        if (!url) return false;
        
        nextPlayer.src = url;
        const relativeVolume = this.soundVolumes[type] || 1.0;
        const targetVol = relativeVolume * this.masterVolumeValue;
        
        nextPlayer.volume = 0.001; // Iniciar en silencio para el fade-in
        
        const playPromise = nextPlayer.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.error("Error al reproducir HTML5 Audio:", error);
            });
        }
        
        // Ejecutar crossfade
        this.crossfade(prevPlayer, nextPlayer, targetVol);
        
        this.activePlayerIdx = nextPlayerIdx;
        this.currentSoundType = type;
        this.isPlaying = true;
        
        this.updateMediaSession(metadata);
        return true;
    }

    /**
     * Realiza un fundido cruzado (crossfade) entre dos reproductores HTML5 Audio.
     */
    crossfade(prevPlayer, nextPlayer, targetVolume) {
        this.fadeIntervals.forEach(interval => clearInterval(interval));
        this.fadeIntervals = [];
        
        const steps = 30;
        const stepTime = this.fadeDuration / steps;
        
        const nextVolStep = targetVolume / steps;
        const prevStartVol = this.isPlaying ? prevPlayer.volume : 0;
        const prevVolStep = prevStartVol / steps;
        
        let currentStep = 0;
        
        const interval = setInterval(() => {
            currentStep++;
            
            // Subir volumen del nuevo
            nextPlayer.volume = Math.max(0, Math.min(1, nextVolStep * currentStep));
            
            // Bajar volumen del anterior
            if (this.isPlaying) {
                prevPlayer.volume = Math.max(0, prevStartVol - (prevVolStep * currentStep));
            }
            
            if (currentStep >= steps) {
                nextPlayer.volume = targetVolume;
                if (this.isPlaying) {
                    prevPlayer.volume = 0;
                    prevPlayer.pause();
                }
                clearInterval(interval);
            }
        }, stepTime);
        
        this.fadeIntervals.push(interval);
    }

    /**
     * Detiene el sonido actual con un fade-out suave.
     */
    stopCurrentSound(customFadeTime = null) {
        if (!this.isPlaying) return;
        
        const player = this.players[this.activePlayerIdx];
        const fadeTime = customFadeTime !== null ? customFadeTime : this.fadeDuration;
        
        this.isPlaying = false;
        this.currentSoundType = null;
        
        this.fadeIntervals.forEach(interval => clearInterval(interval));
        this.fadeIntervals = [];
        
        const steps = 20;
        const stepTime = fadeTime / steps;
        const startVol = player.volume;
        const volStep = startVol / steps;
        let currentStep = 0;
        
        const interval = setInterval(() => {
            currentStep++;
            player.volume = Math.max(0, startVol - (volStep * currentStep));
            
            if (currentStep >= steps) {
                player.volume = 0;
                player.pause();
                clearInterval(interval);
            }
        }, stepTime);
        
        this.fadeIntervals.push(interval);
        
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = "paused";
        }
    }

    setMasterVolume(value) {
        this.masterVolumeValue = Math.max(0, Math.min(1, value));
        
        if (this.isPlaying) {
            const player = this.players[this.activePlayerIdx];
            const relativeVolume = this.soundVolumes[this.currentSoundType] || 1.0;
            player.volume = relativeVolume * this.masterVolumeValue;
        }
    }
    
    fadeOutForTimer(durationSeconds) {
         if (!this.isPlaying) return;
         
         const player = this.players[this.activePlayerIdx];
         const startVol = player.volume;
         const steps = 50;
         const stepTime = (durationSeconds * 1000) / steps;
         const volStep = startVol / steps;
         let currentStep = 0;
         
         this.fadeIntervals.forEach(interval => clearInterval(interval));
         this.fadeIntervals = [];
         
         const interval = setInterval(() => {
             currentStep++;
             player.volume = Math.max(0, startVol - (volStep * currentStep));
             
             if (currentStep >= steps) {
                 this.stopCurrentSound(100);
                 clearInterval(interval);
             }
         }, stepTime);
         
         this.fadeIntervals.push(interval);
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
                const player = this.players[this.activePlayerIdx];
                player.play();
                navigator.mediaSession.playbackState = "playing";
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                this.stopCurrentSound();
                document.dispatchEvent(new CustomEvent('mimir:pause'));
            });
        }
    }
}
