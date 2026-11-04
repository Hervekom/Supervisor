// Stands in for an OpenAI-compatible provider. It never calls the network.
import http from 'node:http';

function reply(messages) {
  const system = messages[0]?.content ?? '';
  const user = messages[1]?.content ?? '';
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
