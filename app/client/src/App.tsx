import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/Layout";
import { Spinner, ConfirmDialog, Toaster } from "./components/ui";
import { LoginPage, RegisterPage, RequireAuth } from "./features/auth/AuthPages";
import { Landing } from "./pages/Landing";
import { Dashboard } from "./pages/Dashboard";

const DocumentPage = lazy(() => import("./pages/DocumentPage").then((m) => ({ default: m.DocumentPage })));
const QuizPlayPage = lazy(() => import("./features/quiz/QuizPlayPage").then((m) => ({ default: m.QuizPlayPage })));
const QuizResultPage = lazy(() => import("./features/quiz/QuizResultPage").then((m) => ({ default: m.QuizResultPage })));
const FlashcardsPage = lazy(() => import("./features/flashcards/FlashcardsPage").then((m) => ({ default: m.FlashcardsPage })));
const StatsPage = lazy(() => import("./features/stats/StatsPage").then((m) => ({ default: m.StatsPage })));
const TutorPage = lazy(() => import("./features/tutor/TutorPage").then((m) => ({ default: m.TutorPage })));
const SettingsPage = lazy(() => import("./features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => count < 2 && (err as { response?: { status: number } }).response?.status !== 404,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<div className="grid h-screen place-items-center"><Spinner /></div>}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="documents/:id" element={<DocumentPage />} />
            <Route path="documents/:id/tutor" element={<TutorPage />} />
            <Route path="quiz/:id" element={<QuizPlayPage />} />
            <Route path="quiz/:id/result" element={<QuizResultPage />} />
            <Route path="flashcards" element={<FlashcardsPage />} />
            <Route path="stats" element={<StatsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster />
      <ConfirmDialog />
    </QueryClientProvider>
  );
}
