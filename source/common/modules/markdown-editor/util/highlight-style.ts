export function isColoredHighlightStyle (style: string|undefined): boolean {
  return style !== undefined && /^background-color: #[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(style)
}
