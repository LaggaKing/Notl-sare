export interface AudioChain {
  ctx: AudioContext;
  masterInput: GainNode;
  compressor: DynamicsCompressorNode | null;
}

type AudioContextConstructor = new () => AudioContext;

let activeChain: AudioChain | null = null;

function getAudioContextCtor(): AudioContextConstructor | null {
  const globalObj = globalThis as typeof globalThis & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return globalObj.AudioContext ?? globalObj.webkitAudioContext ?? null;
}

function createAudioChain(): AudioChain {
  const Ctor = getAudioContextCtor();
  if (!Ctor) {
    throw new Error('Web Audio API (AudioContext) is not supported in this environment.');
  }

  const ctx = new Ctor();
  const masterInput = ctx.createGain();
  masterInput.gain.setValueAtTime(0.9, ctx.currentTime);

  let compressor: DynamicsCompressorNode | null = null;
  if (typeof ctx.createDynamicsCompressor === 'function') {
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, ctx.currentTime);
    compressor.knee.setValueAtTime(12, ctx.currentTime);
    compressor.ratio.setValueAtTime(8, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.15, ctx.currentTime);

    masterInput.connect(compressor);
    compressor.connect(ctx.destination);
  } else {
    masterInput.connect(ctx.destination);
  }

  return { ctx, masterInput, compressor };
}

/**
 * Returns the lazily created singleton AudioContext + master limiter chain,
 * creating it synchronously if supported by the environment.
 */
export function getAudioChain(): AudioChain | null {
  if (activeChain && activeChain.ctx.state !== 'closed') {
    return activeChain;
  }

  if (!getAudioContextCtor()) {
    return null;
  }

  activeChain = createAudioChain();
  return activeChain;
}

/**
 * Returns the existing AudioContext without forcing creation.
 */
export function getExistingAudioContext(): AudioContext | null {
  if (activeChain && activeChain.ctx.state !== 'closed') {
    return activeChain.ctx;
  }
  return null;
}

/**
 * Ensures the singleton AudioContext exists and resumes it safely on user gesture.
 */
export async function ensureAudioContext(): Promise<AudioContext> {
  if (!activeChain || activeChain.ctx.state === 'closed') {
    activeChain = createAudioChain();
  }

  const { ctx } = activeChain;
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  return ctx;
}

/**
 * Returns the master GainNode feeding the compressor/limiter.
 * Throws if Web Audio API is unavailable.
 */
export function getMasterInputNode(): GainNode {
  const chain = getAudioChain();
  if (!chain) {
    throw new Error('Web Audio API (AudioContext) is not supported in this environment.');
  }
  return chain.masterInput;
}

/**
 * Closes and clears the singleton AudioContext (useful for cleanup or tests).
 */
export async function closeAudioContext(): Promise<void> {
  if (!activeChain) {
    return;
  }

  const chainToClose = activeChain;
  activeChain = null;

  try {
    chainToClose.masterInput.disconnect();
    chainToClose.compressor?.disconnect();
  } catch {
    // Ignore disconnect errors if nodes are already detached.
  }

  if (chainToClose.ctx.state !== 'closed') {
    await chainToClose.ctx.close();
  }
}
