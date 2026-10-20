/**
 * Helpers for walking the tree that fast-xml-parser builds with
 * `ignoreAttributes: false` and the `@_` attribute prefix.
 *
 * The tree has no parent links, so a search returns the path to the element
 * found, from which its ancestors can be read. An element with neither
 * attributes nor child elements is a plain string in the tree; these helpers
 * skip it, as it carries nothing they look for.
 */

export interface TreeElement {
  tag: string;
  node: Record<string, any>;
}

/** The element's child elements. */
export function childElements(node: Record<string, any>): TreeElement[] {
  const children: TreeElement[] = [];
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const value = node[key];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== null && typeof item === 'object') children.push({ tag: key, node: item });
    }
  }
  return children;
}

/** The element and all the elements inside it. */
export function* descendantsOrSelf(element: TreeElement): Generator<TreeElement> {
  yield element;
  for (const child of childElements(element.node)) yield* descendantsOrSelf(child);
}

/**
 * The path from `root` to the first element that passes `test`, both
 * included, or undefined if none does. Elements whose tag is in `skip` are
 * not searched.
 */
export function pathTo(
  root: TreeElement,
  test: (element: TreeElement) => boolean,
  skip: ReadonlySet<string> = new Set()
): TreeElement[] | undefined {
  if (test(root)) return [root];
  for (const child of childElements(root.node)) {
    if (skip.has(child.tag)) continue;
    const rest = pathTo(child, test, skip);
    if (rest) return [root, ...rest];
  }
  return undefined;
}

/** Whether the element carries the attribute, whatever its value. */
export function hasAttribute(element: TreeElement, name: string): boolean {
  return `@_${name}` in element.node;
}

/** The attribute's value, if the element carries it. */
export function attribute(element: TreeElement, name: string): string | undefined {
  const value = element.node[`@_${name}`];
  return value === undefined ? undefined : String(value);
}

/**
 * A list-valued attribute's tokens, split on XML whitespace as XPath's
 * contains-token splits them. The tree keeps tabs and newlines in attribute
 * values, where XML attribute normalisation would turn them into spaces.
 */
export function tokens(value: string | undefined): string[] {
  return value === undefined ? [] : value.split(/[ \t\r\n]+/).filter(Boolean);
}
