import type { DegreeType, Profile, Rule, Stage } from './types';

export type Task = { do: string; how: string };

export type Step = {
  id: string;
  phase: string;
  title: string;
  goal: string;
  tasks: Task[];
  mistakes: string[];
  workLabel: string;
  coachFocus: string;
  standards?: string[];
  practice?: string[];
  workTemplate?: string;
  writingMap?: { part: string; needs: string }[];
  optional?: boolean;
  tool?: { href: string; label: string };
  workflowIds?: string[];
  ruleKeys?: string[];
};

export const STEPS: Step[] = [
  {
    id: 'title', phase: 'Find your question', title: 'Understand the title you were given',
    goal: 'Turn your supervisor’s title into a clear research question that you understand and can answer.',
    tasks: [
      { do: 'Ask your supervisor what they expect', how: 'Ask what problem the title addresses, what data to use, what result they expect, and which papers to read first.' },
      { do: 'Break the title into key terms', how: 'List each technical term in the title. Write what each one means, and what you still need to learn.' },
      { do: 'Find the problem behind the title', how: 'Read a few recent papers on those terms. Write what is still unsolved, and why it matters.' },
      { do: 'Write your research question', how: 'Turn the title into one question that evidence can answer. Keep the question close to your supervisor’s intent.' },
      { do: 'Check it is possible', how: 'Confirm the data, tools and time you need. Show your question and any risks to your supervisor.' },
    ],
    mistakes: ['Starting experiments before you understand the title', 'Changing the title without asking your supervisor', 'Treating a title as if it were a research question'],
    workLabel: 'Your title, what it means, and your research question',
    coachFocus: 'whether the student understands the title and has turned it into a feasible question',
  },
  {
    id: 'topic', phase: 'Find your question', title: 'Choose a topic you can finish',
    goal: 'Leave this step with one narrow research question that you can answer in the time you have.',
    tasks: [
      { do: 'List three possible topics', how: 'Start from your courses, your lab, your supervisor’s projects or a real problem you have seen. Write one line on why each matters.' },
      { do: 'Test whether each topic is possible', how: 'For each one, note the data, tools, skills and time you need. Remove any topic that depends on data you cannot get.' },
      { do: 'Narrow one topic into a question', how: 'Limit it by population, place, method or period. A good question can be answered with evidence and fits in one sentence.' },
      { do: 'Show the question to your supervisor', how: 'Bring your question, your data source and one risk. Write down what your supervisor changes.' },
    ],
    mistakes: ['Choosing a whole field instead of a question', 'Choosing a topic before checking that data exists', 'Copying a topic that has already been answered'],
    workLabel: 'Your research question and why it matters',
    coachFocus: 'scope, feasibility in the available time, clarity of the question',
  },
  {
    id: 'literature', phase: 'Find your question', title: 'Map the literature',
    goal: 'Know what has been done, where studies disagree, and which gap your work addresses.',
    tasks: [
      { do: 'Find the key studies', how: 'Search Google Scholar, CNKI or your library with your main terms. Keep the most cited papers and the most recent ones.' },
      { do: 'Read and take notes in your own words', how: 'For each study, record the aim, method, data, main result and limit. Save the full reference at the same time.' },
      { do: 'Group studies by approach', how: 'Build a table with one row per study or family. Add columns for strengths and limits, so you can compare them.' },
      { do: 'Write your gaps', how: 'List what remains unsolved, and name the studies that show it. Then decide which gap you will address.' },
    ],
    mistakes: ['Summarizing one paper after another', 'Citing papers you have not read', 'Claiming a gap that no study supports'],
    workLabel: 'Your themes, the main disagreements and the gap you found',
    coachFocus: 'whether sources are compared rather than listed, and whether the gap follows from them',
  },
  {
    id: 'proposal', phase: 'Plan the work', title: 'Write and defend your proposal',
    goal: 'Get approval for the question, method and schedule.',
    tasks: [
      { do: 'Draft the proposal', how: 'Move from background to gap, aim, objectives, method, expected contribution and timeline.' },
      { do: 'Plan backward from your deadline', how: 'Start at your defense date. Add review, revision and writing time before you plan the research.' },
      { do: 'Complete your university’s form', how: 'Use the current official form. Check the required sections before you write.' },
      { do: 'Present and record the comments', how: 'Rehearse your talk, then write down every comment and what you will change.' },
    ],
    mistakes: ['Promising too much for the time you have', 'Leaving no time for review', 'Describing tools without explaining the research problem'],
    workLabel: 'Your objectives, planned method and timeline',
    coachFocus: 'alignment between objectives, method and timeline',
    workflowIds: ['proposal'],
  },
  {
    id: 'method', phase: 'Plan the work', title: 'Design your method',
    goal: 'Choose a method that can really answer your question, and be able to defend it.',
    tasks: [
      { do: 'Compare possible methods', how: 'List at least two options with their strengths and limits. Choose the one that best fits your question.' },
      { do: 'Define your data or participants', how: 'State the source, size, selection rules and why it fits. Say what the data cannot show.' },
      { do: 'Choose how you will judge results', how: 'Pick your measures and comparison methods before you see the results.' },
      { do: 'Check ethics and permissions', how: 'Ask whether you need ethics approval, consent or data permission. Keep the proof.' },
    ],
    mistakes: ['Choosing a method because it is popular', 'Combining methods without a reason', 'Choosing success measures after seeing results'],
    workLabel: 'Your method, why you chose it, and how you will evaluate results',
    coachFocus: 'fit between question and method, validity, reproducibility',
  },
  {
    id: 'alignment', phase: 'Plan the work', title: 'Link questions to evidence',
    goal: 'Make sure every research question leads to a method, a result and a place in your thesis.',
    tasks: [
      { do: 'Write one main aim', how: 'State what the whole thesis will achieve in one sentence.' },
      { do: 'Split it into objectives', how: 'Use a few specific objectives that each describe something you will do.' },
      { do: 'Give each objective one question', how: 'Each question should have an answer you can show with evidence.' },
      { do: 'Complete the chain', how: 'For each question, name the method, the evidence and the chapter that answers it.' },
    ],
    mistakes: ['Writing questions your data cannot answer', 'Adding objectives that no chapter covers'],
    workLabel: 'Your table: objective, question, method, evidence, chapter',
    coachFocus: 'gaps in the chain from objective to question, method, evidence and chapter',
  },
  {
    id: 'research', phase: 'Do the research', title: 'Collect data and record results',
    goal: 'Produce results you can trace and reproduce.',
    tasks: [
      { do: 'Run a small pilot', how: 'Test your process on a small sample first, then fix any problems before the full study.' },
      { do: 'Run the full study', how: 'Follow your plan. Repeat trials or collect enough cases for your method.' },
      { do: 'Keep a research log', how: 'Record dates, settings, versions, random seeds or sampling choices, and every change to the plan.' },
      { do: 'Back up and analyze your results', how: 'Keep raw data, code and results in two places. Record unexpected and negative results too.' },
    ],
    mistakes: ['Keeping only the best run', 'Changing the plan without recording why', 'Comparing methods under different conditions'],
    workLabel: 'Your main results and what changed from the plan',
    coachFocus: 'whether results answer the question, and how they could be challenged',
  },
  {
    id: 'experiments', phase: 'Do the research', title: 'Train your models',
    goal: 'Train and evaluate your models in a way you can defend, repeat and write about.',
    tasks: [
      { do: 'Prepare your data', how: 'Clean it, then split it into training, validation and test sets. Split before any scaling or balancing, so test data cannot leak into training.' },
      { do: 'Train a simple baseline first', how: 'Start with a standard method. This gives you a number to beat and shows that your pipeline works.' },
      { do: 'Set up a repeatable run', how: 'Use version control and one configuration file. Record the random seed, library versions, hardware and every setting.' },
      { do: 'Run a small test', how: 'Train on a tiny sample until the model fits it. If it cannot, fix the code before you spend time on a full run.' },
      { do: 'Tune using validation data only', how: 'Choose settings on the validation set. Record each trial, including the ones that failed.' },
      { do: 'Train your final model several times', how: 'Use different seeds, then report the mean and standard deviation. A single run can be luck.' },
      { do: 'Compare fairly', how: 'Test your model and the comparison methods on the same data and metrics. Include recent published methods when you can.' },
      { do: 'Remove one part at a time', how: 'If your model has several parts, run a test without each one to show what it adds.' },
      { do: 'Evaluate on the test set once', how: 'Use it only at the end, then save the outputs, logs and model weights.' },
    ],
    mistakes: ['Tuning on the test set', 'Reporting only the best run', 'Comparing models on different data', 'Scaling or balancing data before the split'],
    workLabel: 'Your model, data split, settings and what you ran',
    coachFocus: 'data leakage, fair comparison, repeat runs, and whether the plan can answer the research question',
    optional: true,
  },
  {
    id: 'evidence', phase: 'Do the research', title: 'Bring your results for writing',
    goal: 'Collect everything you need, so you can write from evidence and not from memory.',
    tasks: [
      { do: 'Fill in your results sheet', how: 'Complete each heading in the Write tab. Enter what you actually have, and write “Missing” for anything you do not have.' },
      { do: 'Gather tables and figures', how: 'Keep the source data for each one, so that you can correct it later.' },
      { do: 'Link each result to a research question', how: 'Name the question each result answers. If a question has no result, go back and collect it.' },
      { do: 'Show the sheet to your supervisor', how: 'Agree what is enough before you write the results chapter.' },
    ],
    mistakes: ['Writing results from memory', 'Keeping a figure without its source data', 'Hiding a result that went badly'],
    workLabel: 'Your results sheet',
    coachFocus: 'which evidence is missing before the student can write, and whether results answer each research question',
    workTemplate: `Research questions:

Data (source, size, how it was split or sampled):

Method or model (and why you chose it):

Main settings (parameters, seeds, software, hardware):

Comparison methods:

Measures used:

Main results (with mean and spread if repeated):

Effect of removing each part, if tested:

Statistical tests, if used:

Time and resource costs:

What failed or surprised you:

Limits of these results:

Tables and figures you have:
`,
  },
  {
    id: 'mid_term', phase: 'Do the research', title: 'Pass the mid-term assessment',
    goal: 'Show your progress and fix problems while there is still time.',
    tasks: [
      { do: 'Compare progress with your proposal', how: 'List what is done, what changed and what is late.' },
      { do: 'Name your remaining risks', how: 'For each risk, write how you will reduce it and by when.' },
      { do: 'Complete the assessment', how: 'Fill in the form, meet your supervisor and record any required changes.' },
    ],
    mistakes: ['Hiding delays', 'Reporting activity instead of results'],
    workLabel: 'Your progress, risks and revised plan',
    coachFocus: 'realism of the remaining plan',
    workflowIds: ['mid_term'],
  },
  {
    id: 'paper', phase: 'Do the research', title: 'Publish a paper from your results',
    goal: 'Test one result with peer reviewers before it becomes a thesis chapter.',
    tasks: [
      { do: 'Choose one contribution', how: 'A paper should make one main point. Keep other results for another paper.' },
      { do: 'Choose a journal with your supervisor', how: 'Check its scope, indexing, fees and reputation, and read its author rules. Avoid journals you cannot verify.' },
      { do: 'Agree authorship', how: 'Decide who is an author and what each person contributed before you submit.' },
      { do: 'Write, submit and answer reviewers', how: 'Write it yourself, declare any AI use the journal requires, and respond to each reviewer comment.' },
    ],
    mistakes: ['Submitting to a journal without checking it', 'Reusing a paper in your thesis without checking the rules'],
    workLabel: 'Your target journal and the one contribution of this paper',
    coachFocus: 'whether the contribution is focused and the journal fits',
    optional: true,
    ruleKeys: ['integrity.similarity.max_percent'],
  },
  {
    id: 'outline', phase: 'Write', title: 'Outline the thesis',
    goal: 'Decide what each chapter must prove, and what single idea connects them.',
    tasks: [
      { do: 'Download the official template', how: 'Use the current template from your university, and write inside it from the start.' },
      { do: 'State the idea that connects your work', how: 'Write one sentence that explains how your studies form one thesis.' },
      { do: 'Write one point for each chapter', how: 'For each chapter, write what it establishes, not only its topic.' },
      { do: 'Show your supervisor the outline', how: 'Agree the chapter order before you write long sections.' },
    ],
    mistakes: ['Joining papers without a connecting idea', 'Using four or more heading levels', 'Writing long chapter titles'],
    workLabel: 'Your chapter titles, each with the point it makes',
    coachFocus: 'logical order, gaps and repetition between chapters',
    ruleKeys: ['structure.parts_order', 'heading.chapter_title.max_words', 'structure.chapter_summary_required'],
  },
  {
    id: 'draft', phase: 'Write', title: 'Draft each chapter yourself',
    goal: 'Finish a complete first draft, one chapter at a time.',
    tasks: [
      { do: 'Start with method and results', how: 'These are often the easiest chapters to write first because the facts are clear.' },
      { do: 'Write the literature and introduction', how: 'Now that you know your results, keep only what supports your argument.' },
      { do: 'Explain every result', how: 'Say what happened, why it happened and what it means. Avoid listing numbers only.' },
      { do: 'Get a critique for each chapter', how: 'Upload each chapter in Feedback, answer the questions, revise and repeat.' },
    ],
    mistakes: ['Waiting until the draft is perfect', 'Adding citations at the end', 'Listing results with no explanation'],
    workLabel: 'Which chapters are done, and what you are stuck on',
    coachFocus: 'what blocks the student and which part to tackle next',
    tool: { href: '/feedback', label: 'Get feedback on a chapter' },
    ruleKeys: ['length.main_text.min_words', 'citation.in_text_system'],
    writingMap: [
      { part: 'Introduction', needs: 'Your problem, gap, objectives, research questions and contribution.' },
      { part: 'Literature review', needs: 'Your comparison table of earlier work, and your numbered gaps.' },
      { part: 'Method', needs: 'Your data, split or sampling, model design, settings and reasons for each choice.' },
      { part: 'Results', needs: 'Your tables and figures, repeat-run results, comparisons and part-removal tests.' },
      { part: 'Discussion', needs: 'Why results occurred, what surprised you, how they answer each question, and their limits.' },
      { part: 'Conclusion', needs: 'A direct answer to each question, your contribution, limits and future work.' },
      { part: 'Paper', needs: 'One contribution, its method, the results that prove it, and data availability.' },
    ],
  },
  {
    id: 'revise', phase: 'Write', title: 'Revise the whole thesis',
    goal: 'Turn the draft into one consistent argument that meets every rule.',
    tasks: [
      { do: 'Read it from start to finish', how: 'Check that each chapter leads to the next, and remove repeated material.' },
      { do: 'Write the abstract and conclusion last', how: 'Open the abstract with your main idea. Answer each research question in the conclusion.' },
      { do: 'Recheck every number', how: 'Compare the abstracts, text, tables and figures. Recalculate each percentage and equation.' },
      { do: 'Run the check and fix each result', how: 'Upload your Word file, fix what it finds, and ask your school about any conflicting rules.' },
    ],
    mistakes: ['Writing different facts in the two abstracts', 'Saying percent when you mean percentage points', 'Comparing different metrics'],
    workLabel: 'Your main claims, and what you changed in this revision',
    coachFocus: 'consistency of the argument across the thesis',
    tool: { href: '/check', label: 'Check my thesis' },
    ruleKeys: ['abstract.keywords_count', 'format.body_text', 'language.abstract'],
  },
  {
    id: 'references', phase: 'Write', title: 'Verify every reference',
    goal: 'Make sure every source exists, says what you claim, and is listed correctly.',
    tasks: [
      { do: 'Run the reference check', how: 'Paste your list in Feedback, under References.' },
      { do: 'Open every doubtful source', how: 'Check each result marked Compare or No match against the original.' },
      { do: 'Match citations and the list', how: 'Every citation needs an entry, and every entry needs a citation.' },
      { do: 'Apply the required style', how: 'Use a reference manager such as Zotero, then check the final list by eye.' },
    ],
    mistakes: ['Citing a source you have not read', 'Trusting references suggested by AI without checking them', 'Keeping entries you never cite'],
    workLabel: 'Sources you could not confirm, and what you did about them',
    coachFocus: 'reliability and recency of the sources',
    tool: { href: '/feedback', label: 'Check references' },
    ruleKeys: ['citation.standard', 'citation.max_listed_authors'],
  },
  {
    id: 'pre_defense', phase: 'Submit', title: 'Pass the pre-defense',
    goal: 'Hear objections early and fix them before external review.',
    tasks: [
      { do: 'Prepare a short presentation', how: 'Focus on your question, method, results and contribution.' },
      { do: 'Record every comment', how: 'Ask someone to take notes while you answer.' },
      { do: 'Revise and note each change', how: 'Keep a table with each comment and what you changed.' },
    ],
    mistakes: ['Defending every comment instead of noting it', 'Making changes without recording them'],
    workLabel: 'Panel comments and how you responded',
    coachFocus: 'whether each comment was really addressed',
    workflowIds: ['pre_defense'],
  },
  {
    id: 'submission', phase: 'Submit', title: 'Pass the similarity check and approvals',
    goal: 'Meet the similarity limit honestly and get internal approval.',
    tasks: [
      { do: 'Run the official similarity check', how: 'Use the system your university accepts, and keep the report.' },
      { do: 'Review each flagged passage', how: 'Rethink the idea in your own analysis, then quote or cite the source properly.' },
      { do: 'Get supervisor and school approval', how: 'Submit in the required system before the deadline.' },
    ],
    mistakes: ['Swapping words without changing the thinking', 'Leaving the check until the last week'],
    workLabel: 'Your similarity result and the passages you reworked',
    coachFocus: 'proper attribution and original analysis',
    workflowIds: ['similarity_check', 'internal_approval'],
    ruleKeys: ['integrity.similarity.max_percent', 'submission.min_working_days_before_defense'],
  },
  {
    id: 'blind_review', phase: 'Submit', title: 'Prepare the blind review copy',
    goal: 'Send a copy with nothing that reveals who you are.',
    tasks: [
      { do: 'Save a separate copy', how: 'Keep your full version safe, and work only on the review copy.' },
      { do: 'Remove what identifies you', how: 'Remove names, signatures, acknowledgments, grant numbers, links and file properties.' },
      { do: 'Run the blind review check', how: 'Choose Blind review in Check, and enter your name and your supervisor’s name.' },
      { do: 'Submit on time', how: 'Check the required format and save proof of submission.' },
    ],
    mistakes: ['Leaving names in file properties', 'Forgetting names in the research outputs list'],
    workLabel: 'What you removed, and your submission date',
    coachFocus: 'identity clues that are easy to miss',
    tool: { href: '/check', label: 'Check the blind review copy' },
    workflowIds: ['blind_review'],
    ruleKeys: ['anonymity.acknowledgments_removed', 'anonymity.research_outputs_masked'],
  },
  {
    id: 're_review', phase: 'Submit', title: 'Respond to the reviewers',
    goal: 'Answer every reviewer comment with a real change.',
    tasks: [
      { do: 'Copy every comment into a table', how: 'Use one row per comment, without combining them.' },
      { do: 'Revise the thesis', how: 'Make the real change first, with your supervisor’s guidance.' },
      { do: 'Explain each change', how: 'Say what changed and where. If you disagree, give evidence calmly.' },
    ],
    mistakes: ['Writing “revised” with no detail', 'Submitting before the required revision period ends'],
    workLabel: 'Each reviewer comment and what you changed',
    coachFocus: 'whether each response addresses the comment fully',
    optional: true,
    workflowIds: ['re_review'],
    ruleKeys: ['review.response_to_comments_required', 'review.max_attempts'],
  },
  {
    id: 'defense', phase: 'Finish', title: 'Prepare and pass your defense',
    goal: 'Explain and defend your own work with confidence.',
    tasks: [
      { do: 'Build your slides', how: 'Cover the problem, gap, method, results, contribution and limits.' },
      { do: 'Practice out loud', how: 'Time yourself, then present to a friend who can interrupt you.' },
      { do: 'Prepare your hard answers', how: 'Use the questions below. Keep each answer short and based on evidence.' },
      { do: 'Complete the forms and defend', how: 'Check the required documents. Take notes on every comment.' },
    ],
    mistakes: ['Reading from the slides', 'Being unable to explain an equation', 'Answering a limit by arguing instead of acknowledging it'],
    workLabel: 'Your contribution in three sentences, and the question you fear most',
    coachFocus: 'hard questions a committee would ask about this work',
    workflowIds: ['defense'],
  },
  {
    id: 'archive', phase: 'Finish', title: 'Submit your final thesis',
    goal: 'Make the committee’s changes and complete your degree file.',
    tasks: [
      { do: 'Answer each committee comment', how: 'Write a response for each comment, and make the change.' },
      { do: 'Run the final check', how: 'Use Final copy in Check, then get your supervisor’s approval.' },
      { do: 'Sign the required statements', how: 'Have the author and supervisor sign where required.' },
      { do: 'Submit all final documents', how: 'Follow your university’s list. Make sure the PDF matches the printed copy.' },
    ],
    mistakes: ['Submitting a file that differs from the approved version', 'Forgetting a required signature'],
    workLabel: 'What is left before your degree file is complete',
    coachFocus: 'completeness of the final submission',
    tool: { href: '/check', label: 'Check the final copy' },
    workflowIds: ['archive'],
    ruleKeys: ['archiving.electronic_file'],
  },
];

const STANDARDS: Record<string, string[]> = {
  title: ['Explains each key term in the title', 'States the problem behind the title', 'Turns the title into one question evidence can answer', 'Shows the work is possible with available data and time'],
  topic: ['States a specific problem, not a broad field', 'Shows who is affected and why it matters now', 'Sets a scope you can finish, and says what is left out'],
  literature: ['Groups studies by approach, not one summary after another', 'Compares strengths and limits across studies', 'Lists numbered gaps, each backed by the studies reviewed', 'Each gap leads to a design choice in your work'],
  proposal: ['Moves from context to gap, aim, questions and contribution', 'Separates what already exists from what you will add', 'Sets out what success will look like'],
  method: ['Names the alternatives and explains why this one fits best', 'Justifies any combination of methods with theory and evidence', 'Uses data a sceptical reader would accept, including public or real data when possible', 'Describes each part clearly enough to rebuild it', 'Compares with simple baselines and recent published methods under the same conditions', 'Defines how each claim will be tested before seeing results'],
  alignment: ['Each objective has one clear question', 'Each question can be answered with your evidence', 'The conclusion will be able to answer each question by name'],
  research: ['Records settings, seeds or sampling, and versions', 'Runs repeated trials or a sound sample', 'Removes one part at a time to show what each adds, when it applies', 'Tests beyond the first dataset or setting, when possible'],
  experiments: ['Keeps test data separate from training and tuning', 'Compares methods on the same data and metrics', 'Repeats runs and reports the spread', 'Records settings well enough for someone to repeat the work', 'Shows what each model part adds, when it applies'],
  evidence: ['Each research question has its evidence', 'Each number has a source file or log', 'Data, method and settings are complete', 'Failed runs and limits are recorded', 'Missing evidence is named, not hidden'],
  mid_term: ['Reports progress against the original objectives', 'Explains any change of plan'],
  paper: ['Makes one contribution, stated early', 'Reports results the reader can verify', 'Discloses data availability, author roles and any AI use the journal requires'],
  outline: ['A single idea connects all chapters', 'Each study chapter runs from aim to method, results, discussion and summary', 'Published work is extended, not only joined together'],
  draft: ['Your claims come first, and sources support them', 'Results explain why they occurred, not only what they were', 'Every figure and table makes a point in the text', 'Each paragraph connects to the one before it', 'Each chapter ends with what it established'],
  revise: ['The abstract opens with your core idea and stays separate from experiment detail', 'Both abstracts say the same thing', 'Headings stop at three levels, and chapter titles are short', 'Every equation is checked and its symbols are explained', 'Figures have clear legends', 'Every figure matches across abstracts, chapters and tables', 'Comparisons use the same metric and conditions', 'Gaps state whether they are points or percent', 'The conclusion answers each research question'],
  references: ['You read every source you cite', 'Every listed source is cited, and every citation is listed', 'Key claims cite the original study', 'Sources include foundational and recent work'],
  pre_defense: ['Each comment gets a specific response'],
  submission: ['Reused published work is declared', 'Similarity is resolved through your own analysis and proper credit'],
  blind_review: ['No name, grant or personal link can identify you'],
  re_review: ['Each response names what changed and where', 'If you disagree, you give evidence calmly'],
  defense: ['You can explain each result and how you would repeat it', 'You state limits before the committee does', 'You separate what your data shows from what you hope it shows'],
  archive: ['Each committee comment has a written response', 'The final file matches what was approved'],
};
for (const s of STEPS) s.standards = STANDARDS[s.id];

// Question types seen in real master's defense minutes, in computer science.
STEPS.find((s) => s.id === 'defense')!.practice = [
  'What is new in your work compared with what already exists?',
  'Why did you combine these methods instead of using one?',
  'What theory or evidence supports that design?',
  'How do you compare with recent published methods, not only baselines?',
  'Why this dataset? Would your results hold on real or public data?',
  'Why does your method perform better? What explains the difference?',
  'What are the strengths and limits of your approach?',
  'Is your sample large enough? How did you handle that limit?',
  'Can you explain the symbols in this equation?',
];

export type StepState = { work: string; checks: number[]; status: 'open' | 'done' | 'skipped'; coach?: CoachReply; rounds?: number; updated?: string; guide?: StepGuide };
export type StepGuide = { intro: string; tasks: string[] };
export type LogEntry = { at: string; step: string; tool: string };
export type PathState = {
  topic: string;
  discipline: string;
  defenseDate: string;
  current: string;
  savedAt?: string;
  started?: boolean;
  situation?: string;
  title?: string;
  steps: Record<string, StepState>;
  log: LogEntry[];
};

export type Verdict = 'not_ready' | 'almost' | 'ready';
export type CriterionResult = { standard: string; status: 'met' | 'partly' | 'missing'; comment: string };

export type CoachReply = {
  verdict: Verdict;
  summary: string;
  criteria: CriterionResult[];
  weakest: string;
  questions: string[];
  next_action: string;
};

export const emptyPath = (): PathState => ({ topic: '', discipline: '', defenseDate: '', current: STEPS[0].id, steps: {}, log: [] });
export const stepState = (p: PathState, id: string): StepState => p.steps[id] ?? { work: '', checks: [], status: 'open' };

export function canComplete(step: Step, s: StepState) {
  return s.work.trim().length > 0 && s.work.trim() !== (step.workTemplate ?? '').trim() && step.tasks.every((_, i) => s.checks.includes(i));
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

/** Keeps the most recently edited copy when a browser and the account differ. */
export function newerPath(local: PathState | null, cloud: PathState | null): PathState | null {
  if (!cloud) return local;
  if (!local) return cloud;
  return (local.savedAt ?? '') > (cloud.savedAt ?? '') ? local : cloud;
}

export type Situation = { id: string; label: string; hint: string; start: string; field?: string; upload?: string };

export const SITUATIONS: Situation[] = [
  { id: 'nothing', label: 'I have no topic yet', hint: 'Start from the beginning.', start: 'topic' },
  { id: 'title', label: 'My supervisor gave me a title', hint: 'Understand it and turn it into a research question.', start: 'title', field: 'Your thesis title' },
  { id: 'proposal', label: 'I already have a proposal', hint: 'Check it, then plan the research.', start: 'proposal', field: 'Your thesis title', upload: 'Your proposal' },
  { id: 'research', label: 'I am doing my research', hint: 'Check your results and keep going.', start: 'research', field: 'Your thesis title', upload: 'Your results or notes' },
  { id: 'draft', label: 'I have written some chapters', hint: 'Continue the draft with feedback.', start: 'draft', field: 'Your thesis title', upload: 'Your draft' },
  { id: 'full', label: 'I have a full draft', hint: 'Revise it and prepare to submit.', start: 'revise', field: 'Your thesis title', upload: 'Your full draft' },
  { id: 'reviewers', label: 'I received reviewer comments', hint: 'Answer each comment.', start: 're_review', field: 'Your thesis title', upload: 'The comments you received' },
  { id: 'defense', label: 'I am preparing my defense', hint: 'Practice the hard questions.', start: 'defense', field: 'Your thesis title', upload: 'Your thesis or slides' },
];

/** Starts the path where the student really is. Earlier steps are set aside and can be reopened. */
export function applySituation(p: PathState, id: string, input: { title?: string; text?: string }): PathState {
  const sit = SITUATIONS.find((s) => s.id === id) ?? SITUATIONS[0];
  const startAt = STEPS.findIndex((s) => s.id === sit.start);
  const steps = { ...p.steps };
  STEPS.forEach((s, i) => {
    const earlier = i < startAt;
    const alternative = (sit.start === 'title' && s.id === 'topic') || (sit.start === 'topic' && s.id === 'title');
    if (earlier || alternative) steps[s.id] = { ...stepState(p, s.id), status: 'skipped' };
  });
  const title = input.title?.trim() ?? '';
  if (sit.start === 'title' && title) steps.title = { ...stepState({ ...p, steps }, 'title'), status: 'open', work: `Title: ${title}\n\n` };
  if (input.text?.trim()) {
    steps[sit.start] = {
      ...stepState({ ...p, steps }, sit.start),
      status: 'open',
      work: input.text.trim(),
      checks: STEPS[startAt].tasks.map((_, i) => i),
    };
  }
  return { ...p, steps, current: sit.start, started: true, situation: sit.id, title: title || p.title, topic: p.topic || title };
}

/** Earlier work, so advice builds on what the student has already done. */
export function historyOf(p: PathState, stepId: string, limit = 9000) {
  const at = STEPS.findIndex((s) => s.id === stepId);
  const parts = STEPS.slice(0, at)
    .map((s) => ({ s, w: stepState(p, s.id).work.trim() }))
    .filter((x) => x.w)
    .map((x) => `${x.s.title}: ${x.w.slice(0, x.s.id === 'evidence' ? 4000 : 1200)}`);
  return parts.join('\n\n').slice(-limit);
}
