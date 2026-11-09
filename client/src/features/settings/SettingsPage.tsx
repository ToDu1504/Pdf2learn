import { errorMessage } from "../../api/client";
import { useSettings, useUpdateSettings } from "../../api/queries";
import { Page } from "../../components/Layout";
import { Button, Skeleton } from "../../components/ui";
import { toast } from "../../stores/toast";
import { applyTheme } from "../../hooks/useTheme";
import type { Settings } from "../../types";
import { Monitor, Moon, Sun } from "lucide-react";

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

      </div>
    </Page>
  );
}
