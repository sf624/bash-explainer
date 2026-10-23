/**
 * What an example runner (or an explainer of an embedded language) throws for an input it does not model: no example
 * is shown then. Each runner has its own subclass, so that it catches only its own; anything else that is thrown is a
 * bug, which a catch lets through.
 */
export class Unsupported extends Error {}
