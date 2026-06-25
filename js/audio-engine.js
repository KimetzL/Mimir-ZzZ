class AudioEngine {
    constructor() {
        // Mapa de reproductores por tipo de sonido: { type: { audio: Audio, sourceNode: MediaElementAudioSourceNode, gainNode: GainNode } }
        this.players = {};
        
        this.activeSoundType = null;
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

        // Contexto de Web Audio API (inicializado en unlock/primer gesto del usuario)
        this.ctx = null;
    }

    /**
     * Desbloquea proactivamente el contexto de audio y los reproductores para evitar bloqueos en iOS/Safari.
     */
    unlock() {
        if (!this.ctx) {
            try {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                if (navigator.audioSession) {
                    navigator.audioSession.type = 'playback';
                }
            } catch (e) {
                console.error("Web Audio API no soportado:", e);
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(err => console.log("Error al resumir AudioContext:", err));
        }

        // En iOS, reproducir un fragmento de silencio inicializa la sesión de audio de forma global.
        const silentSrc = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
        const tempPlayer = new Audio(silentSrc);
        tempPlayer.play()
            .then(() => {
                tempPlayer.pause();
            })
            .catch(err => {
                console.log("Error al desbloquear audio temporal:", err);
            });
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
     * Crea u obtiene un reproductor para un tipo de sonido específico.
     * Si Web Audio está disponible, lo enruta a través de un GainNode para controlar el volumen en iOS.
     */
    getOrCreatePlayer(type) {
        if (!this.players[type]) {
            const url = this.soundUrls[type];
            if (!url) return null;
            
            const audio = new Audio(url);
            audio.loop = true;
            audio.preload = "auto";
            
            let gainNode = null;
            let sourceNode = null;
            
            if (this.ctx) {
                try {
                    gainNode = this.ctx.createGain();
                    sourceNode = this.ctx.createMediaElementSource(audio);
                    sourceNode.connect(gainNode);
                    gainNode.connect(this.ctx.destination);
                    // Inicializar la ganancia en silencio para evitar saltos antes del fade-in
                    gainNode.gain.value = 0;
                } catch (e) {
                    console.error("Error al crear nodos Web Audio para " + type, e);
                }
            }
            
            this.players[type] = {
                audio: audio,
                gainNode: gainNode,
                sourceNode: sourceNode
            };
        }
        return this.players[type];
    }

    /**
     * Aplica el volumen a un reproductor usando GainNode o el atributo volume clásico como fallback.
     */
    setVolume(playerObj, volume) {
        if (playerObj.gainNode) {
            playerObj.gainNode.gain.value = volume;
        } else {
            playerObj.audio.volume = volume;
        }
    }

    /**
     * Reproduce un sonido específico. Si ya hay uno sonando, hace crossfade.
     */
    async playSound(type, metadata) {
        if (this.isPlaying && this.activeSoundType === type) return true;
        
        // Asegurar que el contexto de audio esté activo
        if (this.ctx && this.ctx.state === 'suspended') {
            await this.ctx.resume().catch(e => console.error("Error al resumir AudioContext en playSound", e));
        }
        
        const nextPlayerObj = this.getOrCreatePlayer(type);
        if (!nextPlayerObj) return false;
        
        const prevSoundType = this.activeSoundType;
        const prevPlayerObj = prevSoundType ? this.players[prevSoundType] : null;
        
        const relativeVolume = this.soundVolumes[type] || 1.0;
        const targetVol = relativeVolume * this.masterVolumeValue;
        
        // Iniciar en silencio para el fade-in
        this.setVolume(nextPlayerObj, 0.001);
        
        const playPromise = nextPlayerObj.audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.error("Error al reproducir HTML5 Audio:", error);
            });
        }
        
        // Ejecutar crossfade
        this.crossfade(prevPlayerObj, nextPlayerObj, type, targetVol);
        
        this.activeSoundType = type;
        this.isPlaying = true;
        
        this.updateMediaSession(metadata);
        return true;
    }

    /**
     * Realiza un fundido cruzado (crossfade) entre dos reproductores.
     */
    crossfade(prevPlayerObj, nextPlayerObj, nextType, targetVolume) {
        this.fadeIntervals.forEach(interval => clearInterval(interval));
        this.fadeIntervals = [];
        
        const steps = 30;
        const stepTime = this.fadeDuration / steps;
        
        const nextVolStep = targetVolume / steps;
        
        let prevStartVol = 0;
        if (this.isPlaying && prevPlayerObj) {
            prevStartVol = prevPlayerObj.gainNode ? prevPlayerObj.gainNode.gain.value : prevPlayerObj.audio.volume;
        }
        const prevVolStep = prevStartVol / steps;
        
        let currentStep = 0;
        
        const interval = setInterval(() => {
            currentStep++;
            
            // Subir volumen del nuevo
            const nextVol = Math.max(0, Math.min(1, nextVolStep * currentStep));
            this.setVolume(nextPlayerObj, nextVol);
            
            // Bajar volumen del anterior
            if (this.isPlaying && prevPlayerObj) {
                const prevVol = Math.max(0, prevStartVol - (prevVolStep * currentStep));
                this.setVolume(prevPlayerObj, prevVol);
            }
            
            if (currentStep >= steps) {
                this.setVolume(nextPlayerObj, targetVolume);
                if (this.isPlaying && prevPlayerObj) {
                    this.setVolume(prevPlayerObj, 0);
                    prevPlayerObj.audio.pause();
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
        if (!this.isPlaying || !this.activeSoundType) return;
        
        const playerObj = this.players[this.activeSoundType];
        if (!playerObj) return;
        
        const fadeTime = customFadeTime !== null ? customFadeTime : this.fadeDuration;
        
        this.isPlaying = false;
        this.activeSoundType = null;
        
        this.fadeIntervals.forEach(interval => clearInterval(interval));
        this.fadeIntervals = [];
        
        const steps = 20;
        const stepTime = fadeTime / steps;
        const startVol = playerObj.gainNode ? playerObj.gainNode.gain.value : playerObj.audio.volume;
        const volStep = startVol / steps;
        let currentStep = 0;
        
        const interval = setInterval(() => {
            currentStep++;
            const currentVol = Math.max(0, startVol - (volStep * currentStep));
            this.setVolume(playerObj, currentVol);
            
            if (currentStep >= steps) {
                this.setVolume(playerObj, 0);
                playerObj.audio.pause();
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
        
        if (this.isPlaying && this.activeSoundType) {
            const playerObj = this.players[this.activeSoundType];
            if (playerObj) {
                const relativeVolume = this.soundVolumes[this.activeSoundType] || 1.0;
                this.setVolume(playerObj, relativeVolume * this.masterVolumeValue);
            }
        }
    }
    
    fadeOutForTimer(durationSeconds) {
         if (!this.isPlaying || !this.activeSoundType) return;
         
         const playerObj = this.players[this.activeSoundType];
         if (!playerObj) return;
         
         const startVol = playerObj.gainNode ? playerObj.gainNode.gain.value : playerObj.audio.volume;
         const steps = 50;
         const stepTime = (durationSeconds * 1000) / steps;
         const volStep = startVol / steps;
         let currentStep = 0;
         
         this.fadeIntervals.forEach(interval => clearInterval(interval));
         this.fadeIntervals = [];
         
         const interval = setInterval(() => {
             currentStep++;
             const currentVol = Math.max(0, startVol - (volStep * currentStep));
             this.setVolume(playerObj, currentVol);
             
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
                if (this.activeSoundType) {
                    const playerObj = this.players[this.activeSoundType];
                    if (playerObj) {
                        playerObj.audio.play();
                        navigator.mediaSession.playbackState = "playing";
                    }
                }
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                this.stopCurrentSound();
                document.dispatchEvent(new CustomEvent('mimir:pause'));
            });
        }
    }
}
