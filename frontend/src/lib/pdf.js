// Pull the text out of a T&C PDF in the browser. Loaded on demand, since PDF.js is
// large and most sessions never need it.
const MAX_CHARS = 60000

export async function extractPdfText(file) {
  const [pdfjsLib, workerUrl] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.default
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent()
    pages.push(content.items.map((x) => x.str + (x.hasEOL ? '\n' : ' ')).join(''))
  }
  return pages.join('\n').replace(/[ \t]+/g, ' ').trim().slice(0, MAX_CHARS)
}
