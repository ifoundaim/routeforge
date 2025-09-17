export type KeyEventLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

export function isModKey(event: KeyEventLike): boolean {
  return Boolean(event.metaKey || event.ctrlKey)
}

export function isPlainEnter(event: KeyEventLike): boolean {
  return event.key === 'Enter' && !event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey
}

export function isModEnter(event: KeyEventLike): boolean {
  return event.key === 'Enter' && isModKey(event)
}

export function isEscapeKey(event: KeyEventLike): boolean {
  return event.key === 'Escape'
}

export function isEditableTarget(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement {
  if (!target || !(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return true
  const role = target.getAttribute('role')
  if (role === 'textbox' || role === 'combobox') return true
  const contentEditable = target.getAttribute('contenteditable')
  return Boolean(contentEditable && contentEditable !== 'false')
}

export function isMultilineInput(target: EventTarget | null): target is HTMLTextAreaElement {
  if (!target || !(target instanceof HTMLElement)) return false
  return target.tagName === 'TEXTAREA' || target.getAttribute('role') === 'textbox' && target.getAttribute('aria-multiline') === 'true'
}
