document.addEventListener('DOMContentLoaded', () => {
    // Registro del Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registrado', reg.scope))
            .catch(err => console.error('Error al registrar Service Worker', err));
    }

    // Inicializar Motor
    const engine = new AudioEngine();
    engine.preloadSounds();

    // Desbloquear reproductores de audio proactivamente en el primer toque del usuario (crítico para iOS)
    const unlockAudio = () => {
        if (typeof engine.unlock === 'function') {
            engine.unlock();
        }
        document.removeEventListener('touchstart', unlockAudio);
        document.removeEventListener('click', unlockAudio);
    };
    document.addEventListener('touchstart', unlockAudio, { passive: true, once: true });
    document.addEventListener('click', unlockAudio, { passive: true, once: true });
    
    // Elementos DOM
    const soundCards = document.querySelectorAll('.sound-card');
    const bottomControls = document.getElementById('bottom-controls');
    const activeSoundName = document.getElementById('active-sound-name');
    const activeSoundIcon = document.getElementById('active-sound-icon');
    const masterVolume = document.getElementById('master-volume');
    const btnStop = document.getElementById('btn-stop');
    
    // Elementos Timer
    const btnTimer = document.getElementById('btn-timer');
    const timerDisplay = document.getElementById('timer-display');
    const timerModal = document.getElementById('timer-modal');
    const closeTimer = document.getElementById('close-timer');
    const presetBtns = document.querySelectorAll('.preset-btn');
    const customTimeInput = document.getElementById('custom-time');
    const btnStartTimer = document.getElementById('btn-start-timer');
    const btnCancelTimer = document.getElementById('btn-cancel-timer');
    
    // Variables de estado
    let activeCard = null;
    let timerInterval = null;
    let timerEndTime = null;

    // ----- LÓGICA DE TARJETAS DE SONIDO -----
    soundCards.forEach(card => {
        card.addEventListener('click', async () => {
            if (card.classList.contains('disabled')) return;
            
            const soundType = card.dataset.sound;
            const soundName = card.querySelector('span').textContent;
            const soundIcon = card.querySelector('.icon').textContent;
            
            // Si hacemos clic en la tarjeta que ya está sonando, la pausamos
            if (activeCard === card) {
                stopPlayback();
                return;
            }
            
            // Reproducir nuevo sonido
            const metadata = { title: soundName };
            try {
                const success = await engine.playSound(soundType, metadata);
                
                if (success) {
                    // Actualizar UI
                    if (activeCard) activeCard.classList.remove('active');
                    card.classList.add('active');
                    activeCard = card;
                    
                    activeSoundName.textContent = soundName;
                    activeSoundIcon.textContent = soundIcon;
                    
                    bottomControls.classList.remove('hidden');
                }
            } catch (err) {
                console.error("Error al reproducir el sonido:", err);
            }
        });
    });

    // ----- CONTROLES INFERIORES -----
    btnStop.addEventListener('click', () => {
        stopPlayback();
    });

    masterVolume.addEventListener('input', (e) => {
        const vol = parseFloat(e.target.value);
        engine.setMasterVolume(vol);
        // Guardar preferencia
        localStorage.setItem('mimir_vol', vol);
    });
    
    // Recuperar volumen guardado
    const savedVol = localStorage.getItem('mimir_vol');
    if (savedVol !== null) {
        masterVolume.value = savedVol;
        // El engine se actualizará cuando se inicie por primera vez
    }
    
    // Hook para cuando el SO pausa (Media Session API)
    document.addEventListener('mimir:pause', () => {
        stopPlayback();
    });

    function stopPlayback() {
        engine.stopCurrentSound();
        if (activeCard) {
            activeCard.classList.remove('active');
            activeCard = null;
        }
        bottomControls.classList.add('hidden');
        cancelTimer(); // Si se para manual, el timer ya no tiene sentido
    }

    // ----- LÓGICA DEL TEMPORIZADOR -----
    
    btnTimer.addEventListener('click', () => {
        timerModal.classList.remove('hidden');
    });
    
    closeTimer.addEventListener('click', () => {
        timerModal.classList.add('hidden');
    });
    
    // Cerrar clickeando fuera del modal
    timerModal.addEventListener('click', (e) => {
        if (e.target === timerModal) timerModal.classList.add('hidden');
    });
    
    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const minutes = parseInt(btn.dataset.time);
            startTimer(minutes);
        });
    });
    
    btnStartTimer.addEventListener('click', () => {
        const minutes = parseInt(customTimeInput.value);
        if (minutes > 0) {
            startTimer(minutes);
        }
    });
    
    btnCancelTimer.addEventListener('click', () => {
        cancelTimer();
        timerModal.classList.add('hidden');
    });
    
    function startTimer(minutes) {
        cancelTimer();
        
        const now = Date.now();
        timerEndTime = now + (minutes * 60 * 1000);
        
        btnCancelTimer.classList.remove('hidden');
        timerModal.classList.add('hidden');
        btnTimer.classList.add('active');
        
        updateTimerDisplay();
        timerInterval = setInterval(updateTimerDisplay, 1000);
    }
    
    function cancelTimer() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        timerEndTime = null;
        timerDisplay.textContent = "";
        btnCancelTimer.classList.add('hidden');
        btnTimer.classList.remove('active');
    }
    
    function updateTimerDisplay() {
        if (!timerEndTime) return;
        
        const now = Date.now();
        const remaining = timerEndTime - now;
        
        if (remaining <= 0) {
            cancelTimer();
            // Iniciar Fade-out de 10 segundos
            engine.fadeOutForTimer(10);
            
            // Actualizar UI tras el tiempo de fade
            setTimeout(() => {
                if (activeCard) {
                    activeCard.classList.remove('active');
                    activeCard = null;
                }
                bottomControls.classList.add('hidden');
            }, 10000);
            return;
        }
        
        // Formateo mm:ss o hh:mm:ss
        const totalSeconds = Math.floor(remaining / 1000);
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        
        let display = "";
        if (h > 0) display += `${h}:`;
        display += `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        
        timerDisplay.textContent = display;
    }


    // ----- FONDO ANIMADO (PARTÍCULAS) -----
    const canvas = document.getElementById('particles-bg');
    const ctx = canvas.getContext('2d');
    let particles = [];
    
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    
    class Particle {
        constructor() {
            this.reset();
        }
        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 2;
            this.speedX = Math.random() * 0.5 - 0.25;
            this.speedY = Math.random() * -0.5 - 0.1; // Flotan hacia arriba
            this.opacity = Math.random() * 0.5 + 0.1;
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            
            // Reset si sale de pantalla
            if (this.y < 0 || this.x < 0 || this.x > canvas.width) {
                this.reset();
                this.y = canvas.height; // Vuelve a salir por abajo
            }
        }
        draw() {
            ctx.fillStyle = `rgba(255, 255, 255, ${this.opacity})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    
    function initParticles() {
        particles = [];
        // Menos partículas en móvil para ahorrar batería
        const particleCount = window.innerWidth < 600 ? 30 : 70;
        for (let i = 0; i < particleCount; i++) {
            particles.push(new Particle());
        }
    }
    
    function animateParticles() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            p.update();
            p.draw();
        });
        requestAnimationFrame(animateParticles);
    }
    
    initParticles();
    animateParticles();
});
