import { Link } from "react-router-dom";
import { ChevronRight, FileText, Headphones, Layers, ListChecks, Map, MessageCircle } from "lucide-react";
import { APP_NAME, Logo } from "../components/Layout";
import { PdfToRoadmap } from "../features/landing/PdfToRoadmap";
import { useAuth } from "../stores/auth";

const FEATURES = [
  { icon: Map, title: "Lộ trình tự động", text: "Mỗi giáo trình thành các chặng và bài học ngắn, có thứ tự và thời gian học." },
  { icon: FileText, title: "Bài giảng dễ hiểu", text: "Giải thích bằng tiếng Việt, có ví dụ, dẫn về đúng trang trong sách gốc." },
  { icon: ListChecks, title: "Kiểm tra sau mỗi bài", text: "Đạt 70% là hoàn thành. Phân tích chủ đề bạn hay sai." },
  { icon: Layers, title: "Flashcard ngắt quãng", text: "Ôn lại đúng lúc sắp quên. Xuất được sang Anki." },
  { icon: MessageCircle, title: "Gia sư AI", text: "Hỏi bất cứ điều gì về giáo trình, có trích dẫn trang." },
  { icon: Headphones, title: "Nghe bài giảng", text: "Giọng đọc tiếng Việt chạy ngay trên máy của bạn." },
];

export function Landing() {
  const token = useAuth((s) => s.token);
  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-white/75 backdrop-blur-xl dark:border-white/10 dark:bg-black/70">
        <div className="mx-auto flex h-13 max-w-5xl items-center justify-between px-5">
          <Logo to="/" />
          <div className="flex items-center gap-5 text-[14px]">
            {!token && (
              <>
                <Link to="/login" className="text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                  Đăng nhập
                </Link>
                <Link to="/register" className="rounded-full bg-brand-600 px-3.5 py-1.5 font-medium text-white hover:bg-brand-700">
                  Dùng thử
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-5 pt-20 pb-16 text-center sm:pt-28">
        <h1 className="text-[44px] leading-[1.05] font-semibold tracking-tight sm:text-[72px]">
          Học giáo trình.
          <br />
          <span className="text-slate-400">Theo lộ trình.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-[19px] leading-relaxed text-slate-600 sm:text-[21px] dark:text-slate-400">
          Thêm một file PDF. {APP_NAME} chia nó thành các bài học ngắn, giảng giải từng bài và kiểm tra bạn sau mỗi bước.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[17px]">
          <Link to={token ? "/app" : "/register"} className="rounded-full bg-brand-600 px-6 py-3 font-medium text-white hover:bg-brand-700">
            {token ? "Tiếp tục học" : "Bắt đầu miễn phí"}
          </Link>
          {!token && (
            <Link to="/login" className="flex items-center text-brand-600 hover:text-brand-700">
              Tôi đã có tài khoản <ChevronRight className="size-4" />
            </Link>
          )}
        </div>
        <div className="mt-16 sm:mt-20">
          <PdfToRoadmap />
        </div>
      </section>

      <section className="border-t border-black/[0.06] bg-slate-50 py-20 dark:border-white/10 dark:bg-slate-950">
        <div className="mx-auto max-w-5xl px-5">
          <h2 className="mb-12 text-center text-[32px] font-semibold tracking-tight sm:text-[40px]">Mọi thứ để học xong một cuốn sách.</h2>
          <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title}>
                <Icon className="mb-4 size-7 text-brand-600" strokeWidth={1.5} />
                <h3 className="text-[19px] font-semibold">{title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="py-10 text-center text-[12px] text-slate-400">{APP_NAME}</footer>
    </div>
  );
}
