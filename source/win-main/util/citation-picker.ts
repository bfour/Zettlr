export interface CitationPickerResult {
  citekey: string
  title: string
  authors: string
  year: string
}

export interface CitationPickerQuery {
  text?: string
  author?: string
  year?: string
  title?: string
}

function textValue (value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatNames (value: unknown): string {
  if (!Array.isArray(value)) {
    return ''
  }

  return value.map((name: unknown) => {
    if (typeof name !== 'object' || name === null) {
      return ''
    }

    const fields = name as Record<string, unknown>
    return textValue(fields.literal) || [
      fields.given,
      fields['dropping-particle'],
      fields['non-dropping-particle'],
      fields.family,
      fields.suffix
    ].map(textValue).filter(Boolean).join(' ')
  }).filter(Boolean).join(', ')
}

function publicationYear (value: unknown): string {
  if (typeof value !== 'object' || value === null) {
    return ''
  }

  const issued = value as Record<string, unknown>
  const parts = issued['date-parts']
  if (Array.isArray(parts) && Array.isArray(parts[0])) {
    const year: unknown = parts[0][0]
    if (typeof year === 'number' && Number.isFinite(year)) {
      return String(year)
    }
    if (textValue(year) !== '') {
      return textValue(year)
    }
  }

  const date = textValue(issued.literal) || textValue(issued.raw)
  return /\b\d{4}\b/.exec(date)?.[0] ?? date
}

export function toCitationPickerResult (item: CSLItem): CitationPickerResult {
  return {
    citekey: String(item.id),
    title: textValue(item.title) || textValue(item['title-short']) || textValue(item['container-title']),
    authors: formatNames(item.author) || formatNames(item.editor),
    year: publicationYear(item.issued)
  }
}

function normalize (value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function matches (terms: string[], value: string): boolean {
  if (terms.length === 0) {
    return true
  }

  const searchable = normalize(value)
  return terms.every(term => searchable.includes(term))
}

function searchTerms (value = ''): string[] {
  return normalize(value).split(' ').filter(Boolean)
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

export function searchCitations (
  citations: readonly CitationPickerResult[],
  query: CitationPickerQuery,
  used: ReadonlySet<string>
): CitationPickerResult[] {
  const text = searchTerms(query.text)
  const authors = searchTerms(query.author)
  const year = searchTerms(query.year)
  const title = searchTerms(query.title)

  return citations.filter(citation =>
    matches(text, `${citation.title} ${citation.authors} ${citation.year} ${citation.citekey}`) &&
    matches(authors, citation.authors) &&
    matches(year, citation.year) &&
    matches(title, citation.title)
  ).sort((a, b) =>
    Number(used.has(b.citekey)) - Number(used.has(a.citekey)) ||
    collator.compare(a.title || a.citekey, b.title || b.citekey) ||
    collator.compare(a.citekey, b.citekey)
  )
}
