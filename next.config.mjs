// pdf.js loads its worker by a path the bundler cannot follow, so the routes that read PDFs name it here.
const PDF_WORKER = './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs';

export default {
  serverExternalPackages: ['pdfjs-dist'],
  outputFileTracingIncludes: {
    '/api/extract': [PDF_WORKER],
    '/api/profiles/import': [PDF_WORKER],
  },
};
