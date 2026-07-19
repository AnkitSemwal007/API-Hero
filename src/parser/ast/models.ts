import type { HttpMethod } from '../../types';
import type { Location, Range } from '../types';

/** Stable discriminants for every node in an API document AST. */
export enum AstNodeType {
  Document = 'Document',
  Request = 'Request',
  Header = 'Header',
  Directive = 'Directive',
  JsonBody = 'JsonBody',
  RawBody = 'RawBody',
  TextBody = 'TextBody',
  MultipartBody = 'MultipartBody',
  BinaryBody = 'BinaryBody',
  Variable = 'Variable',
  Comment = 'Comment',
  StringLiteral = 'StringLiteral',
  NumberLiteral = 'NumberLiteral',
  BooleanLiteral = 'BooleanLiteral',
  NullLiteral = 'NullLiteral',
  ArrayLiteral = 'ArrayLiteral',
  ObjectLiteral = 'ObjectLiteral',
  ObjectProperty = 'ObjectProperty',
}

export type AstDiagnosticSeverity =
  | 'error'
  | 'warning'
  | 'information'
  | 'hint';

/** A secondary source location that helps explain an AST diagnostic. */
export interface AstDiagnosticRelatedInformation {
  readonly message: string;
  readonly location: Location;
}

/** A framework-independent parser diagnostic attached to an AST node. */
export interface AstDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: AstDiagnosticSeverity;
  readonly range: Range;
  readonly location: Location;
  readonly source?: string;
  readonly relatedInformation?: readonly AstDiagnosticRelatedInformation[];
}

/**
 * JSON-compatible, acyclic parser metadata.
 *
 * Node construction copies and freezes only the top-level metadata object.
 * Callers retain responsibility for nested values and for avoiding cycles.
 */
export type AstMetadata = Readonly<Record<string, unknown>>;

/** Properties shared by every AST node. */
export interface AstNodeBase {
  readonly type: AstNodeType;
  readonly range: Range;
  readonly location: Location;
  /**
   * The containing node, when parent links have been attached.
   *
   * Implementations keep this property non-enumerable so JSON serialization
   * cannot introduce a cycle.
   */
  readonly parent?: AstNode;
  readonly children: readonly AstNode[];
  readonly metadata: AstMetadata;
  readonly diagnostics: readonly AstDiagnostic[];
}

/** Parser-facing compatibility name for the shared HTTP method contract. */
export type ApiHttpMethod = HttpMethod;

/**
 * Canonical parsed representation of an API source document.
 *
 * All future parser-backed features must consume this rich AST rather than
 * introducing a parallel document, request, line-analysis, or syntax model.
 * Obtain instances through `parseApiDocument` from the parser public API.
 */
export interface ApiDocument extends AstNodeBase {
  readonly type: AstNodeType.Document;
  readonly sourceId?: string;
  readonly requests: readonly RequestNode[];
  readonly directives: readonly DirectiveNode[];
  readonly comments: readonly CommentNode[];
}

export interface RequestNode extends AstNodeBase {
  readonly type: AstNodeType.Request;
  readonly method: ApiHttpMethod;
  readonly url: string;
  readonly headers: readonly HeaderNode[];
  readonly body?: BodyNode;
  readonly directives: readonly DirectiveNode[];
  readonly variables: readonly VariableNode[];
  readonly comments: readonly CommentNode[];
}

export interface HeaderNode extends AstNodeBase {
  readonly type: AstNodeType.Header;
  readonly name: string;
  readonly value: string;
}

export const KNOWN_DIRECTIVE_NAMES = [
  'connection',
  'auth',
  'timeout',
  'name',
  'description',
  'tag',
  'variable',
  'sensitive-variable',
] as const;

export type KnownDirectiveName = (typeof KNOWN_DIRECTIVE_NAMES)[number];

export interface DirectiveNode extends AstNodeBase {
  readonly type: AstNodeType.Directive;
  /** Directive name exactly as supplied by the parser or caller. */
  readonly name: string;
  /** Explicit semantic classification, when supplied by the parser or caller. */
  readonly knownName?: KnownDirectiveName;
  readonly value: string;
  readonly variables: readonly VariableNode[];
}

export interface JsonBodyNode extends AstNodeBase {
  readonly type: AstNodeType.JsonBody;
  readonly value: LiteralNode;
}

export interface RawBodyNode extends AstNodeBase {
  readonly type: AstNodeType.RawBody;
  readonly content: string;
  readonly variables: readonly VariableNode[];
}

export interface TextBodyNode extends AstNodeBase {
  readonly type: AstNodeType.TextBody;
  readonly content: string;
  readonly variables: readonly VariableNode[];
}

/** Reserved AST shape for multipart parsing in a later prompt. */
export interface MultipartBodyNode extends AstNodeBase {
  readonly type: AstNodeType.MultipartBody;
  readonly content: string;
}

/** Reserved AST shape for binary body parsing and resolution in a later prompt. */
export interface BinaryBodyNode extends AstNodeBase {
  readonly type: AstNodeType.BinaryBody;
  readonly content: string;
}

export type BodyNode =
  | JsonBodyNode
  | RawBodyNode
  | TextBodyNode
  | MultipartBodyNode
  | BinaryBodyNode;

export interface VariableNode extends AstNodeBase {
  readonly type: AstNodeType.Variable;
  readonly originalText: string;
  readonly name: string;
}

export type CommentStyle = '#' | '//';

export interface CommentNode extends AstNodeBase {
  readonly type: AstNodeType.Comment;
  readonly originalText: string;
  readonly text: string;
  readonly style: CommentStyle;
}

interface LiteralNodeBase extends AstNodeBase {
  readonly raw: string;
}

export interface StringLiteralNode extends LiteralNodeBase {
  readonly type: AstNodeType.StringLiteral;
  readonly value: string;
}

export interface NumberLiteralNode extends LiteralNodeBase {
  readonly type: AstNodeType.NumberLiteral;
  readonly value: number;
}

export interface BooleanLiteralNode extends LiteralNodeBase {
  readonly type: AstNodeType.BooleanLiteral;
  readonly value: boolean;
}

export interface NullLiteralNode extends LiteralNodeBase {
  readonly type: AstNodeType.NullLiteral;
  readonly value: null;
}

export interface ArrayLiteralNode extends LiteralNodeBase {
  readonly type: AstNodeType.ArrayLiteral;
  readonly elements: readonly LiteralNode[];
}

export interface ObjectLiteralNode extends LiteralNodeBase {
  readonly type: AstNodeType.ObjectLiteral;
  readonly properties: readonly ObjectPropertyNode[];
}

export interface ObjectPropertyNode extends AstNodeBase {
  readonly type: AstNodeType.ObjectProperty;
  readonly key: StringLiteralNode;
  readonly value: LiteralNode;
}

export type LiteralNode =
  | StringLiteralNode
  | NumberLiteralNode
  | BooleanLiteralNode
  | NullLiteralNode
  | ArrayLiteralNode
  | ObjectLiteralNode;

export type AstNode =
  | ApiDocument
  | RequestNode
  | HeaderNode
  | DirectiveNode
  | BodyNode
  | VariableNode
  | CommentNode
  | LiteralNode
  | ObjectPropertyNode;
