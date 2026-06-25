class AudioEngine {
    constructor() {
        this.buffers = {}; // Caché de AudioBuffer decodificados: { type: AudioBuffer }
        this.activeSources = {}; // Nodos de origen de audio activos en reproducción: { type: AudioBufferSourceNode }
        this.gainNodes = {}; // Nodos de control de ganancia (volumen): { type: GainNode }
        
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

        this.ctx = null;
        this.loadingSoundType = null; // Previene condiciones de carrera si se pulsa otro sonido al cargar
    }

    /**
     * Inicializa y desbloquea el AudioContext en dispositivos móviles tras la interacción del usuario.
     */
    unlock() {
        if (!this.ctx) {
            try {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                if (navigator.audioSession) {
                    navigator.audioSession.type = 'playback';
                }
            } catch (e) {
                console.error("Web Audio API no soportado en este navegador:", e);
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(err => console.log("Error al resumir AudioContext:", err));
        }

        // Primar la salida de audio reproduciendo un búfer silencioso de 1 muestra (crucial para iOS)
        try {
            const buffer = this.ctx.createBuffer(1, 1, 22050);
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.ctx.destination);
            source.start(0);
        } catch (e) {
            console.log("Error al reproducir búfer de desbloqueo:", e);
        }
    }

    /**
     * Pre-descarga los archivos de audio en segundo plano para guardarlos en la caché local.
     */
    preloadSounds() {
        Object.keys(this.soundUrls).forEach(sound => {
            const url = this.soundUrls[sound];
            if (url) {
                fetch(url).catch(err => console.log("Error pre-descargando sonido " + sound, err));
            }
        });
    }

    /**
     * Decodifica un ArrayBuffer a PCM AudioBuffer compatible con navegadores antiguos y modernos.
     */
    decodeAudio(arrayBuffer) {
        return new Promise((resolve, reject) => {
            if (!this.ctx) {
                reject(new Error("AudioContext no inicializado"));
                return;
            }
            const promise = this.ctx.decodeAudioData(arrayBuffer, resolve, reject);
            if (promise && typeof promise.catch === 'function') {
                promise.catch(reject);
            }
        });
    }

    /**
     * Obtiene el AudioBuffer decodificado de la caché o lo descarga e instala.
     */
    async getAudioBuffer(type) {
        if (this.buffers[type]) return this.buffers[type];
        
        const url = this.soundUrls[type];
        if (!url) return null;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Fallo al descargar sonido en ${url}`);
        
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.decodeAudio(arrayBuffer);
        
        this.buffers[type] = audioBuffer;
        return audioBuffer;
    }

    /**
     * Obtiene o crea un GainNode dedicado para un tipo de sonido.
     */
    getOrCreateGainNode(type) {
        if (!this.gainNodes[type] && this.ctx) {
            this.gainNodes[type] = this.ctx.createGain();
            this.gainNodes[type].connect(this.ctx.destination);
            this.gainNodes[type].gain.value = 0;
        }
        return this.gainNodes[type];
    }

    /**
     * Reproduce un sonido de manera continua. Realiza crossfade si ya hay otro en curso.
     */
    async playSound(type, metadata) {
        if (this.isPlaying && this.activeSoundType === type) return true;
        
        // Asegurar que el contexto de audio esté corriendo
        if (!this.ctx) {
            this.unlock();
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            await this.ctx.resume().catch(e => console.error("Error al resumir AudioContext en playSound", e));
        }
        
        this.loadingSoundType = type;
        
        let buffer;
        try {
            buffer = await this.getAudioBuffer(type);
        } catch (e) {
            console.error("Error al obtener el buffer de audio para " + type, e);
            if (this.loadingSoundType === type) {
                this.loadingSoundType = null;
            }
            return false;
        }
        
        // Si el usuario cambió a otro sonido durante la decodificación, abortamos la reproducción
        if (this.loadingSoundType !== type) {
            return false;
        }
        
        const prevSoundType = this.activeSoundType;
        const nextGain = this.getOrCreateGainNode(type);
        if (!nextGain) return false;
        
        // Crear un nuevo AudioBufferSourceNode (los nodos fuente no pueden reutilizarse)
        const nextSource = this.ctx.createBufferSource();
        nextSource.buffer = buffer;
        nextSource.loop = true; // Activa bucle perfecto a nivel de muestras (gapless)
        nextSource.connect(nextGain);
        
        this.activeSources[type] = nextSource;
        
        const relativeVolume = this.soundVolumes[type] || 1.0;
        const targetVol = relativeVolume * this.masterVolumeValue;
        
        // Iniciar en silencio absoluto para el crossfade suave
        nextGain.gain.setValueAtTime(0.001, this.ctx.currentTime);
        nextSource.start(0);
        
        this.crossfade(prevSoundType, type, targetVol);
        
        this.activeSoundType = type;
        this.isPlaying = true;
        this.loadingSoundType = null;
        
        this.updateMediaSession(metadata);
        return true;
    }

    /**
     * Realiza un fundido cruzado (crossfade) de precisión entre dos sonidos.
     */
    crossfade(prevType, nextType, targetVolume) {
        this.fadeIntervals.forEach(interval => clearInterval(interval));
        this.fadeIntervals = [];
        
        const steps = 30;
        const stepTime = this.fadeDuration / steps;
        
        const nextGain = this.gainNodes[nextType];
        const nextVolStep = targetVolume / steps;
        
        const prevGain = prevType ? this.gainNodes[prevType] : null;
        const prevSource = prevType ? this.activeSources[prevType] : null;
        
        let prevStartVol = 0;
        if (this.isPlaying && prevGain) {
            prevStartVol = prevGain.gain.value;
        }
        const prevVolStep = prevStartVol / steps;
        
        let currentStep = 0;
        
        const interval = setInterval(() => {
            currentStep++;
            
            // Subir volumen del nuevo
            const nextVol = Math.max(0, Math.min(1, nextVolStep * currentStep));
            if (nextGain) {
                nextGain.gain.value = nextVol;
            }
            
            // Bajar volumen del anterior
            if (this.isPlaying && prevGain) {
                const prevVol = Math.max(0, prevStartVol - (prevVolStep * currentStep));
                prevGain.gain.value = prevVol;
            }
            
            if (currentStep >= steps) {
                if (nextGain) {
                    nextGain.gain.value = targetVolume;
                }
                
                if (this.isPlaying && prevGain && prevSource) {
                    prevGain.gain.value = 0;
                    try {
                        prevSource.stop();
                    } catch (e) {
                        // Ignorar errores si la fuente ya está detenida
                    }
                    delete this.activeSources[prevType];
                }
                clearInterval(interval);
            }
        }, stepTime);
        
        this.fadeIntervals.push(interval);
    }

    /**
     * Detiene la reproducción actual aplicando un fade-out.
     */
    stopCurrentSound(customFadeTime = null) {
        this.loadingSoundType = null; // Abortar cualquier carga asíncrona en curso
        
        if (!this.isPlaying || !this.activeSoundType) return;
        
        const type = this.activeSoundType;
        const source = this.activeSources[type];
        const gainNode = this.gainNodes[type];
        
        if (!source || !gainNode) {
            this.isPlaying = false;
            this.activeSoundType = null;
            return;
        }
        
        const fadeTime = customFadeTime !== null ? customFadeTime : this.fadeDuration;
        
        this.isPlaying = false;
        this.activeSoundType = null;
        
        this.fadeIntervals.forEach(interval => clearInterval(interval));
        this.fadeIntervals = [];
        
        const steps = 20;
        const stepTime = fadeTime / steps;
        const startVol = gainNode.gain.value;
        const volStep = startVol / steps;
        let currentStep = 0;
        
        const interval = setInterval(() => {
            currentStep++;
            const currentVol = Math.max(0, startVol - (volStep * currentStep));
            gainNode.gain.value = currentVol;
            
            if (currentStep >= steps) {
                gainNode.gain.value = 0;
                try {
                    source.stop();
                } catch (e) {
                    // Ignorar
                }
                delete this.activeSources[type];
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
            const gainNode = this.gainNodes[this.activeSoundType];
            if (gainNode) {
                const relativeVolume = this.soundVolumes[this.activeSoundType] || 1.0;
                gainNode.gain.value = relativeVolume * this.masterVolumeValue;
            }
        }
    }
    
    fadeOutForTimer(durationSeconds) {
         if (!this.isPlaying || !this.activeSoundType) return;
         
         const type = this.activeSoundType;
         const gainNode = this.gainNodes[type];
         if (!gainNode) return;
         
         const startVol = gainNode.gain.value;
         const steps = 50;
         const stepTime = (durationSeconds * 1000) / steps;
         const volStep = startVol / steps;
         let currentStep = 0;
         
         this.fadeIntervals.forEach(interval => clearInterval(interval));
         this.fadeIntervals = [];
         
         const interval = setInterval(() => {
             currentStep++;
             const currentVol = Math.max(0, startVol - (volStep * currentStep));
             gainNode.gain.value = currentVol;
             
             if (currentStep >= steps) {
                 this.stopCurrentSound(100);
                 clearInterval(interval);
             }
         }, stepTime);
         
         this.fadeIntervals.push(interval);
    }

    /**
     * Sincroniza los controles del sistema operativo móvil/escritorio (Media Session API).
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
                    const gainNode = this.gainNodes[this.activeSoundType];
                    const buffer = this.buffers[this.activeSoundType];
                    const source = this.activeSources[this.activeSoundType];
                    
                    if (buffer && !source && this.ctx) {
                        const newSource = this.ctx.createBufferSource();
                        newSource.buffer = buffer;
                        newSource.loop = true;
                        newSource.connect(gainNode);
                        newSource.start(0);
                        this.activeSources[this.activeSoundType] = newSource;
                    }
                    navigator.mediaSession.playbackState = "playing";
                }
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                this.stopCurrentSound();
                document.dispatchEvent(new CustomEvent('mimir:pause'));
            });
        }
    }
}
