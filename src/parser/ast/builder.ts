import type { Position, Range } from '../types';
import {
  AstNodeType,
  type ApiDocument,
  type ApiHttpMethod,
  type ArrayLiteralNode,
  type AstDiagnostic,
  type AstDiagnosticRelatedInformation,
  type AstDiagnosticSeverity,
  type AstMetadata,
  type BinaryBodyNode,
  type BodyNode,
  type BooleanLiteralNode,
  type CommentNode,
  type CommentStyle,
  type DirectiveNode,
  type HeaderNode,
  type JsonBodyNode,
  type KnownDirectiveName,
  type LiteralNode,
  type MultipartBodyNode,
  type NullLiteralNode,
  type NumberLiteralNode,
  type ObjectLiteralNode,
  type ObjectPropertyNode,
  type RawBodyNode,
  type RequestNode,
  type StringLiteralNode,
  type TextBodyNode,
  type VariableNode,
} from './models';
import {
  createFrozenLocation,
  createImmutableNode,
  type NodeContext,
} from './node-internals';

export interface AstNodeOptions {
  readonly range: Range;
  readonly metadata?: AstMetadata;
  readonly diagnostics?: readonly AstDiagnostic[];
}

export interface DocumentOptions extends AstNodeOptions {
  readonly requests?: readonly RequestNode[];
  readonly directives?: readonly DirectiveNode[];
  readonly comments?: readonly CommentNode[];
}

export interface RequestOptions extends AstNodeOptions {
  readonly method: ApiHttpMethod;
  readonly url: string;
  readonly headers?: readonly HeaderNode[];
  readonly body?: BodyNode;
  readonly directives?: readonly DirectiveNode[];
  readonly variables?: readonly VariableNode[];
  readonly comments?: readonly CommentNode[];
}

export interface DirectiveOptions extends AstNodeOptions {
  readonly name: string;
  readonly knownName?: KnownDirectiveName;
  readonly value?: string;
  readonly variables?: readonly VariableNode[];
}

export interface TextualBodyOptions extends AstNodeOptions {
  readonly content: string;
  readonly variables?: readonly VariableNode[];
}

export interface DiagnosticOptions {
  readonly code: string;
  readonly message: string;
  readonly severity: AstDiagnosticSeverity;
  readonly range: Range;
  readonly source?: string;
  readonly relatedInformation?: readonly AstDiagnosticRelatedInformation[];
}

/** Creates a zero-based UTF-16 source position. */
export function position(offset: number, line = 0, column = offset): Position {
  return Object.freeze({ offset, line, column });
}

/** Creates a half-open range. Offset-only ranges are convenient in tests. */
export function range(startOffset: number, endOffset: number): Range {
  return Object.freeze({
    start: position(startOffset),
    end: position(endOffset),
  });
}

/**
 * Compact factory for immutable AST nodes.
 *
 * Composite factories attach non-enumerable parent links to their immediate
 * children while preserving serializability.
 */
export class AstBuilder {
  public constructor(public readonly sourceId?: string) {}

  public diagnostic(options: DiagnosticOptions): AstDiagnostic {
    const { range: frozenRange, location } = createFrozenLocation(
      options.range,
      this.sourceId,
    );
    const relatedInformation = options.relatedInformation?.map((item) =>
      Object.freeze({
        message: item.message,
        location: createFrozenLocation(
          item.location.range,
          item.location.sourceId,
        ).location,
      }),
    );
    return Object.freeze({
      ...options,
      range: frozenRange,
      location,
      relatedInformation:
        relatedInformation === undefined
          ? undefined
          : Object.freeze(relatedInformation),
    });
  }

  public document(options: DocumentOptions): ApiDocument {
    const requests = this.list(options.requests);
    const directives = this.list(options.directives);
    const comments = this.list(options.comments);
    return createImmutableNode(
      AstNodeType.Document,
      this.context(options),
      [...directives, ...comments, ...requests],
      { sourceId: this.sourceId, requests, directives, comments },
    );
  }

  public request(options: RequestOptions): RequestNode {
    const headers = this.list(options.headers);
    const directives = this.list(options.directives);
    const variables = this.list(options.variables);
    const comments = this.list(options.comments);
    const bodyChildren = options.body === undefined ? [] : [options.body];
    return createImmutableNode(
      AstNodeType.Request,
      this.context(options),
      [...directives, ...comments, ...headers, ...variables, ...bodyChildren],
      {
        method: options.method,
        url: options.url,
        headers,
        body: options.body,
        directives,
        variables,
        comments,
      },
    );
  }

  public header(
    name: string,
    value: string,
    options: AstNodeOptions,
  ): HeaderNode {
    return createImmutableNode(
      AstNodeType.Header,
      this.context(options),
      [],
      { name, value },
    );
  }

  public directive(options: DirectiveOptions): DirectiveNode {
    const variables = this.list(options.variables);
    return createImmutableNode(
      AstNodeType.Directive,
      this.context(options),
      variables,
      {
        name: options.name,
        knownName: options.knownName,
        value: options.value ?? '',
        variables,
      },
    );
  }

  public jsonBody(
    value: LiteralNode,
    options: AstNodeOptions,
  ): JsonBodyNode {
    return createImmutableNode(
      AstNodeType.JsonBody,
      this.context(options),
      [value],
      { value },
    );
  }

  public rawBody(options: TextualBodyOptions): RawBodyNode {
    const variables = this.list(options.variables);
    return createImmutableNode(
      AstNodeType.RawBody,
      this.context(options),
      variables,
      { content: options.content, variables },
    );
  }

  public textBody(options: TextualBodyOptions): TextBodyNode {
    const variables = this.list(options.variables);
    return createImmutableNode(
      AstNodeType.TextBody,
      this.context(options),
      variables,
      { content: options.content, variables },
    );
  }

  public multipartBody(
    content: string,
    options: AstNodeOptions,
  ): MultipartBodyNode {
    return createImmutableNode(
      AstNodeType.MultipartBody,
      this.context(options),
      [],
      { content },
    );
  }

  public binaryBody(
    content: string,
    options: AstNodeOptions,
  ): BinaryBodyNode {
    return createImmutableNode(
      AstNodeType.BinaryBody,
      this.context(options),
      [],
      { content },
    );
  }

  public variable(
    originalText: string,
    name: string,
    options: AstNodeOptions,
  ): VariableNode {
    return createImmutableNode(
      AstNodeType.Variable,
      this.context(options),
      [],
      { originalText, name },
    );
  }

  public comment(
    originalText: string,
    text: string,
    style: CommentStyle,
    options: AstNodeOptions,
  ): CommentNode {
    return createImmutableNode(
      AstNodeType.Comment,
      this.context(options),
      [],
      { originalText, text, style },
    );
  }

  public stringLiteral(
    value: string,
    raw: string,
    options: AstNodeOptions,
  ): StringLiteralNode {
    return createImmutableNode(
      AstNodeType.StringLiteral,
      this.context(options),
      [],
      { value, raw },
    );
  }

  public numberLiteral(
    value: number,
    raw: string,
    options: AstNodeOptions,
  ): NumberLiteralNode {
    return createImmutableNode(
      AstNodeType.NumberLiteral,
      this.context(options),
      [],
      { value, raw },
    );
  }

  public booleanLiteral(
    value: boolean,
    raw: string,
    options: AstNodeOptions,
  ): BooleanLiteralNode {
    return createImmutableNode(
      AstNodeType.BooleanLiteral,
      this.context(options),
      [],
      { value, raw },
    );
  }

  public nullLiteral(
    raw: string,
    options: AstNodeOptions,
  ): NullLiteralNode {
    return createImmutableNode(
      AstNodeType.NullLiteral,
      this.context(options),
      [],
      { value: null, raw },
    );
  }

  public arrayLiteral(
    elements: readonly LiteralNode[],
    raw: string,
    options: AstNodeOptions,
  ): ArrayLiteralNode {
    const frozenElements = this.list(elements);
    return createImmutableNode(
      AstNodeType.ArrayLiteral,
      this.context(options),
      frozenElements,
      { elements: frozenElements, raw },
    );
  }

  public objectProperty(
    key: StringLiteralNode,
    value: LiteralNode,
    options: AstNodeOptions,
  ): ObjectPropertyNode {
    return createImmutableNode(
      AstNodeType.ObjectProperty,
      this.context(options),
      [key, value],
      { key, value },
    );
  }

  public objectLiteral(
    properties: readonly ObjectPropertyNode[],
    raw: string,
    options: AstNodeOptions,
  ): ObjectLiteralNode {
    const frozenProperties = this.list(properties);
    return createImmutableNode(
      AstNodeType.ObjectLiteral,
      this.context(options),
      frozenProperties,
      { properties: frozenProperties, raw },
    );
  }

  private context(options: AstNodeOptions): NodeContext {
    return {
      range: options.range,
      sourceId: this.sourceId,
      metadata: options.metadata,
      diagnostics: options.diagnostics,
    };
  }

  private list<T>(values: readonly T[] | undefined): readonly T[] {
    return Object.freeze([...(values ?? [])]);
  }

}
