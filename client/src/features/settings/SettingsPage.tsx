import { useState } from "react";
import { errorMessage, http } from "../../api/client";
import { useSettings, useTtsStatus, useUpdateSettings, useVoices } from "../../api/queries";
import { Page } from "../../components/Layout";
import { Button, cn, Skeleton } from "../../components/ui";
import { toast } from "../../stores/toast";
import { applyTheme } from "../../hooks/useTheme";
import type { AudioSegment, Settings } from "../../types";
import { usePlayer } from "../audio/playerStore";
import { RATES } from "../audio/MiniPlayer";
import { TtsOfflineHint } from "../audio/SpeakButton";
import { Monitor, Moon, Play, Sun } from "lucide-react";

const SAMPLE = "Xin chào, mình là giọng đọc của Pdf2Learn. Chúc bạn ôn tập thật hiệu quả!";

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="card grid gap-4 p-5 md:grid-cols-[220px_1fr]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {desc && <p className="text-sm text-slate-500">{desc}</p>}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const { data: s, isLoading } = useSettings();
  const update = useUpdateSettings();
  const tts = useTtsStatus();
  const voices = useVoices(!!tts.data?.online);
  const [preview, setPreview] = useState<string | null>(null);

  const save = (patch: Partial<Settings>) =>
    update.mutate(patch, {
      onSuccess: () => toast.success("Đã lưu cài đặt"),
      onError: (e) => toast.error(errorMessage(e)),
    });

  const listen = async (voice: string) => {
    setPreview(voice);
    try {
      const segments = (await http.post<AudioSegment[]>("/tts/speak", { text: SAMPLE, voice })).data;
      usePlayer.getState().load(segments, { title: `Nghe thử: ${voice}`, source: { kind: "text" } });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPreview(null);
    }
  };

  if (isLoading || !s) return <Page title="Cài đặt"><Skeleton className="h-96" /></Page>;

  return (
    <Page title="Cài đặt">
      <div className="space-y-4">
        <Section title="Giao diện" desc="Sáng, tối hoặc theo hệ điều hành">
          <div className="flex gap-2">
            {(["light", "dark", "system"] as const).map((t) => (
              <Button
                key={t}
                variant={s.theme === t ? "primary" : "secondary"}
                onClick={() => {
                  applyTheme(t);
                  save({ theme: t });
                }}
              >
                {t === "light" ? <><Sun /> Sáng</> : t === "dark" ? <><Moon /> Tối</> : <><Monitor /> Hệ thống</>}
              </Button>
            ))}
          </div>
        </Section>

        <Section title="Giọng đọc" desc="Chạy ngay trên máy bạn. Giọng Bắc / Trung / Nam.">
          {!tts.data?.online ? (
            <TtsOfflineHint />
          ) : voices.isLoading ? (
            <Skeleton className="h-32" />
          ) : voices.error ? (
            <p className="text-sm text-rose-600">Không lấy được danh sách giọng: {errorMessage(voices.error)}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {voices.data?.map((v) => (
                <div
                  key={v.id}
                  className={cn("flex items-center justify-between rounded-xl border px-3 py-2", s.tts_voice === v.id ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-slate-200 dark:border-slate-700")}
                >
                  <button className="flex-1 text-left text-sm font-medium" onClick={() => save({ tts_voice: v.id })}>
                    {s.tts_voice === v.id && "✓ "}
                    {v.name}
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => listen(v.id)} loading={preview === v.id}>
                    <Play fill="currentColor" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Tốc độ đọc" desc="Đổi tốc độ không cần tạo lại audio">
          <div className="flex flex-wrap gap-2">
            {RATES.map((r) => (
              <Button
                key={r}
                size="sm"
                variant={s.tts_rate === r ? "primary" : "secondary"}
                onClick={() => {
                  usePlayer.getState().setRate(r);
                  save({ tts_rate: r });
                }}
              >
                {r}x
              </Button>
            ))}
          </div>
        </Section>

        <Section title="Gia sư AI" desc="Đọc to câu trả lời ngay khi gia sư đang trả lời">
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox" className="size-5" checked={s.auto_read_tutor} onChange={(e) => save({ auto_read_tutor: e.target.checked })} />
            <span className="text-sm">Tự đọc câu trả lời của gia sư</span>
          </label>
        </Section>
      </div>
    </Page>
  );
}
