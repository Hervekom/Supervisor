// Stands in for an OpenAI-compatible provider. It never calls the network.
import http from 'node:http';

function reply(messages) {
  const system = messages[0]?.content ?? '';
  const user = messages[1]?.content ?? '';
  if (system.includes('like a chef leading a recipe')) {
    return { reply: `Mock chef reply. ${Array(300).fill('word').join(' ')}`, suggestions: ['Mock suggestion', 'Second idea'], step: user.includes('open method') ? 'method' : 'not_a_step' };
  }
  if (system.includes('experiment run record')) {
    // One sentence repeats a submitted number, one invents a number. The app must drop the invented one.
    const first = user.match(/= ([\d.,]+)/)?.[1] ?? '1';
    if (user.includes('Reply language: French')) {
      return {
        summary: `Avis simulé. La valeur saisie ${first} vient d’une seule graine. Le modèle est 3 fois plus rapide que la référence.`,
        can_support: ['Simulé : la chaîne de traitement fonctionne de bout en bout.', 'Simulé : la précision a progressé de 15 %.'],
        cannot_support: ['Simulé : affirmer que la méthode surpasse la référence.'],
        missing: ['Simulé : plus de graines.'],
        next_action: 'Simulé : relancez avec 3 graines.',
      };
    }
    return {
      summary: `Mock run review. The reported value ${first} comes from one seed. A better model would reach 0.987 accuracy.`,
      can_support: ['Mock: the pipeline runs end to end.'],
      cannot_support: ['Mock: a claim that the method beats the baseline.'],
      missing: ['Mock: more seeds.', 'Mock: the model improved accuracy by 15%.'],
      next_action: 'Mock: run two more seeds.',
    };
  }
  if (system.includes('writing guide')) {
    if (user.includes('<student_paragraph>')) return { missing: ['Mock missing evidence'], question: 'Mock review question?' };
    if (user.includes('Build a plan')) return { points: [{ point: 'Mock point from answers', evidence: 'Mock evidence' }, { point: Array(40).fill('word').join(' '), evidence: '' }] };
    return { question: `Mock question ${(user.match(/Q: /g) ?? []).length + 1}?` };
  }
  if (system.includes('thesis examiner')) {
    const block = user.split('Strong work at this step:')[1]?.split('Degree:')[0] ?? '';
    const standards = block.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
    return {
      verdict: 'ready',
      summary: 'Mock critique summary.',
      criteria: standards.map((standard) => ({ standard, status: 'met', comment: 'Mock reason.' })),
      weakest: 'Mock weakness.',
      questions: ['Mock examiner question?'],
      next_action: 'Mock next action.',
    };
  }
  if (system.includes('guides a student')) return { intro: 'Mock tailored intro.', tasks: ['Mock tailored task.'] };
  return {
    summary: 'Mock chapter feedback.',
    strengths: ['Mock strength'],
    issues: [{ severity: 'major', location: '1.1', problem: 'Mock problem', why_it_matters: 'Mock reason', guiding_question: 'Mock question?' }],
    next_steps: ['Mock step'],
  };
}

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url !== '/chat/completions') return res.end('{}');
      const { messages } = JSON.parse(body);
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(messages)) } }] }));
    });
  })
  .listen(Number(process.env.MOCK_PORT ?? 4110), '127.0.0.1');
