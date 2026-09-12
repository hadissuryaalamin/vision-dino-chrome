export type AttributeValue = string | number | boolean | null | undefined;
export type Child = Node | string | null | undefined | false;

/** Creates an element: `class` sets className, `true` sets an empty attribute, nullish and false are skipped. */
export type ElementFactory = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes?: Readonly<Record<string, AttributeValue>> | null,
  ...children: Child[]
) => HTMLElementTagNameMap[K];

export function createElementFactory(doc: Document): ElementFactory {
  return (tag, attributes, ...children) => {
    const element = doc.createElement(tag);
    if (attributes) {
      for (const [name, value] of Object.entries(attributes)) {
        if (value === null || value === undefined || value === false) continue;
        if (name === "class") element.className = String(value);
        else element.setAttribute(name, value === true ? "" : String(value));
      }
    }
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      element.append(child);
    }
    return element;
  };
}

/** Write text only when it changed, so per-frame updates do not touch the DOM needlessly. */
export function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

export function setAttributeIfChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
