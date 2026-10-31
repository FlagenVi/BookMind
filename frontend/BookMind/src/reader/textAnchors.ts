import type { BookSection } from '../api/books'

export type ProgressAnchor = {
  positionOffset: number
  sectionNumber: number | null
  sectionOffset: number
}

export function anchorFromOffset(
  offset: number,
  sections: BookSection[],
  textLength: number,
): ProgressAnchor {
  const positionOffset = Math.max(0, Math.min(textLength, offset))
  const section = sectionForOffset(sections, positionOffset)
  return {
    positionOffset,
    sectionNumber: section?.number ?? null,
    sectionOffset: section
      ? Math.max(
          0,
          Math.min(
            section.endOffset - section.startOffset,
            positionOffset - section.startOffset,
          ),
        )
      : positionOffset,
  }
}

export function offsetFromAnchor(
  anchor: ProgressAnchor,
  sections: BookSection[],
  textLength: number,
) {
  const section = sections.find((item) => item.number === anchor.sectionNumber)
  if (!section) return Math.max(0, Math.min(textLength, anchor.positionOffset))
  return Math.max(
    section.startOffset,
    Math.min(section.endOffset, section.startOffset + anchor.sectionOffset),
  )
}

export function sectionForOffset(sections: BookSection[], offset: number) {
  return (
    sections.find(
      (item, index) =>
        offset >= item.startOffset &&
        (offset < item.endOffset || index === sections.length - 1),
    ) ?? sections.findLast((item) => offset >= item.startOffset)
  )
}

function textPoint(root: HTMLElement, requestedOffset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(0, requestedOffset)
  let node = walker.nextNode() as Text | null
  let last: Text | null = null
  while (node) {
    last = node
    if (remaining <= node.data.length) return { node, offset: remaining }
    remaining -= node.data.length
    node = walker.nextNode() as Text | null
  }
  return last ? { node: last, offset: last.data.length } : null
}

export function textRectAtOffset(root: HTMLElement, offset: number) {
  const point = textPoint(root, offset)
  if (!point) return root.getBoundingClientRect()
  const range = document.createRange()
  const character = Math.min(point.offset, point.node.data.length)
  range.setStart(point.node, character)
  range.collapse(true)
  let rect = range.getClientRects()[0] ?? range.getBoundingClientRect()
  if (!rect.height && point.node.data.length) {
    range.setStart(point.node, Math.max(0, character - 1))
    range.setEnd(point.node, Math.min(point.node.data.length, character + 1))
    rect = range.getBoundingClientRect()
  }
  return rect
}

export function localOffsetAtY(
  root: HTMLElement,
  targetY: number,
  length: number,
) {
  if (length <= 0) return 0
  if (targetY <= textRectAtOffset(root, 0).top) return 0
  const documentWithCaret = root.ownerDocument as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const x = root.getBoundingClientRect().left + 2
  const caret = documentWithCaret.caretPositionFromPoint?.(x, targetY)
  const fallbackRange = documentWithCaret.caretRangeFromPoint?.(x, targetY)
  const node = caret?.offsetNode ?? fallbackRange?.startContainer
  const offset = caret?.offset ?? fallbackRange?.startOffset
  if (node && offset !== undefined && root.contains(node)) {
    const prefix = root.ownerDocument.createRange()
    prefix.selectNodeContents(root)
    prefix.setEnd(node, offset)
    return Math.max(0, Math.min(length, prefix.toString().length))
  }
  let low = 0
  let high = length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (textRectAtOffset(root, middle).top < targetY) low = middle + 1
    else high = middle
  }
  return Math.max(0, Math.min(length, low - 1))
}
