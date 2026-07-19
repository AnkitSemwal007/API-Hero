import type { Location, Position, Range, Span } from '../types';
import type {
  AstDiagnostic,
  AstMetadata,
  AstNode,
  AstNodeBase,
  AstNodeType,
} from './models';

const parents = new WeakMap<AstNode, AstNode>();

type AstNodeOfType<T extends AstNodeType> = Extract<AstNode, { type: T }>;
type AstNodeProperties<T extends AstNodeType> = Omit<
  AstNodeOfType<T>,
  keyof AstNodeBase
>;

export interface NodeContext {
  readonly range: Range;
  readonly sourceId?: string;
  readonly metadata?: AstMetadata;
  readonly diagnostics?: readonly AstDiagnostic[];
}

export function createImmutableNode<T extends AstNodeType>(
  type: T,
  context: NodeContext,
  children: readonly AstNode[],
  properties: AstNodeProperties<T>,
): AstNodeOfType<T> {
  const { range, location } = createFrozenLocation(
    context.range,
    context.sourceId,
  );
  const node = {
    type,
    range,
    location,
    children: Object.freeze([...children]),
    metadata: Object.freeze({ ...(context.metadata ?? {}) }),
    diagnostics: Object.freeze(
      (context.diagnostics ?? []).map(freezeDiagnostic),
    ),
    ...properties,
  } as AstNodeOfType<T>;

  Object.defineProperty(node, 'parent', {
    enumerable: false,
    configurable: false,
    get: () => parents.get(node),
  });

  Object.freeze(node);
  attachChildParents(node);
  return node;
}

function freezeDiagnostic(diagnostic: AstDiagnostic): AstDiagnostic {
  const { range, location } = createFrozenLocation(
    diagnostic.range,
    diagnostic.location.sourceId,
  );
  return Object.freeze({ ...diagnostic, range, location });
}

export function createFrozenLocation(
  sourceRange: Range,
  sourceId?: string,
): { readonly range: Range; readonly location: Location } {
  const range = freezeRange(sourceRange);
  const span: Span = Object.freeze({
    offset: range.start.offset,
    length: range.end.offset - range.start.offset,
  });
  const location: Location = Object.freeze(
    sourceId === undefined
      ? { range, span }
      : { sourceId, range, span },
  );
  return { range, location };
}

function freezeRange(range: Range): Range {
  return Object.freeze({
    start: freezePosition(range.start),
    end: freezePosition(range.end),
  });
}

function freezePosition(position: Position): Position {
  return Object.freeze({ ...position });
}

function attachChildParents(parent: AstNode): void {
  for (const child of parent.children) {
    const existingParent = parents.get(child);
    if (existingParent !== undefined && existingParent !== parent) {
      throw new Error('An AST node cannot belong to more than one parent.');
    }
    parents.set(child, parent);
  }
}
