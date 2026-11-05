import { stepState, STEPS, type PathState, type StructureId } from './path';

export type IngredientStatus = 'missing' | 'started' | 'ready' | 'set_aside';
export type Ingredient = { label: string; step: string };
/** `share` is the usual part of the main text, in percent. Zero means it is not counted in the main text. */
export type Part = { id: string; title: string; share: [number, number]; ingredients: Ingredient[] };
export type Structure = { id: StructureId; name: string; bestFor: string; parts: Part[] };

const i = (label: string, step: string): Ingredient => ({ label, step });

const FRONT: Part[] = [
  { id: 'abstract', title: 'Abstract', share: [0, 0], ingredients: [i('Your main claims', 'revise')] },
];
const INTRO: Part = {
  id: 'introduction', title: 'Introduction', share: [8, 16],
  ingredients: [i('Your title and research question', 'title'), i('Your narrowed topic', 'topic'), i('Your objectives and plan', 'proposal')],
};
const REVIEW: Part = {
  id: 'literature', title: 'Literature review', share: [20, 35],
  ingredients: [i('Your themes and the gap', 'literature')],
};
const BACK: Part[] = [
  { id: 'references', title: 'References', share: [0, 0], ingredients: [i('Your verified sources', 'references')] },
];

export const STRUCTURES: Structure[] = [
  {
    id: 'classic', name: 'Classic thesis', bestFor: 'One main piece of research. Most theses use this.',
    parts: [
      ...FRONT, INTRO, REVIEW,
      { id: 'methodology', title: 'Methodology', share: [13, 23], ingredients: [i('Your method', 'method'), i('Your link from questions to evidence', 'alignment'), i('Your data and settings', 'experiments')] },
      { id: 'results', title: 'Results', share: [14, 30], ingredients: [i('Your collected results', 'research'), i('Your results sheet', 'evidence')] },
      { id: 'discussion', title: 'Discussion', share: [10, 18], ingredients: [i('Your results sheet', 'evidence'), i('Your chapter outline', 'outline')] },
      { id: 'conclusion', title: 'Conclusion', share: [8, 15], ingredients: [i('Your research question', 'title'), i('Your main claims', 'revise')] },
      ...BACK,
    ],
  },
  {
    id: 'studies', name: 'Thesis by studies', bestFor: 'Two studies or papers joined by one idea.',
    parts: [
      ...FRONT, INTRO, REVIEW,
      { id: 'study1', title: 'Study 1', share: [20, 30], ingredients: [i('Your method', 'method'), i('Your results sheet', 'evidence'), i('Your paper', 'paper')] },
      { id: 'study2', title: 'Study 2', share: [20, 30], ingredients: [i('Your method', 'method'), i('Your results sheet', 'evidence')] },
      { id: 'conclusion', title: 'Conclusion', share: [8, 15], ingredients: [i('Your research question', 'title'), i('Your main claims', 'revise')] },
      ...BACK,
    ],
  },
  {
    id: 'system', name: 'System thesis', bestFor: 'A project that designs and builds a working system.',
    parts: [
      ...FRONT, INTRO,
      { id: 'background', title: 'Background and related work', share: [10, 20], ingredients: [i('Your themes and the gap', 'literature')] },
      { id: 'requirements', title: 'Requirements', share: [5, 12], ingredients: [i('Your objectives and plan', 'proposal')] },
      { id: 'architecture', title: 'Architecture and design', share: [10, 18], ingredients: [i('Your method', 'method')] },
      { id: 'implementation', title: 'Implementation', share: [10, 18], ingredients: [i('Your data and settings', 'experiments')] },
      { id: 'evaluation', title: 'Evaluation', share: [10, 20], ingredients: [i('Your link from questions to evidence', 'alignment'), i('Your results sheet', 'evidence')] },
      { id: 'discussion', title: 'Discussion', share: [8, 12], ingredients: [i('Your chapter outline', 'outline')] },
      { id: 'conclusion', title: 'Conclusion', share: [5, 12], ingredients: [i('Your research question', 'title'), i('Your main claims', 'revise')] },
      ...BACK,
    ],
  },
];

export const structureOf = (p: PathState) => STRUCTURES.find((s) => s.id === p.structure) ?? STRUCTURES[0];

export function ingredientStatus(p: PathState, stepId: string): IngredientStatus {
  const s = stepState(p, stepId);
  if (s.status === 'done') return 'ready';
  if (s.work.trim() || s.checks.length) return 'started';
  return s.status === 'skipped' ? 'set_aside' : 'missing';
}

export const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export type PartView = Part & { words: number; target: [number, number] | null; state: 'empty' | 'writing' | 'target_met' };

export function partViews(p: PathState, minWords: number): PartView[] {
  return structureOf(p).parts.map((part) => {
    const words = wordCount(p.parts?.[part.id] ?? '');
    const target = part.share[1] ? ([part.share[0], part.share[1]].map((x) => Math.round((minWords * x) / 100 / 100) * 100) as [number, number]) : null;
    return { ...part, words, target, state: !words ? 'empty' : target && words >= target[0] ? 'target_met' : 'writing' };
  });
}

/** Parts of the document that a step feeds. */
export const partsOfStep = (p: PathState, stepId: string) => structureOf(p).parts.filter((x) => x.ingredients.some((g) => g.step === stepId));

export const stepTitle = (id: string) => STEPS.find((s) => s.id === id)?.title ?? id;

export const REQUIRED_EXTRAS = ['Cover', 'Originality statement and authorization', 'Table of contents', 'Lists of figures, tables and symbols', 'Research outputs', 'Acknowledgements'];
