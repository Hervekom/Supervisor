export type DegreeType =
  | 'bachelor'
  | 'master_academic'
  | 'master_professional'
  | 'master_equivalent'
  | 'doctorate_academic'
  | 'doctorate_professional';

export type Citation = { source_id: string; page?: number; section?: string; quote: string };

export type Rule = {
  id: string;
  key: string;
  category: string;
  applies_to: DegreeType[];
  value: unknown;
  unit?: string;
  enforcement: 'automatic' | 'assisted' | 'manual';
  severity: 'blocking' | 'major' | 'minor' | 'info';
  status: 'confirmed' | 'needs_confirmation';
  note?: string;
  source: Citation;
};

export type Conflict = {
  id: string;
  key: string;
  topic: string;
  applies_to?: DegreeType[];
  options: { value: unknown; source: Citation }[];
  provisional_option?: number;
  provisional_reason?: string;
  status: 'open' | 'resolved';
  resolution?: string;
};

export type Stage = {
  id: string;
  order: number;
  name: string;
  requires: string[];
  deadline?: string;
  documents?: string[];
  source: Citation;
};

export type Profile = {
  schema_version: string;
  profile_id: string;
  profile_version: string;
  status: 'extracted' | 'student_confirmed' | 'institution_verified';
  institution: { name: string; local_name?: string; country: string; institution_code?: string; languages: string[] };
  scope: { degree_types: DegreeType[]; audience: string; disciplines?: string[]; not_covered: string[] };
  sources: { id: string; title: string; kind: string; language: string; year?: number; file: string; note?: string }[];
  rules: Rule[];
  conflicts: Conflict[];
  workflow: Stage[];
  ai_policy: {
    status: 'not_found' | 'partial' | 'confirmed';
    generative_ai_allowed: boolean | null;
    disclosure_required: boolean | null;
    ai_content_limit_percent: number | null;
    checked_sources: string[];
    note?: string;
  };
};

export const DEGREE_LABELS: Record<DegreeType, string> = {
  bachelor: "Bachelor's thesis",
  master_academic: "Academic master's",
  master_professional: "Professional master's",
  master_equivalent: "Master's (equivalent qualification)",
  doctorate_academic: 'Academic doctorate',
  doctorate_professional: 'Professional doctorate',
};
