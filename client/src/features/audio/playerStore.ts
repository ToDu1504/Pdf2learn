import { create } from "zustand";
import { http } from "../../api/client";
import type { AudioSegment } from "../../types";

type Source = { kind: "chapter"; chapterId: number } | { kind: "text" } | { kind: "tutor" } | { kind: "handsfree" };

type PlayerState = {
  segments: AudioSegment[];
  index: number;
  playing: boolean;
  buffering: boolean;
  rate: number;
  title: string;
  source: Source | null;
  load(segments: AudioSegment[], opts: { title: string; source: Source; startIndex?: number; autoplay?: boolean }): void;
  /** Nối thêm câu (gia sư tự đọc khi đang stream). */
  append(segments: AudioSegment[]): void;
  play(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  prev(): void;
  seek(index: number): void;
  setRate(rate: number): void;
  stop(): void;
};

/** Một HTMLAudioElement duy nhất cho cả app: hết câu thì sang câu tiếp. */
const audio = typeof Audio !== "undefined" ? new Audio() : (null as unknown as HTMLAudioElement);
audio.preload = "auto";

/** Resolve khi phát hết danh sách hiện tại (dùng cho chế độ rảnh tay). */
let finishWaiters: (() => void)[] = [];
const notifyFinished = () => {
  const w = finishWaiters;
  finishWaiters = [];
  w.forEach((f) => f());
};

export const usePlayer = create<PlayerState>((set, get) => {
  const startAt = (index: number) => {
    const seg = get().segments[index];
    if (!seg) return;
    set({ index, buffering: true });
    // Server giữ request tới khi câu tạo xong, nên chỉ cần gán src.
    audio.src = seg.audioUrl;
    audio.playbackRate = get().rate;
    audio.play().catch(() => set({ playing: false, buffering: false }));
    set({ playing: true });
    updateMediaSession(get());
  };

  audio.addEventListener("ended", () => {
    const { index, segments } = get();
    if (index + 1 < segments.length) startAt(index + 1);
    else {
      set({ playing: false, buffering: false, index: segments.length });
      notifyFinished();
    }
  });
  audio.addEventListener("playing", () => set({ buffering: false }));
  audio.addEventListener("waiting", () => set({ buffering: true }));
  audio.addEventListener("error", () => {
    // Câu lỗi (TTS tắt giữa chừng...): bỏ qua sang câu sau thay vì kẹt.
    const { index, segments, playing } = get();
    if (!playing) return;
    if (index + 1 < segments.length) startAt(index + 1);
    else {
      set({ playing: false, buffering: false });
      notifyFinished();
    }
  });

  return {
    segments: [],
    index: 0,
    playing: false,
    buffering: false,
    rate: 1,
    title: "",
    source: null,
    load(segments, { title, source, startIndex = 0, autoplay = true }) {
      notifyFinished();
      audio.pause();
      set({ segments, title, source, index: startIndex, playing: false, buffering: false });
      if (autoplay && segments.length) startAt(startIndex);
    },
    append(segments) {
      const s = get();
      const wasFinished = !s.playing && s.index >= s.segments.length;
      set({ segments: [...s.segments, ...segments] });
      if (wasFinished) startAt(s.segments.length);
    },
    play() {
      const { index, segments } = get();
      if (!segments.length) return;
      if (index >= segments.length) return startAt(0);
      if (audio.src && audio.paused && audio.currentTime > 0) {
        void audio.play();
        set({ playing: true });
      } else startAt(index);
    },
    pause() {
      audio.pause();
      set({ playing: false });
    },
    toggle() {
      if (get().playing) get().pause();
      else get().play();
    },
    next() {
      const { index, segments } = get();
      if (index + 1 < segments.length) startAt(index + 1);
    },
    prev() {
      const { index } = get();
      // Đang giữa câu thì đọc lại từ đầu câu; vừa bắt đầu thì lùi 1 câu.
      startAt(audio.currentTime > 2 ? index : Math.max(0, index - 1));
    },
    seek(index) {
      startAt(index);
    },
    setRate(rate) {
      audio.playbackRate = rate; // preservesPitch mặc định bật: giữ cao độ giọng
      set({ rate });
    },
    stop() {
      audio.pause();
      audio.removeAttribute("src");
      notifyFinished();
      set({ segments: [], index: 0, playing: false, buffering: false, source: null, title: "" });
    },
  };
});

/** Phát danh sách câu và chờ tới khi đọc xong (hoặc bị thay/dừng). */
export function playAndWait(segments: AudioSegment[], title: string) {
  return new Promise<void>((resolve) => {
    usePlayer.getState().load(segments, { title, source: { kind: "handsfree" } });
    finishWaiters.push(resolve);
  });
}

export async function fetchSpeech(text: string) {
  return (await http.post<AudioSegment[]>("/tts/speak", { text })).data;
}

export async function speakText(text: string, title = "Đọc nhanh") {
  const segments = await fetchSpeech(text);
  usePlayer.getState().load(segments, { title, source: { kind: "text" } });
}

function updateMediaSession(s: PlayerState) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: s.segments[s.index]?.text.slice(0, 80) ?? s.title, artist: "Pdf2Learn", album: s.title });
}

if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
  const p = () => usePlayer.getState();
  navigator.mediaSession.setActionHandler("play", () => p().play());
  navigator.mediaSession.setActionHandler("pause", () => p().pause());
  navigator.mediaSession.setActionHandler("nexttrack", () => p().next());
  navigator.mediaSession.setActionHandler("previoustrack", () => p().prev());
}
