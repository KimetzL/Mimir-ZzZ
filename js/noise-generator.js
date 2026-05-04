/**
 * Generador de ruido programático usando Web Audio API.
 * Crea buffers largos (ej: 10 segundos) para que puedan reproducirse en bucle
 * con bajo coste de CPU y alta compatibilidad en iOS.
 */
class NoiseGenerator {
    constructor(audioContext) {
        this.ctx = audioContext;
        this.bufferSize = this.ctx.sampleRate * 5; // 5 segundos de loop
    }

    /**
     * Ruido Blanco (White Noise): Espectro plano.
     */
    generateWhiteNoise() {
        const buffer = this.ctx.createBuffer(1, this.bufferSize, this.ctx.sampleRate);
        const output = buffer.getChannelData(0);
        for (let i = 0; i < this.bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        return buffer;
    }

    /**
     * Ruido Rosa (Pink Noise): -3dB por octava.
     * Basado en el algoritmo de Paul Kellet.
     */
    generatePinkNoise() {
        const buffer = this.ctx.createBuffer(1, this.bufferSize, this.ctx.sampleRate);
        const output = buffer.getChannelData(0);
        
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

        for (let i = 0; i < this.bufferSize; i++) {
            let white = Math.random() * 2 - 1;
            
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            
            output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
            output[i] *= 0.11; // Ajuste de volumen para igualar la energía aparente
            b6 = white * 0.115926;
        }
        return buffer;
    }

    /**
     * Ruido Marrón (Brown Noise): -6dB por octava.
     */
    generateBrownNoise() {
        const buffer = this.ctx.createBuffer(1, this.bufferSize, this.ctx.sampleRate);
        const output = buffer.getChannelData(0);
        let lastOut = 0;
        
        for (let i = 0; i < this.bufferSize; i++) {
            let white = Math.random() * 2 - 1;
            // Integrador con fuga (Leaky integrator)
            output[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = output[i];
            output[i] *= 3.5; // Compensación de volumen
        }
        return buffer;
    }

    /**
     * Ruido Verde (Green Noise): Bandpass filter sobre ruido blanco.
     * Simula frecuencias de la naturaleza.
     */
    generateGreenNoise() {
        // En lugar de aplicar el filtro muestra a muestra, podemos
        // pre-generar el ruido blanco y luego pasarlo por un OfflineAudioContext
        // para aplicar un filtro Biquad con precisión perfecta, o hacerlo matemáticamente simple:
        
        // Versión sencilla y eficiente usando un filtro de paso de banda rudimentario
        // centrado en frecuencias medias (simulando bosque/agua)
        
        const buffer = this.ctx.createBuffer(1, this.bufferSize, this.ctx.sampleRate);
        const output = buffer.getChannelData(0);
        
        let out1 = 0, out2 = 0;
        let p = 0.5; // Frecuencia central relativa (0 a 1) -> ajustado a medios
        
        // Coeficientes básicos para bandpass
        for (let i = 0; i < this.bufferSize; i++) {
            let white = Math.random() * 2 - 1;
            // Filtro Bandpass simplificado
            let r = 0.99; // Q (resonancia invertida)
            out1 = p * (white - out1) + out1;
            let temp = out1;
            out1 = r * out1 + (1 - r) * white;
            out2 = r * out2 + temp;
            
            output[i] = (out1 - out2) * 5.0; // Ganancia compensada
        }
        return buffer;
    }
}
