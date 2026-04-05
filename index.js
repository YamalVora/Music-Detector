// basically, Mic → waveform samples
//Waveform → frequency (Hz)
//Frequency → musical note (A, C#, etc.)
//Note → chord (Am, C, etc.)
function detectPitch(buffer, sampleRate) {
    const SIZE = buffer.length;

    // 1. RMS (Volume) check to ignore silence
    let rms = 0;
    for (let i = 0; i < SIZE; i++) {
        rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;  //it returns -1 as frequency as frequency can never be negative, so if there is noise or very low signal, 
    //it will return -1 and since it doesnt exist, it wont be detected in pitch detection.

    // The Full YIN Algorithm Implementation

    const maxOffset = Math.floor(SIZE / 2);
    const yinBuffer = new Float32Array(maxOffset);
    yinBuffer[0] = 1;

    // Step 1: Calculate the Difference Function
    // We compute the difference d[τ] for every offset. 
    // We don't just pick the lowest value right away.
    for (let tau = 1; tau < maxOffset; tau++) {
        let difference = 0;
        for (let i = 0; i < SIZE - tau; i++) {
            const diff = buffer[i] - buffer[i + tau];
            difference += diff * diff;
        }
        yinBuffer[tau] = difference;
    }

    // Step 2: Cumulative Mean Normalized Difference Function (CMNDF)
    // This normalizes the difference curve so that small offsets don't naturally 
    // trend toward 0. It eliminates the "defaults to 2000Hz" bug.
    let runningSum = 0;
    for (let tau = 1; tau < maxOffset; tau++) {
        runningSum += yinBuffer[tau];
        // This divides the current difference by the average of all previous differences
        yinBuffer[tau] = yinBuffer[tau] * tau / runningSum;
    }

    // Step 3: Absolute Thresholding
    // A lower threshold (0.1) forces the algorithm to wait for the deep fundamental valley,
    // ignoring shallow 'harmonic' valleys that cause the algorithm to report one octave too high.
    const THRESHOLD = 0.1;
    let foundTau = -1;

    for (let tau = 2; tau < maxOffset; tau++) {
        if (yinBuffer[tau] < THRESHOLD) {
            // Once below the threshold, find the actual bottom of this specific valley
            while (tau + 1 < maxOffset && yinBuffer[tau + 1] < yinBuffer[tau]) {
                tau++;
            }
            foundTau = tau;
            break; // We found the FIRST fundamental period. Stop searching!
        }
    }

    // 4. Return result
    // If we never found a clear pitch valley below our threshold, this is likely noise
    if (foundTau === -1) {
        return -1;
    }

    // Step 5: Parabolic Interpolation
    // Notes like C#6 have very small periods (e.g. 43.29 samples).
    // Bouncing between integer bounds 43 and 44 causes huge frequency swings.
    // Parabolic Interpolation finds the true "fractional" sub-sample minimum!
    let betterTau = foundTau;
    if (foundTau > 0 && foundTau < maxOffset - 1) {
        const s0 = yinBuffer[foundTau - 1];
        const s1 = yinBuffer[foundTau];
        const s2 = yinBuffer[foundTau + 1];
        
        // Predict the true bottom of the curve using math
        const peakShift = (s0 - s2) / (2 * (s0 - 2 * s1 + s2));
        
        // Prevent wild shifting if the math does something crazy
        if (Math.abs(peakShift) < 1) {
            betterTau = foundTau + peakShift;
        }
    }

    // Convert period (τ) → frequency
    return sampleRate / betterTau;
}
function frequencyToNote(frequency) {
    if (frequency <= 0) return { note: "--", centsString: "", centsInt: 0 };

    const A4 = 440;
    const semitoneOffset = 12 * Math.log2(frequency / A4);
    const noteIndex = Math.round(semitoneOffset);

    // Calculate cents off perfect pitch
    const centsOffset = Math.round((semitoneOffset - noteIndex) * 100);

    const notes = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];

    const normalizedIndex = (noteIndex % 12 + 12) % 12;
    const noteName = notes[normalizedIndex];

    // Calculate Octave
    // A4 is our reference. A4 is noteIndex 0.
    // C4 is noteIndex -9. The octave number changes at C.
    // We shift everything up by 9 semitones so C4 is at 0, 
    // divide by 12, and add 3 (user requested -1 octave offset).
    const octave = 3 + Math.floor((noteIndex + 9) / 12);

    let centsString = "";
    if (centsOffset > 0) {
        centsString = "+" + centsOffset + " cents";
    } else if (centsOffset < 0) {
        centsString = centsOffset + " cents";
    } else {
        centsString = "0 cents";
    }

    return {
        note: noteName + octave,
        centsString: centsString,
        centsInt: centsOffset
    };
}

async function initMic() { //this is async function so it will wait for the user to give permission to access the microphone and if the user gives permission, it will return the stream of audio data.
    document.getElementById("start-btn").style.display = "none";
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); //So what this will do is, it will ask the user for permission to access the microphone and if the user gives permission, it will return the stream of audio data.
    //jnavigator.mediadevices browses API and gives access to camera and microphone
    //stream means actual mediastream which allows continuous flow of data
    const audioContext = new AudioContext();
    //audio context builds an audio processing environment. 
    //internally it has sample rate, audio graph system etc
    const source = audioContext.createMediaStreamSource(stream); //this code will create a source node from the stream of audio data.
    //stream, which is the mic input. And source is an audio node representing mic input
    //we have to do this because webAPI only works with Audio nodes
    const analyser = audioContext.createAnalyser(); //this code will create an analyser node from the source node.
    //so analyzer observes the audio signal and will extract data from it (I think, in time domain and in frequency domain)
    analyser.fftSize = 2048; //this code will set the size of the analyser node.
    //fftSize is the number of samples the analyser will take from the audio signal.
    //it is a power of 2, and the higher it is, the more accurate the frequency data will be.
    analyser.minDecibels = -100; //this code will set the minimum decibels of the analyser node.
    //this is the minimum decibels of the audio signal.
    analyser.maxDecibels = 0; //this code will set the maximum decibels of the analyser node.
    //this is the maximum decibels of the audio signal.
    analyser.smoothingTimeConstant = 0.8; //this code will set the smoothing time constant of the analyser node.
    //this is the smoothing time constant of the audio signal.
    source.connect(analyser); //this code will connect the source node to the analyser node.
    //connect(A to B) means output of A goes into input of B 
    //so here output of source goes into input of analyser
    const dataArray = new Float32Array(analyser.fftSize);
    //float32array is an array of 32 bit (4 bytes). 
    //audio waveform values range from -1 to +1, so it stores the array 
    //analyser.fftsize means 2048 samples per frame 

    let smoothedFrequency = 0;

    function loop() {
        //this loop is important as audio signal is continuous, 
        //and whatever we do is we take snapshots of it at regular intervals
        //and process them. 
        analyser.getFloatTimeDomainData(dataArray); // fills array with waveform
        //this takes the current audio signals and writes into DATAARRAY
        //so dataarray has the waveform samples
        
        const rawFrequency = detectPitch(dataArray, audioContext.sampleRate);
        
        if (rawFrequency !== -1) {
            // Smooth natural fluctuations 
            if (smoothedFrequency === 0 || Math.abs(rawFrequency - smoothedFrequency) > 0.05 * smoothedFrequency) {
                // If it's a completely new note (frequency jump > 5%), snap to it instantly
                smoothedFrequency = rawFrequency;
            } else {
                // If it's a sustained note, blend it (80% old, 20% new) to stabilize the text
                smoothedFrequency = 0.8 * smoothedFrequency + 0.2 * rawFrequency;
            }

            const result = frequencyToNote(smoothedFrequency);
            
            document.getElementById("note-display").innerText = result.note;
            document.getElementById("freq-display").innerText = smoothedFrequency.toFixed(2) + " Hz";

            if (Math.abs(result.centsInt) <= 5) {
                document.getElementById("cent-display").innerText = "In Tune (" + result.centsString + ")";
                document.getElementById("tuning-ring").classList.add("in-tune");
            } else {
                document.getElementById("cent-display").innerText = result.centsString;
                document.getElementById("tuning-ring").classList.remove("in-tune");
            }
        } else {
            smoothedFrequency = 0; // reset smoothing if silence so the next note snaps instantly
            // The UI is deliberately NOT reset here so the last note remains visible
        }
        //detect pitch will find repeating patterns nad return the frequency in hertz
        //and we also know frequency = sampleRate/period

        // [CHANGED] Removed redundant 'const note = frequencyToNote(frequency);'

        //frequency to note will convert the frequency to the nearest note
        //like for A note it is 440hz,  for C note it is 261.6hz 
        //for this we use the formula n = 12 × log2(f / 440)
        //what this formula does is f is the detected frequency, and n is the 
        //number of semitones away from A4( which is our reference)

        //const chord = noteToChord(note);
        //note to chord will convert the note to the nearest chord

        // [CHANGED] Removed redundant 'console.log(frequency, note);' so it doesn't continuously print -1 and null

        requestAnimationFrame(loop); //used to continuously process audio
        // [CHANGED] Removed 'console.log("loop running");' which was spamming the console endlessly
    }

    loop();


}
// for my reference
//we are NOT using fft, we are using autocorrelation (YIN)
//analyzernode already has fft built in but it only runs when we request the frequency data
//currently we are only operating in time domain, so it doesnt require fft.
//we are using this logic: we sampled it at (lets say 44100hz). So if signal is repeating at 100 samples,
//then its frequency is 44100/100 = 441 hz (ie, A4 note)
//here is a basic flowchart we used.
//Mic -> sampled it -> got discrete samples -> Found period (using YIN) -> found frequency ->applied the formula -> note
//YIN is an improved autocorrelation algorithm which avoids false peaks and octave errors (which occurs in normal autocorrelation)
//What normal autocorrelation does is say we have a signals x[n], we compare it to its shifted version using x[n+tou]
//using R(τ) = Σ x[n] * x[n + τ]
//BUT IN YIN, we calculate the DIFFERENCE between the signal and its shifted version.
//using d(τ) = Σ (x[n] - x[n+τ])²
//then we take the square root of it to get the absolute difference.
//then we further normalize it and find its first minimum
//so basically it gives us more accurate pitch detection 


