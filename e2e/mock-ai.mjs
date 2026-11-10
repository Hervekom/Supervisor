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
  if (system.includes('You analyse a research document written by other people')) {
    // Phase P8: honest items, plus items the app must drop or downgrade.
    const ps = [...user.matchAll(/<passage id="(p\d+)"[^>]*>\n([\s\S]*?)\n<\/passage>/g)].map((m) => ({ id: m[1], text: m[2] }));
    const find = (re) => ps.find((p) => re.test(p.text));
    const quote = (p, re) => (p ? (p.text.match(re) ?? [''])[0] : '');
    const prob = find(/open problem|仍然存在/);
    const data = find(/12,000 fictional|一万二千/);
    const res = find(/accuracy of 0\.\d+|准确率/);
    const aspects = { theory: [] };
    if (prob) aspects.problem = [{ text: 'Mock: sensors are sparse, which makes forecasting hard.', kind: 'stated', passage: prob.id, quote: quote(prob, /remains an open problem|仍然存在传感器稀疏的问题/) }];
    if (data) aspects.data = [
      { text: 'Mock: the dataset has 12,000 fictional samples.', kind: 'stated', passage: data.id, quote: quote(data, /12,000 fictional samples|一万二千个虚构样本/) },
      { text: 'Mock: the dataset has 15,000 samples.', kind: 'stated', passage: data.id, quote: 'it has 15,000 samples' },
      { text: 'Mock: a dataset from another passage.', kind: 'stated', passage: 'p999', quote: 'x' },
      { text: 'Mock: the data seem collected hourly.', kind: 'stated', passage: data.id, quote: 'words that are not in the passage at all' },
    ];
    if (res) aspects.results_quant = [{ text: 'Mock: the lantern network reached an accuracy of 0.91.', kind: 'stated', passage: res.id, quote: quote(res, /accuracy of 0\.91/) }];
    return { aspects };
  }
  if (system.includes('A student searches their own research documents')) return { terms: ['dataset', '数据集', 'corpus'] };
  if (system.includes('A student has collected research documents')) {
    // Phase P7: one honest point, one point that copies its excerpt (the app must drop it), one invented excerpt id.
    const ex = [...user.matchAll(/<excerpt id="(e\d+)"[^>]*>\n([\s\S]*?)\n<\/excerpt>/g)].map((m) => ({ id: m[1], text: m[2] }));
    const points = [{ excerpt: 'e1', why: 'Mock: this passage describes how the authors chose their data.', how: 'Mock: compare their choice with yours and justify yours.', cite: 'Mock: cite the dataset choice with its page.' }];
    if (ex[1]) points.push({ excerpt: 'e2', why: ex[1].text.split(/\s+/).slice(0, 14).join(' '), how: 'Copy this.', cite: 'x' });
    points.push({ excerpt: 'e9', why: 'Mock invented excerpt.', how: '', cite: '' });
    return { points, unrelated: ex[2] ? ['e3'] : [], caution: 'Mock caution: the results are the authors’ own.' };
  }
  if (system.includes('guides a student')) return { intro: 'Mock tailored intro.', tasks: ['Mock tailored task.'] };
  return {
    summary: 'Mock chapter feedback.',
    strengths: ['Mock strength'],
    issues: [{ severity: 'major', location: '1.1', problem: 'Mock problem', why_it_matters: 'Mock reason', guiding_question: 'Mock question?' }],
    next_steps: ['Mock step'],
  };
}

const counts = new Map();

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url !== '/chat/completions') return res.end('{}');
      const { messages } = JSON.parse(body);
      // Phase P4: provider failures on demand, triggered by a marker in the student's synthetic text.
      const user = messages[1]?.content ?? '';
      const marker = user.match(/P4-(MALFORMED-ONCE|STATUS-\d{3})-([\w-]+)/);
      if (marker) {
        const seen = (counts.get(marker[0]) ?? 0) + 1;
        counts.set(marker[0], seen);
        if (marker[1] === 'MALFORMED-ONCE' && seen === 1) return res.end(JSON.stringify({ choices: [{ message: { content: 'Sorry, here is prose instead of JSON.' } }] }));
        if (marker[1].startsWith('STATUS-')) {
          res.statusCode = Number(marker[1].slice(7));
          if (res.statusCode === 429) res.setHeader('retry-after', '1');
          return res.end('{"error":{"message":"mock provider detail"}}');
        }
      }
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(messages)) } }] }));
    });
  })
  .listen(Number(process.env.MOCK_PORT ?? 4110), '127.0.0.1');
