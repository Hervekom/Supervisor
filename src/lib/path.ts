import type { DegreeType, Profile, Rule, Stage } from './types';

export type Step = {
  id: string;
  phase: string;
  title: string;
  goal: string;
  actions: string[];
  checks: string[];
  workLabel: string;
  coachFocus: string;
  optional?: boolean;
  tool?: { href: string; label: string };
  workflowIds?: string[];
  ruleKeys?: string[];
};

export const STEPS: Step[] = [
  {
    id: 'topic', phase: 'Find your question', title: 'Choose a topic you can finish',
    goal: 'Leave this step with one narrow research question that you can answer in the time you have.',
    actions: ['List three topics you care about.', 'For each one, note the data, tools and time it would need.', 'Talk to your supervisor, then write one research question.'],
    checks: ['My question fits in one sentence', 'I know where the data or evidence will come from', 'My supervisor has seen this question'],
    workLabel: 'Your research question and why it matters',
    coachFocus: 'scope, feasibility in the available time, clarity of the question',
  },
  {
    id: 'literature', phase: 'Find your question', title: 'Map the literature',
    goal: 'Know what has been done, where studies disagree, and which gap your work addresses.',
    actions: ['Find the most cited and the most recent studies on your question.', 'Read them and note each method, finding and limit in your own words.', 'Group the studies by theme, then state the gap.'],
    checks: ['I have read every source I plan to cite', 'I can name the gap in one sentence', 'My notes are in my own words'],
    workLabel: 'Your themes, the main disagreements and the gap you found',
    coachFocus: 'whether sources are compared rather than listed, and whether the gap follows from them',
  },
  {
    id: 'proposal', phase: 'Plan the work', title: 'Write and defend your proposal',
    goal: 'Get approval for the question, method and schedule.',
    actions: ['Draft the problem, objectives, method and timeline.', 'Fill in your university’s proposal form.', 'Rehearse, then present it.'],
    checks: ['Objectives match the research question', 'The timeline reaches the submission deadline', 'The proposal has been approved'],
    workLabel: 'Your objectives, planned method and timeline',
    coachFocus: 'alignment between objectives, method and timeline',
    workflowIds: ['proposal'],
  },
  {
    id: 'method', phase: 'Plan the work', title: 'Design your method',
    goal: 'Choose a method that can really answer your question, and be able to defend it.',
    actions: ['Explain why this method fits your question better than the alternatives.', 'Define your data, sample, variables or cases.', 'Plan how you will test validity, and check whether you need ethics approval.'],
    checks: ['I can justify the method against one alternative', 'I know how results will be evaluated', 'Ethics and data permissions are settled'],
    workLabel: 'Your method, why you chose it, and how you will evaluate results',
    coachFocus: 'fit between question and method, validity, reproducibility',
  },
  {
    id: 'research', phase: 'Do the research', title: 'Collect data and record results',
    goal: 'Produce results you can trace and reproduce.',
    actions: ['Run the study as planned.', 'Keep raw data, code and settings under version control.', 'Record every change to the plan and why you made it.'],
    checks: ['Raw data and results are backed up', 'Someone else could repeat what I did', 'Unexpected results are recorded too'],
    workLabel: 'Your main results and what changed from the plan',
    coachFocus: 'whether results answer the question, and how they could be challenged',
  },
  {
    id: 'mid_term', phase: 'Do the research', title: 'Pass the mid-term assessment',
    goal: 'Show your progress and fix problems while there is still time.',
    actions: ['Summarize progress against your proposal.', 'Name the remaining risks.', 'Complete the required form and meet your supervisor.'],
    checks: ['Progress is measured against the proposal', 'Remaining work has dates', 'The assessment is complete'],
    workLabel: 'Your progress, risks and revised plan',
    coachFocus: 'realism of the remaining plan',
    workflowIds: ['mid_term'],
  },
  {
    id: 'outline', phase: 'Write', title: 'Outline the thesis',
    goal: 'Decide what each chapter must prove before you write it.',
    actions: ['Download your university’s template.', 'Write one sentence for what each chapter establishes.', 'Check that the chapters lead to your conclusion.'],
    checks: ['Every chapter serves the research question', 'I use the official template', 'My supervisor has seen the outline'],
    workLabel: 'Your chapter titles, each with the point it makes',
    coachFocus: 'logical order, gaps and repetition between chapters',
    ruleKeys: ['structure.parts_order', 'heading.chapter_title.max_words', 'structure.chapter_summary_required'],
  },
  {
    id: 'draft', phase: 'Write', title: 'Draft each chapter yourself',
    goal: 'Finish a complete first draft, one chapter at a time.',
    actions: ['Write the next chapter in your own words.', 'Get feedback on it here.', 'Answer the questions, revise, then move to the next chapter.'],
    checks: ['Every chapter has a first draft', 'Every chapter has been reviewed', 'Citations are in place as I write'],
    workLabel: 'Which chapters are done, and what you are stuck on',
    coachFocus: 'what blocks the student and which part to tackle next',
    tool: { href: '/feedback', label: 'Get feedback on a chapter' },
    ruleKeys: ['length.main_text.min_words', 'citation.in_text_system'],
  },
  {
    id: 'revise', phase: 'Write', title: 'Revise the whole thesis',
    goal: 'Turn the draft into one consistent argument that meets every rule.',
    actions: ['Read the thesis from start to finish.', 'Write the abstract and conclusion last.', 'Run the check and fix every result.'],
    checks: ['Introduction and conclusion match', 'Terms are used consistently', 'The check shows nothing left to fix'],
    workLabel: 'Your main claims, and what you changed in this revision',
    coachFocus: 'consistency of the argument across the thesis',
    tool: { href: '/check', label: 'Check my thesis' },
    ruleKeys: ['abstract.keywords_count', 'format.body_text', 'language.abstract'],
  },
  {
    id: 'references', phase: 'Write', title: 'Verify every reference',
    goal: 'Make sure every source exists, says what you claim, and is listed correctly.',
    actions: ['Run the reference check.', 'Open each source marked Compare or No match.', 'Remove anything you have not read.'],
    checks: ['Every reference is confirmed', 'Every citation is in the list, and every listed source is cited', 'The list follows the required style'],
    workLabel: 'Sources you could not confirm, and what you did about them',
    coachFocus: 'reliability and recency of the sources',
    tool: { href: '/feedback', label: 'Check references' },
    ruleKeys: ['citation.standard', 'citation.max_listed_authors'],
  },
  {
    id: 'pre_defense', phase: 'Submit', title: 'Pass the pre-defense',
    goal: 'Hear objections early and fix them before external review.',
    actions: ['Prepare a short presentation.', 'Record every comment from the panel.', 'Revise the thesis and note how you responded.'],
    checks: ['The pre-defense is complete', 'Every comment has been addressed'],
    workLabel: 'Panel comments and how you responded',
    coachFocus: 'whether each comment was really addressed',
    workflowIds: ['pre_defense'],
  },
  {
    id: 'submission', phase: 'Submit', title: 'Pass the similarity check and approvals',
    goal: 'Meet the similarity limit honestly and get internal approval.',
    actions: ['Run the official similarity check.', 'Where text is too close to a source, rethink the passage, then quote or cite it properly.', 'Get supervisor and school approval.'],
    checks: ['The result is within the limit', 'Sources are properly credited', 'Supervisor and school have approved'],
    workLabel: 'Your similarity result and the passages you reworked',
    coachFocus: 'proper attribution and original analysis',
    workflowIds: ['similarity_check', 'internal_approval'],
    ruleKeys: ['integrity.similarity.max_percent', 'submission.min_working_days_before_defense'],
  },
  {
    id: 'blind_review', phase: 'Submit', title: 'Prepare the blind review copy',
    goal: 'Send a copy with nothing that reveals who you are.',
    actions: ['Save a separate copy of the thesis.', 'Remove names, signatures and acknowledgments.', 'Run the check in Blind review mode, then submit.'],
    checks: ['The blind review check is clear', 'The file was submitted on time'],
    workLabel: 'What you removed, and your submission date',
    coachFocus: 'identity clues that are easy to miss',
    tool: { href: '/check', label: 'Check the blind review copy' },
    workflowIds: ['blind_review'],
    ruleKeys: ['anonymity.acknowledgments_removed', 'anonymity.research_outputs_masked'],
  },
  {
    id: 're_review', phase: 'Submit', title: 'Respond to the reviewers',
    goal: 'Answer every reviewer comment with a real change.',
    actions: ['Copy every comment into a table.', 'Revise the thesis for each comment.', 'Explain each change, comment by comment.'],
    checks: ['Every comment has its own row', 'Each row names a real change', 'My supervisor has approved the revision'],
    workLabel: 'Each reviewer comment and what you changed',
    coachFocus: 'whether each response addresses the comment fully',
    optional: true,
    workflowIds: ['re_review'],
    ruleKeys: ['review.response_to_comments_required', 'review.max_attempts'],
  },
  {
    id: 'defense', phase: 'Finish', title: 'Prepare and pass your defense',
    goal: 'Explain and defend your own work with confidence.',
    actions: ['Prepare slides around your question, method, results and contribution.', 'Practice answering hard questions out loud.', 'Complete the required forms, then defend.'],
    checks: ['I have practiced aloud in the time allowed', 'I can defend my method and limits', 'The defense is complete'],
    workLabel: 'Your contribution in three sentences, and the question you fear most',
    coachFocus: 'hard questions a committee would ask about this work',
    workflowIds: ['defense'],
  },
  {
    id: 'archive', phase: 'Finish', title: 'Submit your final thesis',
    goal: 'Make the committee’s changes and complete your degree file.',
    actions: ['Revise the thesis under your supervisor’s guidance.', 'Sign the required statements.', 'Submit the final copies and degree file.'],
    checks: ['Committee changes are done', 'The final file matches the printed copy', 'All degree documents are submitted'],
    workLabel: 'What is left before your degree file is complete',
    coachFocus: 'completeness of the final submission',
    tool: { href: '/check', label: 'Check the final copy' },
    workflowIds: ['archive'],
    ruleKeys: ['archiving.electronic_file'],
  },
];

export type StepState = { work: string; checks: number[]; status: 'open' | 'done' | 'skipped'; coach?: CoachReply; updated?: string };
export type LogEntry = { at: string; step: string; tool: string };
export type PathState = {
  topic: string;
  discipline: string;
  defenseDate: string;
  current: string;
  steps: Record<string, StepState>;
  log: LogEntry[];
};

export type CoachReply = {
  assessment: string;
  gaps: string[];
  questions: string[];
  next_action: string;
  ready: boolean;
};

export const emptyPath = (): PathState => ({ topic: '', discipline: '', defenseDate: '', current: STEPS[0].id, steps: {}, log: [] });
export const stepState = (p: PathState, id: string): StepState => p.steps[id] ?? { work: '', checks: [], status: 'open' };

export function canComplete(step: Step, s: StepState) {
  return s.work.trim().length > 0 && step.checks.every((_, i) => s.checks.includes(i));
}

export function nextOpen(p: PathState, afterId?: string) {
  const start = afterId ? STEPS.findIndex((s) => s.id === afterId) + 1 : 0;
  const order = [...STEPS.slice(start), ...STEPS.slice(0, start)];
  return order.find((s) => stepState(p, s.id).status === 'open') ?? null;
}

export function progress(p: PathState) {
  const closed = STEPS.filter((s) => stepState(p, s.id).status !== 'open').length;
  return { closed, total: STEPS.length, percent: Math.round((closed / STEPS.length) * 100) };
}

export function stepRules(step: Step, profile: Profile | null, degree: DegreeType | ''): Rule[] {
  if (!profile || !step.ruleKeys) return [];
  return profile.rules.filter((r) => step.ruleKeys!.includes(r.key) && (!r.applies_to.length || (degree && r.applies_to.includes(degree))));
}

export function stepStages(step: Step, profile: Profile | null): Stage[] {
  if (!profile || !step.workflowIds) return [];
  return profile.workflow.filter((w) => step.workflowIds!.includes(w.id));
}

export function isPathState(v: unknown): v is PathState {
  const p = v as PathState;
  return !!p && typeof p === 'object' && typeof p.steps === 'object' && p.steps !== null && !Array.isArray(p.steps) && Array.isArray(p.log) && typeof p.current === 'string' && STEPS.some((s) => s.id === p.current);
}

export function aiLogText(p: PathState) {
  const title = (id: string) => STEPS.find((s) => s.id === id)?.title ?? id;
  const lines = p.log.map((l) => `${l.at.slice(0, 16).replace('T', ' ')} UTC  ${title(l.step)}: ${l.tool}`);
  return `AI use record${p.topic ? ` for: ${p.topic}` : ''}\n\n${lines.join('\n') || 'No AI use recorded.'}\n`;
}
