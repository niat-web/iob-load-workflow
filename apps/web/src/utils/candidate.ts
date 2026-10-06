import type { CandidateAnalysisStatus, CandidateStatus, Tone } from "../types/api";

export const CANDIDATE_STATUS_OPTIONS: { value: CandidateStatus; label: string }[] = [
  { value: "RECOMMENDED", label: "Recommended" },
  { value: "CONSIDER", label: "Consider" },
  { value: "NOT_RECOMMENDED", label: "Not Recommended" },
];

const STATUS_TONES: Record<CandidateStatus, Tone> = {
  RECOMMENDED: "green",
  CONSIDER: "yellow",
  NOT_RECOMMENDED: "gray",
};

export function candidateStatusLabel(status: CandidateStatus | null): string | null {
  return CANDIDATE_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? null;
}

export function candidateStatusTone(status: CandidateStatus): Tone {
  return STATUS_TONES[status];
}

export function isCandidateStatus(value: string): value is CandidateStatus {
  return CANDIDATE_STATUS_OPTIONS.some((o) => o.value === value);
}

const ANALYSIS_FALLBACK: Record<CandidateAnalysisStatus, string> = {
  COMPLETED: "No reason provided",
  FAILED: "Resume analysis failed",
  NO_RESUME: "No resume uploaded",
  PENDING: "Analysis pending",
};

export function analysisFallback(status: CandidateAnalysisStatus): string {
  return ANALYSIS_FALLBACK[status] ?? "Not available";
}
