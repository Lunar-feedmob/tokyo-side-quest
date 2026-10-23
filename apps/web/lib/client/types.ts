// Shapes returned by /api/v1 (kept loose on purpose: the server is authoritative).

export interface PlaceSummary {
  id: string;
  slug: string;
  nameZh: string;
  nameJa: string;
  nameEn: string | null;
  latitude: number;
  longitude: number;
  status: "published" | "temporarily_closed";
  radiusMeters: number;
  photoEnabled: boolean;
  tags: string[];
  stayMinutes: number | null;
  neighborhoodSlug: string;
  distanceMeters?: number;
  distanceType?: "straight_line";
  explored?: boolean;
}

export interface Neighborhood {
  id: string;
  slug: string;
  nameZh: string;
  nameJa: string;
  nameEn: string | null;
  summary: string;
  latitude: number;
  longitude: number;
}

export interface SourceRef {
  label: string;
  url: string;
  accessedOn: string;
  note?: string;
}

export interface PlaceDetail extends PlaceSummary {
  versionId: string | null;
  version: number | null;
  referenceVersion: string | null;
  publishedAt: string | null;
  content: {
    intro: string;
    cultureNote: string;
    cultureSources: SourceRef[];
    shootingTips: string;
    distinctiveFeatures: string[];
    confusablePlaces: string[];
    unsuitableAngles: string[];
    restrictions: { text: string; source?: SourceRef }[] | null;
    coordinateSource: SourceRef;
    verificationLevel: "desk" | "field";
  } | null;
  references: { id: string; viewNote: string; author: string; license: string; sourceUrl: string; imageUrl: string }[];
  referenceCount: number;
  methods: { location: boolean; photo: boolean };
}

export interface AttemptView {
  attemptId: string;
  mode: "live" | "demo";
  processingStatus: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  stageLabel: string;
  place: { id: string; slug: string; nameZh: string; nameJa: string };
  photo: { assetId: string; previewUrl: string | null; sampleLabel: string | null };
  quest: { runId: string; stepId: string } | null;
  verification: {
    status: "pending" | "matched" | "uncertain" | "mismatched" | "error";
    source: string | null;
    message: string | null;
    reasonCode: string | null;
    evidence: { feature: string; relation: "supports" | "contradicts" | "not_visible"; observation: string }[];
    reshootSuggestion: string | null;
  };
  checkin: { id: string; method: "photo"; arrivalVerified: boolean; label: string } | null;
  rating: {
    status: "not_requested" | "pending" | "completed" | "unscorable" | "error";
    dimensions: { composition: number; lighting: number; clarity: number; expression: number } | null;
    total: number | null;
    grade: string | null;
    gradeMeaning: string | null;
    strength: string | null;
    improvement: string | null;
    rubricVersion: string | null;
    unscorableReason: string | null;
  };
  error: { code: string; stage: string | null; retryable: boolean } | null;
  review: { status: string; reason: string | null } | null;
  canRetry: "verify" | "rate" | null;
  canRequestReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuestRunView {
  runId: string;
  mode: "live" | "demo";
  status: "active" | "ended_partial" | "completed";
  startedAt: string;
  completedAt: string | null;
  quest: { id: string; slug: string; title: string; intro: string; fictionNote: string; version: number; ending: string | null };
  currentStepId: string | null;
  steps: {
    id: string;
    position: number;
    required: boolean;
    title: string;
    proofPolicy: "location" | "photo" | "either";
    place: { id: string; slug: string; nameZh: string; nameJa: string; available: boolean; photoEnabled: boolean };
    status: "completed" | "current" | "locked";
    story: string | null;
    objective: string | null;
    clue: string | null;
    observationQuestion: string | null;
    completionText: string | null;
    completedAt: string | null;
    proofLabel: string | null;
  }[];
}

export interface CheckinEffects {
  stampsAwarded: string[];
  questStepCompleted: boolean;
  questCompleted: boolean;
  questNote: string | null;
}
