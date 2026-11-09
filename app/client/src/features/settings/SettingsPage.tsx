import { errorMessage } from "../../api/client";
import { useSettings, useUpdateSettings } from "../../api/queries";
import { Page } from "../../components/Layout";
import { Button, Skeleton } from "../../components/ui";
import { toast } from "../../stores/toast";
import { applyTheme } from "../../hooks/useTheme";
import type { Settings } from "../../types";
import { Monitor, Moon, Sun } from "lucide-react";
import { ApiKeyForm, DataDirControl } from "../onboarding/Welcome";
import { TranslatorSection } from "./TranslatorSection";

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 size-4 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-slate-500">{hint}</span>
      </span>
    </label>
  );
}

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
  const save = (patch: Partial<Settings>) =>
    update.mutate(patch, {
      onSuccess: () => toast.success("Đã lưu cài đặt"),
      onError: (e) => toast.error(errorMessage(e)),
    });

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

        <Section title="AI (Gemini)" desc="Key được kiểm tra với Google rồi lưu dạng mã hóa trên máy này">
          <ApiKeyForm onSaved={() => toast.success("Đã lưu cấu hình AI")} />
        </Section>

        <Section title="Dữ liệu" desc="Nơi lưu cơ sở dữ liệu, PDF và bản dịch">
          <DataDirControl />
        </Section>

        <Section title="Gói dịch" desc="Dịch PDF sang tiếng Việt giữ nguyên bố cục">
          <TranslatorSection />
        </Section>

        <Section title="Chuẩn bị trước" desc="Làm sẵn ở nền để mở bài nào cũng có ngay, không phải chờ">
          <div className="space-y-4">
            <Toggle
              checked={s.auto_prepare}
              onChange={(v) => save({ auto_prepare: v })}
              label="Tự soạn trước toàn bộ bài giảng"
              hint="Soạn lần lượt theo lộ trình. Luôn chừa lại lượt Gemini cho bài bạn đang mở; hết lượt thì tự làm tiếp khi hạn mức ngày được làm mới."
            />
            <Toggle
              checked={s.auto_translate}
              onChange={(v) => save({ auto_translate: v })}
              label="Tự dịch trước toàn bộ PDF"
              hint="Dịch bằng Google Dịch trên trình duyệt, không tốn lượt AI. Nếu Google đòi xác minh, cửa sổ Chrome sẽ bật lên để bạn giải CAPTCHA."
            />
          </div>
        </Section>
      </div>
    </Page>
  );
}
