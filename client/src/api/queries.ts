import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "./client";
import type {
  ChapterDetail,
  DocumentDetail,
  DocumentItem,
  Flashcard,
  QuizAttempt,
  QuizResult,
  Settings,
  TutorMessage,
  TutorSession,
} from "../types";

const get = async <T,>(url: string) => (await http.get<T>(url)).data;

export const useDocuments = () =>
  useQuery({
    queryKey: ["documents"],
    queryFn: () => get<DocumentItem[]>("/documents"),
    // Có tài liệu đang xử lý thì tự làm mới danh sách.
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === "queued" || d.status === "processing") ? 4000 : false),
  });

export const useDocument = (id: number) =>
  useQuery({ queryKey: ["document", id], queryFn: () => get<DocumentDetail>(`/documents/${id}`), enabled: !!id });

export const useChapter = (id: number | null) =>
  useQuery({
    queryKey: ["chapter", id],
    queryFn: () => get<ChapterDetail>(`/chapters/${id}`),
    enabled: !!id,
    // Chương đang được AI tóm tắt (theo yêu cầu): hỏi lại mỗi 3 giây tới khi xong.
    refetchInterval: (q) => (q.state.data && !q.state.data.summary && q.state.data.analyzing ? 3000 : false),
  });

export const useOverview = () =>
  useQuery({
    queryKey: ["stats", "overview"],
    queryFn: () => get<{ documents: number; attempts: number; dueCards: number; avgScore: number | null }>("/stats/overview"),
  });

export const useQuizHistory = (documentId?: number) =>
  useQuery({
    queryKey: ["quiz-history", documentId ?? "all"],
    queryFn: () => get<QuizAttempt[]>(`/quizzes/history${documentId ? `?documentId=${documentId}` : ""}`),
  });

export const useQuizResult = (id: number) =>
  useQuery({ queryKey: ["quiz-result", id], queryFn: () => get<QuizResult>(`/quizzes/${id}`) });

export const useDueCards = (documentId?: number) =>
  useQuery({
    queryKey: ["flashcards", "due", documentId ?? "all"],
    queryFn: () => get<Flashcard[]>(`/flashcards/due?limit=100${documentId ? `&documentId=${documentId}` : ""}`),
  });

export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => get<Settings>("/users/me/settings"), staleTime: 60_000 });

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Settings>) => (await http.patch<Settings>("/users/me/settings", patch)).data,
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export const useTutorSessions = (documentId: number) =>
  useQuery({ queryKey: ["tutor-sessions", documentId], queryFn: () => get<TutorSession[]>(`/tutor/sessions?documentId=${documentId}`) });

export const useTutorSession = (id: number | null) =>
  useQuery({
    queryKey: ["tutor-session", id],
    queryFn: () => get<TutorSession & { messages: TutorMessage[] }>(`/tutor/sessions/${id}`),
    enabled: !!id,
  });
