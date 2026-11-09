export type SrsCard = { ease_factor: number; interval_days: number; repetitions: number };

const DAY = 24 * 60 * 60 * 1000;

/** SM-2. quality 0–5; < 3 nghĩa là quên → học lại từ đầu. */
export function sm2<T extends SrsCard>(card: T, quality: number, now = new Date()) {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let { repetitions, interval_days } = card;
  if (q < 3) {
    repetitions = 0;
    interval_days = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) interval_days = 1;
    else if (repetitions === 2) interval_days = 6;
    else interval_days = Math.round(interval_days * card.ease_factor);
  }
  const ease_factor = Math.max(1.3, card.ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  return { repetitions, interval_days, ease_factor, next_review_at: new Date(now.getTime() + interval_days * DAY) };
}
