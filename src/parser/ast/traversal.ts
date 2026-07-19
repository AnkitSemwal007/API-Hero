import {
  AstNodeType,
  type ApiDocument,
  type ArrayLiteralNode,
  type AstNode,
  type BinaryBodyNode,
  type BooleanLiteralNode,
  type CommentNode,
  type DirectiveNode,
  type HeaderNode,
  type JsonBodyNode,
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

/** Optional callbacks invoked by {@link AstWalker} in depth-first order. */
export interface AstVisitor {
  enterNode?(node: AstNode): void;
  leaveNode?(node: AstNode): void;
  visitDocument?(node: ApiDocument): void;
  visitRequest?(node: RequestNode): void;
  visitHeader?(node: HeaderNode): void;
  visitDirective?(node: DirectiveNode): void;
  visitJsonBody?(node: JsonBodyNode): void;
  visitRawBody?(node: RawBodyNode): void;
  visitTextBody?(node: TextBodyNode): void;
  visitMultipartBody?(node: MultipartBodyNode): void;
  visitBinaryBody?(node: BinaryBodyNode): void;
  visitVariable?(node: VariableNode): void;
  visitComment?(node: CommentNode): void;
  visitStringLiteral?(node: StringLiteralNode): void;
  visitNumberLiteral?(node: NumberLiteralNode): void;
  visitBooleanLiteral?(node: BooleanLiteralNode): void;
  visitNullLiteral?(node: NullLiteralNode): void;
  visitArrayLiteral?(node: ArrayLiteralNode): void;
  visitObjectLiteral?(node: ObjectLiteralNode): void;
  visitObjectProperty?(node: ObjectPropertyNode): void;
}

/** Framework-independent, depth-first AST walker. */
export class AstWalker {
  public walk(root: AstNode, visitor: AstVisitor): void {
    visitor.enterNode?.(root);
    this.visitTyped(root, visitor);
    for (const child of root.children) {
      this.walk(child, visitor);
    }
    visitor.leaveNode?.(root);
  }

  private visitTyped(node: AstNode, visitor: AstVisitor): void {
    switch (node.type) {
      case AstNodeType.Document:
        visitor.visitDocument?.(node);
        break;
      case AstNodeType.Request:
        visitor.visitRequest?.(node);
        break;
      case AstNodeType.Header:
        visitor.visitHeader?.(node);
        break;
      case AstNodeType.Directive:
        visitor.visitDirective?.(node);
        break;
      case AstNodeType.JsonBody:
        visitor.visitJsonBody?.(node);
        break;
      case AstNodeType.RawBody:
        visitor.visitRawBody?.(node);
        break;
      case AstNodeType.TextBody:
        visitor.visitTextBody?.(node);
        break;
      case AstNodeType.MultipartBody:
        visitor.visitMultipartBody?.(node);
        break;
      case AstNodeType.BinaryBody:
        visitor.visitBinaryBody?.(node);
        break;
      case AstNodeType.Variable:
        visitor.visitVariable?.(node);
        break;
      case AstNodeType.Comment:
        visitor.visitComment?.(node);
        break;
      case AstNodeType.StringLiteral:
        visitor.visitStringLiteral?.(node);
        break;
      case AstNodeType.NumberLiteral:
        visitor.visitNumberLiteral?.(node);
        break;
      case AstNodeType.BooleanLiteral:
        visitor.visitBooleanLiteral?.(node);
        break;
      case AstNodeType.NullLiteral:
        visitor.visitNullLiteral?.(node);
        break;
      case AstNodeType.ArrayLiteral:
        visitor.visitArrayLiteral?.(node);
        break;
      case AstNodeType.ObjectLiteral:
        visitor.visitObjectLiteral?.(node);
        break;
      case AstNodeType.ObjectProperty:
        visitor.visitObjectProperty?.(node);
        break;
    }
  }
}

export function walkAst(root: AstNode, visitor: AstVisitor): void {
  new AstWalker().walk(root, visitor);
}

/** Finds all nodes in a subtree, including the root when it matches. */
export function findAstNodes<T extends AstNode>(
  root: AstNode,
  predicate: (node: AstNode) => node is T,
): readonly T[];
export function findAstNodes(
  root: AstNode,
  predicate: (node: AstNode) => boolean,
): readonly AstNode[];
export function findAstNodes(
  root: AstNode,
  predicate: (node: AstNode) => boolean,
): readonly AstNode[] {
  const matches: AstNode[] = [];
  walkAst(root, {
    enterNode(node) {
      if (predicate(node)) {
        matches.push(node);
      }
    },
  });
  return Object.freeze(matches);
}

/** Returns parents from the immediate parent through the document root. */
export function getAstAncestors(node: AstNode): readonly AstNode[] {
  const ancestors: AstNode[] = [];
  let current = node.parent;
  while (current !== undefined) {
    ancestors.push(current);
    current = current.parent;
  }
  return Object.freeze(ancestors);
}
