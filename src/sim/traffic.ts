import type { Localized, TrafficShape } from './types';

/** Multiplier applied to the offered load at simulated time t (ms). */
export function trafficFactor(shape: TrafficShape, t: number): number {
  switch (shape) {
    case 'steady':
      return 1;
    case 'wave':
      return 1 + 0.5 * Math.sin((2 * Math.PI * t) / 60000);
    case 'spike': {
      // Three times the load for 5 s, every 40 s, the first one 15 s in.
      if (t < 15000) return 1;
      return (t - 15000) % 40000 < 5000 ? 3 : 1;
    }
    case 'ramp':
      return Math.min(1, t / 60000);
    case 'burst':
      // 2 s at 2.5x then 4 s at 0.25x: the same average, delivered in clumps.
      return t % 6000 < 2000 ? 2.5 : 0.25;
  }
}

export const TRAFFIC_SHAPES: TrafficShape[] = ['steady', 'wave', 'spike', 'ramp', 'burst'];

export const TRAFFIC_INFO: Record<TrafficShape, { name: Localized; blurb: Localized }> = {
  steady: {
    name: { en: 'Steady', es: 'Constante' },
    blurb: { en: 'Random arrivals at a constant average rate.', es: 'Llegadas aleatorias a un ritmo medio constante.' },
  },
  wave: {
    name: { en: 'Wave', es: 'Onda' },
    blurb: { en: '±50% around the load, one cycle a minute, like a day in fast forward.', es: '±50% alrededor de la carga, un ciclo por minuto, como un día acelerado.' },
  },
  spike: {
    name: { en: 'Spike', es: 'Pico' },
    blurb: { en: 'Triple the load for 5 s every 40 s. Does it recover afterwards?', es: 'El triple de carga 5 s cada 40 s. ¿Se recupera después?' },
  },
  ramp: {
    name: { en: 'Ramp', es: 'Rampa' },
    blurb: { en: 'Climbs from zero to the load over a minute, then holds.', es: 'Sube de cero a la carga en un minuto y se mantiene.' },
  },
  burst: {
    name: { en: 'Bursty', es: 'Ráfagas' },
    blurb: { en: 'Same average, delivered in clumps: 2 s heavy, 4 s light.', es: 'Mismo promedio, en ráfagas: 2 s fuertes, 4 s suaves.' },
  },
};
